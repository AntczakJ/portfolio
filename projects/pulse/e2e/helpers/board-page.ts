import type { Locator, Page } from '@playwright/test';
import { expect } from '@playwright/test';

/**
 * Page Object for the authenticated dashboard board (`/dashboard`).
 *
 * The board renders from `GET /monitors` (TanStack Query) and live-updates over
 * one `EventSource` on `/api/stream`. Cards are `<li>`s inside the "Status
 * board" section, each a `MonitorCard` carrying `data-monitor-id` +
 * `data-status` and an accessible "Open <name> detail" link. Status is never
 * color-alone (the StatusDot carries a visible text label), the connection
 * indicator is a `role="status"` pill, and the summary bar carries the
 * "All systems operational" / "Outage detected" headline.
 *
 * Selectors prefer accessible queries (role / name / text). The two `data-*`
 * attributes on the card are the one concession — the live status of a specific
 * monitor is genuinely a state attribute (there is no semantic role for
 * "this card's machine-readable status"), and waiting on `data-status` is the
 * robust way to wait on REAL probe state without a fixed sleep.
 */
export class BoardPage {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  async goto(): Promise<void> {
    await this.page.goto('/dashboard', { waitUntil: 'domcontentloaded' });
  }

  section(): Locator {
    return this.page.getByRole('region', { name: 'Status board' });
  }

  /** The "Live" / "Connecting" connection indicator pill (role=status). */
  connectionIndicator(): Locator {
    // The pill is a role="status"; scope to the one that carries the live label
    // vocabulary so the aria-live announcer region (also role=status) is not
    // matched.
    return this.page
      .getByRole('status')
      .filter({ hasText: /Live|Connecting|Reconnecting/ });
  }

  /** Wait for the EventSource to report a live connection. */
  async waitForLive(): Promise<void> {
    await expect(this.connectionIndicator()).toContainText('Live', {
      timeout: 20_000,
    });
  }

  /** All monitor cards on the board. */
  cards(): Locator {
    return this.section().locator('[data-monitor-id]');
  }

  /** A specific card by its visible monitor name (the card heading). */
  cardByName(name: string): Locator {
    return this.cards().filter({ hasText: name });
  }

  /**
   * The "New monitor" CTA. The board header carries one; the empty-state also
   * renders its own copy, so `.first()` pins the header instance (always
   * present, both populated and empty).
   */
  newMonitorButton(): Locator {
    return this.page.getByRole('button', { name: /New monitor/i }).first();
  }

  /** The "Trigger demo incident" button. */
  demoButton(): Locator {
    return this.page.getByRole('button', {
      name: /Trigger demo incident|Arming demo|Incident in progress|Recovering|Demo complete/i,
    });
  }

  /** The board summary bar headline ("All systems operational" / "Outage detected"). */
  summaryHeadline(): Locator {
    return this.section().getByText(
      /All systems operational|Outage detected|Degraded performance|Awaiting first checks/,
    );
  }

  /** The live incident strip that materialises at the top of the board on open. */
  liveIncidentStrip(): Locator {
    // The strip renders an "active incident" region/text when an incident opens.
    return this.section().getByText(/active incident/i);
  }

  /**
   * Wait for a given card to read a given status, polling the `data-status`
   * attribute. This is how the suite waits on REAL probe / incident state
   * instead of a fixed sleep.
   */
  async waitForCardStatus(
    name: string,
    status: 'up' | 'down' | 'degraded' | 'unknown',
    timeout = 75_000,
  ): Promise<void> {
    const card = this.cardByName(name).first();
    await expect(card).toHaveAttribute('data-status', status, { timeout });
  }
}
