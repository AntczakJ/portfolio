'use client';

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

import { getRangeAvailability } from '@/lib/availability';
import { getBookingsForVehicle, BOOKINGS } from '@/mocks';
import {
  reservationDraftSchema,
  type ConfirmedReservation,
  type ReservationConfig,
  type ReservationDraft,
  type WizardStep,
} from '@/lib/schemas/reservation-draft';
import type { InsuranceTier } from '@/lib/schemas/common';
import type { DateRange } from '@/lib/schemas/availability';
import type { Driver } from '@/lib/schemas/driver';
import {
  canAdvance as machineCanAdvance,
  clampStep,
  nextStep,
  previousStep,
} from './wizard-machine';

/**
 * Reservation wizard + configurator carry-over store (ADR-003).
 *
 * One store owns the entire reservation draft, including the carried
 * configurator selection (`config: { colorId, wheelId }` — the spine thread
 * PLAN.md describes). The configurator's "Reserve this configuration" CTA
 * (Task 4.3) writes `vehicleId` + `config` here and routes to `/reserve`; the
 * deep link `/reserve?vehicle=…&color=…&wheels=…` seeds the same fields.
 *
 * Task 5.4 EXTENDS this store (it does NOT replace it — the configurator + the
 * fleet cards already write to it): the per-step setters, the navigation
 * delegated to the pure wizard machine (`wizard-machine.ts`), the non-blocking
 * reconciliation notice surface, the confirmation slice, and the `hydrated`
 * flag so the wizard renders an SSR-safe skeleton until the persisted draft is
 * read (no `localStorage` on the server).
 *
 * The LIVE configurator scene state (current orbit, the in-canvas material) is
 * ephemeral UI state and is deliberately NOT persisted — only the CHOSEN
 * `{ colorId, wheelId }` is (ADR-003 C-A). The transient "currently-previewed"
 * selection lives in `configurator-store.ts`.
 */

const PERSIST_KEY = 'apex:reservation-draft';
const PERSIST_VERSION = 1;
/** 24 h TTL via `savedAt` (ADR-003). */
const TTL_MS = 24 * 60 * 60 * 1000;

/** A calm, dismissible notice surfaced on rehydrate / submit edge cases. */
export type WizardNotice = 'range-unavailable' | 'expired' | null;

export interface ReservationState extends ReservationDraft {
  /** False until the persisted draft has been merged (SSR-safe gate). */
  hydrated: boolean;
  /** A non-blocking notice (reconciliation / expiry); dismissible. */
  notice: WizardNotice;
  /** The deterministic confirmation, set on a successful mocked submit. */
  confirmation: ConfirmedReservation | null;

  /** Replace part of the draft (low-level; bumps `savedAt`). */
  setDraft: (draft: Partial<ReservationDraft>) => void;

  /** The configurator carry-over (ADR-003 C-A): vehicle + config → dates step. */
  configureAndReserve: (vehicleId: string, config: ReservationConfig) => void;
  /** Deep-link seeding (`/reserve?vehicle=…&color=…&wheels=…`). */
  seedFromDeepLink: (seed: {
    vehicleId?: string;
    config?: ReservationConfig;
  }) => void;

  // --- Per-step setters (Task 5.4/5.5) ----------------------------------
  /** Step 1: choose / change the vehicle (clears a now-irrelevant range). */
  selectVehicle: (vehicleId: string) => void;
  /** Step 2: the date range. */
  setRange: (range: DateRange | undefined) => void;
  /** Step 2: pickup / return locations. */
  setPickupLocation: (locationId: string) => void;
  setReturnLocation: (locationId: string) => void;
  /** Step 3: toggle a non-insurance add-on. */
  toggleExtra: (extraId: string) => void;
  /** Step 3: the single-choice insurance tier (or clear). */
  setInsuranceTier: (tier: InsuranceTier | undefined) => void;
  /** Step 4: the driver details. */
  setDriver: (driver: Driver) => void;

  // --- Navigation (delegated to the pure machine) -----------------------
  goToStep: (step: WizardStep) => void;
  next: () => void;
  back: () => void;

  // --- Notice + confirmation + lifecycle --------------------------------
  dismissNotice: () => void;
  setConfirmation: (confirmation: ConfirmedReservation) => void;
  /** Mark hydration complete (called from `onRehydrateStorage`). */
  setHydrated: () => void;
  /** Clear the persisted draft (a "Start over" control / clear-on-confirm). */
  reset: () => void;
}

function emptyDraft(): ReservationDraft {
  return {
    step: 'vehicle',
    extras: [],
    savedAt: Date.now(),
  };
}

export const useReservationStore = create<ReservationState>()(
  persist(
    (set) => ({
      ...emptyDraft(),
      hydrated: false,
      notice: null,
      confirmation: null,

      setDraft: (draft) =>
        set((prev) => ({ ...prev, ...draft, savedAt: Date.now() })),

      configureAndReserve: (vehicleId, config) =>
        set((prev) => ({
          ...prev,
          vehicleId,
          config,
          step: 'dates-locations' satisfies WizardStep,
          confirmation: null,
          savedAt: Date.now(),
        })),

      seedFromDeepLink: (seed) =>
        set((prev) => {
          const next: Partial<ReservationDraft> = { savedAt: Date.now() };
          if (seed.vehicleId) next.vehicleId = seed.vehicleId;
          if (seed.config) next.config = seed.config;
          if (seed.vehicleId && prev.step === 'vehicle') {
            next.step = 'dates-locations';
          }
          return { ...prev, ...next };
        }),

      selectVehicle: (vehicleId) =>
        set((prev) => {
          // Changing the vehicle invalidates a range chosen for the old one
          // (availability is per-vehicle), so clear it and the config carry-over
          // unless the same vehicle was reselected.
          if (prev.vehicleId === vehicleId) {
            return { ...prev, vehicleId, savedAt: Date.now() };
          }
          // NB: zustand v5's `set` SHALLOW-MERGES the returned partial, so a key
          // `delete`-d from the object would NOT be removed from the store (the
          // prior value persists). To actually clear the now-stale range/config
          // we must explicitly assign `undefined`, not delete the key.
          return {
            ...prev,
            vehicleId,
            range: undefined,
            config: undefined,
            extras: prev.extras,
            savedAt: Date.now(),
          };
        }),

      setRange: (range) =>
        // `range` may be `undefined` to clear the selection. Explicitly assign
        // `undefined` (not `delete`) so zustand's shallow merge actually removes
        // the value — a deleted key is a no-op under the shallow `set` merge.
        set((prev) => ({ ...prev, range, savedAt: Date.now() })),

      setPickupLocation: (locationId) =>
        set((prev) => ({
          ...prev,
          pickupLocationId: locationId,
          savedAt: Date.now(),
        })),

      setReturnLocation: (locationId) =>
        set((prev) => ({
          ...prev,
          returnLocationId: locationId,
          savedAt: Date.now(),
        })),

      toggleExtra: (extraId) =>
        set((prev) => {
          const has = prev.extras.includes(extraId);
          const extras = has
            ? prev.extras.filter((id) => id !== extraId)
            : [...prev.extras, extraId];
          return { ...prev, extras, savedAt: Date.now() };
        }),

      setInsuranceTier: (tier) =>
        // `tier` may be `undefined` to clear the choice. Explicitly assign
        // `undefined` (not `delete`) so zustand's shallow merge actually removes
        // the value — a deleted key is a no-op under the shallow `set` merge.
        set((prev) => ({ ...prev, insuranceTier: tier, savedAt: Date.now() })),

      setDriver: (driver) =>
        set((prev) => ({ ...prev, driver, savedAt: Date.now() })),

      goToStep: (step) =>
        set((prev) => {
          const target = clampStep(step, prev, BOOKINGS);
          return { ...prev, step: target, savedAt: Date.now() };
        }),

      next: () =>
        set((prev) => {
          if (!machineCanAdvance(prev, prev.step, BOOKINGS)) return prev;
          return { ...prev, step: nextStep(prev.step), savedAt: Date.now() };
        }),

      back: () =>
        set((prev) => ({
          ...prev,
          step: previousStep(prev.step),
          savedAt: Date.now(),
        })),

      dismissNotice: () => set({ notice: null }),

      setConfirmation: (confirmation) =>
        set((prev) => ({
          ...prev,
          confirmation,
          step: 'confirmation' satisfies WizardStep,
          savedAt: Date.now(),
        })),

      setHydrated: () => set({ hydrated: true }),

      reset: () =>
        set(() => ({
          ...emptyDraft(),
          hydrated: true,
          notice: null,
          confirmation: null,
        })),
    }),
    {
      name: PERSIST_KEY,
      version: PERSIST_VERSION,
      storage: createJSONStorage(() => localStorage),
      // Persist only the draft fields (not the actions, the hydration flag, the
      // notice, or the confirmation — a reload after confirm starts fresh).
      partialize: (state): ReservationDraft => ({
        step: state.step,
        ...(state.vehicleId !== undefined && { vehicleId: state.vehicleId }),
        ...(state.config !== undefined && { config: state.config }),
        ...(state.range !== undefined && { range: state.range }),
        ...(state.pickupLocationId !== undefined && {
          pickupLocationId: state.pickupLocationId,
        }),
        ...(state.returnLocationId !== undefined && {
          returnLocationId: state.returnLocationId,
        }),
        extras: state.extras,
        ...(state.insuranceTier !== undefined && {
          insuranceTier: state.insuranceTier,
        }),
        ...(state.driver !== undefined && { driver: state.driver }),
        savedAt: state.savedAt,
      }),
      migrate: (persisted) => persisted as ReservationDraft,
      // On rehydrate: discard an expired draft, validate the shape, and run the
      // date-range reconciliation (ADR-003). The notice is set in
      // `onRehydrateStorage` (it needs to know whether reconciliation fired).
      merge: (persisted, current): ReservationState => {
        const fallback = current;
        if (!persisted || typeof persisted !== 'object') return fallback;

        const parsed = reservationDraftSchema.safeParse(persisted);
        if (!parsed.success) return fallback;
        const draft = parsed.data;

        // TTL: discard a stale draft.
        if (Date.now() - draft.savedAt > TTL_MS) {
          return { ...current, notice: 'expired' };
        }

        // Clamp the rehydrated step for EVERY step, not just `confirmation`
        // (P1-4): a persisted / hand-edited `step` must never open past an
        // incomplete stage. `clampStep` returns the candidate if reachable, else
        // the earliest incomplete step (and maps `confirmation` to it). The
        // submit/advance guards already prevent a bad SUBMIT, but this stops the
        // wizard OPENING on a step the draft has not earned.
        let reconciled: ReservationDraft = {
          ...draft,
          step: clampStep(draft.step, draft, BOOKINGS),
        };

        // Date-range reconciliation: if a persisted range is no longer fully
        // available, keep vehicle + config, drop the range, return to dates,
        // and flag the notice.
        let noticed: WizardNotice = null;
        if (reconciled.vehicleId && reconciled.range) {
          const result = getRangeAvailability(
            {
              vehicleId: reconciled.vehicleId,
              fromISODate: reconciled.range.fromISODate,
              toISODate: reconciled.range.toISODate,
            },
            getBookingsForVehicle(reconciled.vehicleId),
          );
          if (!result.available) {
            const rest = { ...reconciled };
            delete rest.range;
            reconciled = { ...rest, step: 'dates-locations' };
            noticed = 'range-unavailable';
          }
        }

        return { ...current, ...reconciled, notice: noticed };
      },
      onRehydrateStorage: () => (state) => {
        // Fired after `merge`. Mark hydration complete so the wizard swaps its
        // SSR-safe skeleton for the real, persisted step.
        state?.setHydrated();
      },
    },
  ),
);

export type { InsuranceTier };
