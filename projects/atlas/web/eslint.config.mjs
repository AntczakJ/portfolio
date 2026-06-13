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
    ignores: ['.next/**', 'node_modules/**', 'next-env.d.ts'],
  },
  {
    // `react-hooks/set-state-in-effect` (new in react-hooks v6 / eslint-config-next
    // 16) flags a synchronous setState inside an effect. Both call sites are the
    // canonical next-themes / mounted-gate anti-FOUC pattern it false-positives on:
    // a one-shot post-hydration `setMounted(true)` so the resolved-theme-dependent
    // UI (the theme toggle's icon, the connection pill's "live" amber treatment)
    // only renders client-side, avoiding a hydration mismatch. It sets initial
    // client state once, not a render loop.
    files: [
      'src/components/chrome/theme-toggle.tsx',
      'src/components/chrome/connection-pill.tsx',
    ],
    rules: {
      'react-hooks/set-state-in-effect': 'off',
    },
  },
  {
    // `react-hooks/refs` (new in react-hooks v6 / eslint-config-next 16) flags the
    // `ref.current = latestValue` latest-value sync these files perform during
    // render. The pattern is deliberate and correct: an imperative singleton (the
    // MapLibre controller / the WebSocket + rAF interpolation loop) must mount
    // EXACTLY ONCE and must not re-create on a theme / selection / reduced-motion
    // change. We capture those reactive values in refs and read `.current` inside
    // the mount-once effect, so the effect carries no reactive dependencies while
    // still seeing current values. This is the documented latest-ref escape hatch;
    // the rule cannot distinguish it from an accidental render-time ref write.
    files: [
      'src/components/map/map-canvas.tsx',
      'src/lib/interp/use-live-telemetry.ts',
    ],
    rules: {
      'react-hooks/refs': 'off',
    },
  },
];

export default config;
