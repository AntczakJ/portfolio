import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'vitest';

import { BARBERS } from './barbers';
import { PRE_BOOKINGS } from './pre-bookings';
import { TESTIMONIALS } from './testimonials';

/**
 * Manual seed snapshotter (NOT part of the normal suite).
 *
 * Dumps the faker-derived seed output (barber bios, pre-bookings,
 * testimonial author names) to `seed-data.generated.json`, which
 * `scripts/bake-seed.mjs` turns into the static, faker-free `seed-data.ts`.
 * This is what keeps `@faker-js/faker` out of the client bundle (it uses
 * `new Function`/`eval`, which the strict CSP blocks).
 *
 * Guarded behind `BAKE_SEED=1` so a normal `pnpm test` neither runs it nor
 * writes any file. To regenerate after a seed/roster/menu change:
 *
 *   BAKE_SEED=1 pnpm -F razors-edge-web exec vitest run src/mocks/__generate__.test.ts
 *   node scripts/bake-seed.mjs
 */
describe.skipIf(process.env.BAKE_SEED !== '1')('seed snapshot (manual)', () => {
  it('writes seed-data.generated.json', () => {
    const testimonialAuthors: Record<string, string> = {};
    for (const t of TESTIMONIALS) testimonialAuthors[t.id] = t.author;
    writeFileSync(
      resolve(process.cwd(), 'src/mocks/seed-data.generated.json'),
      JSON.stringify(
        { barbers: BARBERS, preBookings: PRE_BOOKINGS, testimonialAuthors },
        null,
        2,
      ),
    );
  });
});
