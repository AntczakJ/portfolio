/**
 * The six projects' E2E truth (Phase 6, Task 6.2).
 *
 * Mirrors `src/data/projects.ts` for the fields the E2E asserts on. The unit
 * suite (Task 6.1) is the authority that the app's `PROJECTS` config encodes
 * these exactly; the E2E re-states them independently so a spec is a genuine
 * end-to-end check against the real rendered DOM (a test that imported the app's
 * own module would only prove the app agrees with itself). Kept tiny and fixed.
 *
 * Order is canonical (tape … atlas). `name` is the visible display name (the
 * accessible-name stem for "<name> — live demo"). `demoUrl` is the real public
 * Fly URL the live demo anchor must point at.
 */
export interface ProjectFixture {
  readonly slug: string;
  readonly name: string;
  readonly demoUrl: string;
  readonly category: 'api-heavy' | 'web-only';
}

export const PROJECTS: readonly ProjectFixture[] = [
  { slug: 'tape', name: 'tape', demoUrl: 'https://tape-demo.fly.dev', category: 'api-heavy' },
  { slug: 'meld', name: 'meld', demoUrl: 'https://meld-demo.fly.dev', category: 'api-heavy' },
  {
    slug: 'razors-edge',
    name: "razor's edge",
    demoUrl: 'https://razors-edge-demo.fly.dev',
    category: 'web-only',
  },
  { slug: 'pulse', name: 'pulse', demoUrl: 'https://pulse-demo-web.fly.dev', category: 'api-heavy' },
  { slug: 'apex', name: 'apex', demoUrl: 'https://apex-rentals.fly.dev', category: 'web-only' },
  { slug: 'atlas', name: 'atlas', demoUrl: 'https://atlas-ops.fly.dev', category: 'api-heavy' },
];

/** The id of each project's bay section (matches `bayId(slug)` in the app). */
export function bayId(slug: string): string {
  return `bay-${slug}`;
}

/** The discernible accessible name of a project's live-demo link. */
export function demoLinkName(name: string): string {
  return `${name} — live demo`;
}
