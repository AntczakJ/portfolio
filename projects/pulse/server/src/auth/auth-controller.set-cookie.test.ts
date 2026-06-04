import { describe, expect, it } from 'vitest';

import { writeWebResponse } from './auth.controller';

/**
 * Set-Cookie accumulation (reviewer must-fix #2).
 *
 * The Express<->Web-Fetch bridge previously did `res.setHeader('set-cookie', x)`
 * in a loop, which OVERWRITES — only the LAST cookie survived. Works today
 * (better-auth emits a single session cookie) but is a latent auth landmine if a
 * flow ever emits more than one Set-Cookie. The fix sets the FULL array in one
 * call. These tests prove every cookie reaches the response.
 */

/** A tiny fake Express response that records setHeader calls. */
function makeFakeRes() {
  const headers: { name: string; value: string | string[] }[] = [];
  let statusCode = 0;
  let body: string | null = null;
  let ended = false;
  const res = {
    status(code: number) {
      statusCode = code;
      return this;
    },
    setHeader(name: string, value: string | string[]) {
      headers.push({ name, value });
    },
    send(b: string) {
      body = b;
    },
    end() {
      ended = true;
    },
  };
  return {
    res,
    get headers() {
      return headers;
    },
    get statusCode() {
      return statusCode;
    },
    get body() {
      return body;
    },
    get ended() {
      return ended;
    },
    setCookieValue(): string | string[] | undefined {
      return headers.find((h) => h.name.toLowerCase() === 'set-cookie')?.value;
    },
  };
}

/** Build a Web Response carrying N Set-Cookie headers. */
function webResponseWithCookies(cookies: string[], status = 200): Response {
  const headers = new Headers();
  headers.set('content-type', 'application/json');
  for (const c of cookies) headers.append('set-cookie', c);
  return new Response(JSON.stringify({ ok: true }), { status, headers });
}

describe('writeWebResponse — Set-Cookie accumulation', () => {
  it('forwards a SINGLE Set-Cookie as a one-element array (the happy path)', async () => {
    const fake = makeFakeRes();
    await writeWebResponse(
      webResponseWithCookies(['pulse.session=abc; HttpOnly; Path=/']),
      fake.res,
    );
    const value = fake.setCookieValue();
    expect(Array.isArray(value) ? value : [value]).toEqual([
      'pulse.session=abc; HttpOnly; Path=/',
    ]);
    expect(fake.statusCode).toBe(200);
  });

  it('forwards MULTIPLE Set-Cookie headers — none are dropped', async () => {
    const fake = makeFakeRes();
    const cookies = [
      'pulse.session=abc; HttpOnly; Path=/',
      'pulse.dont_remember=1; HttpOnly; Path=/',
    ];
    await writeWebResponse(webResponseWithCookies(cookies), fake.res);

    const value = fake.setCookieValue();
    expect(Array.isArray(value)).toBe(true);
    expect(value).toEqual(cookies);

    // It must be set in ONE setHeader('set-cookie', ...) call, not overwritten.
    const setCookieCalls = fake.headers.filter((h) => h.name.toLowerCase() === 'set-cookie');
    expect(setCookieCalls).toHaveLength(1);
  });

  it('omits Set-Cookie entirely when the Web Response carries none', async () => {
    const fake = makeFakeRes();
    await writeWebResponse(webResponseWithCookies([]), fake.res);
    expect(fake.setCookieValue()).toBeUndefined();
  });

  it('still forwards non-cookie headers and the body', async () => {
    const fake = makeFakeRes();
    await writeWebResponse(webResponseWithCookies(['s=1']), fake.res);
    const ct = fake.headers.find((h) => h.name.toLowerCase() === 'content-type');
    expect(ct?.value).toBe('application/json');
    expect(fake.body).toBe(JSON.stringify({ ok: true }));
  });

  it('ends (no body) on an empty-body response', async () => {
    const fake = makeFakeRes();
    const res = new Response(null, { status: 204 });
    await writeWebResponse(res, fake.res);
    expect(fake.ended).toBe(true);
    expect(fake.body).toBeNull();
  });
});
