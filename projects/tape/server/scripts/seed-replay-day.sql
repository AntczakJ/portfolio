-- Dev-only seed for replay verification (Task 3.6).
-- Inserts a deterministic historic day into footprint_cells + ticks for
-- the symbol BTCUSDT-PERP so the replay endpoint has data to stream.
-- NOT a production artifact — the demo's real historical day comes from a
-- backfill. Idempotent: clears the session's rows first.
--
-- :daystart is the UTC-midnight epoch-ms of the day to seed (psql -v).

DO $$
DECLARE
  v_session uuid;
  v_daystart bigint := :daystart;
  v_bar int;
  v_pb int;
  v_bucket bigint;
  v_mid double precision;
  v_bid double precision;
  v_ask double precision;
  v_trades int;
  v_tick int;
BEGIN
  -- One dedicated seed session (delete + recreate for idempotency).
  DELETE FROM sessions WHERE symbol = 'BTCUSDT-PERP' AND source = 'seed-replay';
  INSERT INTO sessions (id, symbol, started_at, source)
    VALUES (gen_random_uuid(), 'BTCUSDT-PERP', to_timestamp(v_daystart / 1000.0), 'seed-replay')
    RETURNING id INTO v_session;

  -- 45 one-minute bars from 00:00 UTC, ~21 price buckets each.
  FOR v_bar IN 0..44 LOOP
    v_bucket := v_daystart + v_bar * 60000;
    -- Mid price wanders deterministically around 71000 (bucket index ~14200).
    v_mid := 71000 + (sin(v_bar / 4.0) * 60);
    FOR v_pb IN -10..10 LOOP
      -- Volume tapers away from mid; aggressor balance flips by bar parity.
      v_bid := round((40 - abs(v_pb) * 3 + (v_bar % 5) * 2)::numeric, 2);
      v_ask := round((40 - abs(v_pb) * 3 + ((v_bar + 2) % 5) * 2)::numeric, 2);
      IF v_bid < 0 THEN v_bid := 0; END IF;
      IF v_ask < 0 THEN v_ask := 0; END IF;
      v_trades := (v_bid + v_ask)::int / 4 + 1;
      INSERT INTO footprint_cells
        (symbol, bucket_ts, price_bucket, bid_volume, ask_volume, trades, session_id)
      VALUES
        ('BTCUSDT-PERP',
         v_bucket,
         floor((v_mid + v_pb * 5) / 5)::bigint,
         v_bid, v_ask, v_trades, v_session)
      ON CONFLICT ON CONSTRAINT footprint_cells_pk DO UPDATE
        SET bid_volume = EXCLUDED.bid_volume,
            ask_volume = EXCLUDED.ask_volume,
            trades = EXCLUDED.trades,
            session_id = EXCLUDED.session_id;
    END LOOP;

    -- ~30 ticks per bar for the tape strip's bounded window.
    FOR v_tick IN 0..29 LOOP
      INSERT INTO ticks (ts_ms, symbol, price, qty, aggressor, session_id)
      VALUES
        (v_bucket + v_tick * 2000,
         'BTCUSDT-PERP',
         round((v_mid + (v_tick % 7 - 3) * 5)::numeric, 2),
         round((0.05 + (v_tick % 4) * 0.03)::numeric, 3),
         CASE WHEN (v_bar + v_tick) % 2 = 0 THEN 'buy' ELSE 'sell' END,
         v_session)
      ON CONFLICT ON CONSTRAINT ticks_pk DO NOTHING;
    END LOOP;
  END LOOP;
END $$;

SELECT count(*) AS cells, count(distinct bucket_ts) AS bars FROM footprint_cells;
SELECT count(*) AS ticks FROM ticks;
