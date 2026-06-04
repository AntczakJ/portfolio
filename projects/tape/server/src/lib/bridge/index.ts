/**
 * Bridge module barrel — Task 1.4a.
 *
 * One stable import path for the supervisor / health endpoint / tests.
 * Internal modules (`./config`, `./backoff`, `./frame`) are exported
 * here so consumers do not bake the per-file paths into call sites.
 */

export {
  BRIDGE_BACKOFF_INITIAL_MS,
  BRIDGE_BACKOFF_JITTER,
  BRIDGE_BACKOFF_MAX_MS,
  BRIDGE_BACKOFF_RESET_HEALTHY_MS,
  BRIDGE_CRASH_LOOP_MAX,
  BRIDGE_CRASH_LOOP_WINDOW_MS,
  BRIDGE_HANDSHAKE_TIMEOUT_MS,
  BRIDGE_MAX_FRAME_BYTES,
  BRIDGE_SNAPSHOT_POLL_MS,
  defaultWorkerBinaryPath,
  workerBinaryPath,
} from './config';
export { Backoff } from './backoff';
export { decode, encode } from './codec';
export { encodeFrame, FrameReader } from './frame';
export type { FrameReaderOptions } from './frame';
export { defaultBridgePath, isPipe, normalizeBridgePath } from './path';
export { BridgeClient } from './client';
export type { BridgeClientOptions, BridgeClientState } from './client';
export { WorkerSupervisor } from './supervisor';
export type {
  WorkerSupervisorOptions,
  WorkerSupervisorState,
} from './supervisor';
export {
  WorkerPipeline,
  getWorkerPipeline,
  __resetWorkerPipelineForTests,
} from './pipeline';
export type { WorkerPipelineOptions } from './pipeline';
