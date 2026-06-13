/**
 * jsdom does not implement Canvas2D. The BoardEngine tests do not
 * assert on rendered pixels (the subscribe-once contract + the
 * dirty-flag state machine are what we verify), but the engine's
 * constructor calls `canvas.getContext('2d')` — so we hand the
 * constructor a stubbed 2D context whose methods are all no-ops.
 *
 * Importing this module installs the stub on
 * `HTMLCanvasElement.prototype.getContext` for the test process.
 * Pattern lifted from tape's `__tests__/canvas-mock.ts` — patterns
 * port across projects per `docs/conventions.md` § 14; tokens do
 * not.
 *
 * `ResizeObserver` is also not implemented in jsdom — we stub it as
 * a no-op so the engine's `handleResize` path can be exercised
 * directly via `_testTick` without requiring a layout pass.
 */

function makeFakeContext(): CanvasRenderingContext2D {
  const stub = {} as Record<string, unknown>;
  const methods = [
    'beginPath',
    'closePath',
    'moveTo',
    'lineTo',
    'rect',
    'fillRect',
    'strokeRect',
    'clearRect',
    'fill',
    'stroke',
    'fillText',
    'strokeText',
    'save',
    'restore',
    'translate',
    'rotate',
    'scale',
    'setTransform',
    'resetTransform',
    'arc',
    'ellipse',
    'quadraticCurveTo',
    'bezierCurveTo',
    'measureText',
    'setLineDash',
  ];
  for (const m of methods) {
    stub[m] = (): unknown => {
      if (m === 'measureText') return { width: 0 };
      return undefined;
    };
  }
  stub.fillStyle = '';
  stub.strokeStyle = '';
  stub.lineWidth = 1;
  stub.font = '';
  stub.textAlign = 'start';
  stub.textBaseline = 'alphabetic';
  return stub as unknown as CanvasRenderingContext2D;
}

const sharedContext = makeFakeContext();

Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
  configurable: true,
  value(this: HTMLCanvasElement, contextId: string) {
    if (contextId === '2d') return sharedContext;
    return null;
  },
});

// jsdom does not implement ResizeObserver — the engine's host wires
// it but the engine itself does not, so this is for any future
// component-level test. Stub to no-op.
if (typeof globalThis.ResizeObserver === 'undefined') {
  class StubResizeObserver {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  (globalThis as { ResizeObserver: typeof ResizeObserver }).ResizeObserver =
    StubResizeObserver as unknown as typeof ResizeObserver;
}

// Polyfill for `requestAnimationFrame` / `cancelAnimationFrame` so
// the engine's rAF loop can be driven deterministically via
// `_testTick`. The stubs use `setTimeout` / `clearTimeout` under the
// hood so the test runner can advance with `vi.useFakeTimers()` if
// it wants; the engine tests directly call `_testTick` instead.
if (typeof globalThis.requestAnimationFrame === 'undefined') {
  (globalThis as { requestAnimationFrame: typeof requestAnimationFrame }).requestAnimationFrame =
    ((cb: FrameRequestCallback): number => {
      return setTimeout(() => { cb(performance.now()); }, 16) as unknown as number;
    }) as typeof requestAnimationFrame;
  (globalThis as { cancelAnimationFrame: typeof cancelAnimationFrame }).cancelAnimationFrame =
    ((handle: number): void => {
      clearTimeout(handle);
    }) as typeof cancelAnimationFrame;
}
