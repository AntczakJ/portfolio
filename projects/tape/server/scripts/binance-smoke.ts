/**
 * Binance smoke — Task 1.3.
 *
 * Connects via `BinanceFuturesClient` against the configured public
 * endpoint (defaults: `wss://fstream.binance.com/ws`, symbol
 * `btcusdt`), prints the first 20 successfully parsed aggTrade events
 * in compact form, then exits 0. No DB writes, no WS broadcast — this
 * script exercises the client + Zod schema layer only, end to end
 * against the real exchange.
 *
 * Intended manual workflow:
 *
 *   bun projects/tape/server/scripts/binance-smoke.ts
 *
 * Override target with `BINANCE_WS_URL=wss://...` and / or
 * `BINANCE_SYMBOL=ethusdt`. Exit code 0 on success (printed 20 events
 * within 30 s); exit code 1 on timeout, connect failure, or a
 * sustained parse-error rate that prevents reaching the target.
 *
 * NOT a Bun test — this is a one-shot operator-facing diagnostic. The
 * CI-tracked behaviour lives in `src/lib/ingest/__tests__/`.
 */

import { BinanceFuturesClient } from '../src/lib/ingest/binance-client';
import type { BinanceAggTrade } from '../src/lib/schemas/binance/agg-trade';

const TARGET_EVENTS = 20;
const RUN_TIMEOUT_MS = 30_000;

function formatEvent(event: BinanceAggTrade, index: number): string {
  const aggressor = event.m ? 'SELL' : 'BUY ';
  return `[${String(index + 1).padStart(2, ' ')}] ${aggressor} ${event.s} ` +
    `price=${event.p.toFixed(2)} qty=${event.q.toFixed(6)} ts=${String(event.T)}`;
}

async function main(): Promise<number> {
  const url = process.env.BINANCE_WS_URL;
  const symbol = process.env.BINANCE_SYMBOL;
  console.log(
    `[binance-smoke] target stream: ${url ?? 'wss://fstream.binance.com/ws'}/${(symbol ?? 'btcusdt')}@aggTrade`,
  );

  const events: BinanceAggTrade[] = [];

  return await new Promise<number>((resolve) => {
    const timer = setTimeout(() => {
      console.error(
        `[binance-smoke] timed out after ${String(RUN_TIMEOUT_MS)}ms with ${String(events.length)}/${String(TARGET_EVENTS)} events`,
      );
      client.close();
      resolve(1);
    }, RUN_TIMEOUT_MS);

    const client = new BinanceFuturesClient({
      ...(url !== undefined ? { url } : {}),
      ...(symbol !== undefined ? { symbol } : {}),
      onAggTrade: (event) => {
        events.push(event);
        console.log(formatEvent(event, events.length - 1));
        if (events.length >= TARGET_EVENTS) {
          clearTimeout(timer);
          console.log(
            `[binance-smoke] reached ${String(TARGET_EVENTS)} events; parseErrors=${String(client.parseErrors)} restarts=${String(client.restartCount)}`,
          );
          client.close();
          resolve(0);
        }
      },
      onStateChange: (state) => {
        console.log(`[binance-smoke] state=${state}`);
      },
    });

    client.connect().catch((err: unknown) => {
      clearTimeout(timer);
      console.error('[binance-smoke] connect failed:', err);
      resolve(1);
    });
  });
}

main()
  .then((code) => {
    process.exit(code);
  })
  .catch((err: unknown) => {
    console.error('[binance-smoke] fatal:', err);
    process.exit(1);
  });
