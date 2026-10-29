# Car Rental System

A two-sided car rental platform: a public booking site for customers and a back-office console for fleet
managers, backed by an Express API on MongoDB.

## Stack

| Layer | Choice |
| --- | --- |
| API | Node 18+, Express 4, Mongoose 8 |
| Auth | JWT (bcrypt password hashes, `customer` / `manager` roles) |
| Data | MongoDB (Atlas or self-hosted); in-process `mongodb-memory-server` for local dev and tests |
| Web | React 18 + Vite + React Router |

## Layout

```
backend/     Express API, Mongoose models, seed script, tests, smoke script
frontend/    React SPA (customer site + manager console)
```

## Design

### Entities

**Vehicle** — one physical car: make/model/year, unique `licensePlate`, `vehicleClass`, transmission, fuel,
seats, luggage, `dailyRate`, refundable `deposit`, home `location`, `mileageLimitKm`, and a status of
`available` / `maintenance` / `retired`.

**User** — `customer` or `manager`. Passwords are bcrypt-hashed and stored in `passwordHash`, which is
`select: false` so a hash never leaves the database by accident. Deactivating a user (`active: false`) blocks
sign-in without deleting their booking history.

**Booking** — links a customer to a vehicle for a half-open interval `[pickUpDate, returnDate)`. Carries a
human reference `code` (`RC-XXXXXXXX`), the branch pair, a frozen price `breakdown`, and a status.

### Availability rule

A vehicle is unavailable for a window if any booking with an **active** status (`pending`, `confirmed`,
`picked_up`) overlaps it. Overlap is `existing.pickUp < new.return && existing.return > new.pickUp`, so a car
returned on a day is bookable again that same day. Cancelled, no-show and returned bookings free their dates.

`backend/src/routes/bookings.js:1` performs the overlap check and the insert inside a per-vehicle in-process
lock (`backend/src/lib/lock.js:1`) so simultaneous requests for one car produce exactly one booking. This holds
for a single API instance — the supported topology. A multi-instance deployment should replace it with a
MongoDB transaction over a replica set.

### Pricing

`backend/src/lib/pricing.js:1` is the only place money is calculated, and `GET /api/vehicles/:id/quote` exposes
it so the browser never re-implements it:

- `days` = whole calendar days between pick-up and return (1–90)
- `gross` = `dailyRate × days`
- weekly discount = 15% off gross when `days >= 7`
- extras: additional driver $8/day, child seat $5/day
- `rentalTotal` = gross − discount + extras; the deposit is quoted separately and never part of the total

The total is copied onto the booking at creation, so later rate changes cannot rewrite history.

### Status lifecycle

`pending → confirmed → picked_up → returned`, with `cancelled` and `no_show` reachable from `pending` /
`confirmed`. Terminal states cannot move. Customers may only cancel their own `pending`/`confirmed` bookings;
every other transition is manager-only, so the allowed set is enforced server-side rather than by hiding
buttons.

### Access control

| Route | Anonymous | Customer | Manager |
| --- | --- | --- | --- |
| `GET /api/vehicles`, `/locations`, `/:id`, `/:id/quote` | yes | yes | yes (`status=all` also shows retired) |
| `POST /api/auth/register` | yes | — | — |
| `GET /api/bookings/mine`, `POST /api/bookings`, `POST /:id/cancel` | — | own records | own records |
| `GET /api/bookings/all`, `PATCH /api/bookings/:id/status` | — | — | yes |
| `POST/PATCH/DELETE /api/vehicles`, `GET /api/auth/customers`, `POST /api/auth/customers` | — | — | yes |
| `GET /api/stats/*` | — | — | yes |

`role` is taken from the verified JWT and the request body can never set it; registration always yields a
`customer`.

## API

```
GET    /api/health                    liveness + database state
POST   /api/auth/register             create a customer account
POST   /api/auth/login                -> { token, user }
GET    /api/auth/me                   current account
GET    /api/vehicles                  search; filters: location, vehicleClass, transmission, fuel,
                                      minSeats, maxDailyRate, sort, startDate/endDate, status (manager)
GET    /api/vehicles/locations        distinct branches
GET    /api/vehicles/:id              detail, optional availability for a window
GET    /api/vehicles/:id/quote        priced window + whether the car is free
POST   /api/vehicles                  manager: add to fleet
PATCH  /api/vehicles/:id              manager: update (rate locked while on rent)
DELETE /api/vehicles/:id              manager: remove (blocked while active bookings exist)
POST   /api/bookings                  customer: reserve
GET    /api/bookings/mine             customer: own bookings
GET    /api/bookings/all              manager: filter by status / code / customer
GET    /api/bookings/:id              owner or manager
PATCH  /api/bookings/:id/status       manager: lifecycle transition
POST   /api/bookings/:id/cancel       owner or manager
GET    /api/auth/customers            manager: customer directory
POST   /api/auth/customers            manager: create walk-in account
GET    /api/stats/overview            manager: fleet, bookings, revenue, next pick-ups
GET    /api/stats/revenue             manager: revenue grouped by month
```

## Running it

```bash
npm run install:all

# API on :4000, SPA served from the same origin (run the frontend build first)
npm run build
npm start
```

`MONGODB_URI=memory` (the default outside production) starts an in-process MongoDB, so the stack runs with no
database installed — data resets when the process exits. `SEED_ON_START=true` fills an empty database with the
demo fleet before the first request. Point `MONGODB_URI` at a real cluster to persist.

For UI work, run the API and the Vite dev server side by side (`/api` is proxied to `:4000`):

```bash
npm run dev:api      # terminal 1
npm run dev:web      # terminal 2 -> http://localhost:5173
```

Copy `backend/.env.example` to `backend/.env` to override port, secret, or URI.

### Demo logins

| Role | Email | Password |
| --- | --- | --- |
| Manager | `manager@rental.test` | `Manager123!` |
| Customer | `driver@rental.test` | `Driver123!` |

Two more seeded customers exist (`thando@rental.test`, `lihle@rental.test`) with the customer password.

## Verification

```bash
npm test                       # 25 integration tests (booking conflicts, auth, pricing, roles, stats)
npm run build && npm start     # then:
npm run smoke                  # 16 end-to-end checks against the running stack
```

Tests run against an in-memory MongoDB with `--test-concurrency=1`; spawning several instances in parallel
exceeds the mongod startup budget on Windows. The smoke script needs a reachable server and asserts the
quote→book→conflict→cancel→rebook round trip plus the manager views.

## Deployment

The API serves the built SPA, so one web process is enough. `render.yaml` at the repo root describes that
service: build the frontend, install production-only backend deps, `node server.js`, health check on
`/api/health`. Create the Render web service from that blueprint and add `MONGODB_URI` in the dashboard — it is
declared `sync: false` so it is never stored in the repository.

Required in any host:

- `MONGODB_URI` — a real connection string; `memory` is refused with `NODE_ENV=production`
- `JWT_SECRET` — a long random value, also required in production
- `WEB_DIST` — only if the build output is not at `frontend/dist`
- `CORS_ORIGIN` — comma-separated allow-list, only when the SPA is hosted separately

Because production installs with `--omit=dev`, `mongodb-memory-server` is never downloaded there.
