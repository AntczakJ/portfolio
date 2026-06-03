import { expect, test } from '@playwright/test';

import { BookingPage, BOOKING_STORAGE_KEY } from '@helpers/index';

/**
 * Test 9 (BONUS) — refresh reconciliation of a stale held slot (ADR-003).
 *
 * The reconciliation rule is unit-tested deterministically already; this E2E
 * proves it reaches the user. Because the frozen clock keeps real bookings
 * stable, we cannot make a slot go stale "naturally" — so we seed a persisted
 * draft (the exact Zustand `persist` shape) that HOLDS a slot which the seeded
 * pre-bookings already occupy, with a `savedAt` just inside the 24h TTL.
 *
 * On reload, `onRehydrateStorage` re-runs `getAvailability`, finds the held
 * slot taken, keeps service/barber/date, clears the time, drops to the
 * date-time step, and surfaces the calm "slot-taken" notice.
 *
 * Concrete fixture: barber Sasha (brb-sasha) has a seeded pre-booking at
 * 15:30 (startMin 930) on 2026-06-10 — so a draft holding that exact slot is
 * stale by construction. Sasha performs the Signature Cut (a `cut` service).
 *
 * The frozen `now` is 2026-06-10 11:00 Europe/Warsaw = 1781082000000 ms.
 */

const FROZEN_NOW_MS = 1781082000000;

const STALE_DRAFT = {
  state: {
    draft: {
      step: 'details',
      serviceId: 'svc-signature-cut',
      barberId: 'brb-sasha',
      date: '2026-06-10',
      startMin: 930, // 15:30 — occupied by seeded pre-booking pb-0023
      contact: {
        name: 'Tomasz Antczak',
        email: 'tomasz@example.com',
        phone: '+48 600 100 200',
      },
      savedAt: FROZEN_NOW_MS - 1000, // 1s ago — well inside the 24h TTL
    },
  },
  version: 1,
};

test.describe('booking — stale-slot reconciliation', () => {
  test('a held-but-taken slot drops to date-time with a calm notice', async ({
    page,
  }) => {
    const booking = new BookingPage(page);

    // Seed the stale persisted draft at the origin, then load /book so the
    // store rehydrates + reconciles it.
    await page.goto('/book', { waitUntil: 'domcontentloaded' });
    await page.evaluate(
      ([key, value]) => {
        window.localStorage.setItem(key, value);
      },
      [BOOKING_STORAGE_KEY, JSON.stringify(STALE_DRAFT)] as const,
    );
    await page.reload({ waitUntil: 'domcontentloaded' });

    await booking.stepHeading().waitFor({ state: 'visible' });

    // Reconciled to the date-time step (the held time was released).
    await expect(booking.stepHeading()).toHaveText(/When suits you/i);

    // The calm, non-blocking notice is shown.
    await expect(booking.notice()).toBeVisible();
    await expect(booking.notice()).toContainText(/pick another/i);

    // Service + barber + date survived; only the time was cleared (the
    // summary's Time row is empty again). The date strip is back in view.
    await expect(booking.dateGroup()).toBeVisible();
  });
});
