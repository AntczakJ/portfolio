/**
 * ReplayEngine — drives the chart store from the historic NDJSON
 * endpoint at a virtual-clock speed (Task 3.6).
 *
 * Lifecycle, top to bottom:
 *
 *   1. `enter(symbol, date)` — resets the stream store for a fresh
 *      replay session, then streams `/api/replay/:symbol/:date` (NDJSON
 *      cells) INCREMENTALLY: each line is parsed + grouped by `bucketTs`
 *      as it arrives, never awaiting the whole ~72K-line body. Bars are
 *      materialised lazily by the virtual clock, not on arrival.
 *
 *   2. The virtual clock advances `cursorMs` by `wallDeltaMs * speedX`
 *      on each `requestAnimationFrame` tick (or `setTimeout` step under
 *      reduced motion). When the cursor crosses a bar's close boundary
 *      (`bucketTs + BAR_DURATION_MS`), that bar is emitted to the store
 *      as a `replay.bar` frame (absolute totals → hard rebase).
 *
 *   3. `seek(cursorMs)` rebuilds the chart from scratch to that cursor:
 *      reset the store, re-emit every bar closed at-or-before the cursor,
 *      and refetch the bounded tick window. Play resumes forward from the
 *      cursor.
 *
 *   4. `setSpeed`, `play`, `pause`, `stop` map to the obvious clock
 *      operations. `stop` returns to session start (cursor 0) and pauses
 *      — leaving Replay mode is the separate `exit()` path.
 *
 *   5. `exit()` tears down (aborts in-flight fetches, cancels the clock).
 *
 * The engine writes the scrub position back to `useUiStore` as the clock
 * advances so the replay bar's slider tracks playback. It reads speed +
 * commanded position from `useUiStore` via the provider's subscription —
 * the engine itself is store-agnostic and takes plain callbacks/handles,
 * keeping it unit-testable without React.
 *
 * **Reduced motion.** When `prefersReducedMotion` is set, the smooth rAF
 * playback is replaced by discrete `setTimeout` steps of one bar each —
 * the chart jumps bar-to-bar instead of animating the cursor smoothly.
 */
import type { StoreApi } from 'zustand';

import {
  STREAM_RECENT_TICKS_CAP,
  type StreamState,
} from '@/lib/stores/stream-store';
import { streamNdjson, parseNdjsonLine } from './ndjson';
import {
  advanceCursor,
  barToReplayPayload,
  countClosedBars,
  type ReplayBar,
} from './virtual-clock';
import { computeTickWindow, dayStartMs } from './tick-window';
import type { ReplayCellRow, ReplayTickRow, WSTickPayload } from 'tape-server';

/** Upper bound of the scrub timeline — 24 h of UTC session time. */
export const REPLAY_DAY_MS = 86_400_000;

/** Tick-window refetch debounce — coalesce rapid scrub moves. */
const TICK_REFETCH_DEBOUNCE_MS = 120;

/** Discrete clock step under reduced motion — one bar per step (1 min). */
const REDUCED_MOTION_STEP_MS = 60_000;

/**
 * How the engine validates an NDJSON line into a typed row. The provider
 * supplies these (bound to the runtime Zod schemas from
 * `tape-server/replay-schemas`) so the engine stays dependency-light and
 * the schemas are not pinned into the engine's module graph for tests.
 */
export interface ReplayParsers {
  parseCell: (
    value: unknown,
  ) => { ok: true; value: ReplayCellRow } | { ok: false };
  parseTick: (
    value: unknown,
  ) => { ok: true; value: ReplayTickRow } | { ok: false };
}

export type ReplayLoadState =
  | 'idle'
  | 'loading'
  | 'ready'
  | 'empty'
  | 'error';

export interface ReplayEngineDeps {
  /** Base API URL, e.g. `http://localhost:3001`. */
  apiUrl: string;
  /** Canonical symbol for the replay URL, e.g. `BTCUSDT-PERP`. */
  symbol: string;
  /** The stream store this engine feeds. */
  streamStore: StoreApi<StreamState>;
  /** NDJSON line validators. */
  parsers: ReplayParsers;
  /** Reduced-motion flag — discrete stepping instead of smooth rAF. */
  prefersReducedMotion: boolean;
  /** Read the current playback speed multiplier. */
  getSpeedX: () => number;
  /** Write the cursor position back so the scrub slider tracks playback. */
  onCursorChange: (cursorMs: number) => void;
  /** Surface the load state for a calm empty / error UI. */
  onLoadState: (state: ReplayLoadState) => void;
  /** Surface the playing flag so the bar's play/pause button tracks it. */
  onPlayingChange?: (playing: boolean) => void;
  /** Injectable fetch + clock for tests. */
  fetchImpl?: typeof fetch;
  now?: () => number;
  scheduler?: {
    requestFrame: (cb: (now: number) => void) => number;
    cancelFrame: (handle: number) => void;
    setTimeout: (cb: () => void, ms: number) => unknown;
    clearTimeout: (handle: unknown) => void;
  };
}

const defaultScheduler: NonNullable<ReplayEngineDeps['scheduler']> = {
  requestFrame: (cb) => requestAnimationFrame(cb),
  cancelFrame: (handle) => {
    cancelAnimationFrame(handle);
  },
  setTimeout: (cb, ms) => globalThis.setTimeout(cb, ms),
  clearTimeout: (handle) => {
    globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>);
  },
};

export class ReplayEngine {
  readonly #deps: ReplayEngineDeps;
  readonly #fetch: typeof fetch;
  readonly #now: () => number;
  readonly #scheduler: NonNullable<ReplayEngineDeps['scheduler']>;

  #date = '';
  #dayStart = 0;
  /**
   * All grouped bars seen so far, kept sorted ascending by `bucketTs` via
   * binary insertion on ingest so the closed set is always a prefix and
   * late / out-of-order arrivals land in the right slot without a global
   * re-sort that would invalidate the emitted bookkeeping.
   */
  #bars: ReplayBar[] = [];
  /** Bar bucketTs values already emitted to the store at the cursor. */
  #emittedBuckets = new Set<number>();
  /** Fast lookup from bucketTs → bar for incremental ingest. */
  #barByBucket = new Map<number, ReplayBar>();
  #cursorMs = 0;
  #playing = false;
  #loadState: ReplayLoadState = 'idle';

  #cellAbort: AbortController | null = null;
  #tickAbort: AbortController | null = null;
  #frameHandle: number | null = null;
  #stepHandle: unknown = null;
  #tickDebounceHandle: unknown = null;
  #lastFrameMs = 0;

  constructor(deps: ReplayEngineDeps) {
    this.#deps = deps;
    this.#fetch = deps.fetchImpl ?? fetch.bind(globalThis);
    this.#now = deps.now ?? (() => performance.now());
    this.#scheduler = deps.scheduler ?? defaultScheduler;
  }

  get cursorMs(): number {
    return this.#cursorMs;
  }

  get loadState(): ReplayLoadState {
    return this.#loadState;
  }

  /**
   * Enter a replay session for `date` (YYYY-MM-DD). Resets the store,
   * starts streaming the day's cells, and begins playback from
   * `initialCursorMs` (default session start).
   */
  enter(date: string, initialCursorMs = 0): void {
    this.exit();
    this.#date = date;
    this.#dayStart = dayStartMs(date);
    this.#bars = [];
    this.#barByBucket.clear();
    this.#emittedBuckets.clear();
    this.#cursorMs = Math.max(0, Math.min(REPLAY_DAY_MS, initialCursorMs));
    this.#deps.streamStore.getState().resetSession();
    this.#deps.onCursorChange(this.#cursorMs);
    this.#setLoadState('loading');
    void this.#streamCells();
    void this.#refetchTickWindow();
    this.play();
  }

  /** Tear down — abort fetches, cancel the clock. Store is left as-is. */
  exit(): void {
    this.pause();
    this.#cellAbort?.abort();
    this.#cellAbort = null;
    this.#tickAbort?.abort();
    this.#tickAbort = null;
    if (this.#tickDebounceHandle !== null) {
      this.#scheduler.clearTimeout(this.#tickDebounceHandle);
      this.#tickDebounceHandle = null;
    }
    this.#bars = [];
    this.#barByBucket.clear();
    this.#emittedBuckets.clear();
    this.#setLoadState('idle');
  }

  play(): void {
    if (this.#playing) return;
    this.#playing = true;
    this.#deps.onPlayingChange?.(true);
    this.#lastFrameMs = this.#now();
    if (this.#deps.prefersReducedMotion) {
      this.#scheduleStep();
    } else {
      this.#scheduleFrame();
    }
  }

  pause(): void {
    const wasPlaying = this.#playing;
    this.#playing = false;
    if (this.#frameHandle !== null) {
      this.#scheduler.cancelFrame(this.#frameHandle);
      this.#frameHandle = null;
    }
    if (this.#stepHandle !== null) {
      this.#scheduler.clearTimeout(this.#stepHandle);
      this.#stepHandle = null;
    }
    if (wasPlaying) this.#deps.onPlayingChange?.(false);
  }

  /** Stop: return to session start and pause (stays in replay mode). */
  stop(): void {
    this.pause();
    this.seek(0);
  }

  get playing(): boolean {
    return this.#playing;
  }

  /**
   * Seek the virtual clock to `cursorMs`. Rebuilds the chart by resetting
   * the store and re-emitting every bar closed at-or-before the cursor,
   * then refetches the tick window. Playback state (playing / paused) is
   * preserved; if playing, the clock resumes forward from the cursor.
   */
  seek(cursorMs: number): void {
    const wasPlaying = this.#playing;
    this.pause();
    this.#cursorMs = Math.max(0, Math.min(REPLAY_DAY_MS, cursorMs));
    // Rebuild closed bars from scratch up to the cursor.
    this.#deps.streamStore.getState().resetSession();
    this.#emittedBuckets.clear();
    this.#emitClosedBarsUpTo(this.#cursorMs);
    this.#deps.onCursorChange(this.#cursorMs);
    this.#scheduleTickRefetch();
    if (wasPlaying) this.play();
  }

  /** Change speed mid-playback — the next clock tick uses the new value. */
  setSpeed(): void {
    // Speed is read live from `getSpeedX()` on each tick; nothing to do
    // here beyond resetting the frame baseline so a speed bump does not
    // produce one oversized first step.
    this.#lastFrameMs = this.#now();
  }

  /* ---------------------------------------------------------------- *\
     Cell streaming
  \* ---------------------------------------------------------------- */

  async #streamCells(): Promise<void> {
    const abort = new AbortController();
    this.#cellAbort = abort;
    const url = `${this.#deps.apiUrl}/api/replay/${this.#deps.symbol}/${this.#date}`;
    let sawAnyCell = false;
    try {
      const response = await this.#fetch(url, { signal: abort.signal });
      if (!response.ok) {
        this.#setLoadState('error');
        return;
      }
      await streamNdjson(
        response,
        (line) => {
          const row = parseNdjsonLine(line, this.#deps.parsers.parseCell);
          if (row === null) return;
          sawAnyCell = true;
          this.#ingestCellRow(row);
        },
        abort.signal,
      );
      if (abort.signal.aborted) return;
      // Stream complete. `#bars` is kept sorted by binary insertion on
      // ingest, so any bar already past its close boundary was emitted by
      // the clock tick. One final emit catches bars whose boundary the
      // cursor crossed while they were still arriving — no full reset, so
      // the already-fetched tick window survives.
      this.#emitClosedBarsUpTo(this.#cursorMs);
      this.#setLoadState(sawAnyCell ? 'ready' : 'empty');
    } catch (err) {
      if (abort.signal.aborted) return;
      console.error('[replay] cell stream failed', err);
      this.#setLoadState('error');
    }
  }

  /**
   * Fold one streamed cell row into the bar grouping. Incremental /
   * out-of-order arrival is handled: an existing bar (looked up via the
   * `#barByBucket` map) appends the cell; a new bar is binary-INSERTED so
   * `#bars` stays sorted ascending by `bucketTs` — keeping the closed set
   * a prefix without a global re-sort that would orphan the emitted
   * bookkeeping. Cells are NOT emitted here; the virtual clock decides
   * when each bar materialises.
   */
  #ingestCellRow(row: ReplayCellRow): void {
    const existing = this.#barByBucket.get(row.bucketTs);
    if (existing !== undefined) {
      existing.cells.push(row);
      return;
    }
    const bar: ReplayBar = { bucketTs: row.bucketTs, cells: [row] };
    this.#barByBucket.set(row.bucketTs, bar);
    // Binary insert to keep #bars sorted ascending by bucketTs.
    let lo = 0;
    let hi = this.#bars.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      const probe = this.#bars[mid];
      if (probe !== undefined && probe.bucketTs < row.bucketTs) lo = mid + 1;
      else hi = mid;
    }
    this.#bars.splice(lo, 0, bar);
  }

  /* ---------------------------------------------------------------- *\
     Virtual clock
  \* ---------------------------------------------------------------- */

  #scheduleFrame(): void {
    this.#frameHandle = this.#scheduler.requestFrame((now) => {
      this.#frameHandle = null;
      if (!this.#playing) return;
      const delta = Math.max(0, now - this.#lastFrameMs);
      this.#lastFrameMs = now;
      this.#tick(delta);
      if (this.#playing) this.#scheduleFrame();
    });
  }

  #scheduleStep(): void {
    this.#stepHandle = this.#scheduler.setTimeout(() => {
      this.#stepHandle = null;
      if (!this.#playing) return;
      // Discrete one-bar jump, scaled so faster speeds step more bars per
      // wall second but still in instant increments (no smooth motion).
      this.#tick(REDUCED_MOTION_STEP_MS / Math.max(1, this.#deps.getSpeedX()));
      if (this.#playing) this.#scheduleStep();
    }, REDUCED_MOTION_STEP_MS / Math.max(1, this.#deps.getSpeedX()));
  }

  /** Advance the cursor by one tick and materialise newly-closed bars. */
  #tick(wallDeltaMs: number): void {
    const speedX = this.#deps.getSpeedX();
    const next = advanceCursor(
      this.#cursorMs,
      wallDeltaMs,
      speedX,
      REPLAY_DAY_MS,
    );
    this.#cursorMs = next;
    this.#deps.onCursorChange(next);
    this.#emitClosedBarsUpTo(next);
    if (next >= REPLAY_DAY_MS) {
      // Reached the end of the session day — pause at the end.
      this.pause();
    }
  }

  /**
   * Emit every bar that has CLOSED at-or-before `cursorMs` but is not yet
   * in the emitted set. Bars are sorted ascending so the closed set is a
   * prefix `[0, closedCount)`; we emit only the unemitted ones (forward
   * playback emits the new tail; a seek's reset clears the set so the
   * whole prefix re-emits). Each bar becomes one `replay.bar` frame
   * (absolute totals → hard rebase in the store reducer).
   *
   * The session-day cursor is relative to session open; bar `bucketTs` is
   * absolute epoch-ms, so we compare in absolute space by offsetting the
   * cursor with `#dayStart`.
   */
  #emitClosedBarsUpTo(cursorMs: number): void {
    const absoluteCursor = this.#dayStart + cursorMs;
    const closedCount = countClosedBars(this.#bars, absoluteCursor);
    const ingest = this.#deps.streamStore.getState().ingestFrame;
    for (let i = 0; i < closedCount; i += 1) {
      const bar = this.#bars[i];
      if (bar === undefined) continue;
      if (this.#emittedBuckets.has(bar.bucketTs)) continue;
      ingest({
        topic: 'cells.btc',
        kind: 'replay.bar',
        payload: barToReplayPayload(this.#deps.symbol, bar),
      });
      this.#emittedBuckets.add(bar.bucketTs);
    }
  }

  /* ---------------------------------------------------------------- *\
     Tick window
  \* ---------------------------------------------------------------- */

  #scheduleTickRefetch(): void {
    if (this.#tickDebounceHandle !== null) {
      this.#scheduler.clearTimeout(this.#tickDebounceHandle);
    }
    this.#tickDebounceHandle = this.#scheduler.setTimeout(() => {
      this.#tickDebounceHandle = null;
      void this.#refetchTickWindow();
    }, TICK_REFETCH_DEBOUNCE_MS);
  }

  /**
   * Fetch the bounded tick window around the current cursor and feed the
   * ticks into the store's recent-ticks ring (the same ring the live tape
   * strip renders). Replaces, not appends — the window IS the strip's
   * content at this cursor.
   */
  async #refetchTickWindow(): Promise<void> {
    this.#tickAbort?.abort();
    const abort = new AbortController();
    this.#tickAbort = abort;
    const window = computeTickWindow(
      this.#dayStart,
      this.#cursorMs,
      REPLAY_DAY_MS,
    );
    const url = `${this.#deps.apiUrl}/api/replay/${this.#deps.symbol}/${this.#date}/ticks?from=${String(window.from)}&to=${String(window.to)}`;
    const collected: WSTickPayload[] = [];
    try {
      const response = await this.#fetch(url, { signal: abort.signal });
      if (!response.ok) return;
      await streamNdjson(
        response,
        (line) => {
          const row = parseNdjsonLine(line, this.#deps.parsers.parseTick);
          if (row !== null) collected.push(row);
        },
        abort.signal,
      );
      if (abort.signal.aborted) return;
      this.#applyTickWindow(collected);
    } catch (err) {
      if (abort.signal.aborted) return;
      console.error('[replay] tick window fetch failed', err);
    }
  }

  /**
   * Replace the store's recent-ticks ring with the fetched window. The
   * window IS the tape strip's content at this cursor, so we set the ring
   * directly (last `STREAM_RECENT_TICKS_CAP` ticks) rather than appending
   * via `ingestFrame` — that avoids disturbing the cell / CVD state the
   * seek already rebuilt and avoids `tickCount` drifting upward across
   * refetches.
   */
  #applyTickWindow(ticks: WSTickPayload[]): void {
    const ring = ticks.slice(-STREAM_RECENT_TICKS_CAP);
    const newest = ring.at(-1);
    this.#deps.streamStore.setState((state) => ({
      recentTicks: ring,
      lastTickTsMs: newest === undefined ? state.lastTickTsMs : newest.tsMs,
      tickCount: ring.length,
    }));
  }

  #setLoadState(state: ReplayLoadState): void {
    if (this.#loadState === state) return;
    this.#loadState = state;
    this.#deps.onLoadState(state);
  }
}
