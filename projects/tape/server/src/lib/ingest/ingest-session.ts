/**
 * Ingest session lifecycle — Task 1.3.
 *
 * Opens / closes a `sessions` row (Drizzle table at
 * `src/db/schema/sessions.ts`) per ADR-005 § "Read path split" and the
 * Phase 1 § 1.3 task brief in PLAN.md:
 *
 *   "A session represents a single uninterrupted window of market
 *    data on a given symbol from a given upstream source. Ingestion
 *    (Task 1.3) opens a session row when the Binance WebSocket
 *    connects and stamps `ended_at` when the stream cleanly
 *    disconnects."
 *
 * Lifecycle states:
 *
 *   idle ──start()──▶ active ──stop()──▶ closed
 *                              ▲
 *                              └── multiple stop() calls are a no-op
 *                                   (idempotent; the row is only
 *                                    updated once)
 *
 * On unexpected disconnect WITH auto-reconnect (the Binance client's
 * default), the session row STAYS OPEN — a reconnect-with-backoff that
 * succeeds within a few seconds is still the same uninterrupted
 * market window from the analysis perspective. A fresh session row is
 * only opened on a deliberate stop()+start() pair (e.g. process
 * restart, BINANCE_WS_ENABLED toggle, or operator intervention).
 *
 * **Why a singleton?** The ingestor singleton owns the lifetime; there
 * is exactly one Binance ingest stream per process in v1, so there is
 * exactly one open session row at a time. The singleton accessor
 * matches the rest of the ingest layer (`getTickWriter`,
 * `getRetentionScheduler`) so the boot wiring at `src/server.ts`
 * reaches for one consistent surface.
 *
 * **DB tolerance policy.** This module uses the FAIL-FAST `getDb()`
 * accessor, not `pingDb()` — `start()` is on the runtime ingest path,
 * so a missing `DATABASE_URL` must surface at boot, not later. The
 * caller (`src/server.ts`) checks `DATABASE_URL` before booting the
 * ingestor, mirroring the policy ADR-005 / Task 1.2b established for
 * the tick writer.
 *
 * **Tests.** The constructor accepts a `createSession` / `endSession`
 * hook pair so unit tests can drive the lifecycle without a live DB.
 * The hooks default to live Drizzle calls.
 */

import { eq } from 'drizzle-orm';

import { getDb } from '../../db';
import { sessions, type NewSession, type Session } from '../../db/schema/sessions';

/**
 * Open-row creator. Returns the inserted row including its generated
 * `id`. Tests inject an alternative; production uses `defaultCreateSession`
 * which goes through Drizzle.
 */
export type CreateSession = (input: NewSession) => Promise<Session>;

/**
 * End-row updater. Stamps `ended_at` on the session identified by `id`.
 * Tests inject an alternative; production uses `defaultEndSession`.
 */
export type EndSession = (id: string, endedAt: Date) => Promise<void>;

/**
 * Optional clock seam so tests can deterministically drive `startedAt`
 * / `endedAt` values without depending on wall-clock progression.
 */
export type Clock = () => Date;

export interface IngestSessionOptions {
  readonly source?: string;
  readonly symbol?: string;
  readonly createSession?: CreateSession;
  readonly endSession?: EndSession;
  readonly clock?: Clock;
}

/** Default upstream label per ADR-001 (single-exchange v1). */
export const DEFAULT_SESSION_SOURCE = 'binance-futures';

/**
 * Default symbol — `BTCUSDT-PERP` per PLAN.md single-symbol scope.
 * Matches the v1 symbol pinned in `src/server.ts` (`V1_SYMBOL`).
 */
export const DEFAULT_SESSION_SYMBOL = 'BTCUSDT-PERP';

async function defaultCreateSession(input: NewSession): Promise<Session> {
  const db = getDb();
  const rows = await db.insert(sessions).values(input).returning();
  const row = rows[0];
  if (row === undefined) {
    // Drizzle `.returning()` guarantees one row per inserted record;
    // a zero-length response is a driver or schema corruption, not a
    // user-visible code path. Throw loudly — silent miss here would
    // mean ingest with no session row, which breaks the replay scan.
    throw new Error('ingest-session: insert returned no rows');
  }
  return row;
}

async function defaultEndSession(id: string, endedAt: Date): Promise<void> {
  const db = getDb();
  await db.update(sessions).set({ endedAt }).where(eq(sessions.id, id));
}

export class IngestSession {
  readonly source: string;
  readonly symbol: string;
  readonly #createSession: CreateSession;
  readonly #endSession: EndSession;
  readonly #clock: Clock;
  #current: Session | null = null;
  #starting: Promise<Session> | null = null;

  constructor(options: IngestSessionOptions = {}) {
    this.source = options.source ?? DEFAULT_SESSION_SOURCE;
    this.symbol = options.symbol ?? DEFAULT_SESSION_SYMBOL;
    this.#createSession = options.createSession ?? defaultCreateSession;
    this.#endSession = options.endSession ?? defaultEndSession;
    this.#clock = options.clock ?? ((): Date => new Date());
  }

  /**
   * Open a new session row and return its id. Idempotent under
   * concurrent callers — a second `start()` while the first INSERT is
   * still in flight awaits the same promise rather than racing two
   * rows. Once a session is active, subsequent `start()` calls return
   * the SAME id (no new row) — the caller is responsible for
   * `stop()` first if they want a fresh session.
   */
  async start(): Promise<string> {
    if (this.#current !== null) return this.#current.id;
    if (this.#starting !== null) {
      const row = await this.#starting;
      return row.id;
    }
    const startedAt = this.#clock();
    this.#starting = this.#createSession({
      symbol: this.symbol,
      source: this.source,
      startedAt,
    });
    try {
      const row = await this.#starting;
      this.#current = row;
      return row.id;
    } finally {
      this.#starting = null;
    }
  }

  /**
   * Stamp `ended_at` on the active session row and clear the
   * in-memory pointer. Idempotent — a `stop()` against no active
   * session is a no-op. Tolerant of a transient DB error: the
   * in-memory pointer is cleared regardless so a subsequent `start()`
   * opens a fresh row rather than carrying a phantom reference. The
   * error is structured-logged so a sustained failure surfaces in
   * ops without hanging the shutdown path.
   */
  async stop(): Promise<void> {
    const current = this.#current;
    if (current === null) return;
    this.#current = null;
    try {
      await this.#endSession(current.id, this.#clock());
    } catch (err) {
      console.error('[ingest-session] failed to stamp ended_at:', err);
    }
  }

  /**
   * Current active session id, or `null` if no session is open.
   * Read by the ingestor on every aggTrade to tag the persisted
   * tick row.
   */
  get currentId(): string | null {
    return this.#current?.id ?? null;
  }

  /**
   * Snapshot of the active session row (or `null`). Public for tests
   * + future observability (`/health.binance.sessionId` reads
   * `currentId`; richer surfaces could read this).
   */
  get current(): Session | null {
    return this.#current;
  }
}

let singleton: IngestSession | null = null;

export function getIngestSession(): IngestSession {
  singleton ??= new IngestSession();
  return singleton;
}

/**
 * Test-only reset. Not exported from the barrel — tests import this
 * file directly to keep the production surface honest.
 */
export function __resetIngestSessionForTests(): void {
  singleton = null;
}
