/**
 * Barrel re-export for the e2e helpers. Tests import from
 * `@helpers/...` (via the tsconfig path alias) so a refactor of the
 * helper layout is one-edit-here, not a sweep across N specs.
 */
export { baseUrl, apiBaseUrl, wsBaseUrl } from './env';
export {
  seedBoard,
  garbageBoardId,
  type SeededBoard,
} from './seed-board';
export {
  SESSION_COOKIE_NAME,
  readSessionCookie,
  isValidSessionValue,
  clearSessionCookie,
  type SessionCookie,
} from './identity';
export { LandingPage } from './landing-page';
export { BoardPage, type ToolKind } from './board-page';
