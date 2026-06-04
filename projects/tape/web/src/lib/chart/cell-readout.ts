/**
 * Cell readout formatting — pure helpers shared by the visual tooltip
 * and the screen-reader live mirror (Task 3.5).
 *
 * Kept out of the React components so the sentence the SR announces is
 * unit-testable without rendering, and so the visual tooltip and the SR
 * mirror cannot drift in what they report.
 *
 * Convention (matches `lib/chart/cells.ts` and AGENT_NOTES Task 1.3):
 *   - `askVolume` is buy-aggressed volume (taker lifted the offer),
 *   - `bidVolume` is sell-aggressed volume (taker hit the bid),
 *   - delta = ask − bid, positive = net buying,
 *   - imbalance = delta / total in [-1, +1], positive = ask-dominant.
 */
import {
  computeImbalance,
  type NormalizedCell,
} from './cells';
import { DEFAULT_PRICE_BUCKET_SIZE } from './footprint-engine';

/** Stable identity for a hovered cell — the throttle key for the SR
 * mirror (announce on cell change, not on every pointer move). */
export function cellReadoutKey(cell: {
  bucketTs: number;
  priceBucket: number;
}): string {
  return `${String(cell.bucketTs)}:${String(cell.priceBucket)}`;
}

const PRICE_FORMAT = new Intl.NumberFormat('en-US', {
  maximumFractionDigits: 0,
});
const VOL_FORMAT = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

function signedVol(v: number): string {
  const sign = v > 0 ? '+' : v < 0 ? '-' : '';
  return `${sign}${VOL_FORMAT.format(Math.abs(v))}`;
}

/**
 * Build the screen-reader sentence for a hovered cell. Spoken form,
 * e.g.:
 *
 *   "Price 71,250. Bid 2.1, Ask 3.4, Delta +1.3, Imbalance 62% ask."
 *
 * - `priceBucket` is an INDEX; we multiply by the bucket size to speak
 *   the USD price (no `$` so the SR does not say "dollar" awkwardly —
 *   "Price 71,250" reads naturally as the trader's price).
 * - Imbalance is spoken as a magnitude percentage plus the dominant
 *   side word ("ask" = buy-aggressed dominant, "bid" = sell-aggressed
 *   dominant, "balanced" at exactly zero) — the non-visual equivalent
 *   of the tooltip's signed colour.
 * - An empty cell (no recorded volume) announces zeros and "balanced"
 *   so the reading stays a full sentence rather than a partial one.
 */
export function formatCellReadoutSr(
  cell: { bucketTs: number; priceBucket: number },
  data: NormalizedCell | null,
): string {
  const priceUsd = cell.priceBucket * DEFAULT_PRICE_BUCKET_SIZE;
  const bid = data?.bidVolume ?? 0;
  const ask = data?.askVolume ?? 0;
  const delta = ask - bid;
  const imbalance = data === null ? 0 : computeImbalance(data);
  const imbalancePct = Math.round(Math.abs(imbalance) * 100);
  const side =
    imbalance > 0 ? 'ask' : imbalance < 0 ? 'bid' : 'balanced';
  const imbalancePhrase =
    side === 'balanced'
      ? 'Imbalance balanced'
      : `Imbalance ${String(imbalancePct)}% ${side}`;

  return (
    `Price ${PRICE_FORMAT.format(priceUsd)}. ` +
    `Bid ${VOL_FORMAT.format(bid)}, ` +
    `Ask ${VOL_FORMAT.format(ask)}, ` +
    `Delta ${signedVol(delta)}, ` +
    `${imbalancePhrase}.`
  );
}
