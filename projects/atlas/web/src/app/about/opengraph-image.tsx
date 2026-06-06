/**
 * About / landing OG image (Task 6.3) — reuses the root control-room card so the
 * social cards are consistent across surfaces. `runtime` is declared locally
 * (Next.js must read it statically per-route, so it cannot be re-exported), while
 * the generator + metadata fields come from the single root design source.
 */
export const runtime = 'nodejs';

export { default, alt, size, contentType } from '@/app/opengraph-image';
