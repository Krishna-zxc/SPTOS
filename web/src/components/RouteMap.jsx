/**
 * The live map (PRD FR-C2, FR-A4).
 *
 * Leaflet over OpenStreetMap tiles, because §13 rules out any provider that
 * needs a billing account. Two deliberate choices:
 *
 *  - markers are `divIcon`s rather than image pins, so a bus can be drawn in the
 *    colour of its crowding level and labelled with its route code without
 *    shipping a sprite sheet;
 *  - a bus whose data has gone stale is drawn hollow and greyed. The map is the
 *    easiest place to accidentally imply "this is where the bus is right now",
 *    so staleness has to be visible on the marker itself, not only in the list
 *    beside it.
 */
import { useEffect, useMemo } from 'react';
import L from 'leaflet';
import { MapContainer, Marker, Polyline, Popup, TileLayer, useMap } from 'react-leaflet';
import { occupancyLevel } from '@sptos/shared';
import { useMeta } from '../lib/meta.jsx';
import { ageState, clockTime, etaText, useNow } from '../lib/format.js';

const TILES = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
const ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

const OCCUPANCY_COLOUR = {
  empty: '#15803d',
  seats_free: '#15803d',
  standing_only: '#b45309',
  full: '#b91c1c',
};

function busIcon({ label, occupancy, isStale }) {
  const colour = isStale ? '#94a3b8' : (OCCUPANCY_COLOUR[occupancy] ?? '#0f766e');
  return L.divIcon({
    className: 'bus-marker',
    iconSize: [46, 46],
    iconAnchor: [23, 23],
    html: `
      <div style="display:flex;align-items:center;justify-content:center;width:46px;height:46px">
        <span style="
          display:flex;align-items:center;justify-content:center;
          min-width:30px;height:30px;padding:0 6px;border-radius:15px;
          background:${isStale ? '#f8fafc' : colour};
          color:${isStale ? '#475569' : '#fff'};
          border:2px ${isStale ? 'dashed' : 'solid'} ${colour};
          font:700 11px/1 Inter,system-ui,sans-serif;
          box-shadow:0 1px 4px rgba(15,23,42,.35);
        ">${label}</span>
      </div>`,
  });
}

function stopIcon({ isHighlighted, index }) {
  const size = isHighlighted ? 18 : 12;
  return L.divIcon({
    className: 'stop-marker',
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    html: `<div title="Stop ${index}" style="
      width:${size}px;height:${size}px;border-radius:50%;
      background:${isHighlighted ? '#0f766e' : '#fff'};
      border:${isHighlighted ? 3 : 2}px solid #0f766e;
      box-shadow:0 1px 3px rgba(15,23,42,.3);
    "></div>`,
  });
}

/** Keeps the viewport on the route; re-fits only when the geometry changes. */
function FitToRoute({ points }) {
  const map = useMap();
  const signature = points.map((point) => point.join(',')).join('|');

  useEffect(() => {
    if (points.length === 0) return;
    if (points.length === 1) {
      map.setView(points[0], 15);
      return;
    }
    map.fitBounds(L.latLngBounds(points).pad(0.15));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, signature]);

  return null;
}

export function RouteMap({
  stops = [],
  trips = [],
  highlightStopId = null,
  height = null,
  className = '',
}) {
  const { staleAfterSeconds } = useMeta();
  const now = useNow(10_000);

  const line = useMemo(
    () => stops.map((stop) => [stop.latitude, stop.longitude]),
    [stops],
  );

  const containerHeightClass = height ? '' : 'h-60 sm:h-72 md:h-80';

  if (stops.length === 0) {
    return (
      <div
        className={`card grid place-items-center text-sm text-slate-500 ${containerHeightClass} ${className}`}
        style={height ? { height } : undefined}
      >
        This route has no stops on the map yet.
      </div>
    );
  }

  return (
    <div
      className={`card overflow-hidden ${containerHeightClass} ${className}`}
      style={height ? { height } : undefined}
    >
      <MapContainer
        style={{ height: '100%', width: '100%' }}
        center={line[0]}
        zoom={13}
        scrollWheelZoom={false}
        attributionControl
      >
        <TileLayer url={TILES} attribution={ATTRIBUTION} maxZoom={19} />
        <FitToRoute points={line} />
        <Polyline positions={line} pathOptions={{ color: '#0f766e', weight: 4, opacity: 0.55 }} />

        {stops.map((stop) => (
          <Marker
            key={stop.stopId}
            position={[stop.latitude, stop.longitude]}
            icon={stopIcon({ isHighlighted: stop.stopId === highlightStopId, index: stop.seq })}
            keyboard={false}
          >
            <Popup>
              <p className="font-semibold">
                {stop.seq}. {stop.name}
              </p>
              <p className="text-xs text-slate-500">{stop.code}</p>
            </Popup>
          </Marker>
        ))}

        {trips.map((trip) => {
          if (!trip.position) return null;
          const fresh = ageState(trip, staleAfterSeconds, now);
          const level = occupancyLevel(trip.lastCheckin?.occupancy);
          return (
            <Marker
              key={trip.tripId}
              position={[trip.position.latitude, trip.position.longitude]}
              icon={busIcon({
                label: trip.routeCode ?? `${trip.progress.stopsCompleted}/${trip.progress.totalStops}`,
                occupancy: trip.lastCheckin?.occupancy,
                isStale: fresh.isStale,
              })}
              zIndexOffset={500}
            >
              <Popup>
                <p className="font-semibold">Driver {trip.driverName}</p>
                <p className="text-xs">
                  {trip.progress.stopsCompleted} of {trip.progress.totalStops} stops
                  {level ? ` · ${level.label}` : ''}
                </p>
                <p className="text-xs text-slate-500">{fresh.label}</p>
                {trip.nextStop ? (
                  <p className="text-xs">
                    Next: {trip.nextStop.stopName}
                    {trip.etaAvailable && !fresh.isStale && trip.etas?.[0]
                      ? ` — ${etaText(trip.etas[0])} (estimate)`
                      : ' — no estimate'}
                  </p>
                ) : null}
                {trip.lastCheckin ? (
                  <p className="text-xs text-slate-500">
                    Checked in at {clockTime(trip.lastCheckin.recordedAt)}
                  </p>
                ) : null}
              </Popup>
            </Marker>
          );
        })}
      </MapContainer>
    </div>
  );
}

export default RouteMap;
