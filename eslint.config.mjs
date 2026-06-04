import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import jsxA11y from 'eslint-plugin-jsx-a11y';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/.next/**',
      '**/dist/**',
      '**/build/**',
      '**/out/**',
      '**/.turbo/**',
      '**/coverage/**',
      '**/playwright-report/**',
      '**/test-results/**',
      '**/.review/**',
      '**/*.min.js',
      '**/*.min.css',
      // Next.js generates `next-env.d.ts` on every build and gitignores it. It
      // is not authored source (it only emits triple-slash references the
      // strict config forbids), is never staged for the pre-commit hook, and
      // each Next package's own eslint config already ignores it — mirror that
      // at the root so the lint-staged generic glob does not trip on it.
      '**/next-env.d.ts',
      // Standalone screenshot-capture and live-verification scripts. They
      // are operational tooling (run by hand against a local stack), not in
      // any tsconfig, and not part of CI or the test glob.
      '**/docs/capture-*.mjs',
      '**/e2e/*.mjs',
      // Per-package operational scripts (smoke clients, one-off probes) live
      // in projects/*/server/scripts and are deliberately outside each
      // package's tsconfig include, so the type-aware project service cannot
      // resolve them. Each package's own eslint config already ignores
      // scripts/**; mirror that at the root so the lint-staged generic glob
      // does not fail on them with a "not found by the project service" parse
      // error.
      '**/scripts/**',
      // Build-tool config files (vitest, drizzle-kit) live at a package root
      // outside that package's tsconfig include, so the type-aware project
      // service rejects them with a "not found by the project service" parse
      // error. They are build-tool config, not authored app source.
      '**/vitest.config.{ts,mts}',
      '**/drizzle.config.{ts,mts}',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
      },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-misused-promises': [
        'error',
        { checksVoidReturn: { attributes: false } },
      ],
    },
  },
  {
    files: ['**/*.{jsx,tsx}'],
    ...jsxA11y.flatConfigs.recommended,
  },
  {
    files: ['**/*.{js,cjs,mjs}', '*.config.{js,cjs,mjs,ts}'],
    languageOptions: {
      parserOptions: {
        projectService: false,
      },
    },
    ...tseslint.configs.disableTypeChecked,
  },
  {
    // NestJS module/controller classes are decorator-only by framework
    // design (an `@Module({...})` class legitimately has no members), which
    // `no-extraneous-class` flags. Disable it for the Nest server so the
    // strict monorepo config does not fight the framework idiom.
    files: ['projects/pulse/server/**/*.ts'],
    rules: {
      '@typescript-eslint/no-extraneous-class': 'off',
    },
  },
  {
    // Test files legitimately use a few patterns the strict production config
    // forbids: empty mock-method stubs (`no-empty-function`), non-null
    // assertions on fixtures known to be present (`no-non-null-assertion`),
    // `Array<T>` style and belt-and-braces assertions in type-shape checks
    // (`array-type`, `no-unnecessary-type-assertion`). Relax those for test
    // files ONLY — production code stays fully strict. This also reconciles the
    // tape-web test suite (which lints via its own next/typescript config) with
    // the repo-root strict gate that lint-staged runs on every staged file.
    files: [
      '**/__tests__/**/*.{ts,tsx}',
      '**/*.{test,spec}.{ts,tsx}',
      '**/__mocks__/**/*.{ts,tsx}',
    ],
    rules: {
      '@typescript-eslint/no-empty-function': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/array-type': 'off',
      '@typescript-eslint/no-unnecessary-type-assertion': 'off',
    },
  },
);
