'use client';

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

import { nowMs } from '@/lib/clock';
import { getServiceById } from '@/mocks';
import type { BookingDraft, BookingStep } from '@/lib/schemas/booking';
import type { ContactDetails } from '@/lib/schemas/contact';
import type { ConfirmedBooking } from '@/lib/schemas/booking';

import {
  STEP_ORDER,
  barberPerformsService,
  canReachStep,
  clampStep,
  reconcileDraft,
  seedDraftFromParams,
  stepIndex,
  type SeedParams,
} from './booking-machine';

/**
 * The Zustand wizard store (ADR-003) — the thin, persisted shell over the
 * pure machine in `booking-machine.ts`.
 *
 * Persistence: `persist` middleware, `localStorage`, key
 * `razors-edge:booking-draft`, `version: 1`, with a `savedAt` stamp and a
 * 24h TTL + slot reconciliation applied on rehydrate (see
 * `reconcileDraft`). `contact` PII never leaves the device (web-only
 * thesis); "Start over" + clear-on-confirm wipe it.
 *
 * The store keeps the persisted DRAFT plus transient runtime state that is
 * NOT persisted: a one-shot `notice` (e.g. the reconciliation message) and
 * the `confirmation` result of a successful submit.
 */

export const BOOKING_STORAGE_KEY = 'razors-edge:booking-draft';

export type WizardNotice = 'slot-taken' | 'expired' | null;

interface BookingState {
  draft: BookingDraft;
  /** Transient — a calm one-shot notice surfaced by the UI then dismissed. */
  notice: WizardNotice;
  /** Transient — the successful submit result (drives the confirmation). */
  confirmation: ConfirmedBooking | null;
  /** Set true once `persist` has rehydrated + reconciled (avoids SSR flash). */
  hydrated: boolean;

  // ── Selection actions ──────────────────────────────────────────────
  selectService: (serviceId: string) => void;
  selectBarber: (barberId: string | null, anyBarber?: boolean) => void;
  selectDate: (date: string) => void;
  selectSlot: (startMin: number) => void;
  /** Pin the concrete barber an "any" booking resolved to (keeps the flag). */
  pinResolvedBarber: (barberId: string) => void;
  setContact: (contact: ContactDetails) => void;

  // ── Navigation ─────────────────────────────────────────────────────
  goToStep: (step: BookingStep) => void;
  next: () => void;
  back: () => void;

  // ── Lifecycle ──────────────────────────────────────────────────────
  /** Seed from deep-link params on first mount (only when no draft exists). */
  seedIfEmpty: (params: SeedParams) => void;
  dismissNotice: () => void;
  setConfirmation: (confirmation: ConfirmedBooking) => void;
  reset: () => void;
}

const EMPTY_DRAFT: BookingDraft = { step: 'service' };

/** Re-clamp the step after a selection that may have invalidated later steps. */
function withClampedStep(draft: BookingDraft): BookingDraft {
  return { ...draft, step: clampStep(draft), savedAt: nowMs() };
}

export const useBookingStore = create<BookingState>()(
  persist(
    (set, get) => ({
      draft: EMPTY_DRAFT,
      notice: null,
      confirmation: null,
      hydrated: false,

      selectService: (serviceId) => {
        const service = getServiceById(serviceId);
        if (!service) return;
        const current = get().draft;

        // If the new service invalidates the chosen barber, drop the barber.
        const keepBarber =
          current.anyBarber === true ||
          (typeof current.barberId === 'string' &&
            barberPerformsService(current.barberId, serviceId));

        const next: BookingDraft = {
          ...current,
          serviceId,
          ...(keepBarber
            ? {}
            : { barberId: undefined, anyBarber: undefined }),
          // Service/duration may change the grid — release any held slot
          // so the user re-confirms a time against the right duration.
          startMin: undefined,
          step: 'barber',
        };
        set({ draft: withClampedStep(next) });
      },

      selectBarber: (barberId, anyBarber = false) => {
        const current = get().draft;
        if (!current.serviceId) return;

        const any = anyBarber;
        let resolvedId = barberId ?? undefined;

        if (any) {
          // "Any available barber" resolves to a concrete barber later, at
          // date/time selection (deterministic — first free that day).
          resolvedId = undefined;
        } else if (
          resolvedId &&
          !barberPerformsService(resolvedId, current.serviceId)
        ) {
          // Guard against an incompatible explicit pick.
          return;
        }

        const next: BookingDraft = {
          ...current,
          barberId: resolvedId,
          anyBarber: any ? true : undefined,
          // Changing the barber changes the grid → release the held slot.
          startMin: undefined,
          step: 'date-time',
        };
        set({ draft: withClampedStep(next) });
      },

      selectDate: (date) => {
        const current = get().draft;
        const next: BookingDraft = {
          ...current,
          date,
          // New day → no slot held yet.
          startMin: undefined,
        };
        set({ draft: { ...next, savedAt: nowMs() } });
      },

      selectSlot: (startMin) => {
        const current = get().draft;
        if (!current.date) return;
        const next: BookingDraft = { ...current, startMin };
        set({ draft: { ...next, savedAt: nowMs() } });
      },

      pinResolvedBarber: (barberId) => {
        const current = get().draft;
        // Only meaningful in "any" mode — record the concrete barber the
        // grid resolved to so the summary + submit have a real id, while
        // keeping the `anyBarber` flag so the summary still reads "Any".
        const next: BookingDraft = { ...current, barberId };
        set({ draft: { ...next, savedAt: nowMs() } });
      },

      setContact: (contact) => {
        const current = get().draft;
        const next: BookingDraft = { ...current, contact };
        set({ draft: { ...next, savedAt: nowMs() } });
      },

      goToStep: (step) => {
        const current = get().draft;
        if (!canReachStep(current, step)) return;
        set({ draft: { ...current, step, savedAt: nowMs() } });
      },

      next: () => {
        const current = get().draft;
        const idx = stepIndex(current.step);
        const target = STEP_ORDER[Math.min(idx + 1, STEP_ORDER.length - 1)];
        if (target && canReachStep(current, target)) {
          set({ draft: { ...current, step: target, savedAt: nowMs() } });
        }
      },

      back: () => {
        const current = get().draft;
        const idx = stepIndex(current.step);
        const target = STEP_ORDER[Math.max(idx - 1, 0)];
        if (target) {
          set({ draft: { ...current, step: target, savedAt: nowMs() } });
        }
      },

      seedIfEmpty: (params) => {
        const current = get().draft;
        // Only seed a fresh draft — never clobber an in-progress one. A
        // draft is "fresh" if it has no service yet AND is on step 1.
        const isFresh =
          current.step === 'service' && current.serviceId === undefined;
        if (!isFresh) return;
        if (!params.service && !params.barber) return;
        set({ draft: { ...seedDraftFromParams(params), savedAt: nowMs() } });
      },

      dismissNotice: () => set({ notice: null }),

      setConfirmation: (confirmation) =>
        set({ confirmation, draft: { ...get().draft, step: 'confirmation' } }),

      reset: () =>
        set({
          draft: { step: 'service', savedAt: nowMs() },
          notice: null,
          confirmation: null,
        }),
    }),
    {
      name: BOOKING_STORAGE_KEY,
      version: 1,
      storage: createJSONStorage(() => localStorage),
      // Persist ONLY the draft — `notice` / `confirmation` / `hydrated`
      // are transient runtime state.
      partialize: (state) => ({ draft: state.draft }),
      migrate: (persisted) => {
        // v1 is the first version; future shape changes migrate here.
        return persisted;
      },
      onRehydrateStorage: () => (state) => {
        // Runs after the persisted draft is read. Apply the ADR-003
        // reconciliation (TTL + stale-slot) against the frozen clock.
        if (!state) return;
        const outcome = reconcileDraft(state.draft, nowMs());
        state.draft = outcome.draft;
        state.notice = outcome.kind === 'ok' ? null : outcome.kind;
        state.hydrated = true;
      },
    },
  ),
);

/** Re-export the pure helpers the UI also needs (single import surface). */
export {
  STEP_ORDER,
  earliestIncompleteStep,
  canReachStep,
  stepIndex,
} from './booking-machine';
