import { describe, expect, it, vi } from 'vitest';

import type { PulseDb } from '../db/drizzle';
import type { MonitorReadService } from '../monitors/monitor-read.service';
import {
  deriveOverallStatus,
  publicMonitorLeakedKeys,
} from './public-status.derive';
import { PublicStatusService } from './public-status.service';

/**
 * Public status-page tests (Task 6.3) — the redaction guarantee + the banner
 * derivation. The privacy boundary is the load-bearing assertion: a private
 * field (response time, target URL, user id, secret, error, interval, ...)
 * must NEVER appear on the public payload.
 */

describe('deriveOverallStatus (the banner)', () => {
  it('is operational when all monitors are up or null', () => {
    expect(
      deriveOverallStatus([{ status: 'up' }, { status: null }, { status: 'up' }]),
    ).toBe('operational');
  });

  it('is degraded when some are degraded and none are down', () => {
    expect(
      deriveOverallStatus([{ status: 'up' }, { status: 'degraded' }]),
    ).toBe('degraded');
  });

  it('is outage when ANY monitor is down (down dominates degraded)', () => {
    expect(
      deriveOverallStatus([{ status: 'degraded' }, { status: 'down' }, { status: 'up' }]),
    ).toBe('outage');
  });

  it('an empty page is operational', () => {
    expect(deriveOverallStatus([])).toBe('operational');
  });
});

describe('publicMonitorLeakedKeys (the redaction guard)', () => {
  it('accepts the public-safe key set', () => {
    expect(
      publicMonitorLeakedKeys({ id: 'x', name: 'n', status: 'up', uptimePercent: 99 }),
    ).toEqual([]);
  });

  it('flags any private field that sneaks onto the row', () => {
    expect(
      publicMonitorLeakedKeys({
        id: 'x',
        name: 'n',
        status: 'up',
        uptimePercent: 99,
        responseTimeMs: 123, // a private field that must never appear
        targetUrl: 'https://secret.internal',
        userId: 'owner-1',
      }),
    ).toEqual(['responseTimeMs', 'targetUrl', 'userId']);
  });
});

describe('PublicStatusService.getBySlug — the end-to-end redaction', () => {
  /**
   * Drive the service with a stub Drizzle that returns a page, ONE published
   * monitor (carrying private columns the row select would include), and one
   * incident — then assert the SERIALIZED payload exposes ONLY the public
   * subset (no raw response time, no target URL, no user id, no secret).
   */
  it('serializes only the redacted public subset (no private fields leak)', async () => {
    const page = {
      id: 'page-1',
      slug: 'demo',
      title: 'Pulse Demo Status',
      description: 'A demo status page',
    };
    const publishedMonitorId = '22222222-2222-2222-2222-222222222222';
    // A FULL monitor row (as `select().from(monitors)` returns) — it carries
    // private columns (targetUrl, userId, timeoutMs, ...) the service must NOT
    // surface.
    const fullMonitorRow = {
      id: publishedMonitorId,
      userId: 'owner-1',
      name: 'API',
      targetUrl: 'https://api.internal.example.com/health',
      method: 'GET',
      intervalSeconds: 60,
      timeoutMs: 10_000,
      expectedStatus: 200,
      expectedKeyword: null,
      degradedThresholdMs: 1000,
      failureThreshold: 3,
      recoveryThreshold: 2,
      isPublic: true,
      isPaused: false,
      currentStatus: 'up',
      lastCheckedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    // The service issues four selects in order (page by slug, the published
    // join, the full monitor rows, the incidents); a sequenced fake returns one
    // queued result per select chain.
    const sequenced = makeSequencedDb([
      [page], // 1: page by slug
      [{ monitorId: publishedMonitorId }], // 2: published join
      [fullMonitorRow], // 3: full monitor rows
      [
        {
          id: 'inc-1',
          monitorId: publishedMonitorId,
          monitorName: 'API',
          status: 'resolved',
          severity: 'down',
          startedAt: new Date('2026-06-01T00:00:00Z'),
          resolvedAt: new Date('2026-06-01T00:05:00Z'),
          cause: 'down after 3 consecutive down checks',
        },
      ], // 4: incidents
    ]);

    const monitorRead = {
      uptime: vi.fn().mockResolvedValue({ uptimePercent: 99.87654 }),
    } as unknown as MonitorReadService;

    const svc = new PublicStatusService(sequenced, monitorRead);
    const payload = await svc.getBySlug('demo', new Date('2026-06-02T00:00:00Z'));

    // Page metadata only.
    expect(payload.slug).toBe('demo');
    expect(payload.title).toBe('Pulse Demo Status');
    expect(payload.overall).toBe('operational');

    // The monitor row is REDACTED: id + name + status + uptime% only.
    expect(payload.monitors).toHaveLength(1);
    const m = payload.monitors[0];
    if (!m) throw new Error('expected one public monitor');
    expect(publicMonitorLeakedKeys(m as unknown as Record<string, unknown>)).toEqual([]);
    expect(m.name).toBe('API');
    expect(m.status).toBe('up');
    expect(m.uptimePercent).toBe(99.88); // rounded to 2dp
    // The private fields are absent.
    expect((m as Record<string, unknown>).targetUrl).toBeUndefined();
    expect((m as Record<string, unknown>).userId).toBeUndefined();
    expect((m as Record<string, unknown>).responseTimeMs).toBeUndefined();

    // Incident carries the window + severity + cause, no check timing.
    expect(payload.incidents).toHaveLength(1);
    const inc = payload.incidents[0];
    if (!inc) throw new Error('expected one public incident');
    expect(inc.severity).toBe('down');
    expect(inc.durationMs).toBe(5 * 60 * 1000);
    expect(inc.resolvedAt).toBe('2026-06-01T00:05:00.000Z');
    expect((inc as Record<string, unknown>).responseTimeMs).toBeUndefined();
  });
});

/**
 * A minimal Drizzle stub that returns the supplied result arrays in order, one
 * per top-level `select()` chain. Every chain method returns `this` and the
 * terminal `await` resolves the next queued result. Supports the chain shapes
 * the service uses: `.from().where().limit()`, `.from().where()`,
 * `.from().innerJoin().where().orderBy().limit()`.
 */
function makeSequencedDb(results: unknown[][]): PulseDb {
  let i = 0;
  const select = (): unknown => {
    const result = results[i++] ?? [];
    const builder: Record<string, unknown> = {};
    const chain = (): unknown => builder;
    builder.from = chain;
    builder.where = chain;
    builder.innerJoin = chain;
    builder.orderBy = chain;
    builder.limit = chain;
    // Make the builder awaitable (thenable) so `await db.select()...` resolves
    // to the queued result whatever the terminal method was.
    builder.then = (resolve: (v: unknown) => void): void => {
      resolve(result);
    };
    return builder;
  };
  return { select } as unknown as PulseDb;
}
