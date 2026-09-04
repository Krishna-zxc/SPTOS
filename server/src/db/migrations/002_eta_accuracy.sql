-- ---------------------------------------------------------------------------
-- ETA accuracy instrumentation (PRD 4 "Success Metrics" — ETA accuracy).
--
-- The mean absolute error between a predicted and an actual arrival can only be
-- computed if predictions are recorded when they are made. Every ETA the server
-- broadcasts for a downstream stop is logged here; when the bus later checks in
-- at that stop the row is resolved with the actual arrival time and the signed
-- error. The admin dashboard reads MAE straight off this table.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS eta_predictions (
  id                SERIAL PRIMARY KEY,
  trip_id           INTEGER NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  route_id          INTEGER NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
  stop_id           INTEGER NOT NULL REFERENCES stops(id)  ON DELETE CASCADE,
  seq               INTEGER NOT NULL,
  -- Prediction as issued.
  predicted_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  predicted_eta_at  TIMESTAMPTZ NOT NULL,
  horizon_seconds   INTEGER NOT NULL,
  confidence        TEXT    NOT NULL CHECK (confidence IN ('high', 'medium', 'low')),
  based_on_samples  INTEGER NOT NULL DEFAULT 0,
  -- Resolved once the bus actually reports at this stop.
  actual_arrival_at TIMESTAMPTZ,
  error_seconds     INTEGER,
  resolved_at       TIMESTAMPTZ,
  -- One prediction per (trip, stop) generation: the newest supersedes the last.
  UNIQUE (trip_id, stop_id, predicted_at)
);

CREATE INDEX IF NOT EXISTS idx_eta_pred_unresolved
  ON eta_predictions (trip_id, stop_id) WHERE actual_arrival_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_eta_pred_route_resolved
  ON eta_predictions (route_id, resolved_at DESC) WHERE actual_arrival_at IS NOT NULL;
