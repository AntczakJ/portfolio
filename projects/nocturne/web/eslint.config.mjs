// Next 16 ships eslint-config-next as native ESLint flat configs
// (`Linter.Config[]` arrays under the `/core-web-vitals` and `/typescript`
// subpaths). The old `FlatCompat.extends('next/...')` bridge crashes under
// ESLint 9 ("Converting circular structure to JSON") because it double-wraps an
// already-flat config — so we import and spread the flat arrays directly.
// `next lint` was removed in Next 16; the `lint` script calls `eslint .`.
import coreWebVitals from 'eslint-config-next/core-web-vitals';
import typescript from 'eslint-config-next/typescript';

const config = [
  ...coreWebVitals,
  ...typescript,
  {
    ignores: ['.next/**', 'node_modules/**', 'next-env.d.ts', 'scripts/**'],
  },
  {
    // `react-hooks/set-state-in-effect` (react-hooks v6 / eslint-config-next 16)
    // flags a synchronous setState inside an effect. This is the canonical,
    // correct pattern it false-positives on (inherited from apex's
    // `configurator-stage`): the AFTER-MOUNT capability read. The server cannot
    // know `matchMedia` / `navigator` / a live WebGL2 context, so the tier MUST
    // be probed once after mount and committed to state — it is not a render
    // loop (the effect has an empty dep array and runs exactly once). Scoped to
    // this one file keeps the rule active everywhere else.
    files: [
      'src/components/stage/stage.tsx',
      // `use-audio-engine` probes `micAvailable` (`window.isSecureContext` +
      // `navigator.mediaDevices`) once after mount — server-unknowable, the same
      // after-mount-capability-read pattern as `stage.tsx`.
      'src/components/stage/use-audio-engine.ts',
      // `theme-toggle` uses the canonical next-themes mounted-guard
      // (`setMounted(true)` once after mount) so the theme icon does not flip on
      // hydration — the server cannot know the resolved theme. Runs exactly once
      // (empty deps), not a render loop.
      'src/components/stage/theme-toggle.tsx',
    ],
    rules: {
      'react-hooks/set-state-in-effect': 'off',
    },
  },
  {
    // `react-hooks/immutability` (react-hooks v6) flags the canonical R3F
    // ref-bridge pattern the engine depends on: a `useFrame` callback writing
    // the per-frame audio-driven post intensities into a shared ref object so
    // the post effects read them WITHOUT a React re-render (60 fps requires no
    // render churn). This is the intended way to share frame-loop values across
    // R3F components; the rule false-positives on the ref mutation. Scoped to
    // the engine file only.
    files: ['src/components/stage/nocturne-field.tsx'],
    rules: {
      'react-hooks/immutability': 'off',
    },
  },
];

export default config;
