/**
 * STATIC seed data (build-time generated — do NOT edit by hand).
 *
 * Generated from the faker-driven factories by the throwaway
 * `src/mocks/__generate__.test.ts` + `scripts/bake-seed.mjs`. Baking the
 * faker OUTPUT into a static module keeps `@faker-js/faker` entirely OUT
 * of the client bundle — faker uses `new Function` / `eval` internally,
 * which the strict CSP (`script-src 'self' 'unsafe-inline'`, no
 * `unsafe-eval`) blocks. The booking wizard ships client components that
 * import the mock catalog, so the data they touch must be faker-free.
 *
 * Determinism is unchanged: this is the exact seeded output the factories
 * produced (faker seeds 74017 bios / 91135 pre-bookings). Re-bake only if
 * the seeds or the roster/menu change.
 */
import type { PreBooking } from '@/lib/schemas/availability';

/** Seeded barber bios, keyed by barber id. */
export const BARBER_BIOS: Record<string, string> = {
  "brb-marco": "A decade behind the chair, Marco reads a head shape before the clippers ever switch on.",
  "brb-idris": "Known for an unhurried chair, Idris treats the straight razor like a precision instrument.",
  "brb-sasha": "Trained in London and Lisbon, Sasha finishes nothing until the mirror agrees.",
  "brb-emil": "Known for an unhurried chair, Emil treats the straight razor like a precision instrument.",
  "brb-jonah": "Equal parts craft and conversation, Jonah keeps the room as sharp as the work."
};

/** Seeded testimonial author names, keyed by testimonial id. */
export const TESTIMONIAL_AUTHORS: Record<string, string> = {
  "tst-01": "Roy H.",
  "tst-02": "Assunta P.",
  "tst-03": "Payton G.",
  "tst-04": "Bryant C.",
  "tst-05": "Randolph S.",
  "tst-06": "Roland J.",
  "tst-07": "Augusta T.",
  "tst-08": "Ramiro O."
};

/** Seeded pre-bookings (internally non-overlapping, grid-aligned). */
export const SEEDED_PRE_BOOKINGS: readonly PreBooking[] = [
  {
    "id": "pb-0001",
    "barberId": "brb-marco",
    "date": "2026-06-11",
    "startMin": 825,
    "durationMin": 15
  },
  {
    "id": "pb-0002",
    "barberId": "brb-marco",
    "date": "2026-06-11",
    "startMin": 915,
    "durationMin": 30
  },
  {
    "id": "pb-0003",
    "barberId": "brb-marco",
    "date": "2026-06-11",
    "startMin": 945,
    "durationMin": 30
  },
  {
    "id": "pb-0004",
    "barberId": "brb-marco",
    "date": "2026-06-16",
    "startMin": 675,
    "durationMin": 75
  },
  {
    "id": "pb-0005",
    "barberId": "brb-marco",
    "date": "2026-06-16",
    "startMin": 960,
    "durationMin": 90
  },
  {
    "id": "pb-0006",
    "barberId": "brb-marco",
    "date": "2026-06-18",
    "startMin": 825,
    "durationMin": 30
  },
  {
    "id": "pb-0007",
    "barberId": "brb-marco",
    "date": "2026-06-19",
    "startMin": 1110,
    "durationMin": 30
  },
  {
    "id": "pb-0008",
    "barberId": "brb-marco",
    "date": "2026-06-19",
    "startMin": 915,
    "durationMin": 45
  },
  {
    "id": "pb-0009",
    "barberId": "brb-marco",
    "date": "2026-06-23",
    "startMin": 765,
    "durationMin": 120
  },
  {
    "id": "pb-0010",
    "barberId": "brb-idris",
    "date": "2026-06-12",
    "startMin": 1125,
    "durationMin": 15
  },
  {
    "id": "pb-0011",
    "barberId": "brb-idris",
    "date": "2026-06-12",
    "startMin": 975,
    "durationMin": 45
  },
  {
    "id": "pb-0012",
    "barberId": "brb-idris",
    "date": "2026-06-13",
    "startMin": 915,
    "durationMin": 45
  },
  {
    "id": "pb-0013",
    "barberId": "brb-idris",
    "date": "2026-06-17",
    "startMin": 795,
    "durationMin": 75
  },
  {
    "id": "pb-0014",
    "barberId": "brb-idris",
    "date": "2026-06-17",
    "startMin": 675,
    "durationMin": 120
  },
  {
    "id": "pb-0015",
    "barberId": "brb-idris",
    "date": "2026-06-18",
    "startMin": 780,
    "durationMin": 60
  },
  {
    "id": "pb-0016",
    "barberId": "brb-idris",
    "date": "2026-06-19",
    "startMin": 975,
    "durationMin": 30
  },
  {
    "id": "pb-0017",
    "barberId": "brb-idris",
    "date": "2026-06-19",
    "startMin": 750,
    "durationMin": 90
  },
  {
    "id": "pb-0018",
    "barberId": "brb-idris",
    "date": "2026-06-19",
    "startMin": 1035,
    "durationMin": 15
  },
  {
    "id": "pb-0019",
    "barberId": "brb-idris",
    "date": "2026-06-20",
    "startMin": 540,
    "durationMin": 60
  },
  {
    "id": "pb-0020",
    "barberId": "brb-idris",
    "date": "2026-06-20",
    "startMin": 675,
    "durationMin": 60
  },
  {
    "id": "pb-0021",
    "barberId": "brb-idris",
    "date": "2026-06-23",
    "startMin": 765,
    "durationMin": 60
  },
  {
    "id": "pb-0022",
    "barberId": "brb-idris",
    "date": "2026-06-23",
    "startMin": 690,
    "durationMin": 30
  },
  {
    "id": "pb-0023",
    "barberId": "brb-sasha",
    "date": "2026-06-10",
    "startMin": 930,
    "durationMin": 30
  },
  {
    "id": "pb-0024",
    "barberId": "brb-sasha",
    "date": "2026-06-10",
    "startMin": 1170,
    "durationMin": 30
  },
  {
    "id": "pb-0025",
    "barberId": "brb-sasha",
    "date": "2026-06-12",
    "startMin": 855,
    "durationMin": 30
  },
  {
    "id": "pb-0026",
    "barberId": "brb-sasha",
    "date": "2026-06-12",
    "startMin": 810,
    "durationMin": 30
  },
  {
    "id": "pb-0027",
    "barberId": "brb-sasha",
    "date": "2026-06-12",
    "startMin": 1215,
    "durationMin": 30
  },
  {
    "id": "pb-0028",
    "barberId": "brb-sasha",
    "date": "2026-06-13",
    "startMin": 600,
    "durationMin": 60
  },
  {
    "id": "pb-0029",
    "barberId": "brb-sasha",
    "date": "2026-06-13",
    "startMin": 705,
    "durationMin": 75
  },
  {
    "id": "pb-0030",
    "barberId": "brb-sasha",
    "date": "2026-06-13",
    "startMin": 870,
    "durationMin": 45
  },
  {
    "id": "pb-0031",
    "barberId": "brb-sasha",
    "date": "2026-06-14",
    "startMin": 690,
    "durationMin": 90
  },
  {
    "id": "pb-0032",
    "barberId": "brb-sasha",
    "date": "2026-06-18",
    "startMin": 765,
    "durationMin": 90
  },
  {
    "id": "pb-0033",
    "barberId": "brb-sasha",
    "date": "2026-06-18",
    "startMin": 945,
    "durationMin": 90
  },
  {
    "id": "pb-0034",
    "barberId": "brb-sasha",
    "date": "2026-06-21",
    "startMin": 855,
    "durationMin": 90
  },
  {
    "id": "pb-0035",
    "barberId": "brb-sasha",
    "date": "2026-06-21",
    "startMin": 705,
    "durationMin": 120
  },
  {
    "id": "pb-0036",
    "barberId": "brb-emil",
    "date": "2026-06-10",
    "startMin": 690,
    "durationMin": 90
  },
  {
    "id": "pb-0037",
    "barberId": "brb-emil",
    "date": "2026-06-10",
    "startMin": 1005,
    "durationMin": 45
  },
  {
    "id": "pb-0038",
    "barberId": "brb-emil",
    "date": "2026-06-11",
    "startMin": 840,
    "durationMin": 120
  },
  {
    "id": "pb-0039",
    "barberId": "brb-emil",
    "date": "2026-06-13",
    "startMin": 690,
    "durationMin": 30
  },
  {
    "id": "pb-0040",
    "barberId": "brb-emil",
    "date": "2026-06-20",
    "startMin": 810,
    "durationMin": 120
  },
  {
    "id": "pb-0041",
    "barberId": "brb-emil",
    "date": "2026-06-23",
    "startMin": 645,
    "durationMin": 30
  },
  {
    "id": "pb-0042",
    "barberId": "brb-jonah",
    "date": "2026-06-10",
    "startMin": 750,
    "durationMin": 30
  },
  {
    "id": "pb-0043",
    "barberId": "brb-jonah",
    "date": "2026-06-10",
    "startMin": 510,
    "durationMin": 60
  },
  {
    "id": "pb-0044",
    "barberId": "brb-jonah",
    "date": "2026-06-17",
    "startMin": 600,
    "durationMin": 45
  },
  {
    "id": "pb-0045",
    "barberId": "brb-jonah",
    "date": "2026-06-20",
    "startMin": 645,
    "durationMin": 15
  },
  {
    "id": "pb-0046",
    "barberId": "brb-jonah",
    "date": "2026-06-23",
    "startMin": 630,
    "durationMin": 30
  }
];
