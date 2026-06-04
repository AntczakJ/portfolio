import {
  Controller,
  Get,
  Inject,
  InternalServerErrorException,
  NotFoundException,
  Post,
  UseGuards,
} from '@nestjs/common';

import { RateLimitGuard } from '../common/rate-limit.guard';
import { AppConfigService } from '../config/app-config.service';
import { DemoFlagService } from './demo-flag.service';

/**
 * The demo-incident trigger (Task 5.3, ADR-006) — the wow-moment beat.
 *
 * Two routes, BOTH gated by `DEMO_TRIGGER_ENABLED` (404 when disabled so a
 * deployed environment can switch the recruiter-facing trigger off):
 *
 *   - `GET /demo/flaky` — the OWNED flaky endpoint the demo monitor probes.
 *     Returns 200 + a small JSON body normally; returns 500 while the Redis flag
 *     is armed. A REAL probe of it records `up` normally and `down` while armed,
 *     so the genuine incident pipeline fires (no faked arc).
 *
 *   - `POST /demo/trigger` — arms the flag (sets it to fail) for a fixed window,
 *     then lets the Redis TTL auto-recover it. The real probe cycle detects N
 *     consecutive failures, opens an incident, fires the (signed) webhook, then
 *     on recovery records M successes and auto-closes. Idempotent / safe to spam
 *     (re-arming just refreshes the TTL; the single-open + de-dup invariants
 *     prevent any double-fire).
 *
 * TIMING (documented, finalized — ADR-006). The demo monitor is seeded with a
 * SHORT 15 s interval and demo-only thresholds N=2 fail to open / M=1 success to
 * close (see `scripts/seed-demo-monitor.ts`), so the full incident arc completes
 * inside the ~30-45 s wow-moment budget after `POST /demo/trigger`:
 *
 *   t=0      trigger arms the flaky flag for FAIL_WINDOW_SECONDS (35 s)
 *   t<=15s   probe #1 records `down`        (consecutiveBad = 1)
 *   t<=30s   probe #2 records `down`        (consecutiveBad = 2 == N) -> OPEN
 *            -> incident.open + SIGNED webhook + mock email fire here
 *   t=35s    flag auto-expires (Redis TTL) -> /demo/flaky returns 200 again
 *   t<=45s   next probe records `up`        (consecutiveGood = 1 == M) -> CLOSE
 *            -> incident.close + signed close webhook fire here
 *
 * So open lands ~30 s after the trigger and close ~45 s after — within budget.
 * The 35 s window comfortably guarantees the >=2 failing probes needed to open
 * even under worst-case probe-phase alignment (35 / 15 = 2.3 probes), and clears
 * in time for the recovery probe to close inside the budget. FAIL_WINDOW_SECONDS
 * is tuned to the seeded interval + thresholds; if you change one, retune it.
 *
 * The 15 s interval is BELOW the CRUD schema's 30 s floor on purpose — the demo
 * monitor is SEEDED directly (the row is written below the create-API floor),
 * not created through `POST /monitors`. This is the documented exception: the
 * floor protects user-created monitors from hammering third-party targets; the
 * demo monitor targets the app's OWN `/demo/flaky`, so a tighter interval is
 * safe and is what makes the arc fast enough to hold a recruiter.
 *
 * SSRF NOTE (ADR-006): `/demo/flaky` is served by the app's OWN public origin,
 * so the demo monitor targets `https://<pulse-api-host>/demo/flaky` in prod —
 * inside the SSRF allowlist (a public host, not a private/internal address). In
 * LOCAL dev the host resolves to localhost, which the SSRF guard blocks at probe
 * time; for a local verify, point the demo monitor at a public tunnel to the
 * app, or run the verify against the deployed host. The endpoint logic is
 * identical either way — only the monitor's target host differs.
 */

/**
 * How long the flaky endpoint stays failing after a trigger. Tuned to the
 * seeded demo monitor's 15 s interval + N=2 / M=1 thresholds (see the class
 * doc above): 35 s guarantees >=2 failing probes to OPEN the incident + fire
 * the signed webhook, then auto-clears so the next probe records `up` and
 * CLOSES the incident, with the whole arc landing in the ~30-45 s budget.
 *
 * Exposed on the demo controller (`failWindowSeconds` in the trigger response)
 * so the UI can show an accurate "recovering in Ns" countdown.
 */
const FAIL_WINDOW_SECONDS = 35;

@Controller('demo')
export class DemoController {
  constructor(
    @Inject(DemoFlagService) private readonly flag: DemoFlagService,
    @Inject(AppConfigService) private readonly config: AppConfigService,
  ) {}

  /**
   * The probed endpoint. 200 normally; 500 while armed (so a real probe records
   * `down` / `http_error`). A 500 is raised by throwing — Nest serialises it to
   * a 500 response, which the prober classifies as `down` (status not matching
   * the expected 200).
   */
  @Get('flaky')
  async flaky(): Promise<{ status: 'ok'; ts: number }> {
    this.assertEnabled();
    if (await this.flag.isFailing()) {
      throw new InternalServerErrorException({
        status: 'failing',
        message: 'demo flaky endpoint is armed to fail',
      });
    }
    return { status: 'ok', ts: Date.now() };
  }

  /**
   * Arm the demo. Idempotent: re-arming refreshes the TTL. Returns the window so
   * the UI can show "recovering in Ns". The actual incident open/close happens
   * organically through the worker's probe cycle — this only flips the flag.
   *
   * RATE LIMITED (reviewer nice-to-have #3): this route stays UNAUTHENTICATED
   * per ADR-007 (the wow moment must be open to a recruiter), but an unlimited
   * trigger lets an attacker keep the demo monitor perpetually armed (a
   * demo-degradation nuisance). A light per-IP fixed-window limit (10/min) keeps
   * the wow open while bounding abuse; `DEMO_TRIGGER_ENABLED` still gates it off
   * entirely. 10/min comfortably covers a genuine "click it a few times" demo.
   */
  @UseGuards(new RateLimitGuard({ windowMs: 60_000, max: 10 }))
  @Post('trigger')
  async trigger(): Promise<{
    armed: true;
    failWindowSeconds: number;
    note: string;
  }> {
    this.assertEnabled();
    await this.flag.arm(FAIL_WINDOW_SECONDS);
    return {
      armed: true,
      failWindowSeconds: FAIL_WINDOW_SECONDS,
      note:
        'demo flaky endpoint is now failing; the demo monitor will record N failures, ' +
        'open an incident, fire the webhook, then auto-recover and close',
    };
  }

  /** Inspect the current demo state (handy for the UI button + the verify). */
  @Get('status')
  async status(): Promise<{ failing: boolean; recoversInSeconds: number }> {
    this.assertEnabled();
    const failing = await this.flag.isFailing();
    const recoversInSeconds = failing ? await this.flag.remainingSeconds() : 0;
    return { failing, recoversInSeconds };
  }

  /** 404 the demo routes entirely when the trigger is disabled (ADR-006). */
  private assertEnabled(): void {
    if (!this.config.demoTriggerEnabled) {
      throw new NotFoundException();
    }
  }
}
