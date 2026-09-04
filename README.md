# SPTOS — Smart Public Transport Optimization System

**Live bus tracking, arrival estimates and demand analytics for city bus networks — with no GPS hardware, no tracking devices and no per-bus cost.**

SPTOS answers the one question every commuter at a bus stop actually has: *"is my bus coming, and when?"* It also gives the transport authority the data it has never had: which routes are overcrowded, at what hour, and by how much.

---

## The problem

Most city bus networks in India run without any live tracking. A commuter at a stop has no idea whether the bus left five minutes ago or is twenty minutes late. The usual fix — fitting every bus with a GPS tracker — costs money per vehicle, needs SIM cards, needs maintenance, and stops working the moment a device fails.

## The idea

**The driver's own phone is the tracker.** The conductor or driver already has a phone, and already knows exactly where the bus is — they are standing in it.

So instead of hardware, SPTOS asks the driver for one tap per stop:

> Bus reached **Aundh Gaon**. How full is it? → *Empty · Seats free · Standing only · Full*

That single tap is a **check-in**. From a stream of check-ins the system derives everything else:

| From check-ins, SPTOS computes | How |
| --- | --- |
| Where the bus is now | The last stop it checked in at |
| When it will reach your stop | Historical stop-to-stop travel times for this route, at this hour, on this type of day |
| How crowded it is | The occupancy level the driver tapped |
| Which routes need more buses | Occupancy averaged by route × stop × time band |

No GPS. No hardware. Pure software.

---

## Table of contents

- [Who uses it, and what they see](#who-uses-it-and-what-they-see)
- [Tech stack](#tech-stack)
- [Quick start](#quick-start)
- [Demo accounts](#demo-accounts)
- [Project structure](#project-structure)
- [The two ways to run SPTOS](#the-two-ways-to-run-sptos)
- [How the ETA engine works](#how-the-eta-engine-works)
- [Honesty about stale data](#honesty-about-stale-data)
- [Data model](#data-model)
- [API reference](#api-reference)
- [Real-time WebSocket events](#real-time-websocket-events)
- [Works offline (PWA)](#works-offline-pwa)
- [Environment variables](#environment-variables)
- [All npm scripts](#all-npm-scripts)
- [Testing](#testing)
- [Deployment](#deployment)
- [Security notes](#security-notes)
- [License](#license)

---

## Who uses it, and what they see

SPTOS is **one installable app** with three faces. Which face you get is decided by your role.

### 🚏 Commuter — *no account needed*

Checking whether your bus is coming should never require signing up. Everything below is public:

| Page | Route | What it does |
| --- | --- | --- |
| Home | `/` | Search routes and stops, see what is running now |
| Route view | `/routes/:routeId` | Live map of every bus on the route, with its position and crowding |
| Stop board | `/stops/:stopId` | "Next buses at this stop" — the arrivals board you wish existed |
| Trip view | `/trips/:tripId` | Follow one bus stop by stop |
| Saved | `/saved` | *(sign-in required)* Favourite stops and arrival alerts |

Signing in adds only two things: **favourites**, and an **alert** that fires ~5 minutes before your bus reaches your stop.

### 🚌 Driver / Conductor — *sign-in required*

Built for one hand, in a moving bus, on a bad connection.

| Page | Route | What it does |
| --- | --- | --- |
| My trips | `/driver` | Start a trip on an assigned route, or resume the active one |
| Active trip | `/driver/trips/:tripId` | The big-button check-in screen: tap the stop, tap the crowd level |

Taps made in a dead zone are **queued on the device and sent when signal returns** — the driver never has to think about connectivity.

### 🛠️ Administrator — *sign-in required*

| Page | Route | What it does |
| --- | --- | --- |
| Dashboard | `/admin` | Demand, punctuality and operations analytics; CSV export |
| Network map | `/admin/network` | Every active bus in the city on one map |
| Routes | `/admin/routes` | Create routes, and order the stops along them |
| Stops | `/admin/stops` | Create and edit stops (name, code, coordinates) |
| People | `/admin/people` | Create users, set roles, assign drivers to routes, reset passwords |
| Issues | `/admin/issues` | Triage commuter reports (delay / wrong position / wrong crowding) |

---

## Tech stack

Everything here is free tier or open source — deliberately, so a pilot costs nothing to run.

### Frontend — `web/`

| Package | Version | Why |
| --- | --- | --- |
| React | 19.2 | UI |
| Vite | 8.2 | Dev server and bundler |
| Tailwind CSS | 4.3 | Styling |
| React Router | 7.18 | Role-based routing |
| Leaflet + React-Leaflet | 1.9 / 5.0 | Maps on **free OpenStreetMap tiles** — no billing-enabled map provider |
| Recharts | 3.10 | Analytics charts |
| Socket.IO client | 4.8 | Live updates without polling |
| Firebase | 12.18 | Auth + Firestore for the serverless deployment |
| vite-plugin-pwa | 1.3 | Installable, offline-capable app |

### Backend — `server/`

| Package | Version | Why |
| --- | --- | --- |
| Express | 5.2 | REST API |
| Socket.IO | 4.8 | Real-time push |
| PostgreSQL (`pg`) | 8.23 | Production database |
| PGlite | 0.5 | **Embedded Postgres** so local dev needs zero database setup |
| jsonwebtoken | 9.0 | JWT sessions |
| bcryptjs | 3.0 | Password hashing |
| Zod | 4.5 | Request validation on every endpoint |
| morgan | 1.12 | Request logging |

### Shared — `shared/`

A tiny package imported by *both* the server and the web app, so the two can never disagree about the domain vocabulary: occupancy buckets, time bands, freshness rules, roles, and the WebSocket event names.

**Requirements:** Node.js **20 or newer**. Nothing else.

---

## Quick start

You need **Node.js 20+**. You do **not** need to install PostgreSQL, Docker, or a Firebase account to run this locally.

### 1. Clone and install

```bash
git clone https://github.com/Krishna-zxc/SPTOS.git
cd SPTOS
npm install
```

`npm install` installs all three workspaces (`shared`, `server`, `web`) in one go.

### 2. Create the database tables

```bash
npm run migrate
```

With no `DATABASE_URL` set, this creates an **embedded PostgreSQL** database in `server/.pgdata/`. Nothing to install, nothing to configure.

### 3. Load demo data

```bash
npm run seed
```

This gives you a realistic city to click around in:

- **15 stops** across Pune — Shivajinagar, Hinjawadi, Katraj, Kharadi, Viman Nagar and more
- **3 routes** — `R1` Shivajinagar—Hinjawadi, `R2` Katraj—Kharadi, `R3` Swargate—Viman Nagar
- **4 users** (see below)
- **Weeks of synthetic check-in history**, which is what lets the ETA engine produce measured estimates immediately instead of falling back to the timetable

### 4. Run it

```bash
npm run dev
```

| | |
| --- | --- |
| Web app | **http://localhost:5173** |
| API | **http://localhost:4000** |

Both start together. Vite proxies `/api` and `/socket.io` to the server, so the browser only ever talks to one origin — no CORS setup needed in development.

To wipe everything and start over:

```bash
npm run reset
```

---

## Demo accounts

⚠️ **These are seed accounts for local demos only. Never deploy them to a real system.**

When running the **full stack locally** (`npm run dev` after `npm run seed`):

| Role | Email | Password | Notes |
| --- | --- | --- | --- |
| 🛠️ Admin | `meera@sptos.local` | `sptos1234` | Full access |
| 🚌 Driver | `suresh@sptos.local` | `sptos1234` | Assigned routes R1, R3 |
| 🚌 Driver | `anil@sptos.local` | `sptos1234` | Assigned routes R2, R3 |
| 🚏 Commuter | `riya@sptos.local` | `sptos1234` | Has favourites and an alert |

When running as a **static/Firebase build** (the Firestore fallback layer seeds its own users):

| Role | Email | Password |
| --- | --- | --- |
| 🛠️ Admin | `krishna@sptos.local` | `krishnagg` |
| 🚌 Driver | `suresh@sptos.local` | `sptos1234` |
| 🚌 Driver | `anil@sptos.local` | `sptos1234` |
| 🚏 Commuter | `riya@sptos.local` | `sptos1234` |

You can also just **register a new commuter account** from the sign-in page.

---

## Project structure

```
SPTOS/
├── shared/                     # Domain vocabulary used by BOTH server and web
│   └── src/
│       ├── occupancy.js        # The 4 crowd buckets + their load factors
│       ├── timebands.js        # Hour × day-type bands (morning peak, midday…)
│       ├── freshness.js        # "Is this data still live?" — one source of truth
│       ├── roles.js            # commuter | driver | admin, issue kinds, statuses
│       └── events.js           # WebSocket event names and room naming
│
├── server/                     # REST + WebSocket API
│   ├── src/
│   │   ├── index.js            # Entry point — boots HTTP + Socket.IO
│   │   ├── app.js              # Express app and route mounting
│   │   ├── config.js           # Env parsing with safe defaults
│   │   ├── db/
│   │   │   ├── index.js        # Postgres or embedded PGlite
│   │   │   ├── migrate.js      # Runs the SQL migrations
│   │   │   ├── seed.js         # Demo city + synthetic history
│   │   │   └── migrations/     # 001_init.sql, 002_eta_accuracy.sql
│   │   ├── middleware/         # auth (JWT + RBAC), errors, rate limiting
│   │   ├── routes/             # auth · catalog · live · driver · admin
│   │   └── services/
│   │       ├── eta.service.js          # ⭐ The ETA engine
│   │       ├── checkin.service.js      # Recording a driver tap
│   │       ├── live.service.js         # Current state of routes / stops / trips
│   │       ├── analytics.service.js    # Demand, punctuality, operations
│   │       ├── predictions.service.js  # Logs ETAs, later scores their accuracy
│   │       ├── notifications.service.js# Arrival alerts
│   │       └── realtime.js             # Socket.IO rooms and auth
│   └── test/                   # api · eta · shared test suites
│
└── web/                        # The PWA (commuter + driver + admin)
    └── src/
        ├── App.jsx             # The route table, with role gates
        ├── components/         # Layout, maps, ETA cards, badges, forms
        ├── lib/
        │   ├── api.js          # The single place the client calls the API
        │   ├── firebase.js     # Firebase app / Auth / Firestore
        │   ├── firestoreDb.js  # Serverless fallback: same API, on Firestore
        │   ├── mockDb.js       # In-memory demo data
        │   ├── outbox.js       # Queues driver taps made while offline
        │   ├── socket.js       # Live subscription client
        │   └── useLive.js      # React hook for live data
        └── pages/
            ├── commuter/       # Home, RouteView, StopView, TripView, Saved
            ├── driver/         # DriverHome, DriverTrip
            └── admin/          # Dashboard, NetworkMap, Routes, Stops, People, Issues
```

---

## The two ways to run SPTOS

This is worth understanding, because it explains why there are two data layers in the codebase.

### Mode 1 — Full stack (recommended for development)

```
Browser  ──►  Vite (5173)  ──proxy──►  Express (4000)  ──►  PostgreSQL / PGlite
                                            │
                                            └── Socket.IO push
```

You get everything: the real ETA engine, analytics, WebSocket push, CSV export, JWT auth, rate limiting.

### Mode 2 — Static / serverless (Firebase Hosting)

```
Browser  ──►  Firebase Hosting (static PWA)  ──►  Firestore
```

There is no Express server. So `web/src/lib/api.js` notices that an `/api/...` call
came back as the HTML app shell (or failed outright) and **transparently re-runs the
same request against `firestoreDb.js`**, which implements the identical API surface
on top of Firestore.

The upshot: **the exact same React code runs in both modes.** No feature flags, no
separate build. It just degrades to the serverless path when no API is present.

---

## How the ETA engine works

This is the heart of the project — see [`server/src/services/eta.service.js`](server/src/services/eta.service.js).

There is no GPS ground truth, so an arrival time is built from exactly two facts:

1. **Where the bus was last reported** — its most recent check-in
2. **How long this route's legs normally take** — at this hour, on this type of day

The ETA to your stop is the sum of the estimates for each remaining leg between the
bus's last check-in and your stop.

### Every leg estimate falls back through four sources, best first

| # | Source | Meaning | Used when |
| --- | --- | --- | --- |
| 1 | `measured` | Average of past trips on this **exact leg + day type + hour** | ≥ 3 samples exist |
| 2 | `measured_daytype` | Same, relaxed to **day type only** (any hour) | ≥ 3 samples exist |
| 3 | `scheduled` | The difference between the **planned offsets** in the timetable | A timetable exists |
| 4 | `fallback` | A flat configured guess (default **180 s**) | Nothing else is known |

The ETA is presented as a **range**, not a single time, widened by the historical
standard deviation of those legs (or ±25% when no spread is known). A range is
honest; "arrives at 10:42:00" is not.

### Comparing like with like

A leg driven at 09:00 on a Tuesday is nothing like the same leg at 14:00 on a Sunday, so samples are bucketed before averaging — see [`shared/src/timebands.js`](shared/src/timebands.js):

- **Day types:** `weekday`, `weekend`
- **Named bands** (for the admin dashboard): Early `04–07`, Morning peak `07–11`, Midday `11–16`, Evening peak `16–20`, Night `20–04`

### The engine grades itself

Every ETA shown to a commuter is written to the `eta_predictions` table. When the
bus actually arrives, the prediction is scored against reality. The admin
dashboard reports that error, so you can see whether the ETAs are any good rather
than taking them on faith.

---

## Honesty about stale data

A design rule the whole codebase is built around:

> **Never show old data as if it were live.**

If a driver's phone dies mid-route, the last known position must not sit on the map
looking current. So every commuter-facing status carries the **age** of the check-in
behind it and an explicit **stale flag**, from one shared helper
([`shared/src/freshness.js`](shared/src/freshness.js)) rather than each screen inventing its own cutoff.

| Age of the last check-in | What the commuter sees |
| --- | --- |
| under 20 s | "Just now" |
| under 60 s | "Under a minute ago" |
| under an hour | "7 min ago" |
| **over 8 minutes** (`STALE_AFTER_SECONDS`) | **"No recent data · last seen 12 min ago"** |
| never | "No recent data" |

The same rule drives the offline caching strategy: live endpoints are **never**
cached, because a cached position replayed later is indistinguishable from a live
one. Offline, those requests fail and the UI says so.

### Occupancy buckets

Four deliberately coarse choices — a conductor picking one of four labelled buttons
in a moving bus is faster and less ambiguous than judging a percentage. The
`loadFactor` is what demand analytics averages on.

| Value | Label | Load factor |
| --- | --- | --- |
| `empty` | Empty | 0.10 |
| `seats_free` | Seats free | 0.40 |
| `standing_only` | Standing only | 0.75 |
| `full` | Full | 1.00 |

---

## Data model

PostgreSQL, created by [`001_init.sql`](server/src/db/migrations/001_init.sql) and [`002_eta_accuracy.sql`](server/src/db/migrations/002_eta_accuracy.sql).

| Table | What it holds |
| --- | --- |
| `users` | Accounts, bcrypt password hashes, role |
| `routes` | Route code and name |
| `stops` | Stop code, name, latitude, longitude |
| `route_stops` | **Which stops, in what order, on which route** + planned time offsets |
| `driver_assignments` | Which driver is allowed to run which route |
| `trips` | One bus running one route once — `active` / `completed` / `cancelled` |
| `checkins` | ⭐ **The core table.** One driver tap: trip, stop, sequence, occupancy, timestamp |
| `driver_positions` | Optional finer-grained GPS breadcrumbs from the driver's phone |
| `alert_subscriptions` | "Tell me when a bus on route R1 nears stop UNI" |
| `issue_reports` | Commuter reports, with triage status |
| `favourites` | Saved routes and stops |
| `eta_predictions` | Every ETA shown, later scored against actual arrival |

Everything else in the product — the live map, the stop board, the ETAs, the demand
heatmap — is **derived from `checkins`**. That is the whole design.

---

## API reference

Base URL in development: `http://localhost:4000`. All bodies are JSON and every
endpoint validates its input with Zod. Authenticated requests send
`Authorization: Bearer <jwt>`.

Legend: 🌍 public · 🔑 any signed-in user · 🚌 driver or admin · 🛠️ admin only

### Health

| | Endpoint | |
| --- | --- | --- |
| 🌍 | `GET /api/health` | Liveness check |

### Auth — `/api/auth` *(rate limited to 20 requests/minute)*

| | Endpoint | |
| --- | --- | --- |
| 🌍 | `POST /api/auth/register` | Register a commuter. Minimum 8-character password |
| 🌍 | `POST /api/auth/login` | Returns `{ token, user }` |
| 🔑 | `GET /api/auth/me` | The current user |
| 🔑 | `POST /api/auth/password` | Change your own password |

### Catalogue — routes and stops

| | Endpoint | |
| --- | --- | --- |
| 🌍 | `GET /api/meta` | Occupancy buckets, time bands, roles, issue kinds — so the client never hardcodes them |
| 🌍 | `GET /api/routes` | All routes |
| 🌍 | `GET /api/routes/:id` | One route with its ordered stops |
| 🌍 | `GET /api/stops` | All stops |
| 🔑 | `GET /api/favourites` | Your saved routes and stops |
| 🔑 | `POST /api/favourites` | Save one |
| 🔑 | `DELETE /api/favourites/:id` | Remove one |

### Live data

| | Endpoint | |
| --- | --- | --- |
| 🌍 | `GET /api/routes/:id/live` | Every active bus on the route, with position, crowding and freshness |
| 🌍 | `GET /api/stops/:id/live` | **The arrivals board** — next buses at this stop with ETA ranges |
| 🌍 | `GET /api/trips/:id` | One trip's progress and check-in history |
| 🔑 | `GET /api/alerts` | Your arrival alerts |
| 🔑 | `POST /api/alerts` | "Alert me when a bus nears this stop" |
| 🔑 | `DELETE /api/alerts/:id` | Cancel an alert |
| 🔑 | `POST /api/issues` | Report a delay / wrong position / wrong crowding |
| 🔑 | `GET /api/issues/mine` | Your own reports and their status |

### Driver — `/api/driver` *(🚌 driver or admin)*

| | Endpoint | |
| --- | --- | --- |
| 🚌 | `GET /api/driver/assignments` | Routes you may run |
| 🚌 | `GET /api/driver/active-trip` | Resume an in-progress trip |
| 🚌 | `GET /api/driver/trips` | Your trip history |
| 🚌 | `GET /api/driver/trips/:id` | One trip |
| 🚌 | `POST /api/driver/trips` | Start a trip |
| 🚌 | `POST /api/driver/trips/:id/checkins` | ⭐ **The check-in** — reached a stop, with crowd level |
| 🚌 | `POST /api/driver/trips/:id/checkins/batch` | Flush taps queued while offline |
| 🚌 | `PATCH /api/driver/checkins/:id` | Correct a mistaken tap |
| 🚌 | `DELETE /api/driver/checkins/:id` | Delete a mistaken tap |
| 🚌 | `POST /api/driver/trips/:id/positions` | Optional GPS breadcrumbs |
| 🚌 | `POST /api/driver/trips/:id/end` | End the trip |
| 🚌 | `POST /api/driver/trips/:id/cancel` | Cancel the trip |

### Admin — `/api/admin` *(🛠️ admin only)*

| | Endpoint | |
| --- | --- | --- |
| 🛠️ | `GET · POST /api/admin/routes` | List and create routes |
| 🛠️ | `PATCH · DELETE /api/admin/routes/:id` | Edit or remove a route |
| 🛠️ | `PUT /api/admin/routes/:id/stops` | Set the ordered stop list for a route |
| 🛠️ | `POST /api/admin/stops` · `PATCH /api/admin/stops/:id` | Create and edit stops |
| 🛠️ | `GET · POST /api/admin/users` | List and create users |
| 🛠️ | `PATCH /api/admin/users/:id` | Edit a user or change their role |
| 🛠️ | `POST /api/admin/users/:id/password` | Reset someone's password |
| 🛠️ | `PUT /api/admin/users/:id/assignments` | Assign a driver to routes |
| 🛠️ | `GET /api/admin/analytics/demand` | Crowding by route × stop × time band |
| 🛠️ | `GET /api/admin/analytics/punctuality` | On-time performance and ETA accuracy |
| 🛠️ | `GET /api/admin/analytics/operations` | Active trips, check-in coverage, data quality |
| 🛠️ | `GET /api/admin/live/network` | Every active bus in the city |
| 🛠️ | `GET /api/admin/issues` · `PATCH /api/admin/issues/:id` | Triage commuter reports |
| 🛠️ | `GET /api/admin/exports` · `GET /api/admin/export/:dataset` | CSV export |

---

## Real-time WebSocket events

Clients **subscribe to rooms** instead of polling, so a commuter watching one stop
receives only what changes at that stop. Every driver check-in fans out to the
relevant rooms immediately. Contract in [`shared/src/events.js`](shared/src/events.js).

**Client → server**

| Event | Meaning |
| --- | --- |
| `subscribe:route` / `unsubscribe:route` | Watch every bus on a route |
| `subscribe:stop` / `unsubscribe:stop` | Watch one stop's arrivals board |
| `subscribe:admin` | Watch city-wide activity |

**Server → client**

| Event | Fires when |
| --- | --- |
| `route:update` | A bus on this route checked in |
| `stop:update` | The arrivals board for this stop changed |
| `trip:started` | A driver started a trip |
| `trip:ended` | A trip finished |
| `arrival:alert` | **Your bus is ~5 minutes away** |
| `admin:activity` | Anything noteworthy, for the admin live view |

Rooms are named `route:<id>`, `stop:<id>`, `user:<id>`, and `admin`.

---

## Works offline (PWA)

A bus stop is exactly where a data connection is worst, and a driver's phone has to
keep accepting taps through a dead spot. So the caching strategy is spelled out
explicitly in [`web/vite.config.js`](web/vite.config.js) rather than left to a default:

| What | Strategy | Why |
| --- | --- | --- |
| App shell (JS/CSS/HTML/icons) | **Precached** | The UI always opens, even with no signal |
| Catalogue (`/api/routes`, `/api/stops`, `/api/meta`) | **NetworkFirst**, 4 s timeout, 1-day cache | Barely changes; an offline commuter can still find their stop |
| Live endpoints, driver, admin, auth | **NetworkOnly — never cached** | A cached position replayed later would look live. Forbidden |
| OpenStreetMap tiles | **CacheFirst**, 14 days | The map still draws on a slow connection |

Plus: the app is **installable** to the home screen, and driver check-ins made
offline are queued in [`web/src/lib/outbox.js`](web/src/lib/outbox.js) and flushed via the batch endpoint when
signal returns.

---

## Environment variables

**Every value has a working default, so you can run SPTOS with no `.env` file at all.**
Templates are committed as `server/.env.example` and `web/.env.example` — copy them
only when you need to change something.

### Server — `server/.env`

| Variable | Default | What it does |
| --- | --- | --- |
| `PORT` | `4000` | HTTP + WebSocket port |
| `NODE_ENV` | `development` | `development` · `test` · `production` |
| `DATABASE_URL` | *(empty)* | **Leave empty for embedded PGlite.** Set a Postgres URL for a real deployment |
| `JWT_SECRET` | *(random per boot)* | **Required in production** — the server refuses to start without it. In dev a random secret is generated, so tokens expire on restart |
| `JWT_EXPIRES_IN` | `7d` | Token lifetime |
| `CORS_ORIGIN` | `http://localhost:5173` | Comma-separated allowed origins |
| `STALE_AFTER_SECONDS` | `480` | Older than this is shown as "no recent data" (8 min) |
| `MIN_CHECKINS_FOR_ETA` | `1` | Check-ins needed on a trip before any ETA is shown |
| `ETA_MIN_SAMPLES` | `3` | History needed before a measured leg average is trusted |
| `ETA_FALLBACK_SEGMENT_SECONDS` | `180` | Last-resort per-leg guess |
| `ARRIVAL_ALERT_MINUTES` | `5` | How early a subscribed commuter is alerted |

### Web — `web/.env.local`

| Variable | Default | What it does |
| --- | --- | --- |
| `VITE_API_URL` | *(empty → same origin)* | Set only when the client is served from a different origin than the API. Must be an origin the server's `CORS_ORIGIN` allows |

---

## All npm scripts

Run these from the repository root.

| Command | What it does |
| --- | --- |
| `npm run dev` | **Start server + web together** (the one you want) |
| `npm run dev:server` | API only, with file watching |
| `npm run dev:web` | Web only |
| `npm run migrate` | Create/update database tables |
| `npm run seed` | Load the demo city and synthetic history |
| `npm run reset` | Wipe and re-seed from scratch |
| `npm test` | Run the server test suite |
| `npm run build` | Production build of the PWA into `web/dist` |
| `npm start` | Run the API in production mode |
| `npm run deploy:web` | Build, then deploy to Firebase Hosting |

---

## Testing

```bash
npm test
```

Uses Node's built-in test runner — no Jest, no config. Three suites in `server/test/`:

| Suite | Covers |
| --- | --- |
| `api.test.js` | Every endpoint end-to-end via supertest: auth, RBAC, check-ins, alerts, issues, admin |
| `eta.test.js` | The ETA engine's four-tier fallback as a pure function — no database needed |
| `shared.test.js` | Occupancy buckets, time bands, freshness rules |

Tests run against a throwaway database, so they never touch your dev data.

---

## Deployment

### Frontend → Firebase Hosting

```bash
npm run deploy:web
```

That builds `web/dist` and deploys it. [`firebase.json`](firebase.json) is already configured with an
SPA rewrite (so deep links work), immutable caching on hashed assets, and
`no-cache` on the service worker so updates roll out immediately.

Point it at your own Firebase project by editing [`.firebaserc`](.firebaserc), and replace the
config in [`web/src/lib/firebase.js`](web/src/lib/firebase.js) with your project's.

### Backend → any Node host

The server is a plain Node 20 app, deployable to Render, Railway, Fly.io or a VPS:

```bash
npm start
```

For a real deployment you must set:

- **`DATABASE_URL`** — a real Postgres (Neon, Supabase and Render all have free tiers). Without it the server uses embedded PGlite, whose data lives on local disk and will not survive a container restart.
- **`JWT_SECRET`** — the server **refuses to boot in production** without one.
- **`CORS_ORIGIN`** — your deployed web origin, or the browser will be blocked.

Then run `npm run migrate` once against the new database.

---

## Security notes

Read this before putting SPTOS in front of real users. These are known gaps in the
current pilot code, listed plainly rather than buried.

### 🔴 Firestore rules are wide open

[`firestore.rules`](firestore.rules) currently grants `allow read, write: if true` on **every**
collection, including `users`, plus a catch-all `/{document=**}`. Anyone who knows
the project ID can read and rewrite the entire database. The `isAuth()` helper is
defined but never used.

Before any real deployment, gate each collection — public read for `routes` and
`stops`, owner-only access to `users` and `favourites`, driver-only writes to
`checkins`, admin-only writes to the catalogue.

### 🔴 Demo password backdoor in the Firestore path

[`web/src/lib/firestoreDb.js`](web/src/lib/firestoreDb.js) accepts the login if the submitted password is
`sptos1234`, regardless of the stored password — and also if the stored password is
empty. This exists to make the offline demo frictionless. **It must be removed
before real use.** The Express backend does not have this behaviour; it uses bcrypt
properly.

### 🟢 The Firebase config in the repo is *not* a leak

The `apiKey` in [`web/src/lib/firebase.js`](web/src/lib/firebase.js) looks alarming but is fine. Firebase web
API keys are public identifiers, not secrets — they ship inside every client bundle
by design, and Google documents them as such. Access control for a Firebase app is
enforced by Firestore rules and Auth, never by hiding that key. Which is exactly
why the first item on this list matters.

### 🟢 What the repo correctly keeps out

`.gitignore` excludes `server/.env` (the real `JWT_SECRET`), Firebase auth/user
exports, the Firebase deploy cache, `node_modules`, build output and the local
PGlite data directory. Only `.env.example` templates with empty secret values are
committed.

### Other notes

- Demo seed accounts share the password `sptos1234`. Delete or rotate them before a pilot.
- Rate limiting ([`server/src/middleware/ratelimit.js`](server/src/middleware/ratelimit.js)) is in-process, so it protects a single instance only. Put a shared limiter in front of a horizontally scaled deployment.
- Driver check-ins are trusted as submitted. There is no cross-check that a driver is physically at the stop they tapped — an acceptable trade-off for a hardware-free system, but worth knowing.

---

## Roadmap

- [ ] Tighten Firestore rules to per-collection, role-aware access
- [ ] Remove the demo password fallback
- [ ] Web push notifications (alerts currently need a tab open)
- [ ] Route optimisation suggestions from the demand analytics
- [ ] Multi-city / multi-operator support
- [ ] Frontend component tests (vitest is wired up, suites not yet written)

---

## License

MIT.

---

<p align="center">
  Built as a Semester 5 IdeaLab project · <b>SPTOS</b> — live bus tracking without the hardware.
</p>
