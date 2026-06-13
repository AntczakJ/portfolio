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
    // `useGsapEffect` is a pass-through-deps primitive: it forwards the
    // caller's `deps` array straight to `useEffect` and reads `setup` / `idle`
    // via refs. The `exhaustive-deps` rule cannot statically verify a forwarded
    // deps array and false-positives on the stable `scope` ref param.
    // `react-hooks/refs` (new in the react-hooks v6 plugin that
    // eslint-config-next 16 ships) flags the deliberate latest-value ref sync,
    // which is the whole point of the primitive. Scoping both exceptions to
    // this one file keeps the rules active everywhere else. (Pattern inherited
    // from razors-edge / atrium; apex builds its own GSAP module.)
    files: ['src/lib/gsap/use-gsap-effect.ts'],
    rules: {
      'react-hooks/exhaustive-deps': 'off',
      'react-hooks/refs': 'off',
    },
  },
  {
    // `react-hooks/set-state-in-effect` (new in react-hooks v6 / eslint-config-next
    // 16) flags a synchronous setState inside an effect. These are the canonical,
    // correct patterns it false-positives on — each sets initial CLIENT-only state
    // exactly once after mount, not a render loop:
    //   - theme-toggle: the next-themes post-hydration `setMounted(true)`
    //     anti-FOUC / anti-hydration-mismatch flag.
    //   - configurator-stage: the after-mount reduced-motion + theme read (SSR
    //     cannot know `matchMedia` / the live `html.dark` class); the scene is
    //     never decided on first paint.
    //   - date-range-picker: anchoring the visible month to the focused day via a
    //     FUNCTIONAL updater that no-ops when already correct (`prev === next`),
    //     so it cannot loop — it keeps roving focus inside a visible pane.
    files: [
      'src/components/chrome/theme-toggle.tsx',
      'src/components/configurator/configurator-stage.tsx',
      'src/components/reserve/date-range-picker.tsx',
    ],
    rules: {
      'react-hooks/set-state-in-effect': 'off',
    },
  },
  {
    // `react-hooks/immutability` (new in react-hooks v6 / eslint-config-next 16)
    // forbids mutating a value returned from a hook. It false-positives on the
    // core React Three Fiber pattern: three.js objects (the `WebGLRenderer` from
    // `useThree`, and a `MeshPhysicalMaterial` built with `useMemo`) are MUTABLE
    // by design — you set `gl.toneMapping`, `material.metalness`, etc. imperatively
    // inside an effect, then `invalidate()` to repaint under `frameloop="demand"`.
    // There is no React-state equivalent; this is how r3f/three is driven. Scoped
    // to the two configurator files that touch the renderer/material directly.
    files: [
      'src/components/configurator/configurator-scene.tsx',
      'src/components/configurator/lumen-model.tsx',
    ],
    rules: {
      'react-hooks/immutability': 'off',
    },
  },
  {
    // `react-hooks/refs` (new in react-hooks v6 / eslint-config-next 16) flags
    // reading or writing `ref.current` during render and passing a ref to a
    // function during render. These three sites are the deliberate, correct
    // patterns it false-positives on:
    //   - reservation-wizard: the classic "previous value" ref — read
    //     `prevIndexRef.current` during render to derive the slide direction, then
    //     sync it in an effect. (React's own docs describe this pattern.)
    //   - use-step-transition: a latest-value ref sync (`dirRef.current = direction`)
    //     so the deferred GSAP enter reads the freshest direction without making it
    //     an effect dep — the same primitive shape as use-gsap-effect.
    //   - reveal: passing the GSAP-context `scope` DOM ref to `createElement`
    //     (the dynamic-tag analogue of `<div ref={scope}>`); the ref is a DOM
    //     attachment, never read during render.
    files: [
      'src/components/reserve/reservation-wizard.tsx',
      'src/components/reserve/use-step-transition.ts',
      'src/components/sections/reveal.tsx',
    ],
    rules: {
      'react-hooks/refs': 'off',
    },
  },
  {
    // `react-hooks/static-components` (new in react-hooks v6 / eslint-config-next
    // 16) forbids declaring a component during render because a fresh identity each
    // render resets that component's OWN state. `MonthGrid` here holds NO hooks /
    // no internal state — it is a pure render helper that closes over the picker's
    // roving-focus + selection state and handlers (~12 of them) to render one
    // `role="grid"` month, invoked once on mobile and twice on desktop. The rule's
    // state-reset hazard therefore does not apply; hoisting it to a top-level
    // component would only mean threading a dozen props/handlers through a
    // keyboard- and a11y-critical widget for no behavioural gain. Scoped to this
    // one file.
    files: ['src/components/reserve/date-range-picker.tsx'],
    rules: {
      'react-hooks/static-components': 'off',
    },
  },
];

export default config;
