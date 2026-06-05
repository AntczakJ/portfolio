'use client';

import { create } from 'zustand';

import { DEFAULT_CONFIG } from '@/mocks';
import type { ReservationConfig } from '@/lib/schemas/reservation-draft';

/**
 * Configurator preview store (Task 4.3).
 *
 * The TRANSIENT currently-previewed selection the configurator UI shows — the
 * single source of truth shared by the accessible DOM swatch controls, the live
 * R3F scene (which reads `colorId`/`wheelId` to set materials/meshes), and the
 * Tier-3 pre-baked still surface. This is deliberately separate from the
 * persisted reservation draft (`reservation-store.ts`): the previewed config is
 * ephemeral UI state and is copied into the reservation draft only when the
 * user clicks "Reserve this configuration" (ADR-003 C-A — "the live scene's
 * transient state does not belong in the persisted draft").
 *
 * It is NOT persisted (no `localStorage`) — first paint always starts from the
 * default config (which the no-JS/SSR floor also renders), so the live scene and
 * the static render agree at the seam.
 */

export interface ConfiguratorState {
  colorId: string;
  wheelId: string;
  setColor: (colorId: string) => void;
  setWheel: (wheelId: string) => void;
  /** Seed the preview (e.g. when arriving with a deep-linked selection). */
  set: (config: ReservationConfig) => void;
}

export const useConfiguratorStore = create<ConfiguratorState>((set) => ({
  colorId: DEFAULT_CONFIG.colorId,
  wheelId: DEFAULT_CONFIG.wheelId,
  setColor: (colorId) => { set({ colorId }); },
  setWheel: (wheelId) => { set({ wheelId }); },
  set: ({ colorId, wheelId }) => { set({ colorId, wheelId }); },
}));
