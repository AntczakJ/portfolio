/**
 * Worker supervisor — Task 1.4a per ADR-004.
 *
 * Spawns the Rust worker binary as a child of the Elysia process via
 * `Bun.spawn`, owns its lifecycle, restarts it on unexpected exit with
 * the shared backoff curve, and trips a circuit breaker after a
 * sustained crash loop.
 *
 * Single responsibility: process. The bridge connection itself is
 * `BridgeClient`'s problem; this class only deals with the OS process.
 * The two are wired together in Task 1.5 (real worker) — for now the
 * supervisor stands alone and exposes its state via `/health.worker`.
 *
 * Bun spawn quirks (AGENT_NOTES):
 *  - `onExit` fires synchronously and races the log flush; use
 *    `.exited` (a Promise) for restart sequencing instead.
 *  - SIGTERM / SIGKILL / SIGINT are the only portable signals on
 *    Windows. We restrict to those.
 */

import {
  BRIDGE_CRASH_LOOP_MAX,
  BRIDGE_CRASH_LOOP_WINDOW_MS,
  defaultWorkerBinaryPath,
} from './config';
import { Backoff } from './backoff';

export type WorkerSupervisorState =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'stopping'
  | 'crashed';

export interface WorkerSupervisorOptions {
  /** Absolute path to the worker binary. Defaults to `defaultWorkerBinaryPath()`. */
  binaryPath?: string;
  /** Extra args. Defaults to `[]`. */
  args?: readonly string[];
  /** Extra env vars merged over `process.env`. */
  env?: Readonly<Record<string, string | undefined>>;
  /** Called on every state transition. */
  onStateChange?: (state: WorkerSupervisorState) => void;
}

/**
 * Minimal Bun.subprocess surface this supervisor uses. Defined locally
 * to avoid pinning to a Bun type that may shift across runtime versions
 * — the supervisor only reaches for `.pid`, `.exited`, `.kill()`, and
 * the two readable streams.
 */
interface WorkerSubprocess {
  pid: number;
  exited: Promise<number | null>;
  stdout?: ReadableStream<Uint8Array> | null;
  stderr?: ReadableStream<Uint8Array> | null;
  kill(signal?: number | NodeJS.Signals): void;
}

export class WorkerSupervisor {
  readonly #binaryPath: string;
  readonly #args: readonly string[];
  readonly #env: Readonly<Record<string, string | undefined>>;
  readonly #onStateChange: ((state: WorkerSupervisorState) => void) | undefined;
  readonly #backoff = new Backoff();
  #state: WorkerSupervisorState = 'idle';
  #child: WorkerSubprocess | null = null;
  #restartCount = 0;
  #lastExitCode: number | null = null;
  /** Rolling buffer of recent crash timestamps (ms). Pruned per check. */
  #crashTimestamps: number[] = [];
  #restartTimer: ReturnType<typeof setTimeout> | null = null;
  /**
   * `true` after `start()` has been called. Once `stop()` lands this
   * flips back to `false` and the exit handler does not respawn.
   */
  #shouldRun = false;

  constructor(options: WorkerSupervisorOptions = {}) {
    this.#binaryPath = options.binaryPath ?? defaultWorkerBinaryPath();
    this.#args = options.args ?? [];
    this.#env = options.env ?? {};
    this.#onStateChange = options.onStateChange;
  }

  get state(): WorkerSupervisorState {
    return this.#state;
  }

  get pid(): number | null {
    return this.#child?.pid ?? null;
  }

  get restartCount(): number {
    return this.#restartCount;
  }

  get lastExitCode(): number | null {
    return this.#lastExitCode;
  }

  get binaryPath(): string {
    return this.#binaryPath;
  }

  /**
   * Spawn the worker. Idempotent — calling on a running supervisor is a
   * no-op. Returns a promise that resolves once the worker has been
   * spawned (the process is alive); the supervisor flips to
   * `'connected'` after that.
   *
   * NOTE: `'connected'` here means "process alive". The bridge
   * connection itself is `BridgeClient`'s state, not this one. They are
   * wired together in Task 1.5; until then `start()` is called
   * explicitly by tests, never by `app.listen()`.
   */
  start(): void {
    if (this.#shouldRun) return;
    this.#shouldRun = true;
    this.#crashTimestamps = [];
    this.#backoff.reset();
    this.#spawnOnce();
  }

  /**
   * Gracefully stop the worker. Sends SIGTERM, waits for the existing
   * `.exited` promise to resolve, then transitions to `'idle'`. The
   * supervisor will not respawn after this returns; call `start()` to
   * restart it.
   */
  async stop(): Promise<void> {
    if (!this.#shouldRun) return;
    this.#shouldRun = false;
    this.#cancelRestartTimer();
    this.#transition('stopping');
    const child = this.#child;
    if (child === null) {
      this.#transition('idle');
      return;
    }
    try {
      child.kill('SIGTERM');
    } catch (err) {
      console.error('worker SIGTERM failed', err);
    }
    try {
      await child.exited;
    } catch {
      // Ignored — we just want the process gone before we move on.
    }
    this.#child = null;
    this.#transition('idle');
  }

  #spawnOnce(): void {
    this.#transition('connecting');
    const bun = (globalThis as { Bun?: typeof Bun }).Bun;
    if (bun === undefined) {
      console.error(
        'WorkerSupervisor requires the Bun runtime (Bun global is undefined)',
      );
      this.#shouldRun = false;
      this.#transition('crashed');
      return;
    }
    let child: WorkerSubprocess;
    try {
      child = bun.spawn({
        cmd: [this.#binaryPath, ...this.#args],
        stdout: 'pipe',
        stderr: 'pipe',
        env: { ...process.env, ...this.#env },
      });
    } catch (err) {
      console.error('worker spawn failed', err);
      this.#handleExit(null);
      return;
    }
    this.#child = child;
    this.#transition('connected');
    this.#drainStream(child.stdout, (line) => {
      console.log(`[worker] ${line}`);
    });
    this.#drainStream(child.stderr, (line) => {
      console.error(`[worker] ${line}`);
    });
    void child.exited
      .then((code) => {
        this.#handleExit(code);
      })
      .catch((err: unknown) => {
        console.error('worker .exited rejected', err);
        this.#handleExit(null);
      });
  }

  #handleExit(code: number | null): void {
    this.#lastExitCode = code;
    this.#child = null;
    if (!this.#shouldRun) {
      // stop() owns the transition to 'idle' on its own await.
      return;
    }
    console.warn(
      `worker exited (code=${String(code)}), generation=${String(this.#restartCount + 1)}`,
    );
    this.#restartCount += 1;
    const now = Date.now();
    this.#crashTimestamps.push(now);
    this.#crashTimestamps = this.#crashTimestamps.filter(
      (ts) => now - ts <= BRIDGE_CRASH_LOOP_WINDOW_MS,
    );
    if (this.#crashTimestamps.length >= BRIDGE_CRASH_LOOP_MAX) {
      console.error(
        `worker crash loop tripped (${String(this.#crashTimestamps.length)} crashes in ${String(BRIDGE_CRASH_LOOP_WINDOW_MS)}ms); operator intervention required`,
      );
      this.#shouldRun = false;
      this.#transition('crashed');
      return;
    }
    this.#transition('reconnecting');
    const delay = this.#backoff.nextDelayMs();
    this.#restartTimer = setTimeout(() => {
      this.#restartTimer = null;
      if (!this.#shouldRun) return;
      this.#spawnOnce();
    }, delay);
  }

  #drainStream(
    stream: ReadableStream<Uint8Array> | null | undefined,
    onLine: (line: string) => void,
  ): void {
    if (stream === null || stream === undefined) return;
    const decoder = new TextDecoder();
    let buffer = '';
    void (async () => {
      const reader = stream.getReader();
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let newlineAt = buffer.indexOf('\n');
          while (newlineAt !== -1) {
            const line = buffer.slice(0, newlineAt).replace(/\r$/, '');
            buffer = buffer.slice(newlineAt + 1);
            if (line.length > 0) onLine(line);
            newlineAt = buffer.indexOf('\n');
          }
        }
        const tail = buffer + decoder.decode();
        if (tail.length > 0) onLine(tail.replace(/\r$/, ''));
      } catch (err) {
        console.error('worker log drain failed', err);
      } finally {
        reader.releaseLock();
      }
    })();
  }

  #cancelRestartTimer(): void {
    if (this.#restartTimer !== null) {
      clearTimeout(this.#restartTimer);
      this.#restartTimer = null;
    }
  }

  #transition(next: WorkerSupervisorState): void {
    if (this.#state === next) return;
    this.#state = next;
    const cb = this.#onStateChange;
    if (cb !== undefined) {
      try {
        cb(next);
      } catch (err) {
        console.error('supervisor onStateChange handler threw', err);
      }
    }
  }
}
