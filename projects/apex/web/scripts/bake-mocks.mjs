// @ts-check
/**
 * APEX mock-data bake script (Task 3.2 / ADR-002 §5 / ADR-003).
 *
 * Runs faker ONCE at authoring time and emits a STATIC seed file
 * (`src/mocks/seed-data.ts`). This keeps faker's `new Function` eval path OFF
 * the CSP-governed runtime path entirely (the razors-edge lesson): the app
 * imports only the generated static data, never faker. Re-run with:
 *
 *   node scripts/bake-mocks.mjs
 *
 * then re-run `verify-csp.mjs` to confirm faker introduced no eval path.
 *
 * Determinism: a fixed `faker.seed()` + the frozen clock (`NOW_DATE_ISO`)
 * inlined here, so the output is byte-stable across runs. The fleet,
 * configurator options, locations, extras, and shop are HAND-CURATED English
 * data (PLAN.md: faker fills only flavour where copy quality is irrelevant);
 * faker drives the seeded per-vehicle bookings and assembles testimonials from
 * curated English pools so nothing reads as Latin lorem.
 */
import { faker } from '@faker-js/faker';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, '..', 'src', 'mocks', 'seed-data.ts');

const SEED = 20260615;
const NOW_DATE_ISO = '2026-06-15';
const CURRENCY = 'EUR';

faker.seed(SEED);

// --- Date helpers (UTC, calendar-day) -------------------------------------
const MS_PER_DAY = 86_400_000;
const toDateIso = (d) => d.toISOString().slice(0, 10);
const fromDateIso = (s) => new Date(`${s}T00:00:00.000Z`);
const addDays = (s, n) => {
  const d = fromDateIso(s);
  d.setUTCDate(d.getUTCDate() + n);
  return toDateIso(d);
};

// --- Hand-curated fleet ----------------------------------------------------
// One configurable hero (the LUMEN). Prices in minor units (EUR cents).
//
// MODEL-SWAP PASS B reconciliation (N-1): every car now renders from a CC0
// Kenney "Car Kit" silhouette (one consistent art family — N-1 solved by
// construction), so the NAME / SEGMENT / spec / copy are reconciled to match the
// actual silhouette each card renders:
//   lumen   <- suv-luxury     (full-size luxury SUV, configurable flagship)
//   stratos <- sedan-sports   (a low, wide performance SUPER-SALOON — 4 doors,
//                              NOT the old "2-seat track coupe"; copy updated)
//   terra   <- suv            (a tall, boxy seven-seat family SUV)
//   vella   <- sedan          (a formal long-range executive saloon)
//   mira    <- hatchback-sports (a compact hot-hatch — sporty, city-sized)
const fleet = [
  {
    id: 'veh-lumen-gt',
    slug: 'lumen-gt',
    // The configurable hero renders from the CC0 Kenney `suv-luxury` silhouette
    // (model-swap PASS A) — a premium full-size luxury SUV.
    name: 'APEX Lumen SUV',
    tagline: 'The configurable flagship — full-size luxury, yours to shape.',
    tier: 'suv',
    rangeKm: 640,
    accel0to100: 4.9,
    topSpeedKph: 250,
    batteryKwh: 105,
    seats: 7,
    dailyPriceMinor: 29900,
    currency: CURRENCY,
    heroRenderSrc: '/renders/lumen-gt/hero.avif',
    configurable: true,
  },
  {
    id: 'veh-vella-sedan',
    slug: 'vella-sedan',
    // Renders from `sedan.glb` — a formal three-box executive saloon.
    name: 'APEX Vella',
    tagline: 'A long-range executive saloon that disappears the miles.',
    tier: 'sedan',
    rangeKm: 678,
    accel0to100: 4.9,
    topSpeedKph: 210,
    batteryKwh: 98,
    seats: 5,
    dailyPriceMinor: 16900,
    currency: CURRENCY,
    heroRenderSrc: '/renders/vella/hero.avif',
    configurable: false,
  },
  {
    id: 'veh-terra-suv',
    slug: 'terra-suv',
    // Renders from `suv.glb` — a tall, boxy seven-seat family SUV.
    name: 'APEX Terra',
    tagline: 'Seven seats, full charge, ready for the weekend.',
    tier: 'suv',
    rangeKm: 540,
    accel0to100: 5.6,
    topSpeedKph: 200,
    batteryKwh: 110,
    seats: 7,
    dailyPriceMinor: 18900,
    currency: CURRENCY,
    heroRenderSrc: '/renders/terra/hero.avif',
    configurable: false,
  },
  {
    id: 'veh-mira-compact',
    slug: 'mira-compact',
    // Renders from `hatchback-sports.glb` — a compact, sporty five-door hatch.
    name: 'APEX Mira',
    tagline: 'A compact hot-hatch — city-sized, genuinely quick.',
    tier: 'compact',
    rangeKm: 424,
    accel0to100: 6.4,
    topSpeedKph: 185,
    batteryKwh: 58,
    seats: 5,
    dailyPriceMinor: 9900,
    currency: CURRENCY,
    heroRenderSrc: '/renders/mira/hero.avif',
    configurable: false,
  },
  {
    id: 'veh-stratos-performance',
    slug: 'stratos',
    // Renders from `sedan-sports.glb` — a low, wide performance super-saloon
    // (four doors). The old "2-seat track coupe" copy was reconciled to the
    // actual silhouette: a four-door halo with usable seats.
    name: 'APEX Stratos',
    tagline: 'The performance super-saloon. Four seats, halo-car pace.',
    tier: 'performance',
    rangeKm: 498,
    accel0to100: 2.8,
    topSpeedKph: 290,
    batteryKwh: 112,
    seats: 4,
    dailyPriceMinor: 39900,
    currency: CURRENCY,
    heroRenderSrc: '/renders/stratos/hero.avif',
    configurable: false,
  },
];

// --- Configurator options for the hero (colours × wheels + render matrix) ---
const colors = [
  { id: 'col-glacier', name: 'Glacier White', hex: '#eef1f4', materialName: 'Pearl metallic' },
  { id: 'col-graphite', name: 'Graphite', hex: '#2b313a', materialName: 'Satin metallic' },
  { id: 'col-voltaic', name: 'Voltaic Green', hex: '#18c08a', materialName: 'Gloss pearl' },
  { id: 'col-midnight', name: 'Midnight Blue', hex: '#16243f', materialName: 'Deep metallic' },
];
const wheels = [
  { id: 'whl-aero', name: 'Aero 20"', previewSrc: '/renders/lumen-gt/wheels/aero.avif' },
  { id: 'whl-turbine', name: 'Turbine 21"', previewSrc: '/renders/lumen-gt/wheels/turbine.avif' },
  { id: 'whl-forged', name: 'Forged 22"', previewSrc: '/renders/lumen-gt/wheels/forged.avif' },
];
const renderMatrix = {};
for (const c of colors) {
  for (const w of wheels) {
    renderMatrix[`${c.id}:${w.id}`] = `/renders/lumen-gt/matrix/${c.id}__${w.id}.avif`;
  }
}
const configuratorOptions = {
  vehicleId: 'veh-lumen-gt',
  colors,
  wheels,
  // Default to GRAPHITE, not Glacier White (designer-critic close-out): the same
  // model + rig reads premium in graphite everywhere; white reads as a
  // featureless grey block AND (pre-P0-2) exposed the no-glass tell. White stays
  // SELECTABLE — only the default / hero presentation changes. Determinism kept.
  defaultColorId: 'col-graphite',
  // On the graphite body the polished-silver AERO rim reads with strong contrast
  // (a premium machined finish against dark paint), so it is the default. The
  // wheel atlas was re-tinted (P1-C) so every finish matches its copy.
  defaultWheelId: 'whl-aero',
  renderMatrix,
};

// --- Hand-curated locations ------------------------------------------------
const locations = [
  {
    id: 'loc-lis-airport',
    slug: 'lisbon-airport',
    name: 'Lisbon Airport',
    kind: 'airport',
    address: 'Aeroporto Humberto Delgado, Terminal 1',
    city: 'Lisbon',
    lat: 38.7742,
    lng: -9.1342,
    staticMapSrc: '/maps/lisbon-airport.avif',
    hours: 'Mon-Sun, 06:00-23:00',
  },
  {
    id: 'loc-lis-city',
    slug: 'lisbon-baixa',
    name: 'Lisbon Baixa',
    kind: 'city',
    address: 'Rua Augusta 24, Baixa',
    city: 'Lisbon',
    lat: 38.7106,
    lng: -9.1366,
    staticMapSrc: '/maps/lisbon-baixa.avif',
    hours: 'Mon-Sun, 08:00-21:00',
  },
  {
    id: 'loc-prt-airport',
    slug: 'porto-airport',
    name: 'Porto Airport',
    kind: 'airport',
    address: 'Aeroporto Francisco Sa Carneiro',
    city: 'Porto',
    lat: 41.2356,
    lng: -8.6783,
    staticMapSrc: '/maps/porto-airport.avif',
    hours: 'Mon-Sun, 06:00-22:00',
  },
  {
    id: 'loc-prt-depot',
    slug: 'porto-depot',
    name: 'Porto Charging Depot',
    kind: 'depot',
    address: 'Rua do Bonjardim 312',
    city: 'Porto',
    lat: 41.1521,
    lng: -8.6094,
    staticMapSrc: '/maps/porto-depot.avif',
    hours: 'Mon-Fri, 07:00-20:00',
  },
];

// --- Hand-curated extras (add-ons + insurance tiers) -----------------------
const extras = [
  {
    id: 'ext-gps',
    name: 'Navigation pack',
    description: 'Premium offline maps and live traffic routing.',
    priceMinor: 600,
    pricing: 'per-day',
    kind: 'gps',
  },
  {
    id: 'ext-child-seat',
    name: 'Child seat',
    description: 'ISOFIX-mounted seat, suitable from 9 months to 4 years.',
    priceMinor: 500,
    pricing: 'per-day',
    kind: 'child-seat',
  },
  {
    id: 'ext-additional-driver',
    name: 'Additional driver',
    description: 'Add a second named driver to the rental.',
    priceMinor: 3500,
    pricing: 'flat',
    kind: 'additional-driver',
  },
  {
    id: 'ins-basic',
    name: 'Essential cover',
    description: 'Third-party liability with a standard damage excess.',
    priceMinor: 1500,
    pricing: 'per-day',
    kind: 'insurance',
    tier: 'basic',
    excessMinor: 120000,
  },
  {
    id: 'ins-plus',
    name: 'Plus cover',
    description: 'Reduced excess plus tyre, glass and charging-cable cover.',
    priceMinor: 2900,
    pricing: 'per-day',
    kind: 'insurance',
    tier: 'plus',
    excessMinor: 40000,
  },
  {
    id: 'ins-premium',
    name: 'Premium cover',
    description: 'Zero excess, full damage waiver and personal-effects cover.',
    priceMinor: 4500,
    pricing: 'per-day',
    kind: 'insurance',
    tier: 'premium',
    excessMinor: 0,
  },
];

// --- Hand-curated shop -----------------------------------------------------
const shop = {
  id: 'shop-apex',
  name: 'APEX',
  tagline: 'Premium EVs, by the day.',
  about:
    'APEX is a premium electric-vehicle rental built for people who want the car to feel like part of the trip. Configure it, reserve it, and pick it up fully charged.',
  supportEmail: 'hello@apex-rentals.example',
  supportPhone: '+351 210 000 000',
  hours: 'Support, Mon-Sun 07:00-23:00',
  locationIds: locations.map((l) => l.id),
  currency: CURRENCY,
  priceRangeMinMinor: Math.min(...fleet.map((v) => v.dailyPriceMinor)),
  priceRangeMaxMinor: Math.max(...fleet.map((v) => v.dailyPriceMinor)),
  social: {
    instagram: 'https://instagram.com/apex.rentals.example',
    facebook: 'https://facebook.com/apex.rentals.example',
    tiktok: 'https://tiktok.com/@apex.rentals.example',
  },
};

// --- Seeded per-vehicle bookings (faker drives the gaps) -------------------
// Each vehicle gets 2-4 blackout ranges within the next 60 days, leaving
// realistic bookable gaps. Deterministic from the seed.
const reasons = ['booked', 'maintenance', 'transfer'];
const bookings = [];
let bookingCounter = 0;
for (const vehicle of fleet) {
  const count = faker.number.int({ min: 2, max: 4 });
  let cursor = faker.number.int({ min: 2, max: 6 }); // first gap from `now`
  for (let i = 0; i < count; i += 1) {
    const length = faker.number.int({ min: 2, max: 7 });
    const fromISODate = addDays(NOW_DATE_ISO, cursor);
    const toISODate = addDays(NOW_DATE_ISO, cursor + length);
    // Stay inside the 60-day window.
    if (cursor + length >= 58) break;
    bookingCounter += 1;
    bookings.push({
      id: `bk-${String(bookingCounter).padStart(3, '0')}`,
      vehicleId: vehicle.id,
      fromISODate,
      toISODate,
      reason: faker.helpers.arrayElement(reasons),
    });
    cursor += length + faker.number.int({ min: 3, max: 9 }); // gap before next
  }
}

// --- Seeded testimonials (assembled from curated English pools) ------------
const quotePool = [
  'Picked up fully charged, dropped off without a queue. The whole thing felt premium.',
  'Configured the colour and wheels the night before — the car that arrived matched exactly.',
  'Instant torque, zero fuel stops, and a booking flow that actually respected my time.',
  'Rented one to try before buying. The APEX team made the EV case better than any showroom.',
  'The quiet on the motorway is something else. Best weekend rental I have had.',
  'Clean car, clear pricing, no fine-print surprises. I will book again.',
];
// A DISTINCT role per author (A-05). The prior `arrayElement` sampling over a
// 5-role pool produced three identical "Photographer on assignment" — a data
// bug. We now assign one unique role per testimonial by index (cycling the pool
// only if there are more testimonials than roles), so every reviewer reads as a
// different person. Determinism is preserved (no random role draw).
const rolePool = [
  'Weekend driver',
  'Business traveller',
  'First-time EV renter',
  'Family on holiday',
  'Wedding-day hire',
  'Road-trip planner',
];
const cityPool = ['Lisbon', 'Porto', 'Cascais', 'Sintra', 'Faro', 'Braga'];
const testimonials = [];
for (let i = 0; i < 6; i += 1) {
  testimonials.push({
    id: `tst-${String(i + 1).padStart(2, '0')}`,
    author: `${faker.person.firstName()} ${faker.person.lastName().charAt(0)}.`,
    role: `${rolePool[i % rolePool.length]}, ${cityPool[i % cityPool.length]}`,
    rating: faker.number.int({ min: 4, max: 5 }),
    quote: quotePool[i % quotePool.length],
    vehicle: faker.helpers.arrayElement(fleet).name,
  });
}

// --- Emit the static seed file --------------------------------------------
const banner = `/**
 * GENERATED FILE — do not edit by hand.
 *
 * Baked by \`scripts/bake-mocks.mjs\` (Task 3.2). faker ran at AUTHORING time
 * only; this file is plain static data so faker's eval path never reaches a
 * CSP-governed runtime path (ADR-002 §5). Re-generate with:
 *     node scripts/bake-mocks.mjs
 *
 * Seed: ${SEED}. Frozen now: ${NOW_DATE_ISO}.
 */
// prettier-ignore`;

const body = [
  banner,
  '',
  `export const SEED_FLEET = ${JSON.stringify(fleet, null, 2)} as const;`,
  '',
  `export const SEED_CONFIGURATOR_OPTIONS = ${JSON.stringify(configuratorOptions, null, 2)} as const;`,
  '',
  `export const SEED_LOCATIONS = ${JSON.stringify(locations, null, 2)} as const;`,
  '',
  `export const SEED_EXTRAS = ${JSON.stringify(extras, null, 2)} as const;`,
  '',
  `export const SEED_SHOP = ${JSON.stringify(shop, null, 2)} as const;`,
  '',
  `export const SEED_BOOKINGS = ${JSON.stringify(bookings, null, 2)} as const;`,
  '',
  `export const SEED_TESTIMONIALS = ${JSON.stringify(testimonials, null, 2)} as const;`,
  '',
].join('\n');

writeFileSync(OUT, body, 'utf8');
console.log(
  `Baked ${fleet.length} vehicles, ${bookings.length} bookings, ${testimonials.length} testimonials -> ${OUT}`,
);
