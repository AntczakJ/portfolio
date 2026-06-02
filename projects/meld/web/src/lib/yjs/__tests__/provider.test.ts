import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Awareness } from 'y-protocols/awareness';
import * as Y from 'yjs';

import { useWelcomeStore } from '@/lib/stores/welcome-store';

import {
  attachAwarenessSeedPipeline,
  createBoardProvider,
  handleProviderMessage,
} from '../provider';

import type { WSWelcomeFramePayload } from 'meld-server';

/**
 * Mock `@hocuspocus/provider` so `createBoardProvider` can be exercised
 * without opening a real WebSocket. The mock captures the `onMessage`
 * config callback that the factory wires up, and exposes a real
 * `Awareness` instance so `attachAwarenessSeedPipeline` operates on
 * something concrete.
 *
 * The capture is the whole point of the regression test below: it lets
 * us invoke the production `onMessage` closure with the SHAPE the
 * provider actually emits at runtime — the raw browser `MessageEvent`
 * — which the previous `({ event }) => ...` destructure could not
 * survive.
 */
const capturedConfig: {
  onMessage: ((payload: unknown) => void) | undefined;
} = { onMessage: undefined };

vi.mock('@hocuspocus/provider', () => {
  class HocuspocusProvider {
    awareness: Awareness;
    #listeners = new Map<string, Set<(...args: unknown[]) => void>>();

    constructor(config: { onMessage?: (payload: unknown) => void }) {
      // A fresh doc + awareness per provider — the seed pipeline writes
      // to `awareness.setLocalStateField`.
      this.awareness = new Awareness(new Y.Doc());
      if (config.onMessage) {
        capturedConfig.onMessage = config.onMessage;
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
 * Tests for the awareness-seed pipeline + TEXT-frame router from
 * `lib/yjs/provider.ts` (Task 2.5a).
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

describe('handleProviderMessage', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

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

  it('routes a TEXT welcome frame into the welcome store', () => {
    const welcome = buildWelcome(SESSION_A, 'otter');
    const event = new MessageEvent('message', { data: JSON.stringify(welcome) });
    handleProviderMessage(event);
    expect(useWelcomeStore.getState().welcome?.session.id).toBe(SESSION_A);
  });

  it('drops malformed JSON silently with a dev warn', () => {
    const event = new MessageEvent('message', { data: 'not-json' });
    handleProviderMessage(event);
    expect(useWelcomeStore.getState().welcome).toBeNull();
    expect(warnSpy).toHaveBeenCalled();
  });

  it('ignores BINARY frames (passes them through to the framework)', () => {
    const event = new MessageEvent('message', {
      data: new ArrayBuffer(8),
    });
    handleProviderMessage(event);
    expect(useWelcomeStore.getState().welcome).toBeNull();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('routes unknown kinds to the onUnknown callback when provided', () => {
    const onUnknown = vi.fn();
    const event = new MessageEvent('message', {
      data: JSON.stringify({ kind: 'control.overrun', reason: 'rate.exceeded' }),
    });
    handleProviderMessage(event, onUnknown);
    expect(onUnknown).toHaveBeenCalledOnce();
  });

  it('does not throw on a nullish event (defensive guard)', () => {
    expect(() => { handleProviderMessage(null); }).not.toThrow();
    expect(() => { handleProviderMessage(undefined); }).not.toThrow();
    expect(useWelcomeStore.getState().welcome).toBeNull();
  });
});

/**
 * Regression test for the HocuspocusProvider 4.1 `onMessage` raw-
 * `MessageEvent` trap.
 *
 * At RUNTIME the provider emits the RAW browser `MessageEvent` to its
 * `'message'` listeners (see `attachWebSocketListeners` ->
 * `emit('message', event)`), NOT the `{ event, message }` object the
 * published `onMessageParameters` type implies. The previous wiring
 * destructured `({ event }) => ...` off that raw event, yielding
 * `undefined`, and `handleProviderMessage(undefined)` threw
 * `TypeError: Cannot read properties of undefined (reading 'data')`.
 *
 * Because our `onMessage` listener is registered BEFORE the provider's
 * own y-protocol sync listener and the emitter dispatches via
 * `forEach`, that throw aborted the loop and killed Yjs sync +
 * awareness over the wire — the board's entire collaboration layer
 * went dead while the socket itself stayed connected.
 *
 * The pre-existing `handleProviderMessage` tests fed it a synthetic
 * `MessageEvent` directly, so they never exercised the factory's
 * `onMessage` closure. This suite drives the closure that
 * `createBoardProvider` actually wires, with BOTH the raw-event runtime
 * shape and the typed `{ event }` shape.
 */
describe('createBoardProvider onMessage wiring (raw MessageEvent regression)', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    useWelcomeStore.getState().clearWelcome();
    capturedConfig.onMessage = undefined;
    vi.stubEnv('NODE_ENV', 'development');
  });

  afterEach(() => {
    warnSpy.mockRestore();
    useWelcomeStore.getState().clearWelcome();
    capturedConfig.onMessage = undefined;
    vi.unstubAllEnvs();
  });

  it('captures an onMessage config callback from createBoardProvider', () => {
    createBoardProvider('12345678-1234-4abc-8def-1234567890ab', {
      doc: new Y.Doc(),
    });
    expect(typeof capturedConfig.onMessage).toBe('function');
  });

  it('does not throw when invoked with a RAW MessageEvent (the real runtime shape)', () => {
    createBoardProvider('12345678-1234-4abc-8def-1234567890ab', {
      doc: new Y.Doc(),
    });
    const onMessage = capturedConfig.onMessage;
    expect(onMessage).toBeDefined();

    const welcome = buildWelcome(SESSION_A, 'otter');
    // The provider emits the RAW MessageEvent — NOT `{ event, message }`.
    const rawEvent = new MessageEvent('message', {
      data: JSON.stringify(welcome),
    });

    expect(() => onMessage?.(rawEvent)).not.toThrow();
    expect(useWelcomeStore.getState().welcome?.session.id).toBe(SESSION_A);
  });

  it('still handles the typed { event } shape (forward-compatibility)', () => {
    createBoardProvider('12345678-1234-4abc-8def-1234567890ab', {
      doc: new Y.Doc(),
    });
    const onMessage = capturedConfig.onMessage;
    expect(onMessage).toBeDefined();

    const welcome = buildWelcome(SESSION_B, 'fox');
    const event = new MessageEvent('message', { data: JSON.stringify(welcome) });

    expect(() => onMessage?.({ event })).not.toThrow();
    expect(useWelcomeStore.getState().welcome?.session.id).toBe(SESSION_B);
  });

  it('routes unknown control frames from a raw MessageEvent to onUnknownControlFrame', () => {
    const onUnknownControlFrame = vi.fn();
    createBoardProvider('12345678-1234-4abc-8def-1234567890ab', {
      doc: new Y.Doc(),
      onUnknownControlFrame,
    });
    const onMessage = capturedConfig.onMessage;

    const rawEvent = new MessageEvent('message', {
      data: JSON.stringify({ kind: 'control.overrun', reason: 'rate.exceeded' }),
    });

    expect(() => onMessage?.(rawEvent)).not.toThrow();
    expect(onUnknownControlFrame).toHaveBeenCalledOnce();
    expect(useWelcomeStore.getState().welcome).toBeNull();
  });

  it('ignores a binary (ArrayBuffer) raw MessageEvent without spurious unknown dispatch', () => {
    const onUnknownControlFrame = vi.fn();
    createBoardProvider('12345678-1234-4abc-8def-1234567890ab', {
      doc: new Y.Doc(),
      onUnknownControlFrame,
    });
    const onMessage = capturedConfig.onMessage;

    const rawEvent = new MessageEvent('message', { data: new ArrayBuffer(8) });

    expect(() => onMessage?.(rawEvent)).not.toThrow();
    expect(onUnknownControlFrame).not.toHaveBeenCalled();
    expect(useWelcomeStore.getState().welcome).toBeNull();
  });
});
