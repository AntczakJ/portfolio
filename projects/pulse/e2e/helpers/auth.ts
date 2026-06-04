import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';

/**
 * Auth helpers for the ADR-007 demo-open + sign-in-gated posture.
 *
 * The dashboard stays OPEN to an anonymous visitor (the shared demo workspace),
 * but a WRITE affordance (New monitor / Add channel / edit) routes through the
 * sign-in prompt (the global `AuthDialog`, opened via `openAuthPrompt`). This
 * helper drives that dialog through the real UI (RHF + better-auth), which is
 * the faithful E2E of the boundary.
 *
 * A unique email per run keeps the test idempotent against the shared backend
 * (better-auth rejects a duplicate email; a per-run nonce avoids that and lets
 * the test create a fresh OWN workspace each time).
 */

export interface TestIdentity {
  readonly name: string;
  readonly email: string;
  readonly password: string;
}

/** Mint a unique identity so a re-run does not collide on the email. */
export function freshIdentity(): TestIdentity {
  const nonce = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  return {
    name: 'E2E Tester',
    email: `e2e+${nonce}@pulse.test`,
    password: 'pulse-e2e-passw0rd',
  };
}

/** The global auth dialog (Radix), identified by its sign-in / sign-up title. */
function dialog(page: Page) {
  return page.getByRole('dialog');
}

/** Wait for the auth dialog to be open (either mode). */
export async function expectAuthDialogOpen(page: Page): Promise<void> {
  await expect(
    dialog(page).getByText(/Sign in to Pulse|Create your Pulse account/),
  ).toBeVisible();
}

/**
 * Sign up a fresh user through the dialog. Assumes the dialog is already open
 * (a gated action / the "Sign in" button opened it). Switches to sign-up mode,
 * fills the form, submits, and waits for the dialog to close (success
 * invalidates the session and the dialog dismisses).
 */
export async function signUpThroughDialog(
  page: Page,
  identity: TestIdentity,
): Promise<void> {
  const d = dialog(page);
  await expect(d).toBeVisible();

  const signUpHeading = d.getByRole('heading', {
    name: 'Create your Pulse account',
  });
  const switchButton = d.getByRole('button', { name: 'Create an account' });

  // The gated affordance opens the dialog in SIGN-IN mode; switch to sign-up.
  // The mode swap is React-state driven and can race the click, so retry until
  // the create-account heading is shown (the switch button "Create an account"
  // is distinct from the submit "Create account").
  await expect(async () => {
    if (await signUpHeading.isVisible()) return;
    await switchButton.click();
    await expect(signUpHeading).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 15_000 });

  await d.getByLabel('Name').fill(identity.name);
  await d.getByLabel('Email').fill(identity.email);
  await d.getByLabel('Password').fill(identity.password);
  await d.getByRole('button', { name: 'Create account' }).click();

  // On success the dialog closes (session invalidated -> authenticated state).
  await expect(d).toBeHidden({ timeout: 20_000 });
}

/** Open the sign-in dialog via the header "Sign in" button. */
export async function openSignInFromHeader(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Sign in' }).first().click();
  await expectAuthDialogOpen(page);
}

/** Sign out via the account menu in the header. */
export async function signOut(page: Page): Promise<void> {
  // The account trigger is a button with an accessible "Account menu for <email>"
  // name.
  await page
    .getByRole('button', { name: /Account menu for/ })
    .first()
    .click();
  await page.getByRole('menuitem', { name: /Sign out/ }).click();
}

/** True once the header shows the authenticated account affordance. */
export async function isAuthenticated(page: Page): Promise<boolean> {
  return page
    .getByRole('button', { name: /Account menu for/ })
    .first()
    .isVisible()
    .catch(() => false);
}
