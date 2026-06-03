/**
 * Deterministic mock-domain constants the specs reference by id/name.
 *
 * These mirror the seeded mock catalog (`projects/razors-edge/web/src/mocks`)
 * under the frozen clock (2026-06-10 11:00 Europe/Warsaw). They are the
 * stable contract the deep-link + happy-path specs assert against. If the
 * mock catalog ids change, this one file is the single edit point.
 */

/** A plain cut every barber can perform — the happy-path default service. */
export const SERVICE_SIGNATURE_CUT = {
  id: 'svc-signature-cut',
  // The deterministic booking reference for Signature Cut / Marco /
  // 2026-06-10 / 11:00 (the demo's canonical screenshot booking, per
  // razors-edge AGENT_NOTES). The happy path does not hard-assert this exact
  // value (the chosen slot varies), but it documents the deterministic-ref
  // contract the suite relies on for a stable `RE-XXXXXX` reference.
  knownReference: 'RE-X717NH',
} as const;

/** A combo service — carries a longer duration (the uniform availability model). */
export const SERVICE_CUT_AND_BEARD = {
  id: 'svc-cut-and-beard',
} as const;

/** Marco performs every service — a safe barber for any deep-link. */
export const BARBER_MARCO = {
  id: 'brb-marco',
  name: 'Marco Vidal',
} as const;

/** An id that exists in no catalog — used to prove invalid params are ignored. */
export const INVALID_ID = 'does-not-exist-xyz';

/** The booking-draft localStorage key (Zustand `persist`). */
export const BOOKING_STORAGE_KEY = 'razors-edge:booking-draft';
