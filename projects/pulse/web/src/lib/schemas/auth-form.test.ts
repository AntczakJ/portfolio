import { describe, expect, it } from 'vitest';

import { signInFormSchema, signUpFormSchema } from './auth-form';

/**
 * The auth form schemas mirror better-auth's server-side rules (email format +
 * the 8-char password floor) so the dialog gives immediate, accessible field
 * feedback before the request (Task 6.4, conventions § 5).
 */

describe('signInFormSchema', () => {
  it('accepts a valid email + non-empty password', () => {
    const r = signInFormSchema.safeParse({
      email: 'ada@example.com',
      password: 'whatever',
    });
    expect(r.success).toBe(true);
  });

  it('rejects an invalid email', () => {
    const r = signInFormSchema.safeParse({ email: 'nope', password: 'x' });
    expect(r.success).toBe(false);
  });

  it('rejects an empty password', () => {
    const r = signInFormSchema.safeParse({
      email: 'ada@example.com',
      password: '',
    });
    expect(r.success).toBe(false);
  });

  it('trims the email', () => {
    const r = signInFormSchema.parse({
      email: '  ada@example.com  ',
      password: 'x',
    });
    expect(r.email).toBe('ada@example.com');
  });
});

describe('signUpFormSchema', () => {
  it('accepts a valid name + email + 8-char password', () => {
    const r = signUpFormSchema.safeParse({
      name: 'Ada Lovelace',
      email: 'ada@example.com',
      password: '12345678',
    });
    expect(r.success).toBe(true);
  });

  it('rejects a password shorter than 8 characters', () => {
    const r = signUpFormSchema.safeParse({
      name: 'Ada',
      email: 'ada@example.com',
      password: '1234567',
    });
    expect(r.success).toBe(false);
  });

  it('rejects an empty name', () => {
    const r = signUpFormSchema.safeParse({
      name: '   ',
      email: 'ada@example.com',
      password: '12345678',
    });
    expect(r.success).toBe(false);
  });
});
