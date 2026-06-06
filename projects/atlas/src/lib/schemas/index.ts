/**
 * Shared Zod schema barrel — the FE/BE contract (conventions section 5).
 *
 * The FIRST import is the jitless Zod global side-effect: it runs
 * `z.config({ jitless: true })` before any schema below is defined, so every
 * validator built from this barrel uses Zod's CSP-safe interpreter rather than
 * the `new Function` JIT (ADR-003 / ADR-006). Any consumer that imports a
 * schema from this package gets jitless Zod transitively; the server entrypoint
 * also imports the side-effect explicitly as its first line for belt-and-braces.
 *
 * The WS frame contract (`./ws`) is the load-bearing cross-package surface: the
 * server validates inbound control frames against it at the boundary, the web
 * imports its types to drive the client. It is re-exported here AND available as
 * the dedicated `atlas-shared/schemas/ws` subpath so the web can import the
 * frame types without walking the whole domain graph.
 */
import './zod-config';

export * from './enums';
export * from './event';
export * from './geojson';
export * from './route';
export * from './stop';
export * from './telemetry';
export * from './vehicle';
export * from './zone';
export * from './ws';
