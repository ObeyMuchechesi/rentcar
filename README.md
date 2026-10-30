# Car Rental System

A two-sided car rental platform: a public booking site for renters and a back-office console for the branch,
backed by an Express API on MongoDB. Branches are international, so every price, quote and revenue figure is
carried in the currency of the branch it belongs to.

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
seats, luggage, `dailyRate`, refundable `deposit`, `mileageLimitKm`, and a status of `available` /
`maintenance` / `retired`. A car belongs to a branch, which is a `location` plus an ISO-3166 `country`, and is
priced in its own ISO-4217 `currency` — that is what makes the same platform work in Johannesburg and Tokyo.

**User** — `customer` or `manager`. Passwords are bcrypt-hashed and stored in `passwordHash`, which is
`select: false` so a hash never leaves the database by accident. Contact details are international: `phone` is
normalised to E.164 on write, `country` and `drivingLicenceCountry` are ISO-3166 alpha-2, and a licence number is
stored verbatim because every country formats its own. Deactivating a user (`active: false`) blocks sign-in
without deleting their booking history.

**Booking** — links a customer to a vehicle for a half-open interval `[pickUpDate, returnDate)`. Carries a human
reference `code` (`RC-XXXXXXXX`), the branch pair, the frozen `currency`, a frozen price `breakdown`, and a
status. Two booleans record the signatures: `customerAccepted` and `managerApproved`.

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
- extras: additional driver 16% of the daily rate per day, child seat 10% — percentages, because a flat
  $8/day is generous in one market and worthless in another
- `rentalTotal` = gross − discount + extras; the deposit is quoted separately and never part of the total

Everything is in the vehicle's own currency and nothing is ever converted: a quote has to be payable in the
money the branch actually takes. The total is copied onto the booking at creation, so later rate changes cannot
rewrite history.

### Status lifecycle

A rental needs two yeses. The renter signs the quote (`customerAccepted`) and the branch approves the booking
(`managerApproved`); when both are true the status becomes `confirmed`.

```
pending ──(both signatures)──> confirmed ──> picked_up ──> returned
   │  renter says no ─────────> cancelled
   │  branch says no ─────────> declined
   └── counter: no_show
```

Either side can still say no until the car is handed over (`pending` and `confirmed` are decidable); after that
only the counter lifecycle applies. `declinedBy` records who said no, and the virtual `awaiting` field answers
`'customer' | 'manager' | null` — so a branch can list "what is waiting on me" with
`GET /api/bookings/all?awaiting=manager`. A booking taken at the counter for a renter who is not present starts
with `customerAccepted: false`, and their signature on the dashboard is what confirms it.

Terminal states cannot move, and the allowed set is enforced server-side rather than by hiding buttons.

### Money across currencies

Revenue, per-branch turnover and a renter's lifetime spend are all grouped **strictly per currency** and never
summed together (`backend/src/routes/stats.js:15`), because adding `R12,000` to `£300` produces a number that
means nothing. The API returns one entry per currency; the UI formats each with `Intl.NumberFormat` in its own
currency.

### Access control

| Route | Anonymous | Customer | Manager |
| --- | --- | --- | --- |
| `GET /api/vehicles`, `/locations`, `/:id`, `/:id/quote` | yes | yes | yes (`status=all` also shows retired) |
| `POST /api/auth/register` | yes | — | — (always yields a `customer`) |
| `GET`/`PATCH /api/auth/me` | — | own profile | own profile |
| `GET /api/bookings/mine`, `POST /api/bookings`, `POST /:id/cancel`, `POST /:id/decision` | — | own records | own records |
| `GET /api/bookings/all`, `PATCH /api/bookings/:id/status` | — | — | yes |
| `POST/PATCH/DELETE /api/vehicles` | — | — | yes |
| `GET/POST/PATCH/DELETE /api/auth/accounts` | — | — | yes |
| `GET /api/stats/*` | — | — | yes |

`role` comes from the verified JWT and the request body can never set it: self-registration always creates a
`customer`, and only the accounts desk can grant or revoke `manager`. Attaching a booking to another account
(`customerId`) is manager-only, which is how a walk-in booking is taken. Three guards keep the back office from
locking itself out: you cannot deactivate or delete the account you are signed in with, an account with bookings
on file must be suspended rather than deleted, and the last active manager cannot be demoted, suspended or
removed.

## API

```
GET    /api/health                    liveness + database state
POST   /api/auth/register             self-service customer account (role is never taken from the body)
POST   /api/auth/login                -> { token, user }
GET    /api/auth/me                   current account
PATCH  /api/auth/me                   own profile; changing email or password needs `currentPassword`
GET    /api/vehicles                  search; filters: country, location, vehicleClass, transmission, fuel,
                                      minSeats, maxDailyRate, sort, startDate/endDate, status (manager)
GET    /api/vehicles/locations        branches: location + country + currency + vehicle count
GET    /api/vehicles/:id              detail, optional availability for a window
GET    /api/vehicles/:id/quote        priced window in the branch currency + whether the car is free
POST   /api/vehicles                  manager: add to fleet
PATCH  /api/vehicles/:id              manager: update (rate locked while on rent)
DELETE /api/vehicles/:id              manager: remove (blocked while active bookings exist)
POST   /api/bookings                  renter signs the quote; a manager may pass `customerId` for a walk-in
GET    /api/bookings/mine             customer: own bookings
GET    /api/bookings/all              manager: filter by status / code / customer / awaiting
GET    /api/bookings/:id              owner or manager
POST   /api/bookings/:id/decision     { action: accept | decline } from either side of the handshake
PATCH  /api/bookings/:id/status       manager: counter lifecycle transition
POST   /api/bookings/:id/cancel       owner or manager (same as a decline from their side)
GET    /api/auth/accounts             manager: list, `?role=` and `?search=`
POST   /api/auth/accounts             manager: open an account with any role
PATCH  /api/auth/accounts/:id         manager: profile, `active`, `role`, or reset a password
DELETE /api/auth/accounts/:id         manager: delete, unless the account has bookings
GET    /api/stats/overview            manager: fleet, branches, queues, revenue per currency, next pick-ups
GET    /api/stats/revenue             manager: revenue grouped by month, per currency
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

### Who sees what

- **Nobody** — the catalogue: search, branch picker with each branch's currency, vehicle detail, quote. Sign-in
  sits in the top bar as a quiet link, not a call to action, because browsing needs no account.
- **A renter** — `/dashboard`: what needs their signature, live rentals, and history, with spend totalled one
  figure per currency. `/account` is their own profile, email and password.
- **A manager** — `/admin`: operations stats and the approval queue; `/admin/bookings` the ledger plus the
  walk-in desk; `/admin/fleet`; `/admin/accounts` the accounts desk (the only place a `manager` role can be
  granted, and the only place an account can be deleted).

### Demo logins

| Role | Email | Password | Country |
| --- | --- | --- | --- |
| Manager | `manager@rental.test` | `Manager123!` | ZA |
| Manager | `ops@rental.test` | `Manager123!` | BR |
| Renter | `driver@rental.test` | `Driver123!` | ZA |
| Renter | `thando@rental.test` | `Driver123!` | ZA |
| Renter | `lihle@rental.test` | `Driver123!` | ZA |
| Renter | `jack@rental.test` | `Driver123!` | GB |
| Renter | `sofia@rental.test` | `Driver123!` | ES |
| Renter | `kenji@rental.test` | `Driver123!` | JP |
| Renter | `daniel@rental.test` | `Driver123!` | CA |

The seeded manager address is configurable (`SEED_MANAGER_EMAIL`, `SEED_MANAGER_PASSWORD`,
`SEED_CUSTOMER_PASSWORD`), and once signed in a manager changes their own email on `/account` — the test address
is not permanent. Seeding fills 26 vehicles across 14 branches in 11 countries, and leaves bookings in every
handshake state so each dashboard has something to show.

## Moving an existing database to this model

`npm run seed` **drops** users, vehicles and bookings before rebuilding — it is for a fresh database only.
`npm run migrate:global` (`backend/scripts/globalise.js:1`) is the additive path for a database that already has
real data: it stamps `country`/`currency` on vehicles that predate them, sets the two signature flags from each
booking's existing status, normalises phone numbers to E.164, and tops the fleet up to the worldwide branches. It
reports what it changed and is safe to re-run; a second pass changes nothing. It never deletes a row, and on
`NODE_ENV=production` it also declines to insert the demo renter accounts (unless `SEED_DEMO_ACCOUNTS=true`).

Legacy rows get geography inferred but money left alone: their `country` becomes `ZA` while the `currency` stays
`USD`, because the pre-worldwide build formatted every price in dollars and re-stamping them as the local currency
would silently revalue every rate and booking already on file. Re-rate a branch deliberately from the Fleet screen
if you want prices in the money it actually charges. A database that an earlier version of this script already stamped
with the local currency needs the same correction: the migration only touches documents that still lack the fields, so
re-running it will not change rows it has already written.

## Verification

```bash
npm test                       # 39 integration tests (conflicts, handshake, accounts desk, per-currency stats)
npm run build && npm start     # then:
npm run smoke                  # 34 end-to-end checks against the running stack
SMOKE_BASE_URL=https://<your-deployment> npm run smoke   # the same checks against a deployment
```

`npm run concurrency` is the cross-instance proof: it starts two separate API processes against the
same replica set and races eight identical bookings between them, three rounds, asserting exactly one 201 and one
stored booking per round. It refuses to run against a standalone server, where the answer would only prove the
in-process lock works.

Tests run against an in-memory MongoDB with `--test-concurrency=1`; spawning several instances in parallel
exceeds the mongod startup budget on Windows. The in-memory server is standalone, so the suite exercises the
lock fallback while `npm run concurrency` exercises the transaction path. The smoke script needs a reachable
server and walks the quote→book→conflict→withdraw→rebook round trip, both sides of the signature handshake, the
per-currency catalogue, and the accounts desk end to end (open an account, sign in as it, change its email,
suspend it, delete it). It cleans up after itself, but it does write — run it against a deployment you are happy
to touch.

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

`npm run migrate:global` runs against the production URI **before** this version is published. A legacy vehicle
document has no `country`, so saving it fails validation, and has no `currency`, so it gets quoted in the `USD`
default instead of the money that branch actually takes.

Only the root runtime dependencies are installed on Vercel — `backend/package.json` devDependencies are not —
so `mongodb-memory-server` never reaches the function. `vercel@52` is the CLI version used here; the current
`latest` fails on Node 20.11 because it `require()`s an ES module, which needs Node 20.19+.
