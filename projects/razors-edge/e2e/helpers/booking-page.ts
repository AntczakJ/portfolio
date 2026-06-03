import type { Locator, Page } from '@playwright/test';
import { expect } from '@playwright/test';

import { BOOKING_STORAGE_KEY } from './fixtures';

/**
 * `booking-page.ts` — Page Object for the `/book` wizard (the centerpiece).
 *
 * The wizard is a five-step machine (service -> barber -> date-time ->
 * details -> confirmation) over a Zustand store persisted to localStorage.
 * Every selectable control is a real accessible widget — `radiogroup`s of
 * `radio`s for service / barber / date / time, a labelled form for details —
 * so this POM queries by role + accessible name, never by test id (none
 * exist in the wizard; the components were built accessible-first).
 *
 * Determinism: the app's frozen clock makes the date strip + availability
 * grid stable, so the POM can pick "the first available slot" and get the
 * same slot every run.
 */
export class BookingPage {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  async goto(query = ''): Promise<void> {
    await this.page.goto(`/book${query}`, { waitUntil: 'domcontentloaded' });
    // The wizard renders a skeleton until `persist` rehydrates; wait for the
    // real step heading to appear so we never act on the skeleton.
    await this.stepHeading().waitFor({ state: 'visible' });
  }

  /**
   * Clear the persisted booking draft so a spec starts from a fresh wizard.
   * Call AFTER a navigation to the origin (localStorage is origin-scoped).
   */
  async clearPersistedDraft(): Promise<void> {
    await this.page.evaluate((key) => {
      window.localStorage.removeItem(key);
    }, BOOKING_STORAGE_KEY);
  }

  // ── Shared widgets ───────────────────────────────────────────────────

  /** The focusable step heading (`#wizard-step-heading`, tabIndex -1). */
  stepHeading(): Locator {
    return this.page.locator('#wizard-step-heading');
  }

  /** The reconciliation / expiry notice (role=status), if present. */
  notice(): Locator {
    return this.page.getByRole('status');
  }

  continueButton(): Locator {
    // Desktop inline Continue (lg:inline-flex). The mobile sticky bar carries
    // its own Continue; at the Desktop Chrome viewport the inline one shows.
    return this.page.getByRole('button', { name: 'Continue' });
  }

  backButton(): Locator {
    return this.page.getByRole('button', { name: 'Back' });
  }

  // ── Step 1: service ──────────────────────────────────────────────────

  serviceGroup(): Locator {
    return this.page.getByRole('radiogroup', { name: 'Choose a service' });
  }

  /** Select a service by its visible accessible name (the service name). */
  async pickService(name: string | RegExp): Promise<void> {
    await this.serviceGroup()
      .getByRole('radio', { name })
      .first()
      .click();
  }

  /** Select the first service radio in the group (deterministic order). */
  async pickFirstService(): Promise<string> {
    const first = this.serviceGroup().getByRole('radio').first();
    const label = (await first.getAttribute('aria-label')) ?? '';
    await first.click();
    return label;
  }

  // ── Step 2: barber ───────────────────────────────────────────────────

  barberGroup(): Locator {
    return this.page.getByRole('radiogroup', { name: 'Choose a barber' });
  }

  async pickBarber(name: string | RegExp): Promise<void> {
    await this.barberGroup().getByRole('radio', { name }).first().click();
  }

  /**
   * Select the first concrete barber (the one after "Any available barber").
   * Returns its accessible name fragment for assertions.
   */
  async pickFirstConcreteBarber(): Promise<void> {
    const radios = this.barberGroup().getByRole('radio');
    // index 0 is "Any available barber"; index 1 is the first concrete one.
    await radios.nth(1).click();
  }

  async pickAnyBarber(): Promise<void> {
    await this.barberGroup()
      .getByRole('radio', { name: /Any available barber/i })
      .click();
  }

  // ── Step 3: date + time ──────────────────────────────────────────────

  dateGroup(): Locator {
    return this.page.getByRole('radiogroup', { name: 'Choose a date' });
  }

  timeGroup(): Locator {
    return this.page.getByRole('radiogroup', { name: 'Choose a start time' });
  }

  /** Pick the first offered date. */
  async pickFirstDate(): Promise<void> {
    await this.dateGroup().getByRole('radio').first().click();
  }

  /**
   * The available time slots are `radio`s; disabled slots are NOT in the
   * radiogroup role tree (they are `aria-disabled` buttons), so `getByRole
   * radio` returns ONLY the selectable ones.
   */
  availableSlots(): Locator {
    return this.timeGroup().getByRole('radio');
  }

  /** Disabled (unavailable) slots — buttons with aria-disabled. */
  disabledSlots(): Locator {
    return this.timeGroup().locator('button[aria-disabled="true"]');
  }

  /** Pick the first available time slot; returns its accessible name. */
  async pickFirstAvailableSlot(): Promise<string> {
    const slot = this.availableSlots().first();
    await slot.waitFor({ state: 'visible' });
    const label = (await slot.getAttribute('aria-label')) ?? '';
    await slot.click();
    return label;
  }

  // ── Step 4: details ──────────────────────────────────────────────────

  detailsForm(): Locator {
    return this.page.locator('#wizard-details-form');
  }

  nameInput(): Locator {
    return this.page.getByLabel('Name');
  }

  emailInput(): Locator {
    return this.page.getByLabel('Email');
  }

  phoneInput(): Locator {
    return this.page.getByLabel('Phone');
  }

  notesInput(): Locator {
    return this.page.getByLabel(/Notes/);
  }

  confirmButton(): Locator {
    return this.page.getByRole('button', { name: /Confirm booking/i });
  }

  async fillDetails(details: {
    name: string;
    email: string;
    phone: string;
    notes?: string;
  }): Promise<void> {
    await this.nameInput().fill(details.name);
    await this.emailInput().fill(details.email);
    await this.phoneInput().fill(details.phone);
    if (details.notes) await this.notesInput().fill(details.notes);
  }

  // ── Step 5: confirmation ─────────────────────────────────────────────

  /** The "Confirmed" heading region — proves we reached confirmation. */
  confirmedHeading(): Locator {
    return this.page.getByRole('heading', { name: /You are booked in/i });
  }

  bookingReference(): Locator {
    // The reference is rendered under the "Booking reference" label.
    return this.page.getByText(/^RE-[0-9A-Z]{6}$/);
  }

  addToCalendarButton(): Locator {
    return this.page.getByRole('button', { name: /Add to calendar/i });
  }

  demoDisclaimer(): Locator {
    return this.page.getByText(/This is a demo\. No real appointment/i);
  }

  /**
   * Drive the full happy path from a fresh service step to confirmation,
   * choosing the first available option at each step. Returns the captured
   * booking reference text.
   */
  async completeHappyPath(details: {
    name: string;
    email: string;
    phone: string;
    notes?: string;
  }): Promise<string> {
    await this.pickFirstService();
    await expect(this.barberGroup()).toBeVisible();

    await this.pickFirstConcreteBarber();
    await expect(this.dateGroup()).toBeVisible();

    await this.pickFirstDate();
    await this.pickFirstAvailableSlot();
    await this.continueButton().click();

    await expect(this.detailsForm()).toBeVisible();
    await this.fillDetails(details);
    await this.confirmButton().click();

    await expect(this.confirmedHeading()).toBeVisible();
    return (await this.bookingReference().first().textContent()) ?? '';
  }
}
