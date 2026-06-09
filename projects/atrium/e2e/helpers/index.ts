/**
 * Barrel re-export for the e2e helpers. Tests import from `@helpers/...` (the
 * tsconfig path alias) so a helper-layout refactor is one edit here, not a sweep
 * across every spec.
 */
export { baseUrl } from './env';
export { attachDiagnostics, type Diagnostics } from './diagnostics';
export { LandingPage } from './landing-page';
export {
  PROJECTS,
  bayId,
  demoLinkName,
  type ProjectFixture,
} from './projects';
