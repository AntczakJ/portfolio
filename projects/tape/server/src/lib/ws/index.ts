/**
 * WS module barrel — Task 1.6b.
 *
 * One stable import path for the registry, snapshot cache,
 * synthesizer, and heartbeat. The Elysia handler in `src/server.ts`
 * and any future producer (Binance ingest in Task 1.3, Rust worker
 * wire-up in Task 1.5) reach through this barrel rather than the
 * per-file paths.
 */

export {
  getRegistry,
  WSConnectionRegistry,
  WS_QUEUE_MAX_BYTES,
  WS_QUEUE_MAX_WALL_MS,
} from './connections';
export type { WSClientHandle, WSClientSocket, WSOverrunReason } from './connections';

export {
  getSnapshotCache,
  SnapshotCache,
} from './snapshot-cache';

export {
  HeartbeatLoop,
  WS_HEARTBEAT_INTERVAL_MS,
} from './heartbeat';

export {
  getRateLimit,
  WSRateLimit,
  WS_MAX_CONNECTIONS_PER_IP_DEFAULT,
} from './rate-limit';
export type { WSRateLimitOptions } from './rate-limit';

export {
  SYNTH_CELL_CLOSE_INTERVAL_MS,
  SYNTH_CELL_DELTA_INTERVAL_MS,
  SYNTH_DEFAULT_SEED,
  SYNTH_TICK_INTERVAL_MS,
  WSSynthesizer,
} from './synthesizer';
export type { SynthesizerOptions } from './synthesizer';
