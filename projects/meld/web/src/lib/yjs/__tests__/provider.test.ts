import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from 'vitest';
import { Awareness } from 'y-protocols/awareness';
import * as Y from 'yjs';

import { useWelcomeStore } from '@/lib/stores/welcome-store';

import {
  attachAwarenessSeedPipeline,
  createBoardProvider,
  handleStatelessControlMessage,
} from '../provider';

import type { WSWelcomeFramePayload } from 'meld-server';

/**
 * Mock `@hocuspocus/provider` so `createBoardProvider` can be exercised
 * without opening a real WebSocket. The mock captures the `onStateless`
 * config callback that the factory wires up (ADR-011), and exposes a
 * real `Awareness` instance so `attachAwarenessSeedPipeline` operates
 * on something concrete.
 *
 * The capture lets us invoke the production `onStateless` closure with
 * the SHAPE the provider hands it at runtime — `{ payload: string }`
 * (provider d.ts `onStatelessParameters` lines 162–164) — and assert
 * the welcome dispatch happens exactly as the wire would drive it.
 */
const capturedConfig: {
  onStateless: ((data: { payload: string }) => void) | undefined;
} = { onStateless: undefined };

vi.mock('@hocuspocus/provider', () => {
  class HocuspocusProvider {
    awareness: Awareness;
    #listeners = new Map<string, Set<(...args: unknown[]) => void>>();

    constructor(config: { onStateless?: (data: { payload: string }) => void }) {
      // A fresh doc + awareness per provider — the seed pipeline writes
      // to `awareness.setLocalStateField`.
      this.awareness = new Awareness(new Y.Doc());
      if (config.onStateless) {
        capturedConfig.onStateless = config.onStateless;
      }
    }

    on(event: string, cb: (...args: unknown[]) => void): void {
      let set = this.#listeners.get(event);
      if (set === undefined) {
        set = new Set();
        this.#listeners.set(event, set);
      }
      set.add(cb);
    }

    off(event: string, cb: (...args: unknown[]) => void): void {
      this.#listeners.get(event)?.delete(cb);
    }
  }

  return { HocuspocusProvider };
});

/**
 * Tests for the awareness-seed pipeline + stateless control-message
 * router from `lib/yjs/provider.ts` (Task 2.5a / ADR-011).
 *
 * The pipeline's contract:
 *   1. When the welcome store carries a payload at provider
 *      construction, the local awareness state's `identity` field
 *      gets seeded immediately.
 *   2. When a fresh welcome lands AFTER provider construction, the
 *      store subscription re-seeds.
 *   3. On `provider.destroy()`, the store subscription detaches.
 *
 * We mock `HocuspocusProvider` with a minimal stand-in that satisfies
 * the surface the pipeline touches (`.awareness`, `.on('destroy')`,
 * `.off('destroy')`). Constructing the real provider would open a
 * WebSocket, which is out of scope for a unit test.
 */

class MockProvider {
  awareness: Awareness;
  #listeners = new Map<string, Set<(...args: unknown[]) => void>>();

  constructor(awareness: Awareness) {
    this.awareness = awareness;
  }

  on(event: string, cb: (...args: unknown[]) => void): void {
    let set = this.#listeners.get(event);
    if (set === undefined) {
      set = new Set();
      this.#listeners.set(event, set);
    }
    set.add(cb);
  }

  off(event: string, cb: (...args: unknown[]) => void): void {
    this.#listeners.get(event)?.delete(cb);
  }

  emit(event: string): void {
    this.#listeners.get(event)?.forEach((cb) => { cb(); });
  }
}

function buildWelcome(sessionId: string, emojiName: string): WSWelcomeFramePayload {
  return {
    kind: 'welcome',
    session: {
      id: sessionId,
      emojiChar: '\u{1F367}',
      emojiName,
      color: { L: 0.6, C: 0.17, H: 285 },
      colorDark: { L: 0.7, C: 0.18, H: 285 },
      mintedAt: 'cookie',
    },
    board: {
      id: '12345678-1234-4abc-8def-1234567890ab',
      createdAt: 1_780_232_684_228,
      connectionCount: 1,
    },
    origin: 'http://localhost:3000',
    serverTime: 1_780_232_684_300,
    protocolVersion: 1,
  };
}

const SESSION_A = '8f41d59d-9ad8-4db5-94fc-c5a5ced3b43f';
const SESSION_B = '7a628a49-1234-4abc-8def-abcdef012345';

describe('attachAwarenessSeedPipeline', () => {
  let doc: Y.Doc;
  let awareness: Awareness;
  let provider: MockProvider;

  beforeEach(() => {
    doc = new Y.Doc();
    awareness = new Awareness(doc);
    provider = new MockProvider(awareness);
    useWelcomeStore.getState().clearWelcome();
  });

  afterEach(() => {
    useWelcomeStore.getState().clearWelcome();
    awareness.destroy();
    doc.destroy();
  });

  it('seeds the local awareness identity when welcome is already set at construction', () => {
    useWelcomeStore.getState().setWelcome(buildWelcome(SESSION_A, 'otter'));
    attachAwarenessSeedPipeline(provider as unknown as Parameters<typeof attachAwarenessSeedPipeline>[0]);

    const localState = awareness.getLocalState();
    expect(localState).not.toBeNull();
    const identity = (localState as { identity?: { sessionId: string } }).identity;
    expect(identity?.sessionId).toBe(SESSION_A);
  });

  it('seeds the local awareness identity when welcome arrives after construction', () => {
    attachAwarenessSeedPipeline(provider as unknown as Parameters<typeof attachAwarenessSeedPipeline>[0]);
    expect(awareness.getLocalState()).toEqual({});

    useWelcomeStore.getState().setWelcome(buildWelcome(SESSION_A, 'otter'));

    const identity = (awareness.getLocalState() as { identity?: { sessionId: string } })
      .identity;
    expect(identity?.sessionId).toBe(SESSION_A);
  });

  it('re-seeds on a second welcome (session-rotate flow)', () => {
    attachAwarenessSeedPipeline(provider as unknown as Parameters<typeof attachAwarenessSeedPipeline>[0]);

    useWelcomeStore.getState().setWelcome(buildWelcome(SESSION_A, 'otter'));
    expect(
      (awareness.getLocalState() as { identity?: { sessionId: string } }).identity
        ?.sessionId,
    ).toBe(SESSION_A);

    useWelcomeStore.getState().setWelcome(buildWelcome(SESSION_B, 'fox'));
    expect(
      (awareness.getLocalState() as { identity?: { sessionId: string } }).identity
        ?.sessionId,
    ).toBe(SESSION_B);
  });

  it('detaches the store subscription on provider destroy', () => {
    attachAwarenessSeedPipeline(provider as unknown as Parameters<typeof attachAwarenessSeedPipeline>[0]);
    useWelcomeStore.getState().setWelcome(buildWelcome(SESSION_A, 'otter'));
    expect(
      (awareness.getLocalState() as { identity?: { sessionId: string } }).identity
        ?.sessionId,
    ).toBe(SESSION_A);

    provider.emit('destroy');

    // After destroy, a subsequent welcome must NOT re-seed (the
    // listener detached). Replace the state in the store and confirm
    // the awareness identity sticks at SESSION_A.
    useWelcomeStore.getState().setWelcome(buildWelcome(SESSION_B, 'fox'));
    expect(
      (awareness.getLocalState() as { identity?: { sessionId: string } }).identity
        ?.sessionId,
    ).toBe(SESSION_A);
  });
});

describe('handleStatelessControlMessage', () => {
  let warnSpy: MockInstance<typeof console.warn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    useWelcomeStore.getState().clearWelcome();
    vi.stubEnv('NODE_ENV', 'development');
  });

  afterEach(() => {
    warnSpy.mockRestore();
    useWelcomeStore.getState().clearWelcome();
    vi.unstubAllEnvs();
  });

  it('routes a welcome payload into the welcome store', () => {
    const welcome = buildWelcome(SESSION_A, 'otter');
    handleStatelessControlMessage(JSON.stringify(welcome));
    expect(useWelcomeStore.getState().welcome?.session.id).toBe(SESSION_A);
  });

  it('drops malformed JSON silently with a dev warn', () => {
    handleStatelessControlMessage('not-json');
    expect(useWelcomeStore.getState().welcome).toBeNull();
    expect(warnSpy).toHaveBeenCalled();
  });

  it('drops a payload without a `kind` discriminator', () => {
    handleStatelessControlMessage(JSON.stringify({ session: {} }));
    expect(useWelcomeStore.getState().welcome).toBeNull();
    expect(warnSpy).toHaveBeenCalled();
  });

  it('drops a welcome payload that fails schema validation', () => {
    // `kind: 'welcome'` but a structurally invalid body — must not
    // populate the store and must not throw.
    handleStatelessControlMessage(
      JSON.stringify({ kind: 'welcome', session: { id: 'not-a-uuid' } }),
    );
    expect(useWelcomeStore.getState().welcome).toBeNull();
    expect(warnSpy).toHaveBeenCalled();
  });

  it('routes unknown kinds to the onUnknown callback when provided', () => {
    const onUnknown = vi.fn();
    handleStatelessControlMessage(
      JSON.stringify({ kind: 'control.overrun', reason: 'rate.exceeded' }),
      onUnknown,
    );
    expect(onUnknown).toHaveBeenCalledOnce();
    expect(useWelcomeStore.getState().welcome).toBeNull();
  });
});

/**
 * Wiring test for the ADR-011 `onStateless` config callback.
 *
 * Control messages now arrive over Hocuspocus's Stateless channel, not
 * raw TEXT frames. The provider decodes the stateless y-protocol
 * envelope and invokes `onStateless({ payload })` with the inner string
 * (provider d.ts `onStateless` config callback line 352,
 * `onStatelessParameters = { payload: string }` lines 162–164).
 *
 * This suite drives the closure `createBoardProvider` actually wires —
 * captured from the mocked provider constructor — with the runtime
 * `{ payload }` shape, and asserts the welcome dispatch into
 * `useWelcomeStore`, plus malformed-JSON and unknown-kind handling
 * (no throw; unknown → `onUnknownControlFrame`). It replaces the
 * retired raw-`MessageEvent` `onMessage`-wiring regression suite — that
 * code path no longer exists.
 */
describe('createBoardProvider onStateless wiring', () => {
  let warnSpy: MockInstance<typeof console.warn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    useWelcomeStore.getState().clearWelcome();
    capturedConfig.onStateless = undefined;
    vi.stubEnv('NODE_ENV', 'development');
  });

  afterEach(() => {
    warnSpy.mockRestore();
    useWelcomeStore.getState().clearWelcome();
    capturedConfig.onStateless = undefined;
    vi.unstubAllEnvs();
  });

  it('captures an onStateless config callback from createBoardProvider', () => {
    createBoardProvider('12345678-1234-4abc-8def-1234567890ab', {
      doc: new Y.Doc(),
    });
    expect(typeof capturedConfig.onStateless).toBe('function');
  });

  it('dispatches a welcome payload into the welcome store', () => {
    createBoardProvider('12345678-1234-4abc-8def-1234567890ab', {
      doc: new Y.Doc(),
    });
    const onStateless = capturedConfig.onStateless;
    expect(onStateless).toBeDefined();

    const welcome = buildWelcome(SESSION_A, 'otter');
    // The provider hands us `{ payload: string }` — the raw string the
    // server passed to `Connection.sendStateless`.
    expect(() => onStateless?.({ payload: JSON.stringify(welcome) })).not.toThrow();
    expect(useWelcomeStore.getState().welcome?.session.id).toBe(SESSION_A);
  });

  it('does not throw and does not dispatch on a malformed payload', () => {
    createBoardProvider('12345678-1234-4abc-8def-1234567890ab', {
      doc: new Y.Doc(),
    });
    const onStateless = capturedConfig.onStateless;

    expect(() => onStateless?.({ payload: 'not-json' })).not.toThrow();
    expect(useWelcomeStore.getState().welcome).toBeNull();
  });

  it('routes unknown control kinds to onUnknownControlFrame', () => {
    const onUnknownControlFrame = vi.fn();
    createBoardProvider('12345678-1234-4abc-8def-1234567890ab', {
      doc: new Y.Doc(),
      onUnknownControlFrame,
    });
    const onStateless = capturedConfig.onStateless;

    expect(() =>
      onStateless?.({
        payload: JSON.stringify({ kind: 'control.overrun', reason: 'rate.exceeded' }),
      }),
    ).not.toThrow();
    expect(onUnknownControlFrame).toHaveBeenCalledOnce();
    expect(useWelcomeStore.getState().welcome).toBeNull();
  });
});
