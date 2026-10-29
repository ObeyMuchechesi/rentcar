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
backend/     Express API, Mongoose models, seed script, tests, verification scripts
frontend/    React SPA (customer site + manager console)
api/index.js Vercel serverless entry that boots the Express app
vercel.json  build, static output and /api routing for the deployment
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

`backend/src/routes/bookings.js:62` runs the overlap check and the insert inside a MongoDB transaction that also
increments `Vehicle.bookingEpoch`. Two simultaneous bookings of one car therefore write the same document, the
loser aborts with a write conflict, and the retry reads the winner's booking and answers 409 — the guarantee
holds across API instances, which is what Vercel's serverless functions are. On a standalone MongoDB, where
transactions do not exist, `backend/src/lib/reservation.js:1` falls back to the per-vehicle in-process lock
(`backend/src/lib/lock.js:1`) and `GET /api/health` reports `bookingTransactions: false`.

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
SMOKE_BASE_URL=https://<your-deployment> npm run smoke   # the same checks against a deployment
```

`npm run concurrency` is the cross-instance proof: it starts two separate API processes against the
same replica set and races eight identical bookings between them, three rounds, asserting exactly one 201 and one
stored booking per round. It refuses to run against a standalone server, where the answer would only prove the
in-process lock works.

Tests run against an in-memory MongoDB with `--test-concurrency=1`; spawning several instances in parallel
exceeds the mongod startup budget on Windows. The in-memory server is standalone, so the suite exercises the
lock fallback while `npm run concurrency` exercises the transaction path. The smoke script needs a reachable
server and asserts the quote→book→conflict→cancel→rebook round trip plus the manager views.

## Deployment

Live at **https://rentcar-woad.vercel.app** (public). Vercel serves the Vite build from its CDN and rewrites
`/api/*` to a single Node function:

- `buildCommand` / `outputDirectory` build `frontend/dist`; files that exist in the output win over rewrites, so
  hashed assets load normally while `/admin` and other deep links fall through to `index.html`
- `api/index.js` boots the Express app once per warm instance and answers 503 while it is still connecting, so
  only cold starts pay for the Atlas handshake
- with the CDN owning the frontend, `VERCEL=1` switches off the Express static mount (`backend/src/config.js:13`)
  and the function stays API-only
- the function is API-only, so booking safety depends on the transaction path: `GET /api/health` must report
  `bookingTransactions: true`

Required environment variables, both stored as Vercel *Sensitive* values and never in the repository:

- `MONGODB_URI` — a real replica-set connection string; `memory` is refused with `NODE_ENV=production`
- `JWT_SECRET` — a long random value, also required in production
- `WEB_DIST` — only if the build output is not at `frontend/dist`
- `CORS_ORIGIN` — comma-separated allow-list, only when the SPA is hosted separately from the API

MongoDB Atlas must accept connections from Vercel's rotating egress addresses, i.e. an IP access list entry of
`0.0.0.0/0`; otherwise the function boots and reports `database: disconnected`.

```bash
npx vercel link --yes --project rentcar
grep '^MONGODB_URI=' backend/.env | cut -d= -f2- | tr -d '\r\n' | npx vercel env add MONGODB_URI production --sensitive
npx vercel env add JWT_SECRET production --sensitive          # pipes a fresh secret, nothing is echoed
npx vercel deploy --prod --yes
```

Only the root runtime dependencies are installed on Vercel — `backend/package.json` devDependencies are not —
so `mongodb-memory-server` never reaches the function. `vercel@52` is the CLI version used here; the current
`latest` fails on Node 20.11 because it `require()`s an ES module, which needs Node 20.19+.
