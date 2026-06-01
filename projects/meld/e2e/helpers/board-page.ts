import type { BrowserContext, Locator, Page } from '@playwright/test';
import { expect } from '@playwright/test';

export type ToolKind = 'select' | 'rectangle' | 'ellipse' | 'freehand' | 'text';

const TOOL_SHORTCUTS: Record<Exclude<ToolKind, 'select'>, string> = {
  rectangle: 'r',
  ellipse: 'e',
  freehand: 'p',
  text: 't',
};

/**
 * `board-page.ts` — Page Object for the board route (`/board/[boardId]`).
 *
 * Exposes the canvases, toolbar slots, banner, identity badge, and the
 * action verbs Phase 3.2 drawing-primitives + Phase 3.4 offline tests
 * need. Pointer drags use Playwright's `mouse.move + mouse.down +
 * mouse.move + mouse.up` sequence rather than `Locator.dragTo` because
 * the shape canvas hit-tests the pointer overlay which sits ABOVE the
 * cursor canvas — `dragTo` would attempt to drop onto the locator's
 * element, which is the wrong target for a free-space draw.
 *
 * Locators prefer `getByTestId` — components carry the testids added
 * by Phase 5.1; see `data-testid` additions in `web/src/components/`.
 */
export class BoardPage {
  readonly page: Page;
  readonly context: BrowserContext;

  constructor(page: Page, context: BrowserContext) {
    this.page = page;
    this.context = context;
  }

  async goto(boardId: string): Promise<void> {
    await this.page.goto(`/board/${boardId}`, {
      waitUntil: 'domcontentloaded',
    });
  }

  shapeCanvas(): Locator {
    return this.page.getByTestId('shape-canvas');
  }

  cursorCanvas(): Locator {
    return this.page.getByTestId('cursor-canvas');
  }

  toolbar(): Locator {
    return this.page.getByTestId('board-toolbar');
  }

  toolbarSlot(kind: ToolKind): Locator {
    return this.page.getByTestId(`toolbar-slot-${kind}`);
  }

  connectionBanner(): Locator {
    return this.page.getByTestId('connection-banner');
  }

  offlineAriaLive(): Locator {
    return this.page.getByTestId('offline-aria-live');
  }

  identityBadge(): Locator {
    return this.page.getByTestId('identity-badge');
  }

  themeToggle(): Locator {
    return this.page.getByTestId('theme-toggle');
  }

  boardNotFoundDialog(): Locator {
    return this.page.getByTestId('board-not-found-dialog');
  }

  /**
   * Wait for both canvases AND the toolbar to be visible — the
   * "the board is interactive" checkpoint. Used by the drawing-primitives
   * + multi-user-presence tests as a barrier before pointer ops.
   */
  async waitForReady(): Promise<void> {
    await expect(this.shapeCanvas()).toBeVisible({ timeout: 15_000 });
    await expect(this.cursorCanvas()).toBeVisible({ timeout: 5_000 });
    await expect(this.toolbar()).toBeVisible({ timeout: 5_000 });
  }

  /**
   * Select a tool via keyboard shortcut (R/E/P/T/V/Escape). Keyboard is
   * the canonical input per the toolbar's docblock; tests using the
   * keyboard exercise the same path a recruiter would touch on first
   * arrival.
   */
  async selectTool(kind: ToolKind): Promise<void> {
    if (kind === 'select') {
      await this.page.keyboard.press('Escape');
      return;
    }
    const shortcut = TOOL_SHORTCUTS[kind];
    await this.page.keyboard.press(shortcut);
    // Mirror the active state assertion so a test that selects a tool
    // and then immediately drags has a deterministic checkpoint.
    await expect(this.toolbar()).toHaveAttribute('data-active-tool', kind, {
      timeout: 3_000,
    });
  }

  /**
   * Drag from (x1, y1) to (x2, y2) in viewport pixels via the page
   * mouse. Coordinates are relative to the page; callers compute them
   * from the shape canvas's bounding box. The pointer move is split
   * into N intermediate steps to emit pointer-move events the engine's
   * freehand path consumes.
   */
  async dragPointer(
    from: { x: number; y: number },
    to: { x: number; y: number },
    steps = 8,
  ): Promise<void> {
    await this.page.mouse.move(from.x, from.y);
    await this.page.mouse.down();
    await this.page.mouse.move(to.x, to.y, { steps });
    await this.page.mouse.up();
  }

  /**
   * Draw a shape by selecting the tool, computing a drag rect inside
   * the shape canvas's bounding box, and emitting the drag. Returns
   * the canvas-relative rect for downstream assertions.
   */
  async drawShape(
    kind: 'rectangle' | 'ellipse' | 'freehand',
    offset: { x1: number; y1: number; x2: number; y2: number },
  ): Promise<{ from: { x: number; y: number }; to: { x: number; y: number } }> {
    await this.selectTool(kind);
    const canvasHandle = this.shapeCanvas();
    const box = await canvasHandle.boundingBox();
    if (box === null) {
      throw new Error('drawShape: shape canvas has no bounding box');
    }
    const from = { x: box.x + offset.x1, y: box.y + offset.y1 };
    const to = { x: box.x + offset.x2, y: box.y + offset.y2 };
    await this.dragPointer(from, to);
    return { from, to };
  }

  /**
   * Move the pointer over the shape canvas (no drag). Used by the
   * multi-user-presence test to push an awareness cursor frame to
   * peers without committing a shape.
   */
  async moveCursor(offset: { x: number; y: number }): Promise<void> {
    const box = await this.shapeCanvas().boundingBox();
    if (box === null) {
      throw new Error('moveCursor: shape canvas has no bounding box');
    }
    await this.page.mouse.move(box.x + offset.x, box.y + offset.y);
  }

  /**
   * Push the BrowserContext offline. Wraps `context.setOffline(true)`
   * but kept as a verb on the POM so tests read as
   * `await board.goOffline()` rather than reaching into the context.
   */
  async goOffline(): Promise<void> {
    await this.context.setOffline(true);
  }

  async goOnline(): Promise<void> {
    await this.context.setOffline(false);
  }

  /**
   * Read the canonical `data-meld-layer` attributes for the two canvas
   * elements. Used by the offline-edit-merge test to assert the shape
   * canvas is the same element the engine's painter targets.
   */
  async readLayerAttributes(): Promise<{ shape: string | null; cursor: string | null }> {
    return {
      shape: await this.shapeCanvas().getAttribute('data-meld-layer'),
      cursor: await this.cursorCanvas().getAttribute('data-meld-layer'),
    };
  }

  /**
   * Read the cursor canvas's painted pixel count. Used as a proxy for
   * "the cursor engine has drawn something" without depending on the
   * specific OKLCH palette in effect. The cursor canvas is `aria-hidden`
   * and `pointer-events: none`, so the only way to count drawn pixels
   * is `page.evaluate` against the `data-testid="cursor-canvas"` element.
   */
  async cursorCanvasNonEmpty(): Promise<boolean> {
    return this.page.evaluate(() => {
      const el = document.querySelector<HTMLCanvasElement>(
        '[data-testid="cursor-canvas"]',
      );
      if (el === null) return false;
      const ctx = el.getContext('2d');
      if (ctx === null) return false;
      // Sample a 32-pixel-wide centered band to keep the read cheap;
      // any non-zero alpha pixel means SOMETHING painted.
      const { width, height } = el;
      if (width === 0 || height === 0) return false;
      const sampleHeight = Math.min(32, height);
      const data = ctx.getImageData(
        0,
        Math.floor(height / 2) - Math.floor(sampleHeight / 2),
        width,
        sampleHeight,
      ).data;
      for (let i = 3; i < data.length; i += 4) {
        if (data[i] !== 0) return true;
      }
      return false;
    });
  }

  /**
   * Read the shape canvas's painted pixel count via the same band-sample
   * strategy. Used by the drawing-primitives test as a sanity check
   * that the engine painted SOMETHING after the drag, without binding
   * to a specific shape color or stroke width.
   */
  async shapeCanvasNonEmpty(): Promise<boolean> {
    return this.page.evaluate(() => {
      const el = document.querySelector<HTMLCanvasElement>(
        '[data-testid="shape-canvas"]',
      );
      if (el === null) return false;
      const ctx = el.getContext('2d');
      if (ctx === null) return false;
      const { width, height } = el;
      if (width === 0 || height === 0) return false;
      const sampleHeight = Math.min(64, height);
      const data = ctx.getImageData(
        0,
        Math.floor(height / 2) - Math.floor(sampleHeight / 2),
        width,
        sampleHeight,
      ).data;
      for (let i = 3; i < data.length; i += 4) {
        if (data[i] !== 0) return true;
      }
      return false;
    });
  }
}
