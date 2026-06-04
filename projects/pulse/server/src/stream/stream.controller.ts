import {
  Controller,
  Inject,
  type MessageEvent,
  Param,
  Req,
  Sse,
} from '@nestjs/common';
import {
  bufferTime,
  concat,
  EMPTY,
  filter,
  from,
  interval,
  map,
  merge,
  mergeMap,
  type Observable,
  of,
} from 'rxjs';

import { CurrentOwnerService, type OwnerRequest } from '../auth/current-owner';
import type { SseEvent } from '../lib/schemas/events';
import { EventsBridgeService } from './events-bridge.service';
import { PublicPageService } from './public-page.service';
import { redactForPublic } from './public-redaction';

/** The stream routes only need the inbound headers (cookie) + Last-Event-ID. */
type SessionRequest = OwnerRequest;

/** Heartbeat cadence (ADR-003): keeps the connection under the Fly edge idle
 * timeout (~60 s) and lets the client detect a dead link. */
const HEARTBEAT_INTERVAL_MS = 15_000;

/**
 * The two SSE routes (Task 3.1, ADR-003).
 *
 * Both routes are `@Sse()` handlers returning `Observable<MessageEvent>`. Nest
 * pipes the observable into the response as `text/event-stream` and sets the
 * SSE headers itself (`Content-Type: text/event-stream`, `Connection:
 * keep-alive`, `Cache-Control: no-cache`, and `X-Accel-Buffering: no` to
 * disable proxy/NGINX buffering). The `MessageEvent.id` we set becomes the SSE
 * `id:` line, which the browser echoes back as `Last-Event-ID` on reconnect.
 *
 * Routing: the controller base is `api`, so these resolve to
 * `GET /api/stream` and `GET /api/public/:slug/stream`. The base is scoped to
 * this controller (not a global prefix) so the Phase 1/2 `/health` + `/monitors`
 * routes keep their established paths.
 */
@Controller('api')
export class StreamController {
  constructor(
    @Inject(EventsBridgeService) private readonly bridge: EventsBridgeService,
    @Inject(PublicPageService) private readonly publicPages: PublicPageService,
    @Inject(CurrentOwnerService) private readonly currentOwner: CurrentOwnerService,
  ) {}

  /**
   * Authenticated dashboard stream — scoped to the current user's
   * `dashboard:<userId>` events (ADR-003).
   *
   * AUTH (ADR-007): `currentOwner.resolveOwnerUserId(req)` reads the better-auth
   * session cookie (the `EventSource` sends it via `withCredentials: true`) — an
   * authenticated user gets THEIR `dashboard:<userId>` scope (their own
   * monitors' events); an anonymous visitor falls back to the seeded demo owner,
   * so the demo board streams live without a login wall. The scope matches what
   * the worker publishes (`dashboard:<ownerUserId>`), so live events route
   * correctly. The dashboard stream is a READ, so the demo fallback is correct
   * here (the WRITE endpoints are the ones gated).
   *
   * Pipeline: replay any missed buffered events (Last-Event-ID) -> then live
   * events filtered to this scope, with `check.result` coalesced per monitor to
   * bound a slow consumer's burst -> merged with a 15 s heartbeat.
   */
  @Sse('stream')
  async dashboardStream(@Req() req: SessionRequest): Promise<Observable<MessageEvent>> {
    const userId = await this.currentOwner.resolveOwnerUserId(req);
    const scope = `dashboard:${userId}`;
    const lastEventId = parseLastEventId(req);

    // Replay first (oldest-first), then live. `concat` guarantees the replayed
    // events flush before the live subscription's output interleaves.
    const replay$ = from(this.bridge.replayAfter(scope, lastEventId));
    const live$ = this.bridge.events$.pipe(
      // Only this user's events. The dashboard sees EVERYTHING about its own
      // monitors (incl. raw check.result + alert.fired) — it is the private
      // surface; the public route is the one that redacts.
      filterByScope(scope),
    );

    const domain$ = concat(replay$, coalesceCheckResults(live$));

    return merge(domain$.pipe(map(toMessageEvent)), heartbeat$());
  }

  /**
   * Unauthenticated public stream — re-scoped to a status page's published
   * monitor set (`public:<pageId>`), exposing STRICTLY LESS (ADR-003).
   *
   * It carries ONLY `status.change` / `incident.open` / `incident.close` for the
   * page's public monitors — NEVER `check.result` (raw response times) or
   * `alert.fired` (the owner's alerting). The `redactForPublic` chokepoint runs
   * on BOTH the replay and the live path, so no event type or monitor outside
   * the published set can reach an anonymous viewer by any path.
   */
  @Sse('public/:slug/stream')
  async publicStream(
    @Param('slug') slug: string,
    @Req() req: SessionRequest,
  ): Promise<Observable<MessageEvent>> {
    const { pageId, monitorIds } = await this.publicPages.resolveBySlug(slug);
    const sourceScope = await this.dashboardScopeForPage(pageId);
    const lastEventId = parseLastEventId(req);

    // The ring buffer is keyed by the SOURCE scope (`dashboard:<ownerUserId>` —
    // what the worker published). Replay reads from there, then each event is
    // redacted + re-scoped to `public:<pageId>` (or dropped). The replay cursor
    // is the source envelope id, which is preserved across redaction.
    const replay$ = from(
      sourceScope
        ? this.bridge
            .replayAfter(sourceScope, lastEventId)
            .map((e) => redactForPublic(e, pageId, monitorIds))
            .filter((e): e is SseEvent => e !== null)
        : [],
    );

    const live$ = this.bridge.events$.pipe(
      mapAndFilter((e) => redactForPublic(e, pageId, monitorIds)),
    );

    const domain$ = concat(replay$, live$);

    return merge(domain$.pipe(map(toMessageEvent)), heartbeat$());
  }

  /**
   * The source scope (`dashboard:<ownerUserId>`) the worker publishes a page's
   * monitor events under — needed to read the right ring buffer for public
   * replay. v1 is single-owner, so every public monitor belongs to the one
   * demo owner; we resolve it the same way the dashboard route does.
   *
   * (When v1 grows to multiple owners contributing to one public page, this
   * becomes a per-monitor owner lookup feeding multiple source scopes; the live
   * path already handles that because it filters the whole stream by monitor id,
   * independent of scope. The replay path is the only owner-coupled bit and is
   * the short, best-effort one.)
   */
  private async dashboardScopeForPage(pageId: string): Promise<string | null> {
    // Reuse the demo-user resolution (single owner in v1). `pageId` is accepted
    // for the future per-page owner lookup; unused today.
    void pageId;
    try {
      // The public replay reads the demo owner's ring (v1 single-owner). An
      // empty-headers request resolves to the demo owner via the seam.
      const userId = await this.currentOwner.resolveOwnerUserId({ headers: {} });
      return `dashboard:${userId}`;
    } catch {
      return null;
    }
  }
}

// ---------------------------------------------------------------------------
// RxJS pipeline helpers (small, local to the stream surface)
// ---------------------------------------------------------------------------

/** Read the reconnect cursor: `Last-Event-ID` header (browser EventSource sends
 * it automatically). Non-numeric / absent -> -1 (replay nothing extra). */
function parseLastEventId(req: SessionRequest): number {
  const raw = req.headers['last-event-id'];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (value === undefined) return -1;
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : -1;
}

/** Keep only events whose envelope scope matches exactly. */
function filterByScope(scope: string) {
  return filter((e: SseEvent) => e.scope === scope);
}

/** Map each event through a transform and drop the nulls (redaction). */
function mapAndFilter(fn: (e: SseEvent) => SseEvent | null) {
  return mergeMap((e: SseEvent): Observable<SseEvent> => {
    const out = fn(e);
    return out === null ? EMPTY : of(out);
  });
}

/**
 * Coalescing window (ms): bursts of `check.result` arriving within this window
 * are collapsed to the latest per monitor. Small enough that the board still
 * feels instant (a single probe result is emitted within 250 ms), large enough
 * to absorb a genuine flood. At portfolio probe rates most windows hold zero or
 * one event, so the common case has no added latency beyond the window flush.
 */
const COALESCE_WINDOW_MS = 250;

/**
 * Coalesce `check.result` events PER MONITOR within a short time window (ADR-003
 * backpressure): for each window, keep only the LATEST `check.result` per
 * monitor (a slow consumer drops intermediate response-time points — the chart
 * refetches its window anyway). `status.change` / `incident.*` / `alert.fired`
 * are NEVER coalesced — every one passes through in arrival order.
 */
function coalesceCheckResults(source: Observable<SseEvent>): Observable<SseEvent> {
  return source.pipe(
    bufferTime(COALESCE_WINDOW_MS),
    mergeMap((batch) => from(collapseBatch(batch))),
  );
}

/**
 * Collapse one time-window batch: drop any `check.result` that is superseded by
 * a LATER `check.result` for the same monitor in the same batch; keep all other
 * events untouched and in order. Pure + array-based so it is trivially correct.
 */
function collapseBatch(batch: SseEvent[]): SseEvent[] {
  // Find, per monitor, the index of the last check.result in the batch.
  const lastCheckIndexByMonitor = new Map<string, number>();
  batch.forEach((e, i) => {
    if (e.type === 'check.result') {
      lastCheckIndexByMonitor.set(e.payload.monitorId, i);
    }
  });
  return batch.filter((e, i) => {
    if (e.type !== 'check.result') return true;
    return lastCheckIndexByMonitor.get(e.payload.monitorId) === i;
  });
}

/** A 15 s heartbeat as a typed SSE `MessageEvent` (named `heartbeat`). */
function heartbeat$(): Observable<MessageEvent> {
  return interval(HEARTBEAT_INTERVAL_MS).pipe(
    map(
      (): MessageEvent => ({
        type: 'heartbeat',
        data: { ts: Date.now() },
      }),
    ),
  );
}

/**
 * Map a domain envelope to an SSE `MessageEvent`. The named-event `type`
 * becomes the SSE `event:` line (so the browser `addEventListener('check.result', …)`
 * works), the envelope `id` becomes the SSE `id:` line (the `Last-Event-ID`
 * cursor), and the full envelope is the JSON `data:` payload so the client can
 * narrow on `type` and read `scope`/`ts`.
 */
function toMessageEvent(event: SseEvent): MessageEvent {
  return {
    type: event.type,
    id: String(event.id),
    data: event,
  };
}
