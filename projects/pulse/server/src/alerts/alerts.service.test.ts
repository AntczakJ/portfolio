import { describe, expect, it, vi } from 'vitest';

import type { AlertChannel, Incident, Monitor } from '../db/schema';
import type { EventsPublisherService } from '../events/events-publisher.service';
import type { DeliveryResult } from './alert-dispatcher';
import { AlertsService } from './alerts.service';
import type { EmailDispatcher } from './email-dispatcher';
import type { WebhookDispatcher } from './webhook-dispatcher';

/**
 * Alert de-dup tests (Task 5.2, ADR-005). The "one alert per (incident, channel,
 * transition)" invariant is enforced at the DB by the unique
 * `(incident_id, alert_channel_id, transition)` constraint. `AlertsService`
 * claims the slot via `INSERT ... ON CONFLICT DO NOTHING` BEFORE the network
 * call, so a re-fire is a clean skip. This test models that constraint with a
 * tiny in-memory fake and proves a second dispatch for the same transition
 * neither sends again nor publishes a second `alert.fired`.
 */

const monitor = {
  id: 'm-1',
  userId: 'u-1',
  name: 'API',
  targetUrl: 'https://api.example.com',
} as unknown as Monitor;

const incident = {
  id: 'i-1',
  monitorId: 'm-1',
  severity: 'down',
  startedAt: new Date('2026-06-04T10:00:00Z'),
  resolvedAt: null,
} as unknown as Incident;

const webhookChannel = {
  id: 'c-1',
  userId: 'u-1',
  type: 'webhook',
  target: 'https://hook.example.com',
  secret: 'sek',
  isEnabled: true,
} as unknown as AlertChannel;

/**
 * A minimal fake Drizzle that supports exactly the calls AlertsService makes:
 *   - select().from().where()  -> the enabled channels
 *   - insert().values().onConflictDoNothing().returning() -> claim a slot,
 *     honoring the unique (incident, channel, transition) constraint
 *   - update().set().where() -> record the outcome
 */
function makeFakeDb(channels: AlertChannel[]): {
  db: unknown;
  deliveries: Map<string, { status: string; responseCode: number | null }>;
} {
  const deliveries = new Map<string, { status: string; responseCode: number | null }>();

  const db = {
    select: () => ({
      from: () => ({
        where: () => Promise.resolve(channels),
      }),
    }),
    insert: () => ({
      values: (vals: { incidentId: string; alertChannelId: string; transition: string }) => ({
        onConflictDoNothing: () => ({
          returning: () => {
            const key = `${vals.incidentId}|${vals.alertChannelId}|${vals.transition}`;
            if (deliveries.has(key)) return Promise.resolve([]); // conflict -> no row
            deliveries.set(key, { status: 'failed', responseCode: null });
            // The row id encodes the key so the update can find it.
            return Promise.resolve([{ id: key }]);
          },
        }),
      }),
    }),
    update: () => ({
      set: (vals: { status: string; responseCode: number | null }) => ({
        where: () => {
          // We cannot read the id here, so record onto the most-recent claim by
          // scanning for the failed placeholder; simplest: update all failed.
          for (const [k, v] of deliveries) {
            if (v.status === 'failed') deliveries.set(k, vals);
          }
          return Promise.resolve(undefined);
        },
      }),
    }),
  };

  return { db, deliveries };
}

function makeService(channels: AlertChannel[], dispatchResult: DeliveryResult) {
  const { db, deliveries } = makeFakeDb(channels);
  const dispatch = vi.fn().mockResolvedValue(dispatchResult);
  const webhook = { channelType: 'webhook' as const, dispatch } as unknown as WebhookDispatcher;
  const email = {
    channelType: 'email' as const,
    dispatch: vi.fn(),
  } as unknown as EmailDispatcher;
  const publishAlertFired = vi.fn().mockResolvedValue(undefined);
  const events = { publishAlertFired } as unknown as EventsPublisherService;

  const service = new AlertsService(
    db as never,
    events,
    webhook,
    email,
  );
  return { service, dispatch, publishAlertFired, deliveries };
}

describe('AlertsService — de-dup by DB constraint', () => {
  it('fires once for an open transition: dispatches + publishes alert.fired', async () => {
    const { service, dispatch, publishAlertFired } = makeService(
      [webhookChannel],
      { status: 'sent', responseCode: 200, mock: false },
    );

    await service.dispatchForTransition(monitor, incident, 'open');

    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(publishAlertFired).toHaveBeenCalledTimes(1);
    expect(publishAlertFired.mock.calls[0]?.[0]).toBe('u-1'); // owner scope
    expect(publishAlertFired.mock.calls[0]?.[1]).toMatchObject({
      incidentId: 'i-1',
      monitorId: 'm-1',
      channelType: 'webhook',
      transition: 'open',
      status: 'sent',
    });
  });

  it('a SECOND open dispatch for the same incident+channel is a no-op (de-dup)', async () => {
    const { service, dispatch, publishAlertFired } = makeService(
      [webhookChannel],
      { status: 'sent', responseCode: 200, mock: false },
    );

    await service.dispatchForTransition(monitor, incident, 'open');
    await service.dispatchForTransition(monitor, incident, 'open');

    // The unique constraint blocked the second claim, so no second send / event.
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(publishAlertFired).toHaveBeenCalledTimes(1);
  });

  it('open and close are SEPARATE transitions — both fire once each', async () => {
    const { service, dispatch } = makeService(
      [webhookChannel],
      { status: 'sent', responseCode: 200, mock: false },
    );

    await service.dispatchForTransition(monitor, incident, 'open');
    await service.dispatchForTransition(monitor, incident, 'close');

    expect(dispatch).toHaveBeenCalledTimes(2);
    expect(dispatch.mock.calls[0]?.[3]).toBe('open');
    expect(dispatch.mock.calls[1]?.[3]).toBe('close');
  });

  it('no enabled channels => no dispatch, no event', async () => {
    const { service, dispatch, publishAlertFired } = makeService(
      [],
      { status: 'sent', responseCode: 200, mock: false },
    );
    await service.dispatchForTransition(monitor, incident, 'open');
    expect(dispatch).not.toHaveBeenCalled();
    expect(publishAlertFired).not.toHaveBeenCalled();
  });

  it('a failed delivery still records + publishes (failed), and still de-dups', async () => {
    const { service, dispatch, publishAlertFired } = makeService(
      [webhookChannel],
      { status: 'failed', responseCode: 500, mock: false },
    );
    await service.dispatchForTransition(monitor, incident, 'open');
    await service.dispatchForTransition(monitor, incident, 'open');
    expect(dispatch).toHaveBeenCalledTimes(1); // de-dup holds even on failure
    expect(publishAlertFired).toHaveBeenCalledTimes(1);
    expect(publishAlertFired.mock.calls[0]?.[1]).toMatchObject({ status: 'failed' });
  });
});
