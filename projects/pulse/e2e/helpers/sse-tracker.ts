import type { Page, Request } from '@playwright/test';

import { apiBaseUrl } from './env';

/**
 * Tracks the live-channel network so a spec can assert the success criterion:
 * the board is genuinely PUSHED over exactly ONE long-lived `text/event-stream`
 * connection on `/api/stream`, NOT a polling XHR loop (pulse PLAN.md success
 * criteria + AGENT_NOTES "genuinely pushed, not polled").
 *
 * It counts:
 *   - `streamRequests` — every request whose path is the dashboard SSE route
 *     `/api/stream`. There must be exactly one for a single mounted board (the
 *     EventSource opens once; a reconnect would be a NEW request, which is why
 *     a spec asserts within a settled window).
 *   - `monitorListPolls` — repeated `GET /monitors` requests. ONE initial fetch
 *     (+ optional reconcile refetches on reconnect) is expected; a steady stream
 *     of them on a fixed interval would betray polling-instead-of-SSE. A spec
 *     asserts the count stays small over an observation window.
 *
 * The matchers are origin-agnostic (they match on the path) so the tracker works
 * against the local split origin (:3080) and the deployed single-origin proxy.
 */
export interface SseTracker {
  readonly streamRequests: Request[];
  readonly publicStreamRequests: Request[];
  readonly monitorListPolls: Request[];
  /** All counted request URLs, for a readable failure message. */
  snapshot(): { stream: number; publicStream: number; monitorPolls: number };
}

const DASHBOARD_STREAM_RE = /\/api\/stream(\?|$)/;
const PUBLIC_STREAM_RE = /\/api\/public\/[^/]+\/stream(\?|$)/;
const MONITORS_LIST_RE = /\/monitors(\?|$)/;

export function trackSse(page: Page): SseTracker {
  const streamRequests: Request[] = [];
  const publicStreamRequests: Request[] = [];
  const monitorListPolls: Request[] = [];

  page.on('request', (req: Request) => {
    const url = req.url();
    if (DASHBOARD_STREAM_RE.test(url)) {
      streamRequests.push(req);
      return;
    }
    if (PUBLIC_STREAM_RE.test(url)) {
      publicStreamRequests.push(req);
      return;
    }
    // Only count the API monitor-list reads (not the Next route), so an
    // accidental match on a page path does not inflate the count.
    if (MONITORS_LIST_RE.test(url) && url.startsWith(apiBaseUrl())) {
      monitorListPolls.push(req);
    }
  });

  return {
    streamRequests,
    publicStreamRequests,
    monitorListPolls,
    snapshot() {
      return {
        stream: streamRequests.length,
        publicStream: publicStreamRequests.length,
        monitorPolls: monitorListPolls.length,
      };
    },
  };
}
