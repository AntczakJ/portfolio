/**
 * Simulation engine barrel (Phase 3, ADR-002).
 *
 * The api-heavy spine: a PURE tick reducer (`reducer/`) driven by an IO shell
 * (`shell/`), composed with the persistence sink (`persistence/`) and the frozen
 * seed baseline (`baseline/` + `../seed/`) by the {@link EngineService}. The WS
 * gateway (Phase 4) consumes `EngineService.onTick` / `.snapshot` / the control
 * surface; nothing outside this module reaches into the reducer.
 */
export { EngineService } from './engine-service.js';
export type { EngineDefinitions, EngineServiceOptions } from './engine-service.js';
export { SimulationEngine } from './shell/engine.js';
export type {
  EngineOptions,
  EngineSnapshot,
  EngineTickOutput,
} from './shell/engine.js';
export { tick, telemetryFor } from './reducer/tick.js';
export type { TickResult } from './reducer/tick.js';
export { createInitialWorldState } from './reducer/world-state.js';
export type { VehicleState, WorldState } from './reducer/world-state.js';
export { buildBaseline } from './baseline/build-baseline.js';
export type { BaselineInput } from './baseline/build-baseline.js';
export type { SimBaseline } from './baseline/types.js';
export { EventSink } from './persistence/event-sink.js';
export type { ReducerEvent } from './reducer/events.js';
