/**
 * WebSocket frame contract barrel (ADR-003) — the FE/BE integration boundary
 * (conventions section 5).
 *
 * Both atlas-server (the `@fastify/websocket` gateway, runtime-validating every
 * inbound control frame) and atlas-web (the WS client, types-only import) point
 * here. The web side imports TYPES only, so the Zod runtime is erased from the
 * browser bundle (verbatimModuleSyntax). Importing this barrel pulls in the
 * jitless Zod global side-effect transitively (via the parent schemas barrel),
 * so the runtime validation path is CSP-safe.
 *
 * Available subpath import: `atlas-shared/schemas/ws`.
 */
export * from './protocol';
export * from './server-frames';
export * from './client-frames';
