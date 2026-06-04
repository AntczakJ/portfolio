import type { ReactNode } from 'react';

import { FootprintChart } from '@/components/chart/footprint-chart';
import { MobileTape } from '@/components/chart/mobile-tape';
import { TapeTicker } from '@/components/chart/tape-ticker';
import { WSProviderMount } from '@/components/ws/ws-provider-mount';

/**
 * v1 main canvas — the Phase 3 footprint chart fills the main region.
 *
 * **Wow moment (Phase 3.1).** The `<FootprintChart />` here is the
 * core wow-moment surface. It owns its own canvas, ResizeObserver, and
 * rAF loop via the `FootprintChartEngine`. The engine subscribes
 * directly to the Zustand stream store and the theme bridge — no
 * per-frame React work.
 *
 * **WS provider mount.** The `WSStreamProvider` is dynamically imported
 * here (not in `app/layout.tsx`) so its module graph — including the
 * ~14 KB `msgpackr` runtime dep — lands in this route's chunk rather
 * than the root layout chunk. The `/` page in v1 IS the dashboard, so
 * mounting at the page level is correct; if a future route surfaces
 * that should NOT pay the msgpackr cost (a marketing landing, etc.),
 * move the provider mount into a dedicated dashboard layout instead
 * of root layout.
 *
 * In development we additionally render a `<TokenPreview />` dev aid
 * (Task 2.5) so we can visually confirm the `getComputedStyle` +
 * `MutationObserver` bridge fires when the theme flips. Phase 3.1
 * repositions the preview as a small floating overlay in the
 * bottom-right corner so it does not compete with the chart for
 * vertical space. The literal `process.env.NODE_ENV === 'development'`
 * check gates the JSX so Next inlines it to `false` in production
 * builds and the whole subtree is dead-code-eliminated.
 *
 * **Responsive split (PLAN.md success criteria).** Below the `md`
 * (768 px) breakpoint we hide the Canvas2D footprint chart and render
 * `<MobileTape />` instead — a vertical scrollable list of recent
 * trades. Both branches are present in the SSR HTML and toggled via
 * Tailwind `hidden md:flex` / `md:hidden` so there is no hydration
 * mismatch. At ≥ 768 px the chart owns the surface; below 768 px the
 * tape feed reads as a deliberately mobile-optimised view rather
 * than a cramped chart.
 *
 * **Desktop tape pane (Task 3.3).** At ≥ 768 px a dedicated
 * `<TapeTicker />` pane sits to the LEFT of the footprint chart — a
 * virtualized, click-to-pin, keyboard-reachable live trade feed
 * consuming the 3.4 stream store's tick ring. It is distinct from the
 * in-canvas right-edge strip (axis-adjacent decoration drawn by the
 * rAF loop). The pane is `lg:flex` so the chart keeps its full width
 * on tablets (768–1023 px) where horizontal real estate is tight; the
 * tape returns at desktop widths (≥ 1024 px) and at < 768 px the
 * mobile single-column tape takes over.
 */
export default function HomePage(): ReactNode {
  return (
    <div className="relative flex h-full w-full flex-1 overflow-hidden">
      <WSProviderMount />
      {/* Desktop: tape pane (lg+) + chart. */}
      <div className="hidden h-full w-full md:flex">
        <aside className="hidden h-full w-[15rem] shrink-0 lg:block">
          <TapeTicker />
        </aside>
        <div className="h-full min-w-0 flex-1">
          <FootprintChart />
        </div>
      </div>
      {/* Mobile: single-column tape-only fallback (< 768 px). */}
      <div className="block h-full w-full md:hidden">
        <MobileTape />
      </div>
    </div>
  );
}
