/**
 * Process-resilience policy tests (narrowed `uncaughtException` policy).
 *
 * The reviewer flagged the original process-wide keep-alive as broader
 * than the incident required: Node documents that resuming after an
 * arbitrary `uncaughtException` leaves the process in an UNDEFINED state,
 * so an unconditional keep-alive masks genuinely fatal faults. The
 * narrowed policy is asymmetric:
 *
 *   - `unhandledRejection`  -> stay alive (recoverable, not-awaited).
 *   - `uncaughtException`   -> log + bounded grace flush + exit(1) so the
 *                              platform (Fly) restarts a known-good process.
 *
 * These tests pin the PURE decision helper and the installer's WIRING via
 * an injected fake `process` + injected timer — NO real process spawn, NO
 * real handler install, so they are deterministic and non-flaky (the
 * brittle case the task warned against).
 *
 * Test runner: Node's built-in `node:test` via the package `test` script.
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import {
  UNCAUGHT_EXCEPTION_EXIT_CODE,
  decideResilienceAction,
  installProcessResilience,
} from '../process-resilience';

/**
 * Drain the microtask queue a few times so a multi-hop promise chain
 * (`Promise.resolve().then(flush).then(exit, onReject)`) settles before we
 * assert. A handful of awaits is enough for the deepest path here (a
 * rejected flush -> reject handler -> log -> exit).
 */
async function drainMicrotasks(): Promise<void> {
  for (let i = 0; i < 8; i += 1) {
    await Promise.resolve();
  }
}

void describe('decideResilienceAction', () => {
  void it('keeps the process alive on unhandledRejection', () => {
    // The fire-and-forget `onChange` incident: a not-awaited rejection
    // cannot have torn a synchronous transaction, so surviving is correct.
    assert.equal(decideResilienceAction('unhandledRejection'), 'stay-alive');
  });

  void it('exits after grace on uncaughtException', () => {
    // Undefined process state -> hand recovery to the platform restart.
    assert.equal(
      decideResilienceAction('uncaughtException'),
      'exit-after-grace',
    );
  });
});

/**
 * Minimal fake `process` capturing the two registered handlers so a test
 * can drive them synchronously without touching the real event loop.
 */
function makeFakeProc(): {
  proc: Pick<NodeJS.Process, 'on' | 'exit'>;
  fire: (event: 'unhandledRejection' | 'uncaughtException', arg: unknown) => void;
  exitCodes: number[];
} {
  const handlers = new Map<string, (arg: unknown) => void>();
  const exitCodes: number[] = [];
  const proc = {
    on(event: string, handler: (arg: never) => void) {
      handlers.set(event, handler as (arg: unknown) => void);
      return proc as unknown as NodeJS.Process;
    },
    exit(code?: number) {
      exitCodes.push(code ?? 0);
      // Real `process.exit` never returns; our fake records and returns
      // so the handler's post-exit code (if any) does not run in tests.
      return undefined as never;
    },
  } as unknown as Pick<NodeJS.Process, 'on' | 'exit'>;

  return {
    proc,
    fire(event, arg) {
      const h = handlers.get(event);
      assert.ok(h, `no handler registered for ${event}`);
      h(arg);
    },
    exitCodes,
  };
}

void describe('installProcessResilience', () => {
  void it('registers both process handlers', () => {
    const registered: string[] = [];
    const spyProc = {
      on(event: string) {
        registered.push(event);
        return spyProc;
      },
      exit() {
        return undefined;
      },
    } as unknown as Pick<NodeJS.Process, 'on' | 'exit'>;

    installProcessResilience({ proc: spyProc });

    assert.deepEqual(registered.sort(), [
      'uncaughtException',
      'unhandledRejection',
    ]);
  });

  void it('logs and stays alive on unhandledRejection (no exit, no flush)', () => {
    const { proc, fire, exitCodes } = makeFakeProc();
    const logs: unknown[][] = [];
    let flushed = false;

    installProcessResilience({
      proc,
      logError: (message, detail) => logs.push([message, detail]),
      flush: () => {
        flushed = true;
      },
    });

    fire('unhandledRejection', new Error('not awaited db write'));

    assert.equal(exitCodes.length, 0, 'must NOT exit on a rejection');
    assert.equal(flushed, false, 'must NOT flush on a rejection');
    assert.equal(logs.length, 1);
    assert.match(String(logs[0]?.[0]), /unhandledRejection/);
  });

  void it('logs, flushes, then exits non-zero on uncaughtException', async () => {
    const { proc, fire, exitCodes } = makeFakeProc();
    const logs: unknown[][] = [];
    let flushCalls = 0;

    installProcessResilience({
      proc,
      logError: (message, detail) => logs.push([message, detail]),
      flush: () => {
        flushCalls += 1;
      },
      // Immediate timer so we do not depend on wall-clock in the test;
      // the flush path should exit first anyway.
      setTimer: () => 0,
    });

    fire('uncaughtException', new Error('surprising sync throw'));

    // The flush runs on a microtask (Promise.resolve().then(...)), so let
    // the queue drain before asserting the exit fired.
    await drainMicrotasks();

    assert.equal(flushCalls, 1, 'flush must run exactly once');
    assert.deepEqual(exitCodes, [UNCAUGHT_EXCEPTION_EXIT_CODE]);
    assert.match(String(logs[0]?.[0]), /uncaughtException/);
  });

  void it('exits exactly once even if the grace timer also fires', async () => {
    const { proc, fire, exitCodes } = makeFakeProc();
    const timers: (() => void)[] = [];

    installProcessResilience({
      proc,
      logError: () => undefined,
      flush: () => undefined,
      // Capture the timer callback so we can fire it AFTER the flush path
      // has already exited — the `exited` guard must dedupe.
      setTimer: (cb) => {
        timers.push(cb);
        return 0;
      },
    });

    fire('uncaughtException', new Error('boom'));
    await drainMicrotasks();

    // Flush path already exited once. Now fire the grace timer.
    for (const t of timers) t();

    assert.deepEqual(
      exitCodes,
      [UNCAUGHT_EXCEPTION_EXIT_CODE],
      'double exit on timer + flush both settling',
    );
  });

  void it('still exits if the flush itself rejects', async () => {
    const { proc, fire, exitCodes } = makeFakeProc();
    const logs: unknown[][] = [];

    installProcessResilience({
      proc,
      logError: (message, detail) => logs.push([message, detail]),
      flush: () => Promise.reject(new Error('flush hung/failed')),
      setTimer: () => 0,
    });

    fire('uncaughtException', new Error('boom'));
    await drainMicrotasks();

    assert.deepEqual(exitCodes, [UNCAUGHT_EXCEPTION_EXIT_CODE]);
    assert.ok(
      logs.some((l) => String(l[0]).includes('flush failed')),
      'a failed flush must be logged',
    );
  });
});
