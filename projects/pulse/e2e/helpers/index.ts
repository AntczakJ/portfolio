/**
 * Barrel re-export for the e2e helpers. Tests import from `@helpers/...` (via
 * the tsconfig path alias) so a refactor of the helper layout is one edit here,
 * not a sweep across N specs.
 */
export { baseUrl, apiBaseUrl, demoStatusSlug } from './env';
export { attachDiagnostics, type Diagnostics } from './diagnostics';
export { trackSse, type SseTracker } from './sse-tracker';
export { BoardPage } from './board-page';
export { PublicStatusPage } from './public-status-page';
export {
  freshIdentity,
  expectAuthDialogOpen,
  signUpThroughDialog,
  openSignInFromHeader,
  signOut,
  isAuthenticated,
  type TestIdentity,
} from './auth';
