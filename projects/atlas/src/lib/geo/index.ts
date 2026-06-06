/**
 * Shared geo module barrel (ADR-004) — the FE/BE single source for spatial math
 * (conventions section 5, applied to algorithms).
 *
 * Pure functions wrapping SCOPED `@turf/*` modules (not the `@turf/turf`
 * mega-bundle — keeps the web bundle lean for the Lighthouse budget). Imported
 * by atlas-server (the engine: authoritative projection, ETA, geofence
 * transitions every tick) and atlas-web (remaining-route slice + interpolation
 * geometry). Units are pinned to METRES throughout (the ADR-004 sharp edge).
 *
 * Available subpath import: `atlas-shared/geo`.
 */
export * from './types';
export * from './route';
export * from './eta';
export * from './geofence';
