/**
 * Barrel re-export for the e2e helpers. Tests import from `@helpers/...`
 * (the tsconfig path alias) so a helper-layout refactor is one edit here, not
 * a sweep across every spec.
 */
export { baseUrl } from './env';
export { attachDiagnostics, type Diagnostics } from './diagnostics';
export { LandingPage } from './landing-page';
export { BookingPage } from './booking-page';
export {
  SERVICE_SIGNATURE_CUT,
  SERVICE_CUT_AND_BEARD,
  BARBER_MARCO,
  INVALID_ID,
  BOOKING_STORAGE_KEY,
} from './fixtures';
