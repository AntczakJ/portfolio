import { expect, test } from '@playwright/test';

import { TapeApp } from '@helpers/tape-app';

/**
 * Critical path 2 (Task 5.3) — replay control opens and the scrub moves.
 *
 * No backend is up in the deterministic run, so the replay endpoint
 * resolves to the dead port and the engine reaches an empty/error load
 * state. That is fine: this spec asserts the CONTROL WIRING + the
 * empty-state path (per the task brief), not historic data rendering:
 *
 *   - selecting the Replay rail entry flips the mode and expands the bar,
 *   - the scrub slider + transport buttons appear,
 *   - dragging / keyboard-seeking the scrub moves the persisted replay
 *     position (the value the chart's virtual clock reads),
 *   - play ⇄ pause toggles the transport button's accessible state,
 *   - the mode-change announcement reaches the polite live region.
 *
 * The chart-moves-on-data assertion requires a seeded replay day (real
 * Postgres) and lives in the @live spec.
 */
test.describe('replay control — open + scrub wiring', () => {
  test('Replay rail entry expands the control bar', async ({ page }) => {
    const app = new TapeApp(page);
    await app.mockWebSocket();
    await app.goto();

    // Live mode: the rail's Live entry is current.
    await expect(app.liveRailEntry()).toHaveAttribute('aria-current', 'page');

    // Enter replay (waits for hydration + confirms the flip).
    await app.enterReplay();
    await expect(app.replayRailEntry()).toHaveAttribute('aria-current', 'page');

    // The control bar now exposes the scrub slider + transport.
    await expect(app.replaySlider()).toBeVisible();
    await expect(app.stopButton()).toBeVisible();
    // Play/pause: exactly one of the two labels is present at a time.
    const playOrPause = page.getByRole('button', {
      name: /^(Play|Pause) replay$/,
    });
    await expect(playOrPause).toBeVisible();
  });

  test('scrub seek moves the persisted replay position', async ({ page }) => {
    const app = new TapeApp(page);
    await app.mockWebSocket();
    await app.goto();
    await app.enterReplay();

    const slider = app.replaySlider();
    await expect(slider).toBeVisible();

    // The slider's aria-valuenow reflects replayPositionMs. Focus it and
    // arrow-right to seek forward — this exercises the keyboard scrub
    // path (Task 2.4 shortcuts are document-level; the slider's own
    // ArrowRight is the Radix slider step).
    const before = await slider.getAttribute('aria-valuenow');
    await slider.focus();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');

    await expect
      .poll(async () => slider.getAttribute('aria-valuenow'), {
        message: 'slider aria-valuenow did not advance on ArrowRight',
      })
      .not.toBe(before);

    const after = await slider.getAttribute('aria-valuenow');
    expect(Number(after)).toBeGreaterThan(Number(before ?? '0'));
  });

  test('play ⇄ pause toggles the transport button state', async ({ page }) => {
    const app = new TapeApp(page);
    await app.mockWebSocket();
    await app.goto();
    await app.enterReplay();

    // The engine AUTO-PLAYS on replay entry (`enter()` calls `play()`),
    // so once entry settles the transport shows "Pause replay". We first
    // wait for that settled playing state — depending on the click while
    // the async entry is still flipping the flag is the race that makes a
    // bare read-click-assert flaky. Once settled, Pause → Play → Pause is
    // deterministic.
    const pause = app.pauseButton();
    const play = app.playButton();

    // Settle: the auto-play makes Pause the steady state.
    await expect(pause).toBeVisible({ timeout: 15_000 });
    await expect(pause).toHaveAttribute('aria-pressed', 'true');

    // Pause → Play.
    await pause.click();
    await expect(play).toBeVisible();

    // Play → Pause.
    await play.click();
    await expect(pause).toBeVisible();
  });

  test('mode-change announcement reaches the live region', async ({
    page,
  }) => {
    const app = new TapeApp(page);
    await app.mockWebSocket();
    await app.goto();
    await app.enterReplay();

    // The replay bar carries a polite status region announcing the mode.
    const announcement = app
      .replayControls()
      .getByText(/Replay mode/, { exact: false });
    await expect(announcement).toBeAttached();
  });
});
