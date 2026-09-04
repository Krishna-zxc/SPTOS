-- ---------------------------------------------------------------------------
-- SPTOS initial schema (PRD FR-S3, FR-S5, FR-A1)
--
-- Design notes
--  * All timestamps are timestamptz. `recorded_at` is the moment the event
--    happened on the device; `created_at` is when the server stored it. The two
--    differ for check-ins that were queued offline (FR-D6).
--  * Enumerated values use CHECK constraints rather than CREATE TYPE so the
--    migration stays trivially re-runnable and portable.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS users (
  id             SERIAL PRIMARY KEY,
  name           TEXT        NOT NULL,
  email          TEXT        NOT NULL UNIQUE,
  password_hash  TEXT        NOT NULL,
  role           TEXT        NOT NULL CHECK (role IN ('commuter', 'driver', 'admin')),
  phone          TEXT,
  is_active      BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS routes (
  id          SERIAL PRIMARY KEY,
  code        TEXT        NOT NULL UNIQUE,
  name        TEXT        NOT NULL,
  description TEXT,
  is_active   BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS stops (
  id         SERIAL PRIMARY KEY,
  code       TEXT        NOT NULL UNIQUE,
  name       TEXT        NOT NULL,
  latitude   DOUBLE PRECISION NOT NULL,
  longitude  DOUBLE PRECISION NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Ordered stop sequence for a route. `scheduled_offset_seconds` is the planned
-- time from the start of the trip to this stop; it seeds ETAs before any
-- history exists and is the baseline for punctuality (FR-A3).
CREATE TABLE IF NOT EXISTS route_stops (
  route_id                  INTEGER NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
  stop_id                   INTEGER NOT NULL REFERENCES stops(id)  ON DELETE RESTRICT,
  seq                       INTEGER NOT NULL CHECK (seq >= 1),
  scheduled_offset_seconds  INTEGER NOT NULL DEFAULT 0 CHECK (scheduled_offset_seconds >= 0),
  PRIMARY KEY (route_id, seq),
  UNIQUE (route_id, stop_id)
);
-- Which routes a driver may run a trip on (FR-D1).
CREATE TABLE IF NOT EXISTS driver_assignments (
  id         SERIAL PRIMARY KEY,
  driver_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  route_id   INTEGER NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (driver_id, route_id)
);

-- One run of a route by one driver (FR-D1, FR-D5).
CREATE TABLE IF NOT EXISTS trips (
  id                 SERIAL PRIMARY KEY,
  route_id           INTEGER NOT NULL REFERENCES routes(id) ON DELETE RESTRICT,
  driver_id          INTEGER NOT NULL REFERENCES users(id)  ON DELETE RESTRICT,
  status             TEXT    NOT NULL DEFAULT 'active'
                       CHECK (status IN ('active', 'completed', 'cancelled')),
  scheduled_start_at TIMESTAMPTZ,
  started_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at           TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (ended_at IS NULL OR ended_at >= started_at)
);

-- A driver's report that the bus has left a stop, with occupancy (FR-D2, FR-D3).
-- `client_uuid` makes the offline sync idempotent: replaying a queued check-in
-- cannot create a duplicate (FR-D6).
CREATE TABLE IF NOT EXISTS checkins (
  id          SERIAL PRIMARY KEY,
  trip_id     INTEGER NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  stop_id     INTEGER NOT NULL REFERENCES stops(id) ON DELETE RESTRICT,
  seq         INTEGER NOT NULL CHECK (seq >= 1),
  occupancy   TEXT    NOT NULL
                CHECK (occupancy IN ('empty', 'seats_free', 'standing_only', 'full')),
  event       TEXT    NOT NULL DEFAULT 'departed' CHECK (event IN ('arrived', 'departed')),
  latitude    DOUBLE PRECISION,
  longitude   DOUBLE PRECISION,
  client_uuid TEXT UNIQUE,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  voided_at   TIMESTAMPTZ
);

-- Optional phone-GPS breadcrumbs during an active trip (FR-D4). Retained only
-- for operational need (NFR: Security & privacy) — see prune_driver_positions.
CREATE TABLE IF NOT EXISTS driver_positions (
  id          SERIAL PRIMARY KEY,
  trip_id     INTEGER NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  latitude    DOUBLE PRECISION NOT NULL,
  longitude   DOUBLE PRECISION NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Arrival alerts a commuter has asked for (FR-C6, FR-S4).
CREATE TABLE IF NOT EXISTS alert_subscriptions (
  id             SERIAL PRIMARY KEY,
  user_id        INTEGER NOT NULL REFERENCES users(id)  ON DELETE CASCADE,
  route_id       INTEGER NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
  stop_id        INTEGER NOT NULL REFERENCES stops(id)  ON DELETE CASCADE,
  minutes_before INTEGER NOT NULL DEFAULT 5 CHECK (minutes_before BETWEEN 1 AND 60),
  trip_id        INTEGER REFERENCES trips(id) ON DELETE SET NULL,
  notified_at    TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, route_id, stop_id)
);

-- Commuter-reported inaccuracies, triaged by admins (FR-C7, FR-A5).
CREATE TABLE IF NOT EXISTS issue_reports (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id)   ON DELETE CASCADE,
  route_id   INTEGER          REFERENCES routes(id)  ON DELETE SET NULL,
  stop_id    INTEGER          REFERENCES stops(id)   ON DELETE SET NULL,
  trip_id    INTEGER          REFERENCES trips(id)   ON DELETE SET NULL,
  kind       TEXT    NOT NULL CHECK (kind IN ('delay', 'wrong_position', 'wrong_occupancy', 'other')),
  note       TEXT,
  status     TEXT    NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'acknowledged', 'resolved', 'dismissed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Saved routes/stops for one-tap access (FR-C8).
CREATE TABLE IF NOT EXISTS favourites (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id)   ON DELETE CASCADE,
  route_id   INTEGER NOT NULL REFERENCES routes(id)  ON DELETE CASCADE,
  stop_id    INTEGER NOT NULL REFERENCES stops(id)   ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, route_id, stop_id)
);

-- --- Indexes (NFR: Performance — lookups stay fast as history grows) -------
CREATE INDEX IF NOT EXISTS idx_route_stops_stop        ON route_stops (stop_id);
CREATE INDEX IF NOT EXISTS idx_trips_route_status      ON trips (route_id, status);
CREATE INDEX IF NOT EXISTS idx_trips_started_at        ON trips (started_at DESC);
CREATE INDEX IF NOT EXISTS idx_checkins_trip_seq       ON checkins (trip_id, seq);
CREATE INDEX IF NOT EXISTS idx_checkins_stop_recorded  ON checkins (stop_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_checkins_recorded_at    ON checkins (recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_positions_trip_recorded ON driver_positions (trip_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_issue_reports_status    ON issue_reports (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_alerts_route_stop       ON alert_subscriptions (route_id, stop_id);
-- ---------------------------------------------------------------------------
-- Derived view: one row per observed stop-to-stop leg (FR-S1).
--
-- This is the raw material for ETA averaging. Legs are bucketed by time band
-- (weekday/weekend x hour of day) because a 09:00 leg and a 14:00 leg on the
-- same road are not comparable. Implausible legs — clock skew, a driver
-- tapping twice, a bus parked for an hour — are filtered out here so every
-- consumer of the view sees the same cleaned sample set.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW segment_travel_samples AS
SELECT
  t.route_id,
  t.id                                                        AS trip_id,
  c1.stop_id                                                  AS from_stop_id,
  c2.stop_id                                                  AS to_stop_id,
  c1.seq                                                      AS from_seq,
  c1.recorded_at                                              AS departed_at,
  EXTRACT(EPOCH FROM (c2.recorded_at - c1.recorded_at))::int   AS travel_seconds,
  CASE WHEN EXTRACT(DOW FROM c1.recorded_at) IN (0, 6)
       THEN 'weekend' ELSE 'weekday' END                      AS day_type,
  EXTRACT(HOUR FROM c1.recorded_at)::int                       AS hour_of_day
FROM checkins c1
JOIN checkins c2
  ON  c2.trip_id = c1.trip_id
  AND c2.seq     = c1.seq + 1
JOIN trips t ON t.id = c1.trip_id
WHERE c1.voided_at IS NULL
  AND c2.voided_at IS NULL
  AND t.status <> 'cancelled'
  AND c2.recorded_at > c1.recorded_at
  -- 20s is faster than any real leg; 60min means the bus was not in service.
  AND EXTRACT(EPOCH FROM (c2.recorded_at - c1.recorded_at)) BETWEEN 20 AND 3600;



