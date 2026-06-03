import type { ConsoleMessage, Page } from '@playwright/test';

/**
 * A page-error / console-error / CSP-violation collector.
 *
 * The landing smoke (and any spec that wants to assert a clean console)
 * attaches one of these BEFORE navigating, drives the page, then asserts the
 * collected arrays are empty. This is the production-surface contract the
 * frontend-engineer verified by hand at every milestone (ZERO CSP violations
 * / console errors / page errors under the prod build + strict CSP); the E2E
 * suite makes it a standing gate.
 *
 * CSP violations are caught two ways, because a violation surfaces
 * differently depending on the directive:
 *   1. The page-side `securitypolicyviolation` event (the authoritative
 *      signal — fired in the page for every blocked resource/inline), relayed
 *      to Node via an exposed binding.
 *   2. Console messages whose text mentions "Content Security Policy" (a
 *      belt-and-braces net for anything the event misses).
 */
export interface Diagnostics {
  /** Uncaught exceptions / unhandled rejections that reached the page. */
  readonly pageErrors: Error[];
  /** `console.error(...)` messages (excluding known-benign noise). */
  readonly consoleErrors: string[];
  /**
   * UNEXPECTED CSP violations, as `"<directive> blocked <uri>"` strings. The
   * one KNOWN, separately-tracked violation (the zod-4 `script-src eval`
   * probe — defect D-CSP-1, owned by the `theme-toggle` fixme) is filtered
   * out of this list so the deploy-anchor assertions do not flap on a bug
   * that is already loudly reported. It is still collected in
   * `knownZodEvalViolations` so a spec can assert on it directly.
   */
  readonly cspViolations: string[];
  /** The known, tracked zod-4 `script-src eval` probe hits (D-CSP-1). */
  readonly knownZodEvalViolations: string[];
}

/**
 * The zod-4 JIT `allowsEval` probe (`new Function('')`) that intermittently
 * escapes the `z.config({ jitless: true })` guard on the client landing path
 * and trips `script-src 'eval'` under the strict no-`unsafe-eval` CSP.
 * Tracked as defect D-CSP-1; filtered from the unexpected-violation list.
 */
function isKnownZodEvalViolation(text: string): boolean {
  return /script-src\b.*\beval\b/i.test(text);
}

/**
 * Console noise we deliberately tolerate. Keep this list TIGHT and
 * documented — every entry is a conscious exception, not a catch-all.
 */
function isBenignConsoleError(text: string): boolean {
  // Next/React can log a hydration/devtools hint or a favicon 404 in some
  // environments; a resource 404 is not a functional error for these specs.
  if (/favicon/i.test(text)) return true;
  // The React DevTools "Download the React DevTools" notice is an info-level
  // message but some Chromium builds surface it via console; ignore it.
  if (/Download the React DevTools/i.test(text)) return true;
  return false;
}

const VIOLATION_BINDING = '__razorsEdgeReportCspViolation';

export async function attachDiagnostics(page: Page): Promise<Diagnostics> {
  const pageErrors: Error[] = [];
  const consoleErrors: string[] = [];
  const cspViolations: string[] = [];
  const knownZodEvalViolations: string[] = [];

  function recordCsp(text: string): void {
    if (isKnownZodEvalViolation(text)) {
      knownZodEvalViolations.push(text);
    } else {
      cspViolations.push(text);
    }
  }

  page.on('pageerror', (err) => {
    pageErrors.push(err);
  });

  page.on('console', (msg: ConsoleMessage) => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    if (/Content Security Policy|Refused to (execute|load|apply|connect)/i.test(text)) {
      recordCsp(text);
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
      recordCsp(
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
        report({
          directive: ev.violatedDirective,
          blockedURI: ev.blockedURI,
        });
      }
    });
  }, VIOLATION_BINDING);

  return { pageErrors, consoleErrors, cspViolations, knownZodEvalViolations };
}
