import type { ConsoleMessage, Page } from '@playwright/test';

/**
 * A page-error / console-error / CSP-violation collector.
 *
 * Any spec that wants to assert a clean production surface attaches one BEFORE
 * navigating, drives the page, then asserts the collected arrays are empty. This
 * is the production-surface contract the frontend-engineer verified by hand at
 * every milestone (ZERO CSP violations / console errors / page errors under the
 * prod build + the strict ADR-002 §6 CSP); the E2E suite makes it a standing
 * gate.
 *
 * nocturne has NO tracked/known CSP violation: the one risk — Zod v4's JIT
 * `new Function` probe reaching the client bundle — was closed with
 * `z.config({ jitless: true })` (the side-effect import in the layout + the
 * providers + the schema barrel; AGENT_NOTES Pass-1). So every CSP violation
 * here is UNEXPECTED and fails the assertion; there is no allow-list.
 *
 * CSP violations are caught two ways, because a violation surfaces differently
 * depending on the directive:
 *   1. The page-side `securitypolicyviolation` event (the authoritative signal),
 *      relayed to Node via an exposed binding.
 *   2. Console messages mentioning a CSP refusal (a belt-and-braces net).
 */
export interface Diagnostics {
  /** Uncaught exceptions / unhandled rejections that reached the page. */
  readonly pageErrors: Error[];
  /** `console.error(...)` messages (excluding known-benign noise). */
  readonly consoleErrors: string[];
  /** CSP violations, as `"<directive> blocked <uri>"` strings. */
  readonly cspViolations: string[];
}

/**
 * Console noise we deliberately tolerate. Keep this list TIGHT and documented —
 * every entry is a conscious exception, not a catch-all.
 */
function isBenignConsoleError(text: string): boolean {
  // A favicon / resource 404 is not a functional error for these specs.
  if (/favicon/i.test(text)) return true;
  // Some Chromium builds surface the React DevTools notice via console.
  if (/Download the React DevTools/i.test(text)) return true;
  // A 404 status line for a resource fetch (not a code error).
  if (/Failed to load resource.*404/i.test(text)) return true;
  // Software-GL (SwiftShader) on the headless CI runner can emit WebGL
  // performance / context-loss warnings that are an artefact of NOT having a
  // GPU, not a defect in the app. They are logged as warnings, not errors,
  // but some driver paths surface them as console.error — tolerate the
  // SwiftShader/WebGL-noise band specifically (never a CSP refusal, which is
  // matched first in the caller and never reaches here).
  if (/SwiftShader|WebGL.*(context|performance)|GroupMarkerNotSet/i.test(text))
    return true;
  return false;
}

const VIOLATION_BINDING = '__nocturneReportCspViolation';

export async function attachDiagnostics(page: Page): Promise<Diagnostics> {
  const pageErrors: Error[] = [];
  const consoleErrors: string[] = [];
  const cspViolations: string[] = [];

  page.on('pageerror', (err) => {
    pageErrors.push(err);
  });

  page.on('console', (msg: ConsoleMessage) => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    if (
      /Content Security Policy|Refused to (execute|load|apply|connect)/i.test(
        text,
      )
    ) {
      cspViolations.push(text);
      return;
    }
    if (isBenignConsoleError(text)) return;
    consoleErrors.push(text);
  });

  // Relay the page-side securitypolicyviolation event into Node. The binding
  // must be exposed + the listener added before any navigation so we catch
  // violations fired during the very first paint/hydration.
  await page.exposeFunction(
    VIOLATION_BINDING,
    (detail: { directive: string; blockedURI: string }) => {
      cspViolations.push(
        `${detail.directive} blocked ${detail.blockedURI || '(inline)'}`,
      );
    },
  );
  await page.addInitScript((binding: string) => {
    document.addEventListener('securitypolicyviolation', (ev) => {
      const report = (
        window as unknown as Record<
          string,
          (d: { directive: string; blockedURI: string }) => void
        >
      )[binding];
      if (typeof report === 'function') {
        report({ directive: ev.violatedDirective, blockedURI: ev.blockedURI });
      }
    });
  }, VIOLATION_BINDING);

  return { pageErrors, consoleErrors, cspViolations };
}
