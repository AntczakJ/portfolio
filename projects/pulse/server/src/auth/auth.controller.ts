import { All, Controller, Inject, Req, Res } from '@nestjs/common';

import { AuthService } from './auth.service';

/**
 * Minimal Express request/response shapes (we do NOT depend on @types/express —
 * the same narrow-structural-type discipline the stream's SessionRequest uses).
 */
interface ExpressLikeRequest {
  method: string;
  originalUrl: string;
  headers: Record<string, string | string[] | undefined>;
  // Express has already consumed the body (JSON middleware); we re-serialize it
  // for the Web Request better-auth expects. Undefined for GET/HEAD.
  body?: unknown;
  protocol: string;
  ip?: string;
  socket?: { remoteAddress?: string };
  get(name: string): string | undefined;
}

interface ExpressLikeResponse {
  status(code: number): ExpressLikeResponse;
  setHeader(name: string, value: string | string[]): void;
  send(body: string): void;
  end(): void;
}

/**
 * better-auth HTTP surface (ADR-007, Phase 6).
 *
 * better-auth ships ONE Web-Fetch handler (`auth.handler(Request) -> Response`)
 * that serves every auth route under its base path: sign up, sign in, sign out,
 * get session, etc. This controller is a thin catch-all under `/api/auth/*`
 * that bridges the Express req/res to a Web `Request`/`Response` and forwards.
 *
 * Concrete routes this exposes (better-auth's email+password surface):
 *   POST /api/auth/sign-up/email   { name, email, password }      -> sets session cookie
 *   POST /api/auth/sign-in/email   { email, password }            -> sets session cookie
 *   POST /api/auth/sign-out                                       -> clears the cookie
 *   GET  /api/auth/get-session                                    -> { user, session } | null
 *
 * The route is mounted under `/api`, so it co-locates with the `@Sse()` routes
 * and is reverse-proxied as one origin in prod (ADR-006). The brute-force rate
 * limit lives inside better-auth (configured in auth.ts), so it covers every
 * forwarded request here without a separate Nest guard.
 */
@Controller('api/auth')
export class AuthController {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}

  @All('*splat')
  async handle(
    @Req() req: ExpressLikeRequest,
    @Res() res: ExpressLikeResponse,
  ): Promise<void> {
    const webRequest = toWebRequest(req);
    const webResponse = await this.auth.instance.handler(webRequest);
    await writeWebResponse(webResponse, res);
  }
}

/** Build a Web `Request` from the Express request better-auth's handler consumes. */
function toWebRequest(req: ExpressLikeRequest): Request {
  const host = req.get('host') ?? 'localhost';
  const url = `${req.protocol}://${host}${req.originalUrl}`;

  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const v of value) headers.append(key, v);
    } else {
      headers.set(key, value);
    }
  }

  // Ensure better-auth has a client IP to key its brute-force rate limiter on
  // (it SKIPS rate limiting when it cannot determine one). Behind the pulse-web
  // proxy the real client is already in `x-forwarded-for`; in the direct dev
  // loop there is none, so we set it from the connecting socket. We only ADD it
  // when absent — a real proxy's header is never overwritten.
  if (!headers.has('x-forwarded-for')) {
    const connectingIp = req.ip ?? req.socket?.remoteAddress;
    if (connectingIp) headers.set('x-forwarded-for', connectingIp);
  }

  const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
  // Express' JSON body-parser has already parsed the body into an object; the
  // Web Request needs the raw JSON string back. better-auth reads JSON.
  const body =
    hasBody && req.body !== undefined && req.body !== null
      ? JSON.stringify(req.body)
      : undefined;

  if (hasBody && body !== undefined && !headers.has('content-type')) {
    headers.set('content-type', 'application/json');
  }

  const init: RequestInit = { method: req.method, headers };
  if (body !== undefined) init.body = body;
  return new Request(url, init);
}

/**
 * Pipe a Web `Response` (status, headers incl. Set-Cookie, body) to Express.
 * Exported for unit testing the Set-Cookie accumulation (it is otherwise a
 * module-internal helper).
 */
export async function writeWebResponse(
  webResponse: Response,
  res: ExpressLikeResponse,
): Promise<void> {
  res.status(webResponse.status);

  // Forward every header. `Headers` collapses multiple Set-Cookie into the
  // `getSetCookie()` array, which we must replay as an ARRAY in ONE setHeader
  // call so the browser gets EVERY cookie. Calling `setHeader('set-cookie', x)`
  // in a loop OVERWRITES (keeps only the last) — a latent auth landmine if
  // better-auth ever emits more than one Set-Cookie (e.g. a session cookie plus
  // a `dont_remember` flag). Passing the full string[] sets them all at once.
  webResponse.headers.forEach((value, key) => {
    if (key.toLowerCase() === 'set-cookie') return; // handled below
    res.setHeader(key, value);
  });
  const setCookies = webResponse.headers.getSetCookie();
  if (setCookies.length > 0) {
    res.setHeader('set-cookie', setCookies);
  }

  const text = await webResponse.text();
  if (text.length > 0) {
    res.send(text);
  } else {
    res.end();
  }
}
