/**
 * jsdom does not implement Canvas2D. The footprint engine tests do
 * not assert on rendered pixels (the math + state machine is what we
 * verify), but the engine's constructor calls `canvas.getContext('2d')`
 * — so we hand the constructor a stubbed 2D context whose methods are
 * all no-ops.
 *
 * Importing this module installs the stub on
 * `HTMLCanvasElement.prototype.getContext` for the test process. Pure
 * side-effect import.
 */

/** Minimal CanvasRenderingContext2D-shaped fake. All methods no-op. */
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
    'measureText',
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
