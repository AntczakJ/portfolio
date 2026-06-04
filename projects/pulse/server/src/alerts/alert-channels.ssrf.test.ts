import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';

import type { CreateAlertChannel } from '../lib/schemas/alert-channel';
import { AlertChannelsService } from './alert-channels.service';

/**
 * Create-time SSRF gate on the WEBHOOK target (reviewer must-fix #1, ADR-002).
 *
 * A webhook target is an OUTBOUND URL the worker POSTs to on every incident
 * transition, so it MUST be guarded against internal / metadata / loopback
 * addresses exactly like a probe target. These tests prove the create path runs
 * the same `assertProbeUrlAllowed` shape gate: a channel pointed at a private
 * address (literal IP or `localhost`) is rejected with a 400 `target_not_allowed`
 * BEFORE any row is written; a public webhook target is accepted; and an EMAIL
 * channel is never SSRF-checked (its target is an email address, not a URL).
 */

/** A fake db whose insert path records the values it would have written. */
function makeFakeDb() {
  const inserted: Record<string, unknown>[] = [];
  const db = {
    insert: () => ({
      values: (vals: Record<string, unknown>) => ({
        returning: () => {
          inserted.push(vals);
          return Promise.resolve([
            {
              id: '00000000-0000-0000-0000-000000000001',
              type: vals.type,
              target: vals.target,
              isEnabled: vals.isEnabled ?? true,
              createdAt: new Date('2026-06-01T00:00:00Z'),
            },
          ]);
        },
      }),
    }),
  };
  return { db, inserted };
}

function makeService() {
  const { db, inserted } = makeFakeDb();
  const service = new AlertChannelsService(db as never);
  return { service, inserted };
}

const OWNER = '00000000-0000-0000-0000-0000000000aa';

function webhook(target: string): CreateAlertChannel {
  return { type: 'webhook', target, secret: 'supersecret', isEnabled: true };
}

describe('AlertChannelsService — create-time webhook SSRF gate', () => {
  it('rejects a webhook target at the cloud metadata IP (169.254.169.254)', async () => {
    const { service, inserted } = makeService();
    await expect(
      service.create(OWNER, webhook('http://169.254.169.254/latest/meta-data/')),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(inserted).toHaveLength(0); // never written
  });

  it.each([
    'http://127.0.0.1:8080/hook',
    'http://10.0.0.5/hook',
    'http://192.168.1.10/hook',
    'http://172.16.0.9/hook',
    'http://localhost/hook',
    'http://internal.localhost/hook',
  ])('rejects internal webhook target %s with 400 target_not_allowed', async (target) => {
    const { service, inserted } = makeService();
    const err = await service.create(OWNER, webhook(target)).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect((err as BadRequestException).getResponse()).toMatchObject({
      error: 'target_not_allowed',
    });
    expect(inserted).toHaveLength(0);
  });

  it('rejects a non-http(s) webhook scheme', async () => {
    const { service } = makeService();
    await expect(service.create(OWNER, webhook('ftp://example.com/hook'))).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('accepts a public webhook target and writes the row', async () => {
    const { service, inserted } = makeService();
    const res = await service.create(OWNER, webhook('https://hooks.slack.com/services/T/B/X'));
    expect(res.type).toBe('webhook');
    expect(inserted).toHaveLength(1);
    expect(inserted[0]?.target).toBe('https://hooks.slack.com/services/T/B/X');
  });

  it('does NOT SSRF-check an EMAIL channel (target is an address, not a URL)', async () => {
    const { service, inserted } = makeService();
    const create = service.create.bind(service);
    const res = await create(OWNER, {
      type: 'email',
      target: 'ops@example.com',
      secret: null,
      isEnabled: true,
    });
    expect(res.type).toBe('email');
    expect(inserted).toHaveLength(1);
    // The email channel stores no secret.
    expect(inserted[0]?.secret).toBeNull();
  });
});
