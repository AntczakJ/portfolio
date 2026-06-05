import { shopSchema, type Shop } from '@/lib/schemas/shop';

import { SEED_SHOP } from './seed-data';

/** Shop (the rental business) mock accessor (Task 3.2). Drives footer + JSON-LD. */
export const SHOP: Shop = shopSchema.parse(SEED_SHOP);
