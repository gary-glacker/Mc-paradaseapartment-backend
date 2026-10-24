# MC Paradise — Backend

Express + MongoDB API that stores booking requests from the website and feeds
the admin dashboard. Organised as a small MVC: **models** (Mongoose schemas),
**controllers** (business logic) and **routes** (HTTP endpoints).

## Requirements

- **Node.js 18+**
- **MongoDB** running locally (or a MongoDB Atlas connection string)

## Run it

```bash
cd backend
npm install
npm start          # or: npm run dev  (auto-restart on change)
```

API listens on **http://localhost:4000**.

## Configuration

Copy `.env.example` to `.env` and adjust as needed:

| Variable         | Default                                      | Purpose                          |
| ---------------- | -------------------------------------------- | -------------------------------- |
| `MONGODB_URI`    | `mongodb://127.0.0.1:27017/mc_paradise`      | MongoDB connection string        |
| `PORT`           | `4000`                                       | API port                         |
| `ADMIN_USERNAME` | `admin`                                      | Admin username (first run)       |
| `ADMIN_PASSWORD` | `admin123`                                   | Admin password (first run)       |
| `ADMIN_NAME`     | `Administrator`                              | Admin display name (first run)   |

### Email (SMTP)

Optional. Leave `SMTP_HOST` empty and the app runs normally — it simply logs
that it skipped the message. When configured, a new booking triggers:

- a **confirmation email to the guest** (reference, room, dates, total and the
  front-desk number), and
- a **heads-up to every staff account that has an email address on file**
  (set one per person in **Dashboard → Staff accounts**).

| Variable          | Default                     | Purpose                                  |
| ----------------- | --------------------------- | ---------------------------------------- |
| `SMTP_HOST`       | *(empty — email disabled)*  | SMTP server hostname                     |
| `SMTP_PORT`       | `587`                       | SMTP port                                |
| `SMTP_SECURE`     | `false`                     | `true` for port 465 (implicit TLS)       |
| `SMTP_USER`       | *(empty)*                   | SMTP username                            |
| `SMTP_PASSWORD`   | *(empty)*                   | SMTP password / app password             |
| `SMTP_TLS_RELAXED`| `false`                     | Accept a local antivirus TLS certificate |
| `MAIL_FROM`       | falls back to `SMTP_USER`   | The “from” address guests see            |
| `PUBLIC_SITE_URL` | `http://localhost:4000`     | Used for links inside emails             |
| `SUPPORT_PHONE`   | `+250 788 382 569`          | Front-desk number quoted to the guest    |

**Email never blocks a booking.** If a send fails the booking is still saved
and the guest still sees success; the failure is logged and recorded as a
notification. Every send (or failure) is printed to the server console.

> **Antivirus TLS interception.** If you see
> `self-signed certificate in certificate chain`, an antivirus suite (Avast,
> Kaspersky, ESET…) is scanning your mail over TLS and presenting its own
> certificate. Set `SMTP_TLS_RELAXED=true` to accept that local certificate.
> Leave it `false` in production or on a normal network.

> **Gmail `from` address.** Gmail rejects a sender that does not match the
> authenticated account, so set `MAIL_FROM` to the same address as `SMTP_USER`
> when using Gmail.

### Image uploads (Cloudinary)

Customer ID/passport photos (Customers) and room photos (Rooms) are uploaded to
[Cloudinary](https://cloudinary.com). **Uploads are signed by the server**, so
the API secret never leaves the backend — the browser asks for a signature and
posts the file straight to Cloudinary.

| Variable                 | Default       | Purpose                                  |
| ------------------------ | ------------- | ---------------------------------------- |
| `CLOUDINARY_CLOUD_NAME`  | *(empty)*     | Cloud name (Dashboard → Credentials)     |
| `CLOUDINARY_API_KEY`     | *(empty)*     | API key                                  |
| `CLOUDINARY_API_SECRET`  | *(empty)*     | API secret — never sent to the browser   |
| `CLOUDINARY_FOLDER`      | `mc-paradise` | Folder prefix; uploads land in `<folder>/<purpose>` |

Leave the three credentials empty and the rest of the app keeps working: the
upload fields explain that Cloudinary is not configured, and `POST
/api/uploads/sign` answers `503`. Set them and restart the API to enable
uploads. Administrators can check the live state from **Dashboard → Settings →
Images**.

The admin account is only created the first time the API starts against an
empty database. Change the password afterwards from **Dashboard → Settings**.

## Layout

```
backend/
├── server.js                 app wiring: middleware, routers, static site, boot
├── config/
│   └── db.js                 connection + legacy migrations
├── models/                   one Mongoose schema per file (+ index.js)
│   ├── Admin.js  Session.js  Booking.js  Notification.js  Page.js  Property.js
│   ├── Customer.js  CustomerSession.js  Room.js  Tenancy.js
│   ├── Maintenance.js  Payment.js
├── controllers/              request handlers, one module per resource
│   ├── authController.js      bookingController.js   notificationController.js
│   ├── pageController.js      propertyController.js  statsController.js
│   ├── customerController.js  roomController.js      tenancyController.js
│   ├── maintenanceController.js  paymentController.js  staffController.js
│   ├── uploadController.js   Cloudinary config + signed-upload endpoint
├── routes/                   express Routers, mounted under /api
│   ├── index.js  authRoutes.js  bookingRoutes.js  notificationRoutes.js
│   ├── pageRoutes.js  propertyRoutes.js  statsRoutes.js
│   ├── customerRoutes.js  portalRoutes.js  roomRoutes.js  tenancyRoutes.js
│   ├── maintenanceRoutes.js  paymentRoutes.js  reportRoutes.js  staffRoutes.js
│   ├── uploadRoutes.js
├── middleware/
│   ├── asyncHandler.js        forwards rejected promises to the error handler
│   ├── requireAuth.js         verifies the staff Bearer session token
│   ├── requireCustomer.js     customer Bearer auth + `requireRole(...roles)`
│   ├── requireScope.js        `adminOnly` / `frontDesk` role scopes per route
│   └── errorHandler.js        maps thrown errors to JSON responses
└── utils/
    ├── auth.js               scrypt hashing, tokens, TTL
    ├── cloudinary.js         signed uploads + public config (no secret shipped)
    ├── mailer.js             SMTP transport + booking email templates
    └── helpers.js            validation/formatting helpers, `notify`, `actorOf`
```

`server.js` contains no business logic — it only mounts `routes/index.js` under
`/api`, serves the built website, and runs the boot sequence.

## Database

Collections (managed with Mongoose):

| Collection      | Contents                                                   |
| --------------- | ---------------------------------------------------------- |
| `admins`        | Dashboard users (scrypt-hashed passwords, optional email)  |
| `sessions`      | Staff Bearer tokens; auto-expire via a MongoDB TTL index   |
| `bookings`      | Every booking request from the website                     |
| `notifications` | Dashboard alerts, each recording the actor and the action  |
| `pages`         | Site sections and their published/hidden state             |
| `properties`    | Residences the manager rents out                           |
| `rooms`         | The physical lettable units (9 rooms, per-night rate)      |
| `customers`     | Registered guests with a portal login                       |
| `customersessions` | **Separate** Bearer tokens for the tenant portal         |
| `tenancies`     | A confirmed stay: room, dates, rent, agreement, checklist  |
| `maintenances`  | Repair requests raised by tenants from the portal          |
| `payments`      | Receipts against a tenancy (bank / mobile money / cash)    |

Documents are returned to the client with `id` (string) instead of `_id`, and
`createdAt`/`updatedAt` as ISO strings.

### Roles

Two staff roles exist. `Reception` is a normal staff account the Admin creates;
customer accounts are assigned the `customer` role by reception at registration.

| Capability                                             | Admin | Reception |
| ------------------------------------------------------ | :---: | :-------: |
| Overview, bookings, check-in & tenancies, customers     |   ✓   |     ✓     |
| Rooms                                                   |   ✓   |     ✓     |
| Maintenance                                             |   ✓   |     ✓     |
| Financial reports                                       |   ✓   |     ✓     |
| Notifications                                           |   ✓   |     ✓     |
| Own account settings                                    |   ✓   |     ✓     |
| **Properties**                                          |   ✓   |     ✗     |
| **Site pages**                                          |   ✓   |     ✗     |
| **Staff accounts** (create / update / delete / reset)   |   ✓   |     ✗     |
| Clear the whole notification feed                       |   ✓   |     ✗     |

Reception’s scope is the **front desk**: everything needed to take a booking and
run a tenancy, but not the building definition, the website controls or the
staff roster. The allowed list lives in
`middleware/requireScope.js` (`FRONT_DESK`) and is mirrored in the UI by
`Frontend/src/admin/permissions.ts`, so a new route is closed to reception until
someone deliberately opens it.

Role checks are enforced **server-side** — a restricted action returns
`403 { error: "Your role does not allow this action.", required: ["Admin"] }`,
not merely a hidden button.

### Bookings are assigned by reception, never automatically

A website booking is stored **`pending` with no room attached**. The room,
tenant and agreement are all decided by reception on the Check-in page, which
lists the outstanding requests under **“N booking(s) awaiting assignment”** —
every `pending` or `confirmed` apartment booking that has no room yet.

The room a guest asked for is kept as a **preference** in `requestedRoom` /
`requestedRoomNumber`; the assignment fields `room` / `roomNumber` stay empty
until the front desk allocates a unit — via the tenancy wizard, or by sending
`roomId` to `PATCH /api/bookings/:id`. Confirming the booking does **not**
assign a room; it only moves the request into the reception queue.

### Notifications record who did what

Every notification carries the **actor** and the **action**, so the feed is a
usable audit trail:

| Field    | Meaning                                                        |
| -------- | -------------------------------------------------------------- |
| `action` | Short verb phrase, e.g. `Room assigned`, `Booking confirmed`   |
| `actor`  | Who caused it — a staff name, `Website guest`, or `System`     |
| `role`   | Their role at the time (`Admin`, `Reception`, `Guest`)         |
| `source` | `staff` · `guest` · `system`                                   |

Controllers build this with `actorOf(req, { action })` (see `utils/helpers.js`);
`notify(title, body, ref, actor)` stores it.

### Rooms and pricing

Rooms are discrete physical units, distinct from `properties` (which remains the
public marketing residence). Each room carries its bed count and nightly rate:

| Room            | Type             | Beds | Rate (USD / night) |
| --------------- | ---------------- | ---- | ------------------ |
| R-101 … R-105   | Two-bed apartment | 2    | 80                 |
| R-106 … R-109   | One-bed studio    | 1    | 50                 |

Nine rooms, fourteen beds in total. A room cannot be double-booked: creating an
overlapping tenancy returns `409`, and `?force=true` overrides deliberately.

### Tenancies and the tenant portal

A `tenancy` is the confirmed stay created by reception from the **Check-in &
tenancies** page. It holds the room, entry/exit dates, nightly rate, computed
total, a signed rental agreement and a handover checklist.

- **Every tenancy includes free gym access**, granted automatically and valid
  while the stay is active. The tenant portal shows the gym pass with its expiry.
- Signing the agreement (on-screen, typed name) **auto-activates** the tenancy and
  unlocks the gym pass. The rendered agreement embeds the tenant's national ID.
- Tenants sign in at `/portal/login` with their **phone number or national ID**
  plus the password reception set. They see their stay, days remaining, balance,
  payments, the agreement, and can raise maintenance requests.
- Staff and customer sessions live in **separate collections with separate
  middleware**, so a portal token can never reach the staff API (it gets `401`).

### Payments

Payments are recorded against a tenancy and accepted by **bank transfer, mobile
money, or cash** (card is also available). Payments are **voided, never deleted**,
so the ledger stays auditable. `DELETE /api/payments/:id` exists but is
deliberately awkward to reach from the UI.

#### A paid booking becomes a receipt

A booking's `payment.status` is only a flag on the booking. The financial report
sums the `Payment` collection, so flagging alone would hide the money. When
reception marks a booking **paid** (from the Bookings drawer, using **Mark paid**),
the API writes a real receipt **linked to that booking**, and it appears at once
in **Financial reports** — under collected, by method, by purpose, by room, and
in the CSV ledger.

- **Amount:** `amountPaid` when reception typed one, otherwise the booking total.
- **Reversal:** setting the booking back to `unpaid`/`partial`, cancelling it, or
  deleting it **voids** the receipt instead of deleting it, so the audit trail
  and the report still balance. A voided receipt shows as *“reversed, no longer
  in the report”*.
- The receipt reference (`receiptRef`) is returned on every booking payload,
  alongside `receiptId` and `receiptVoided`. These are derived fields — they are
  computed on read and never written to the collection.

### Bookings

A booking keeps the **full client information** the property manager needs:

| Field               | Notes                                                        |
| ------------------- | ------------------------------------------------------------ |
| `ref`               | Reference shown to the guest (e.g. `MC-7F3K2A`)              |
| `kind`              | `apartment` \| `gym` \| `restaurant`                         |
| `status`            | `pending` \| `confirmed` \| `rejected` \| `cancelled`        |
| `property`          | Link to the residence being booked (apartment bookings)      |
| `propertyName`      | Snapshot of the residence/item name                          |
| `requestedRoom`     | The room the guest *asked for* on the website — a preference, not a reservation |
| `requestedRoomNumber` | Snapshot of that room's number                             |
| `room` / `roomNumber` | The room reception **assigned**. Empty until then          |
| `guest.*`           | Full name, phone, email, notes                               |
| `stay.*`            | **`checkIn` (entry)**, **`checkOut` (exit)**, nights, adults, children, guests, rooms |
| `schedule.*`        | `startDate` (gym) or `date`/`time`/`people` (restaurant)     |
| `payment.*`         | `status` (`unpaid`/`partial`/`paid`), method, reference, amount, paidAt |

Dates are stored as `YYYY-MM-DD` strings — the app is date-only, so no timezone
handling is needed. Apartment bookings are validated on entry/exit consistency
and against the residence's maximum occupancy.

#### From website request to tenancy

Nothing is reserved on the website. The full flow is:

1. A guest submits the booking wizard → the booking is stored **`pending`**,
   unassigned, with the requested room recorded in `requestedRoom`.
2. Staff **Confirm** the booking on the Bookings page → it becomes `confirmed`
   and still has no room.
3. Reception works in the **Check-in & tenancies** page. A panel lists
   *“N booking(s) awaiting assignment”* — every `pending`/`confirmed` apartment
   booking that has no room yet. **Allocate a room** opens the wizard already
   prefilled from that booking (dates and guests) on the room step.
4. The wizard walks through **Booking → Tenant → Room → Confirm**: register or
   find the customer, fill the information, pick a room, and **verify everything**
   on the summary (tenant, room, dates, nights, rate, total, gym, booking
   reference, booking payment status, receipt state and the balance still to
   collect).
5. **Create tenancy** signs the agreement, activates the stay and grants free
   gym access. The linked booking is marked `confirmed` with the assigned room.

`GET /api/bookings` accepts one status or several comma-separated
(`?status=pending,confirmed`), which is how the Check-in queue is loaded.


### Migrations

There is **no demo or seed content**. A fresh database starts empty: no
bookings, no residences and no site pages. Everything is created through the
dashboard, so the numbers you see are always real.

On every boot the API:

1. creates the admin account if missing (first run only),
2. migrates older bookings from the single `dates` block to `stay` / `schedule`,
3. links apartment bookings to the matching residence by name.

Site **pages** are defined in code (`SITE_SECTIONS` in `utils/helpers.js`). They
are not written to the database at boot — the dashboard creates them on demand
the first time **Site pages** is opened, and a manager's live/hidden choice is
preserved from then on.

If a legacy `backend/data/db.json` file happens to be present, it is imported
once when the bookings collection is empty. That file is not part of the repo.

## Endpoints

### Public
| Method | Path                       | Purpose                                        |
| ------ | -------------------------- | ---------------------------------------------- |
| GET    | `/api/health`              | Liveness probe                                 |
| POST   | `/api/bookings`            | Submit a booking from the website              |
| GET    | `/api/bookings/lookup`     | Guest checks a booking (`ref` + `phone`)       |
| GET    | `/api/bookings/availability`| Is a residence free (`property`,`checkIn`,`checkOut`) |
| GET    | `/api/properties/public`   | Bookable residences for the website            |
| GET    | `/api/rooms/public`        | Available rooms with bed counts and rates      |
| GET    | `/api/pages`               | Published/hidden state of the site pages       |

A website booking may carry either a `propertyId` (a residence slug) **or** a
`roomId` (a room's `_id`). When a `roomId` is sent it is recorded as the guest's
**preference** — `requestedRoom` / `requestedRoomNumber` are stored and
`propertyName` becomes the room's name — while `room` / `roomNumber` stay empty.
The party size is validated against the room's `maxGuests`. Reception therefore
sees exactly which unit a guest requested, without anything being reserved.

The booking is saved **`pending` and unassigned** — nothing is reserved. Its
response triggers (a) a notification naming the guest as the actor, (b) a
confirmation email to the guest, and (c) an alert to every staff member with an
email on file. Email failures are logged and recorded, never returned to the
guest.

### Tenant portal (requires a **customer** token, not a staff token)
| Method | Path                        | Purpose                                  |
| ------ | --------------------------- | ---------------------------------------- |
| POST   | `/api/portal/login`         | Sign in with phone/national ID + password |
| GET    | `/api/portal/me`            | Current customer                          |
| POST   | `/api/portal/logout`        | End the portal session                    |
| GET    | `/api/portal/dashboard`     | Stay, days remaining, balance, gym pass   |
| GET    | `/api/portal/tenancy`       | Current tenancy + agreement               |
| GET    | `/api/portal/payments`      | Receipts recorded against the tenant      |
| GET    | `/api/portal/maintenance`   | The tenant's own requests                 |
| POST   | `/api/portal/maintenance`   | Raise a new repair request                |

### Staff (requires `Authorization: Bearer <token>`)
| Method | Path                      | Purpose                              |
| ------ | ------------------------- | ------------------------------------ |
| POST   | `/api/auth/login`         | Sign in, returns token               |
| GET    | `/api/auth/me`            | Current user                         |
| POST   | `/api/auth/logout`        | End session                          |
| POST   | `/api/auth/password`      | Change password                      |
| PUT    | `/api/auth/profile`       | Update name / username               |
| GET    | `/api/uploads/config`     | Cloudinary state + public config (no secret) |
| POST   | `/api/uploads/sign`       | Sign one upload (`purpose`) — `503` if unconfigured |
| GET    | `/api/staff`              | List staff accounts                  |
| POST   | `/api/staff`              | Create a staff account (**Admin**)   |
| PATCH  | `/api/staff/:id`          | Update name / role (**Admin**)       |
| POST   | `/api/staff/:id/password` | Reset a staff password (**Admin**)   |
| DELETE | `/api/staff/:id`          | Delete a staff account (**Admin**)   |
| GET    | `/api/customers`          | List registered customers (`q`,`type`) |
| POST   | `/api/customers`          | Register a customer (name, national ID, phone, password) |
| GET    | `/api/customers/:id`      | One customer                         |
| PATCH  | `/api/customers/:id`      | Update a customer                    |
| GET    | `/api/rooms`              | Rooms with live occupancy            |
| POST   | `/api/rooms`              | Create a room                        |
| POST   | `/api/rooms/bulk`         | Create many rooms at once            |
| GET    | `/api/rooms/availability` | Free rooms for a date range          |
| PATCH  | `/api/rooms/:id`          | Update a room                        |
| DELETE | `/api/rooms/:id`          | Delete a room                        |
| GET    | `/api/tenancies`          | List tenancies (`status`,`q`)        |
| POST   | `/api/tenancies`          | Confirm a stay (409 if the room is taken) |
| GET    | `/api/tenancies/:id`      | One tenancy                          |
| PATCH  | `/api/tenancies/:id`      | Update dates / rate / status         |
| POST   | `/api/tenancies/:id/sign` | Sign the agreement (activates + gym) |
| POST   | `/api/tenancies/:id/end`  | Check out / end the stay             |
| GET    | `/api/tenancies/:id/agreement` | Rendered rental agreement       |
| POST   | `/api/tenancies/:id/requirements` | Tick the handover checklist   |
| DELETE | `/api/tenancies/:id`      | Delete a tenancy                     |
| GET    | `/api/maintenance`        | Reception queue + stats              |
| PATCH  | `/api/maintenance/:id`    | Triage (open → in progress → resolved) |
| GET    | `/api/payments`           | Payment ledger                       |
| POST   | `/api/payments`           | Record a payment                     |
| POST   | `/api/payments/:id/void`  | Void a payment (auditable, not deleted) |
| GET    | `/api/reports/financial`  | Collected vs outstanding, method/room breakdown, ledger |
| GET    | `/api/reports/summary`    | Dashboard counters for the overview  |
| GET    | `/api/bookings`           | List bookings (`kind`,`status`,`q`,`from`,`to`,`property`; `status` accepts a comma-separated list; search matches `ref`, `item`, `propertyName`, `roomNumber`, guest name/phone/email) |
| GET    | `/api/bookings/:id`       | One booking (incl. derived `receiptRef`/`receiptVoided`) |
| PATCH  | `/api/bookings/:id`       | Change status / payment / residence / assigned room. Marking `paid` raises a receipt; leaving `paid` or cancelling voids it |
| DELETE | `/api/bookings/:id`       | Delete booking (voids any linked receipt) |
| GET    | `/api/properties`         | Residences with occupancy counters   |
| POST   | `/api/properties`         | Create a residence                   |
| GET    | `/api/properties/:id`     | Residence + its bookings             |
| PATCH  | `/api/properties/:id`     | Update a residence                   |
| DELETE | `/api/properties/:id`     | Delete (409 while bookings reference it; `?force=true` to detach) |
| GET    | `/api/notifications`      | Notifications + unread count (incl. actor/action) |
| POST   | `/api/notifications/read` | Mark read (all, or by `id`)          |
| DELETE | `/api/notifications`      | Clear the feed (**Admin only**)      |
| GET    | `/api/pages/admin`        | Site pages incl. per-page counters   |
| PATCH  | `/api/pages/:slug`        | Publish / hide a section             |
| GET    | `/api/stats`              | Dashboard counters                   |

## Production

When a build exists in `Frontend/dist`, the API also serves the built website
(with an SPA fallback), so a single process hosts both the site and the API:

```bash
cd Frontend
npm run build      # produces Frontend/dist
cd ../backend
npm start          # serves the site + API on :4000
```
