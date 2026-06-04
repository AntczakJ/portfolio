import {
  type CanActivate,
  type ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';

/**
 * A small fixed-window in-memory rate limiter (Task 6.3, §4 security bar).
 *
 * Applied to the UNAUTHENTICATED public read endpoints (`/public/:slug`) to
 * bound abuse — a §4 "rate limiting on any public backend" requirement. The
 * auth endpoints are separately rate-limited inside better-auth (auth.ts).
 *
 * v1 is single-web-machine (ADR-006), so an in-memory counter is correct and
 * has no external dependency; a Redis-backed store is the multi-replica swap
 * (the same posture as better-auth's in-memory default). The window map is
 * swept lazily so it does not grow unbounded.
 *
 * Use via `@UseGuards(new RateLimitGuard({ windowMs, max }))` on a controller
 * or route. Keyed by client IP (best-effort: `x-forwarded-for` first hop behind
 * the pulse-web proxy, else the socket address).
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly hits = new Map<string, { count: number; resetAt: number }>();
  private lastSweep = 0;

  constructor(
    private readonly options: { windowMs: number; max: number },
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<{
      ip?: string;
      socket?: { remoteAddress?: string };
      headers: Record<string, string | string[] | undefined>;
    }>();

    const key = clientKey(req);
    const now = Date.now();
    this.sweep(now);

    const entry = this.hits.get(key);
    if (!entry || entry.resetAt <= now) {
      this.hits.set(key, { count: 1, resetAt: now + this.options.windowMs });
      return true;
    }

    if (entry.count >= this.options.max) {
      const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
      throw new HttpException(
        {
          error: 'rate_limited',
          message: 'Too many requests. Please slow down.',
          retryAfterSeconds: retryAfter,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    entry.count += 1;
    return true;
  }

  /** Evict expired windows periodically so the map stays bounded. */
  private sweep(now: number): void {
    if (now - this.lastSweep < this.options.windowMs) return;
    this.lastSweep = now;
    for (const [key, entry] of this.hits) {
      if (entry.resetAt <= now) this.hits.delete(key);
    }
  }
}

/** Best-effort client key: first `x-forwarded-for` hop, else socket address. */
function clientKey(req: {
  ip?: string;
  socket?: { remoteAddress?: string };
  headers: Record<string, string | string[] | undefined>;
}): string {
  const fwd = req.headers['x-forwarded-for'];
  const first = Array.isArray(fwd) ? fwd[0] : fwd;
  if (first) return first.split(',')[0]?.trim() ?? 'unknown';
  return req.ip ?? req.socket?.remoteAddress ?? 'unknown';
}
