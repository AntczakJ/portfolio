// Bake the faker-derived seed JSON into a static, faker-free TS module so
// `@faker-js/faker` never reaches the client bundle (it uses new Function /
// eval, which the strict CSP blocks). Run after regenerating
// `src/mocks/seed-data.generated.json` via the __generate__ test.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const cwd = process.cwd();
const data = JSON.parse(
  readFileSync(resolve(cwd, 'src/mocks/seed-data.generated.json'), 'utf8'),
);

const bios = {};
for (const b of data.barbers) bios[b.id] = b.bio;
const authors = data.testimonialAuthors ?? {};
const pb = data.preBookings.map((p) => ({
  id: p.id,
  barberId: p.barberId,
  date: p.date,
  startMin: p.startMin,
  durationMin: p.durationMin,
}));

const header = [
  '/**',
  ' * STATIC seed data (build-time generated — do NOT edit by hand).',
  ' *',
  ' * Generated from the faker-driven factories by the throwaway',
  ' * `src/mocks/__generate__.test.ts` + `scripts/bake-seed.mjs`. Baking the',
  ' * faker OUTPUT into a static module keeps `@faker-js/faker` entirely OUT',
  ' * of the client bundle — faker uses `new Function` / `eval` internally,',
  " * which the strict CSP (`script-src 'self' 'unsafe-inline'`, no",
  ' * `unsafe-eval`) blocks. The booking wizard ships client components that',
  ' * import the mock catalog, so the data they touch must be faker-free.',
  ' *',
  ' * Determinism is unchanged: this is the exact seeded output the factories',
  ' * produced (faker seeds 74017 bios / 91135 pre-bookings). Re-bake only if',
  ' * the seeds or the roster/menu change.',
  ' */',
  "import type { PreBooking } from '@/lib/schemas/availability';",
  '',
  '/** Seeded barber bios, keyed by barber id. */',
  `export const BARBER_BIOS: Record<string, string> = ${JSON.stringify(bios, null, 2)};`,
  '',
  '/** Seeded testimonial author names, keyed by testimonial id. */',
  `export const TESTIMONIAL_AUTHORS: Record<string, string> = ${JSON.stringify(authors, null, 2)};`,
  '',
  '/** Seeded pre-bookings (internally non-overlapping, grid-aligned). */',
  `export const SEEDED_PRE_BOOKINGS: readonly PreBooking[] = ${JSON.stringify(pb, null, 2)};`,
  '',
].join('\n');

writeFileSync(resolve(cwd, 'src/mocks/seed-data.ts'), header);
console.log('wrote src/mocks/seed-data.ts');
