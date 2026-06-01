import { describe, expect, it } from 'vitest';

import {
  awarenessCursorSchema,
  awarenessIdentitySchema,
  awarenessStateSchema,
  parseAwarenessCursor,
  parseAwarenessIdentity,
} from '../awareness-schemas';

const validIdentity = {
  sessionId: '8f41d59d-9ad8-4db5-94fc-c5a5ced3b43f',
  emojiChar: '\u{1F367}',
  emojiName: 'shaved-ice',
  color: { L: 0.6, C: 0.17, H: 285 },
  colorDark: { L: 0.7, C: 0.18, H: 285 },
};

describe('awarenessIdentitySchema', () => {
  it('accepts a canonical identity payload', () => {
    const result = awarenessIdentitySchema.safeParse(validIdentity);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.sessionId).toBe(validIdentity.sessionId);
      expect(result.data.color.H).toBe(285);
    }
  });

  it('rejects a missing field', () => {
    const { sessionId: _omit, ...withoutSessionId } = validIdentity;
    void _omit;
    const result = awarenessIdentitySchema.safeParse(withoutSessionId);
    expect(result.success).toBe(false);
  });

  it('rejects a non-UUID sessionId', () => {
    const result = awarenessIdentitySchema.safeParse({
      ...validIdentity,
      sessionId: 'not-a-uuid',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a non-numeric color component', () => {
    const result = awarenessIdentitySchema.safeParse({
      ...validIdentity,
      color: { L: 'bright', C: 0.17, H: 285 },
    });
    expect(result.success).toBe(false);
  });

  it('rejects an empty emojiChar', () => {
    const result = awarenessIdentitySchema.safeParse({
      ...validIdentity,
      emojiChar: '',
    });
    expect(result.success).toBe(false);
  });

  it('rejects an empty emojiName', () => {
    const result = awarenessIdentitySchema.safeParse({
      ...validIdentity,
      emojiName: '',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a missing color component', () => {
    const result = awarenessIdentitySchema.safeParse({
      ...validIdentity,
      colorDark: { L: 0.7, C: 0.18 },
    });
    expect(result.success).toBe(false);
  });

  it('rejects when the input is not an object', () => {
    expect(awarenessIdentitySchema.safeParse(null).success).toBe(false);
    expect(awarenessIdentitySchema.safeParse(undefined).success).toBe(false);
    expect(awarenessIdentitySchema.safeParse('string').success).toBe(false);
    expect(awarenessIdentitySchema.safeParse(42).success).toBe(false);
  });
});

describe('parseAwarenessIdentity', () => {
  it('returns ok with the parsed value on a valid payload', () => {
    const result = parseAwarenessIdentity(validIdentity);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.emojiName).toBe('shaved-ice');
    }
  });

  it('returns ok=false with a ZodError on an invalid payload', () => {
    const result = parseAwarenessIdentity({ sessionId: 'bad' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.issues.length).toBeGreaterThan(0);
    }
  });
});

/* ============================================================== *\
   Phase 3.3 — cursor schema
\* ============================================================== */

describe('awarenessCursorSchema', () => {
  it('accepts a valid x/y pair', () => {
    const result = awarenessCursorSchema.safeParse({ x: 100, y: 200 });
    expect(result.success).toBe(true);
  });

  it('accepts null (off-canvas)', () => {
    const result = awarenessCursorSchema.safeParse(null);
    expect(result.success).toBe(true);
    expect(result.data).toBeNull();
  });

  it('accepts fractional pixels', () => {
    const result = awarenessCursorSchema.safeParse({ x: 0.5, y: 99.99 });
    expect(result.success).toBe(true);
  });

  it('rejects a string x', () => {
    const result = awarenessCursorSchema.safeParse({ x: '0', y: 0 });
    expect(result.success).toBe(false);
  });

  it('rejects a missing y', () => {
    const result = awarenessCursorSchema.safeParse({ x: 10 });
    expect(result.success).toBe(false);
  });
});

describe('parseAwarenessCursor', () => {
  it('returns the cursor on a valid payload', () => {
    expect(parseAwarenessCursor({ x: 5, y: 7 })).toEqual({ x: 5, y: 7 });
  });

  it('returns null for null input (off-canvas)', () => {
    expect(parseAwarenessCursor(null)).toBeNull();
  });

  it('returns null for undefined input (missing field)', () => {
    expect(parseAwarenessCursor(undefined)).toBeNull();
  });

  it('returns null for malformed input (forward-compat shim)', () => {
    // A peer with a valid identity but broken cursor still counts —
    // the cursor just collapses to null. The drop-on-malformed
    // policy applies to IDENTITY, not cursor.
    expect(parseAwarenessCursor({ x: 'NaN', y: 0 })).toBeNull();
    expect(parseAwarenessCursor('garbage')).toBeNull();
    expect(parseAwarenessCursor(42)).toBeNull();
  });
});

describe('awarenessStateSchema', () => {
  it('accepts identity + cursor', () => {
    const result = awarenessStateSchema.safeParse({
      identity: validIdentity,
      cursor: { x: 1, y: 2 },
    });
    expect(result.success).toBe(true);
  });

  it('accepts identity + null cursor', () => {
    const result = awarenessStateSchema.safeParse({
      identity: validIdentity,
      cursor: null,
    });
    expect(result.success).toBe(true);
  });

  it('accepts identity without cursor (Phase 2.5a backward compat)', () => {
    const result = awarenessStateSchema.safeParse({
      identity: validIdentity,
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing identity (drop-on-malformed contract)', () => {
    const result = awarenessStateSchema.safeParse({
      cursor: { x: 0, y: 0 },
    });
    expect(result.success).toBe(false);
  });
});
