import { Module } from '@nestjs/common';

import { ProbeRunnerService } from './probe-runner.service';

/**
 * Probe module (Phase 2.1) — owns the HTTP probe runner.
 *
 * `ProbeRunnerService` is the pure-ish execution primitive: it runs one
 * HTTP(S) check with the execution-time SSRF guard (resolve -> validate ->
 * pin), manual redirects, the per-attempt timeout, the 512 KB body cap, and
 * the up/degraded/down classification (ADR-002). It has no DB / queue
 * dependency — the worker's processor injects it and the check recorder, then
 * stitches probe -> record together. The SSRF guard itself stays a pure
 * function module-level (ssrf-guard.ts) so it is exhaustively unit-tested.
 */
@Module({
  providers: [ProbeRunnerService],
  exports: [ProbeRunnerService],
})
export class ProbeModule {}
