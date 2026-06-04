import { describe, expect, it } from 'vitest';

import {
  alertChannelFormSchema,
  toCreateAlertChannel,
} from './alert-channel-form';

/**
 * The alert-channel form schema mirrors the server's `createAlertChannelSchema`
 * (conventions § 5) and `toCreateAlertChannel` maps the validated output onto
 * the shared `CreateAlertChannel` wire body. These tests pin both: the by-type
 * `target` validation and the secret-handling in the mapping.
 */

describe('alertChannelFormSchema — validation', () => {
  it('accepts a webhook with an http(s) target', () => {
    const r = alertChannelFormSchema.safeParse({
      type: 'webhook',
      target: 'https://hooks.example.com/abc',
      secret: 'supersecret',
    });
    expect(r.success).toBe(true);
  });

  it('rejects a webhook target that is not an http(s) URL', () => {
    const r = alertChannelFormSchema.safeParse({
      type: 'webhook',
      target: 'not-a-url',
      secret: 'supersecret',
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues.some((i) => i.path[0] === 'target')).toBe(true);
    }
  });

  it('rejects a too-short webhook signing secret (when provided)', () => {
    const r = alertChannelFormSchema.safeParse({
      type: 'webhook',
      target: 'https://hooks.example.com/abc',
      secret: 'short',
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues.some((i) => i.path[0] === 'secret')).toBe(true);
    }
  });

  it('accepts an email channel with a valid address', () => {
    const r = alertChannelFormSchema.safeParse({
      type: 'email',
      target: 'ops@example.com',
      secret: '',
    });
    expect(r.success).toBe(true);
  });

  it('rejects an email channel with an invalid address', () => {
    const r = alertChannelFormSchema.safeParse({
      type: 'email',
      target: 'not-an-email',
      secret: '',
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues.some((i) => i.path[0] === 'target')).toBe(true);
    }
  });
});

describe('toCreateAlertChannel — mapping', () => {
  it('maps a webhook with a secret to the wire body', () => {
    const body = toCreateAlertChannel({
      type: 'webhook',
      target: 'https://hooks.example.com/abc',
      secret: 'supersecret',
    });
    expect(body).toEqual({
      type: 'webhook',
      target: 'https://hooks.example.com/abc',
      secret: 'supersecret',
      isEnabled: true,
    });
  });

  it('nulls an empty webhook secret (server falls back to the global key)', () => {
    const body = toCreateAlertChannel({
      type: 'webhook',
      target: 'https://hooks.example.com/abc',
      secret: '',
    });
    expect(body.secret).toBeNull();
  });

  it('never carries a secret for an email channel', () => {
    const body = toCreateAlertChannel({
      type: 'email',
      target: 'ops@example.com',
      secret: 'ignored-for-email',
    });
    expect(body.secret).toBeNull();
    expect(body.target).toBe('ops@example.com');
    expect(body.type).toBe('email');
  });
});
