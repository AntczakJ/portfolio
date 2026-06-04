import type { Locator, Page } from '@playwright/test';

import { demoStatusSlug } from './env';

/**
 * Page Object for the public status page (`/status/[slug]`).
 *
 * SSRs from `GET /public/:slug` (the SEO floor — the first paint carries the
 * real redacted content), then live-updates off the redacted public SSE stream.
 * It carries STRICTLY the redacted subset: per-monitor status + 30-day uptime %,
 * and a recent-incident timeline (severity + cause). It must NEVER carry raw
 * response times, private monitors, alert data, or the internal "wow-moment
 * target" label.
 *
 * The overall banner ("All systems operational" / "Degraded performance" /
 * "Active outage") is server-derived and floored so it can never read
 * operational while an incident is open (the C-3 fix).
 */
export class PublicStatusPage {
  readonly page: Page;
  readonly slug: string;

  constructor(page: Page, slug = demoStatusSlug()) {
    this.page = page;
    this.slug = slug;
  }

  async goto(): Promise<void> {
    await this.page.goto(`/status/${this.slug}`, {
      waitUntil: 'domcontentloaded',
    });
  }

  /** The overall-status banner region (the H1 lives inside it). */
  overallBanner(): Locator {
    return this.page.getByRole('region', { name: 'Overall status' });
  }

  /** The banner headline H1. */
  headline(): Locator {
    return this.overallBanner().getByRole('heading', { level: 1 });
  }

  /** The "Monitored services" section. */
  servicesSection(): Locator {
    return this.page.getByRole('region', { name: 'Monitored services' });
  }

  /** A public monitor row by name. */
  monitorRow(name: string): Locator {
    return this.servicesSection().getByRole('listitem').filter({ hasText: name });
  }

  /** The whole document text, for leak assertions. */
  async bodyText(): Promise<string> {
    return this.page.locator('body').innerText();
  }
}
