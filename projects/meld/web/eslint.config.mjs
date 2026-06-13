// Next 16 ships eslint-config-next as native ESLint flat configs
// (`Linter.Config[]` arrays under the `/core-web-vitals` and `/typescript`
// subpaths). The old `FlatCompat.extends('next/...')` bridge now produces a
// "Converting circular structure to JSON" crash under ESLint 9 because it
// double-wraps an already-flat config — so we import and spread the flat
// arrays directly. `next lint` was also removed in Next 16; the `lint` script
// now calls `eslint .` against this config.
import coreWebVitals from 'eslint-config-next/core-web-vitals';
import typescript from 'eslint-config-next/typescript';

const config = [
  ...coreWebVitals,
  ...typescript,
  {
    ignores: ['.next/**', 'node_modules/**', 'next-env.d.ts', 'scripts/**'],
  },
  {
    // `react-hooks/refs` (new in the react-hooks v6 plugin eslint-config-next
    // 16 ships) flags reading or writing `ref.current` during render. Both
    // sites below are the canonical, SAFE latest-value ref-sync primitive:
    // they write the freshest prop/callback into a ref on every render
    // (`onUnknownControlFrameRef.current = onUnknownControlFrame`,
    // `providerRef.current = provider`) so a stable callback handed to an
    // external system (the Hocuspocus provider) always reads the current
    // value WITHOUT taking it as an effect dependency. The write is
    // idempotent and never read during the same render to compute JSX, so it
    // is concurrent-safe — unlike a stateful render-phase latch (which we
    // fixed in code in identity-badge-client.tsx by moving to useState rather
    // than exempting). Scoping to these two files keeps the rule live
    // everywhere else.
    files: [
      'src/components/board/board-canvas-host.tsx',
      'src/lib/yjs/use-overrun-handler.ts',
    ],
    rules: {
      'react-hooks/refs': 'off',
    },
  },
  {
    // `react-hooks/set-state-in-effect` (new in react-hooks v6 /
    // eslint-config-next 16) flags a synchronous setState inside an effect.
    // Each site below is a GUARDED one-shot that synchronizes React state
    // with an EXTERNAL system transition — exactly the case the rule's own
    // docs permit — not a render loop:
    //   - theme-toggle.tsx: the next-themes post-hydration `setMounted(true)`
    //     anti-FOUC flag (fires once, empty deps).
    //   - board-canvas-host.tsx: the offline→live shape crossfade dip,
    //     gated by a `previous === current` early-return.
    //   - offline-aria-live-region.tsx: the assertive/polite announcement
    //     copy, gated by a connection-state transition guard.
    //   - use-reconciliation-count.ts: the Y.Map observer reset on doc swap
    //     and the offline→live baseline reset, both gated and synchronizing
    //     against the Yjs doc / connection-state external systems.
    files: [
      'src/components/chrome/theme-toggle.tsx',
      'src/components/chrome/offline-aria-live-region.tsx',
      'src/components/board/board-canvas-host.tsx',
      'src/lib/yjs/use-reconciliation-count.ts',
    ],
    rules: {
      'react-hooks/set-state-in-effect': 'off',
    },
  },
];

export default config;
