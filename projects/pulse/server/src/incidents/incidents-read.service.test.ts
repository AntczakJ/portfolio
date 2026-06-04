import { NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import type { CurrentOwnerService } from '../auth/current-owner';
import { incidentsListQuerySchema } from '../lib/schemas/incidents-list';
import type { MonitorsService } from '../monitors/monitors.service';
import { IncidentsReadController } from './incidents-read.controller';
import {
  IncidentsReadService,
  toIncidentListItem,
  type RawIncidentRow,
} from './incidents-read.service';

/**
 * Incident-list read tests (Phase 5 read surface):
 *   - the pure row mapper (`toIncidentListItem`) — the open/closed duration math
 *     and the exact wire shape the frontend consumes,
 *   - the service scoping (cross-monitor list scopes by OWNER; single-monitor
 *     list scopes by MONITOR id; the optional status filter narrows the WHERE),
 *   - the controller OWNERSHIP gate (404 on a monitor the demo user doesn't own
 *     — `MonitorsService.getOwned` throws NotFoundException, which propagates),
 *   - the query validation (limit bounds + the optional status enum).
 *
 * The DB is a tiny fake that records the calls the service makes (the same
 * style as `alerts.service.test.ts`), so the test runs without Postgres.
 */

const STARTED = new Date('2026-06-04T10:00:00.000Z');
const RESOLVED = new Date('2026-06-04T10:01:00.000Z'); // +60s
const NOW = new Date('2026-06-04T10:05:00.000Z'); // +300s from start

function rawRow(over: Partial<RawIncidentRow>): RawIncidentRow {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    monitorId: '22222222-2222-2222-2222-222222222222',
    monitorName: 'API',
    monitorUrl: 'https://api.example.com',
    status: 'resolved',
    severity: 'down',
    startedAt: STARTED,
    resolvedAt: RESOLVED,
    cause: 'down after 3 consecutive down checks',
    ...over,
  };
}

describe('toIncidentListItem (pure mapper)', () => {
  it('maps a CLOSED incident with the resolved duration and the full wire shape', () => {
    const item = toIncidentListItem(rawRow({}), NOW);
    expect(item).toEqual({
      id: '11111111-1111-1111-1111-111111111111',
      monitorId: '22222222-2222-2222-2222-222222222222',
      monitorName: 'API',
      monitorUrl: 'https://api.example.com',
      status: 'resolved',
      severity: 'down',
      startedAt: '2026-06-04T10:00:00.000Z',
      resolvedAt: '2026-06-04T10:01:00.000Z',
      durationMs: 60_000,
      cause: 'down after 3 consecutive down checks',
    });
  });

  it('maps an OPEN incident with the still-accruing duration (now - started)', () => {
    const item = toIncidentListItem(
      rawRow({ status: 'open', resolvedAt: null, severity: 'degraded' }),
      NOW,
    );
    expect(item.status).toBe('open');
    expect(item.resolvedAt).toBeNull();
    expect(item.severity).toBe('degraded');
    // 300s of accrual so the live row counts up off a real baseline.
    expect(item.durationMs).toBe(300_000);
  });

  it('clamps a negative duration to 0 (clock skew never goes negative)', () => {
    const future = new Date(NOW.getTime() + 10_000);
    const item = toIncidentListItem(rawRow({ status: 'open', resolvedAt: null, startedAt: future }), NOW);
    expect(item.durationMs).toBe(0);
  });
});

/**
 * A minimal fake Drizzle that captures the query chain the read service builds
 * and returns canned rows. It records whether `innerJoin` was called (the
 * cross-monitor list joins monitors; the single-monitor list does not) and the
 * limit, so we can assert scoping without a real DB.
 */
function makeFakeDb(rows: unknown[]): {
  db: unknown;
  calls: { joined: boolean; limit: number | null };
} {
  const calls = { joined: false, limit: null as number | null };
  const builder = {
    from: () => builder,
    innerJoin: () => {
      calls.joined = true;
      return builder;
    },
    where: () => builder,
    orderBy: () => builder,
    limit: (n: number) => {
      calls.limit = n;
      return Promise.resolve(rows);
    },
  };
  const db = { select: () => builder };
  return { db, calls };
}

describe('IncidentsReadService scoping', () => {
  it('listForOwner JOINS monitors and applies the limit (cross-monitor scope)', async () => {
    const { db, calls } = makeFakeDb([
      {
        id: '11111111-1111-1111-1111-111111111111',
        monitorId: '22222222-2222-2222-2222-222222222222',
        monitorName: 'API',
        monitorUrl: 'https://api.example.com',
        status: 'resolved',
        severity: 'down',
        startedAt: STARTED,
        resolvedAt: RESOLVED,
        cause: 'down after 3 consecutive down checks',
      },
    ]);
    const service = new IncidentsReadService(db as never);

    const res = await service.listForOwner('owner-1', 20, undefined, NOW);

    expect(calls.joined).toBe(true); // cross-monitor list joins monitors
    expect(calls.limit).toBe(20);
    expect(res.monitorId).toBeNull(); // cross-monitor list has no scope id
    expect(res.items).toHaveLength(1);
    expect(res.items[0]?.monitorName).toBe('API');
    expect(res.items[0]?.durationMs).toBe(60_000);
  });

  it('listForMonitor does NOT join, scopes by monitor id, and passes through name/url', async () => {
    const { db, calls } = makeFakeDb([
      {
        id: '11111111-1111-1111-1111-111111111111',
        monitorId: '22222222-2222-2222-2222-222222222222',
        status: 'open',
        severity: 'down',
        startedAt: STARTED,
        resolvedAt: null,
        cause: 'down after 3 consecutive down checks',
      },
    ]);
    const service = new IncidentsReadService(db as never);

    const res = await service.listForMonitor(
      '22222222-2222-2222-2222-222222222222',
      'API',
      'https://api.example.com',
      50,
      'open',
      NOW,
    );

    expect(calls.joined).toBe(false); // single-monitor list needs no join
    expect(calls.limit).toBe(50);
    expect(res.monitorId).toBe('22222222-2222-2222-2222-222222222222');
    expect(res.items[0]?.status).toBe('open');
    // name/url passed through so the shape stays uniform with the cross list.
    expect(res.items[0]?.monitorName).toBe('API');
    expect(res.items[0]?.monitorUrl).toBe('https://api.example.com');
    // open incident -> accruing duration.
    expect(res.items[0]?.durationMs).toBe(300_000);
  });
});

describe('IncidentsReadController ownership 404', () => {
  it('propagates the NotFoundException from getOwned for a foreign monitor id', async () => {
    const listForMonitor = vi.fn();
    const incidents = {
      listForMonitor,
    } as unknown as IncidentsReadService;
    const monitors = {
      getOwned: vi.fn().mockRejectedValue(new NotFoundException('monitor not found')),
    } as unknown as MonitorsService;
    // The owner seam resolves a (demo) owner id from the request; ownership is
    // still enforced by getOwned, which 404s for a foreign monitor id.
    const currentOwner = {
      resolveOwnerUserId: vi.fn().mockResolvedValue('owner-1'),
    } as unknown as CurrentOwnerService;

    const controller = new IncidentsReadController(incidents, monitors, currentOwner);

    await expect(
      controller.listForMonitor(
        { headers: {} },
        '33333333-3333-3333-3333-333333333333',
        { limit: 20 },
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    // The read service is never reached for a monitor the user does not own.
    expect(listForMonitor).not.toHaveBeenCalled();
  });
});

describe('incidentsListQuerySchema (query validation at the boundary)', () => {
  it('defaults limit to 20 and leaves status optional', () => {
    const parsed = incidentsListQuerySchema.parse({});
    expect(parsed.limit).toBe(20);
    expect(parsed.status).toBeUndefined();
  });

  it('coerces a string limit and accepts a valid status filter', () => {
    const parsed = incidentsListQuerySchema.parse({ limit: '5', status: 'open' });
    expect(parsed.limit).toBe(5);
    expect(parsed.status).toBe('open');
  });

  it('rejects limit below 1, above 100, and an unknown status', () => {
    expect(incidentsListQuerySchema.safeParse({ limit: '0' }).success).toBe(false);
    expect(incidentsListQuerySchema.safeParse({ limit: '101' }).success).toBe(false);
    expect(incidentsListQuerySchema.safeParse({ status: 'flapping' }).success).toBe(false);
  });
});
