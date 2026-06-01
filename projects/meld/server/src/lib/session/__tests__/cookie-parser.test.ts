/**
 * Cookie-header parser tests (Task 1.7b).
 *
 * Validates the shared parser at `src/lib/session/cookie-parser.ts` which
 * is consumed by BOTH the Hono cookie middleware (via the existing
 * `getCookie` indirection in `cookie.ts`) AND the Hocuspocus `onConnect`
 * extension at `src/lib/ws/on-connect.ts`. A drift between the two call
 * sites would silently produce different session ids on the HTTP load
 * path vs the WS upgrade path, which is the worst kind of bug —
 * cookie-disabled clients would get the right identity in HTTP responses
 * and the wrong one on the welcome frame.
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import {
  isUuidV4,
  parseCookieHeader,
  readCookieFromHeader,
  UUID_V4_REGEX,
} from '../cookie-parser';

void describe('parseCookieHeader', () => {
  void it('returns empty record for undefined / null / empty input', () => {
    assert.deepEqual(parseCookieHeader(undefined), {});
    assert.deepEqual(parseCookieHeader(null), {});
    assert.deepEqual(parseCookieHeader(''), {});
  });

  void it('parses a single name=value pair', () => {
    assert.deepEqual(parseCookieHeader('meld_session=abc'), {
      meld_session: 'abc',
    });
  });

  void it('parses multiple semicolon-separated pairs', () => {
    assert.deepEqual(parseCookieHeader('a=1; b=2; c=3'), {
      a: '1',
      b: '2',
      c: '3',
    });
  });

  void it('tolerates missing space after semicolon', () => {
    assert.deepEqual(parseCookieHeader('a=1;b=2;c=3'), {
      a: '1',
      b: '2',
      c: '3',
    });
  });

  void it('tolerates trailing semicolon', () => {
    assert.deepEqual(parseCookieHeader('a=1;'), { a: '1' });
  });

  void it('tolerates leading and trailing whitespace per pair', () => {
    assert.deepEqual(parseCookieHeader('  a=1 ;   b=2  '), {
      a: '1',
      b: '2',
    });
  });

  void it('preserves `=` inside cookie values (split on first equals)', () => {
    assert.deepEqual(parseCookieHeader('token=eyJhbGciOi=padded'), {
      token: 'eyJhbGciOi=padded',
    });
  });

  void it('ignores pairs without `=`', () => {
    assert.deepEqual(parseCookieHeader('a=1; junk; b=2'), {
      a: '1',
      b: '2',
    });
  });

  void it('ignores pairs with empty name', () => {
    assert.deepEqual(parseCookieHeader('=value; a=1'), { a: '1' });
  });

  void it('last value wins on duplicate names (RFC 6265 § 5.3 step 11)', () => {
    assert.deepEqual(parseCookieHeader('a=1; a=2; a=3'), { a: '3' });
  });

  void it('handles a realistic meld_session cookie header', () => {
    const uuid = '9b67ac26-a6a8-417e-86ef-42a87b71120f';
    const header = `meld_session=${uuid}; other=value`;
    assert.deepEqual(parseCookieHeader(header), {
      meld_session: uuid,
      other: 'value',
    });
  });
});

void describe('readCookieFromHeader', () => {
  void it('returns the value when the cookie is present', () => {
    const uuid = '9b67ac26-a6a8-417e-86ef-42a87b71120f';
    assert.equal(
      readCookieFromHeader(`meld_session=${uuid}`, 'meld_session'),
      uuid,
    );
  });

  void it('returns undefined when the cookie is absent', () => {
    assert.equal(readCookieFromHeader('a=1; b=2', 'meld_session'), undefined);
  });

  void it('returns undefined when the header is empty / null / undefined', () => {
    assert.equal(readCookieFromHeader('', 'meld_session'), undefined);
    assert.equal(readCookieFromHeader(undefined, 'meld_session'), undefined);
    assert.equal(readCookieFromHeader(null, 'meld_session'), undefined);
  });
});

void describe('UUID_V4_REGEX / isUuidV4', () => {
  void it('matches the canonical lowercase 8-4-4-4-12 form', () => {
    assert.ok(UUID_V4_REGEX.test('9b67ac26-a6a8-417e-86ef-42a87b71120f'));
    assert.ok(isUuidV4('9b67ac26-a6a8-417e-86ef-42a87b71120f'));
  });

  void it('rejects upper-case hex (Node randomUUID emits lowercase)', () => {
    assert.equal(isUuidV4('9B67AC26-A6A8-417E-86EF-42A87B71120F'), false);
  });

  void it('rejects non-v4 version nibble', () => {
    // v1 UUID — version nibble is 1.
    assert.equal(isUuidV4('9b67ac26-a6a8-117e-86ef-42a87b71120f'), false);
  });

  void it('rejects malformed variant nibble', () => {
    // First char of the 4th group must be in [8,9,a,b].
    assert.equal(isUuidV4('9b67ac26-a6a8-417e-06ef-42a87b71120f'), false);
  });

  void it('rejects garbage / empty / undefined', () => {
    assert.equal(isUuidV4('not-a-uuid'), false);
    assert.equal(isUuidV4(''), false);
    assert.equal(isUuidV4(undefined), false);
  });

  void it('accepts all variant nibble values 8, 9, a, b', () => {
    for (const v of ['8', '9', 'a', 'b']) {
      assert.ok(
        isUuidV4(`9b67ac26-a6a8-417e-${v}6ef-42a87b71120f`),
        `variant ${v} should be accepted`,
      );
    }
  });
});
