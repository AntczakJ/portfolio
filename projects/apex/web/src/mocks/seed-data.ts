/**
 * GENERATED FILE — do not edit by hand.
 *
 * Baked by `scripts/bake-mocks.mjs` (Task 3.2). faker ran at AUTHORING time
 * only; this file is plain static data so faker's eval path never reaches a
 * CSP-governed runtime path (ADR-002 §5). Re-generate with:
 *     node scripts/bake-mocks.mjs
 *
 * Seed: 20260615. Frozen now: 2026-06-15.
 */
// prettier-ignore

export const SEED_FLEET = [
  {
    "id": "veh-lumen-gt",
    "slug": "lumen-gt",
    "name": "APEX Lumen SUV",
    "tagline": "The configurable flagship — full-size luxury, yours to shape.",
    "tier": "suv",
    "rangeKm": 640,
    "accel0to100": 4.9,
    "topSpeedKph": 250,
    "batteryKwh": 105,
    "seats": 7,
    "dailyPriceMinor": 29900,
    "currency": "EUR",
    "heroRenderSrc": "/renders/lumen-gt/hero.avif",
    "configurable": true
  },
  {
    "id": "veh-vella-sedan",
    "slug": "vella-sedan",
    "name": "APEX Vella",
    "tagline": "A long-range executive saloon that disappears the miles.",
    "tier": "sedan",
    "rangeKm": 678,
    "accel0to100": 4.9,
    "topSpeedKph": 210,
    "batteryKwh": 98,
    "seats": 5,
    "dailyPriceMinor": 16900,
    "currency": "EUR",
    "heroRenderSrc": "/renders/vella/hero.avif",
    "configurable": false
  },
  {
    "id": "veh-terra-suv",
    "slug": "terra-suv",
    "name": "APEX Terra",
    "tagline": "Seven seats, full charge, ready for the weekend.",
    "tier": "suv",
    "rangeKm": 540,
    "accel0to100": 5.6,
    "topSpeedKph": 200,
    "batteryKwh": 110,
    "seats": 7,
    "dailyPriceMinor": 18900,
    "currency": "EUR",
    "heroRenderSrc": "/renders/terra/hero.avif",
    "configurable": false
  },
  {
    "id": "veh-mira-compact",
    "slug": "mira-compact",
    "name": "APEX Mira",
    "tagline": "A compact hot-hatch — city-sized, genuinely quick.",
    "tier": "compact",
    "rangeKm": 424,
    "accel0to100": 6.4,
    "topSpeedKph": 185,
    "batteryKwh": 58,
    "seats": 5,
    "dailyPriceMinor": 9900,
    "currency": "EUR",
    "heroRenderSrc": "/renders/mira/hero.avif",
    "configurable": false
  },
  {
    "id": "veh-stratos-performance",
    "slug": "stratos",
    "name": "APEX Stratos",
    "tagline": "The performance super-saloon. Four seats, halo-car pace.",
    "tier": "performance",
    "rangeKm": 498,
    "accel0to100": 2.8,
    "topSpeedKph": 290,
    "batteryKwh": 112,
    "seats": 4,
    "dailyPriceMinor": 39900,
    "currency": "EUR",
    "heroRenderSrc": "/renders/stratos/hero.avif",
    "configurable": false
  }
] as const;

export const SEED_CONFIGURATOR_OPTIONS = {
  "vehicleId": "veh-lumen-gt",
  "colors": [
    {
      "id": "col-glacier",
      "name": "Glacier White",
      "hex": "#eef1f4",
      "materialName": "Pearl metallic"
    },
    {
      "id": "col-graphite",
      "name": "Graphite",
      "hex": "#2b313a",
      "materialName": "Satin metallic"
    },
    {
      "id": "col-voltaic",
      "name": "Voltaic Green",
      "hex": "#18c08a",
      "materialName": "Gloss pearl"
    },
    {
      "id": "col-midnight",
      "name": "Midnight Blue",
      "hex": "#16243f",
      "materialName": "Deep metallic"
    }
  ],
  "wheels": [
    {
      "id": "whl-aero",
      "name": "Aero 20\"",
      "previewSrc": "/renders/lumen-gt/wheels/aero.avif"
    },
    {
      "id": "whl-turbine",
      "name": "Turbine 21\"",
      "previewSrc": "/renders/lumen-gt/wheels/turbine.avif"
    },
    {
      "id": "whl-forged",
      "name": "Forged 22\"",
      "previewSrc": "/renders/lumen-gt/wheels/forged.avif"
    }
  ],
  "defaultColorId": "col-glacier",
  "defaultWheelId": "whl-turbine",
  "renderMatrix": {
    "col-glacier:whl-aero": "/renders/lumen-gt/matrix/col-glacier__whl-aero.avif",
    "col-glacier:whl-turbine": "/renders/lumen-gt/matrix/col-glacier__whl-turbine.avif",
    "col-glacier:whl-forged": "/renders/lumen-gt/matrix/col-glacier__whl-forged.avif",
    "col-graphite:whl-aero": "/renders/lumen-gt/matrix/col-graphite__whl-aero.avif",
    "col-graphite:whl-turbine": "/renders/lumen-gt/matrix/col-graphite__whl-turbine.avif",
    "col-graphite:whl-forged": "/renders/lumen-gt/matrix/col-graphite__whl-forged.avif",
    "col-voltaic:whl-aero": "/renders/lumen-gt/matrix/col-voltaic__whl-aero.avif",
    "col-voltaic:whl-turbine": "/renders/lumen-gt/matrix/col-voltaic__whl-turbine.avif",
    "col-voltaic:whl-forged": "/renders/lumen-gt/matrix/col-voltaic__whl-forged.avif",
    "col-midnight:whl-aero": "/renders/lumen-gt/matrix/col-midnight__whl-aero.avif",
    "col-midnight:whl-turbine": "/renders/lumen-gt/matrix/col-midnight__whl-turbine.avif",
    "col-midnight:whl-forged": "/renders/lumen-gt/matrix/col-midnight__whl-forged.avif"
  }
} as const;

export const SEED_LOCATIONS = [
  {
    "id": "loc-lis-airport",
    "slug": "lisbon-airport",
    "name": "Lisbon Airport",
    "kind": "airport",
    "address": "Aeroporto Humberto Delgado, Terminal 1",
    "city": "Lisbon",
    "lat": 38.7742,
    "lng": -9.1342,
    "staticMapSrc": "/maps/lisbon-airport.avif",
    "hours": "Mon-Sun, 06:00-23:00"
  },
  {
    "id": "loc-lis-city",
    "slug": "lisbon-baixa",
    "name": "Lisbon Baixa",
    "kind": "city",
    "address": "Rua Augusta 24, Baixa",
    "city": "Lisbon",
    "lat": 38.7106,
    "lng": -9.1366,
    "staticMapSrc": "/maps/lisbon-baixa.avif",
    "hours": "Mon-Sun, 08:00-21:00"
  },
  {
    "id": "loc-prt-airport",
    "slug": "porto-airport",
    "name": "Porto Airport",
    "kind": "airport",
    "address": "Aeroporto Francisco Sa Carneiro",
    "city": "Porto",
    "lat": 41.2356,
    "lng": -8.6783,
    "staticMapSrc": "/maps/porto-airport.avif",
    "hours": "Mon-Sun, 06:00-22:00"
  },
  {
    "id": "loc-prt-depot",
    "slug": "porto-depot",
    "name": "Porto Charging Depot",
    "kind": "depot",
    "address": "Rua do Bonjardim 312",
    "city": "Porto",
    "lat": 41.1521,
    "lng": -8.6094,
    "staticMapSrc": "/maps/porto-depot.avif",
    "hours": "Mon-Fri, 07:00-20:00"
  }
] as const;

export const SEED_EXTRAS = [
  {
    "id": "ext-gps",
    "name": "Navigation pack",
    "description": "Premium offline maps and live traffic routing.",
    "priceMinor": 600,
    "pricing": "per-day",
    "kind": "gps"
  },
  {
    "id": "ext-child-seat",
    "name": "Child seat",
    "description": "ISOFIX-mounted seat, suitable from 9 months to 4 years.",
    "priceMinor": 500,
    "pricing": "per-day",
    "kind": "child-seat"
  },
  {
    "id": "ext-additional-driver",
    "name": "Additional driver",
    "description": "Add a second named driver to the rental.",
    "priceMinor": 3500,
    "pricing": "flat",
    "kind": "additional-driver"
  },
  {
    "id": "ins-basic",
    "name": "Essential cover",
    "description": "Third-party liability with a standard damage excess.",
    "priceMinor": 1500,
    "pricing": "per-day",
    "kind": "insurance",
    "tier": "basic",
    "excessMinor": 120000
  },
  {
    "id": "ins-plus",
    "name": "Plus cover",
    "description": "Reduced excess plus tyre, glass and charging-cable cover.",
    "priceMinor": 2900,
    "pricing": "per-day",
    "kind": "insurance",
    "tier": "plus",
    "excessMinor": 40000
  },
  {
    "id": "ins-premium",
    "name": "Premium cover",
    "description": "Zero excess, full damage waiver and personal-effects cover.",
    "priceMinor": 4500,
    "pricing": "per-day",
    "kind": "insurance",
    "tier": "premium",
    "excessMinor": 0
  }
] as const;

export const SEED_SHOP = {
  "id": "shop-apex",
  "name": "APEX",
  "tagline": "Premium EVs, by the day.",
  "about": "APEX is a premium electric-vehicle rental built for people who want the car to feel like part of the trip. Configure it, reserve it, and pick it up fully charged.",
  "supportEmail": "hello@apex-rentals.example",
  "supportPhone": "+351 210 000 000",
  "hours": "Support, Mon-Sun 07:00-23:00",
  "locationIds": [
    "loc-lis-airport",
    "loc-lis-city",
    "loc-prt-airport",
    "loc-prt-depot"
  ],
  "currency": "EUR",
  "priceRangeMinMinor": 9900,
  "priceRangeMaxMinor": 39900,
  "social": {
    "instagram": "https://instagram.com/apex.rentals.example",
    "facebook": "https://facebook.com/apex.rentals.example",
    "tiktok": "https://tiktok.com/@apex.rentals.example"
  }
} as const;

export const SEED_BOOKINGS = [
  {
    "id": "bk-001",
    "vehicleId": "veh-lumen-gt",
    "fromISODate": "2026-06-21",
    "toISODate": "2026-06-26",
    "reason": "maintenance"
  },
  {
    "id": "bk-002",
    "vehicleId": "veh-lumen-gt",
    "fromISODate": "2026-07-01",
    "toISODate": "2026-07-07",
    "reason": "transfer"
  },
  {
    "id": "bk-003",
    "vehicleId": "veh-lumen-gt",
    "fromISODate": "2026-07-15",
    "toISODate": "2026-07-18",
    "reason": "booked"
  },
  {
    "id": "bk-004",
    "vehicleId": "veh-lumen-gt",
    "fromISODate": "2026-07-24",
    "toISODate": "2026-07-31",
    "reason": "transfer"
  },
  {
    "id": "bk-005",
    "vehicleId": "veh-vella-sedan",
    "fromISODate": "2026-06-21",
    "toISODate": "2026-06-24",
    "reason": "transfer"
  },
  {
    "id": "bk-006",
    "vehicleId": "veh-vella-sedan",
    "fromISODate": "2026-06-29",
    "toISODate": "2026-07-02",
    "reason": "maintenance"
  },
  {
    "id": "bk-007",
    "vehicleId": "veh-terra-suv",
    "fromISODate": "2026-06-19",
    "toISODate": "2026-06-25",
    "reason": "maintenance"
  },
  {
    "id": "bk-008",
    "vehicleId": "veh-terra-suv",
    "fromISODate": "2026-07-04",
    "toISODate": "2026-07-09",
    "reason": "maintenance"
  },
  {
    "id": "bk-009",
    "vehicleId": "veh-mira-compact",
    "fromISODate": "2026-06-21",
    "toISODate": "2026-06-23",
    "reason": "transfer"
  },
  {
    "id": "bk-010",
    "vehicleId": "veh-mira-compact",
    "fromISODate": "2026-06-27",
    "toISODate": "2026-06-30",
    "reason": "maintenance"
  },
  {
    "id": "bk-011",
    "vehicleId": "veh-mira-compact",
    "fromISODate": "2026-07-03",
    "toISODate": "2026-07-06",
    "reason": "booked"
  },
  {
    "id": "bk-012",
    "vehicleId": "veh-stratos-performance",
    "fromISODate": "2026-06-17",
    "toISODate": "2026-06-21",
    "reason": "transfer"
  },
  {
    "id": "bk-013",
    "vehicleId": "veh-stratos-performance",
    "fromISODate": "2026-06-30",
    "toISODate": "2026-07-04",
    "reason": "maintenance"
  },
  {
    "id": "bk-014",
    "vehicleId": "veh-stratos-performance",
    "fromISODate": "2026-07-10",
    "toISODate": "2026-07-14",
    "reason": "transfer"
  },
  {
    "id": "bk-015",
    "vehicleId": "veh-stratos-performance",
    "fromISODate": "2026-07-23",
    "toISODate": "2026-07-26",
    "reason": "maintenance"
  }
] as const;

export const SEED_TESTIMONIALS = [
  {
    "id": "tst-01",
    "author": "Kristina Y.",
    "role": "Weekend driver, Lisbon",
    "rating": 5,
    "quote": "Picked up fully charged, dropped off without a queue. The whole thing felt premium.",
    "vehicle": "APEX Lumen SUV"
  },
  {
    "id": "tst-02",
    "author": "Timmothy P.",
    "role": "Business traveller, Porto",
    "rating": 4,
    "quote": "Configured the colour and wheels the night before — the car that arrived matched exactly.",
    "vehicle": "APEX Terra"
  },
  {
    "id": "tst-03",
    "author": "Ines S.",
    "role": "First-time EV renter, Cascais",
    "rating": 4,
    "quote": "Instant torque, zero fuel stops, and a booking flow that actually respected my time.",
    "vehicle": "APEX Terra"
  },
  {
    "id": "tst-04",
    "author": "Roxanne O.",
    "role": "Family on holiday, Sintra",
    "rating": 5,
    "quote": "Rented one to try before buying. The APEX team made the EV case better than any showroom.",
    "vehicle": "APEX Stratos"
  },
  {
    "id": "tst-05",
    "author": "Afton C.",
    "role": "Wedding-day hire, Faro",
    "rating": 4,
    "quote": "The quiet on the motorway is something else. Best weekend rental I have had.",
    "vehicle": "APEX Terra"
  },
  {
    "id": "tst-06",
    "author": "Nikita R.",
    "role": "Road-trip planner, Braga",
    "rating": 4,
    "quote": "Clean car, clear pricing, no fine-print surprises. I will book again.",
    "vehicle": "APEX Vella"
  }
] as const;
