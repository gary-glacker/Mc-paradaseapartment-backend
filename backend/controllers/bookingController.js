import mongoose from 'mongoose'
import { Booking, Payment, Property, Room } from '../models/index.js'
import { samePhoneTail } from './customerController.js'
import { newBookingRef, newPaymentRef } from '../utils/auth.js'
import {
  BOOKING_KINDS,
  BOOKING_STATUSES,
  actorOf,
  digits,
  escapeRegex,
  int,
  isoDate,
  nightsBetween,
  notify,
  str,
} from '../utils/helpers.js'
import { guestBookingEmail, sendMail, staffBookingEmail, staffRecipients } from '../utils/mailer.js'
import { currencyConfig } from '../utils/currency.js'

/** Bookings are priced in the base currency; resolve it once. */
const baseCurrency = async () => (await currencyConfig()).base

/* ------------------------------------------------------------------ */
/* Shaping                                                             */
/* ------------------------------------------------------------------ */

/** The subset of a booking a guest may see about their own reservation. */
const publicBooking = (b) => ({
  ref: b.ref,
  kind: b.kind,
  status: b.status,
  item: b.item,
  detail: b.detail,
  total: b.total,
  currency: b.currency,
  propertyName: b.propertyName,
  roomNumber: b.roomNumber ?? '',
  guest: { fullName: b.guest?.fullName ?? '' },
  stay: b.stay,
  schedule: b.schedule,
  payment: { method: b.payment?.method ?? '', status: b.payment?.status ?? 'unpaid' },
  createdAt: b.createdAt,
  updatedAt: b.updatedAt,
})

/** Build the entry/exit block, preferring nested values then flat ones. */
const buildStay = (b) => {
  const src = b.stay ?? {}
  const checkIn = isoDate(src.checkIn ?? b.checkIn)
  const checkOut = isoDate(src.checkOut ?? b.checkOut)
  const adults = int(src.adults ?? b.adults)
  const children = int(src.children ?? b.children)
  const guests = int(src.guests ?? b.guests) || adults + children

  return {
    checkIn,
    checkOut,
    nights: int(src.nights ?? b.nights) || nightsBetween(checkIn, checkOut),
    adults,
    children,
    guests,
    rooms: int(src.rooms ?? b.rooms) || 1,
  }
}

/** Build the one-off schedule block used by gym and restaurant bookings. */
const buildSchedule = (b) => {
  const src = b.schedule ?? {}
  return {
    startDate: isoDate(src.startDate ?? b.startDate),
    date: isoDate(src.date ?? b.date),
    time: str(src.time ?? b.time, 12) || null,
    people: int(src.people ?? b.people),
  }
}

/* ------------------------------------------------------------------ */
/* Public                                                              */
/* ------------------------------------------------------------------ */

/**
 * POST /api/bookings
 * Called by the website once a guest confirms. Every request is stored,
 * including the entry and exit dates for a stay.
 */
export async function createBooking(req, res) {
  const b = req.body ?? {}
  const kind = BOOKING_KINDS.includes(b.kind) ? b.kind : null
  if (!kind) return res.status(400).json({ error: 'Unknown booking type.' })

  const fullName = str(b.fullName, 120)
  const phone = str(b.phone, 40)
  if (!fullName) return res.status(400).json({ error: 'Full name is required.' })
  if (!phone) return res.status(400).json({ error: 'Phone number is required.' })

  const stay = buildStay(b)
  const schedule = buildSchedule(b)

  /* An apartment booking must describe a real stay. */
  if (kind === 'apartment') {
    if (!stay.checkIn) return res.status(400).json({ error: 'An entry (check-in) date is required.' })
    if (!stay.checkOut) return res.status(400).json({ error: 'An exit (check-out) date is required.' })
    if (stay.nights < 1) return res.status(400).json({ error: 'The exit date must be after the entry date.' })
    if (stay.guests < 1) return res.status(400).json({ error: 'At least one guest is required.' })
  }

  /* Link the residence when the guest chose one. */
  let property = null
  const propertySlug = str(b.propertyId ?? b.apartmentId ?? b.property, 80).toLowerCase()
  if (propertySlug) {
    property = await Property.findOne({ slug: propertySlug })
    if (property && stay.guests > property.guests) {
      return res.status(400).json({ error: `This residence fits up to ${property.guests} guests.` })
    }
  }

  /*
   * The website books discrete rooms, so a booking may arrive with a room
   * id instead of a property slug. Resolve it so reception sees which room
   * was requested, and validate the party size against the room — but do
   * NOT assign it. Nothing is reserved until reception picks the room on
   * the Check-in page.
   */
  let room = null
  const roomId = b.roomId ?? b.propertyId
  if (!property && mongoose.isValidObjectId(roomId)) {
    room = await Room.findById(roomId)
    if (room && stay.guests > room.maxGuests) {
      return res.status(400).json({ error: `This room fits up to ${room.maxGuests} guests.` })
    }
  }

  const doc = {
    kind,
    status: 'pending',
    property: property?._id ?? null,
    propertyName: property?.name ?? room?.name ?? str(b.item, 80),
    /* The guest's preference only — reception assigns the real room later. */
    requestedRoom: room?._id ?? null,
    requestedRoomNumber: room?.number ?? '',
    room: null,
    roomNumber: '',
    item: str(b.item, 120),
    detail: str(b.detail, 160),
    total: int(b.total),
    /* Bookings are always priced in the base currency. */
    currency: (await baseCurrency()),
    guest: {
      fullName,
      phone,
      email: str(b.email, 160).toLowerCase(),
      notes: str(b.notes, 600),
    },
    stay,
    schedule,
    payment: { method: str(b.paymentMethod, 20), status: 'unpaid' },
  }

  /* Retry a couple of times in the unlikely event of a reference collision. */
  let booking = null
  let lastErr = null
  for (let attempt = 0; attempt < 4 && !booking; attempt += 1) {
    try {
      booking = await Booking.create({ ...doc, ref: str(b.ref, 24) || newBookingRef() })
    } catch (err) {
      if (err?.code !== 11000) throw err
      lastErr = err
      doc.ref = undefined // next attempt generates a fresh one
    }
  }
  if (!booking) throw lastErr ?? new Error('Could not create the booking.')

  /*
   * A website booking never allocates a room. It stays `pending` and
   * unassigned until reception picks it up on the Check-in page, which
   * is where the room, the tenant and the agreement are decided.
   * `propertyName`/`roomNumber` here only record what the guest ASKED
   * for — nothing is reserved.
   */
  const requestedRoom = room?.number || booking.requestedRoomNumber || booking.item || kind

  await notify(
    `New ${kind} booking — needs a room`,
    `${booking.ref} — ${fullName} requested ${requestedRoom}. Awaiting reception.`,
    booking.ref,
    actorOf(req, { source: 'guest', action: 'Booking submitted' }),
  )

  /* Email the guest and the staff. Failures must never break the booking. */
  void sendBookingEmails(booking).catch((err) => {
    console.error(`[mail] booking ${booking.ref} email step threw: ${err?.message}`)
  })

  res.status(201).json({ booking })
}

/**
 * Emails the guest a confirmation and alerts every staff member with an
 * address on file. Runs after the response — a failure here is logged
 * and recorded as a notification, never surfaced to the guest.
 */
async function sendBookingEmails(booking) {
  const guestEmail = booking.guest?.email

  if (guestEmail) {
    const { subject, html, text } = guestBookingEmail(booking, supportPhone())
    const res = await sendMail({ to: guestEmail, subject, html, text })
    if (!res.sent) {
      console.warn(`[mail] guest confirmation for ${booking.ref} not sent: ${res.reason}`)
      await notify(
        'Guest email not sent',
        `${booking.ref} — could not email ${guestEmail}: ${res.reason}`,
        booking.ref,
        actorOf(null, { source: 'system', action: 'Email failed' }),
      )
    }
  }

  try {
    const recipients = await staffRecipients()
    if (recipients.length === 0) return
    const { subject, html, text } = staffBookingEmail(booking, booking.guest?.phone)
    const res = await sendMail({ to: recipients, subject, html, text })
    if (!res.sent) {
      console.warn(`[mail] staff alert for ${booking.ref} not sent: ${res.reason}`)
      await notify(
        'Staff email not sent',
        `${booking.ref} — could not alert staff: ${res.reason}`,
        booking.ref,
        actorOf(null, { source: 'system', action: 'Email failed' }),
      )
    }
  } catch (err) {
    console.warn(`[mail] staff alert for ${booking.ref} threw: ${err?.message}`)
  }
}

/** The front-desk number shown in the guest's confirmation email. */
function supportPhone() {
  return process.env.SUPPORT_PHONE || '+250 788 382 569'
}

/**
 * Keep the money on a booking visible to the financial report.
 *
 * A booking's `payment.status` is only a flag; the report sums the
 * `Payment` collection. So when reception marks a booking paid we write
 * a real receipt linked to the booking, and when the booking is no
 * longer paid we VOID that receipt (never delete it) so the audit trail
 * and the report still balance.
 *
 * `amountPaid` wins when reception typed an amount, otherwise the
 * booking total is used. Returns the linked receipt, if any.
 */
async function syncBookingReceipt(booking, req) {
  const status = booking.payment?.status ?? 'unpaid'
  const recorded = booking.payment?.amountPaid
  const amount = Number(recorded) > 0 ? Number(recorded) : Number(booking.total) || 0

  /* Existing receipt for this booking, if one was ever written. */
  const existing = await Payment.findOne({ booking: booking._id }).sort({ createdAt: -1 })
  const actor = actorOf(req, { action: 'Booking payment recorded' })

  /* Not settled — make sure any receipt is reversed rather than left
     sitting in the report as income. */
  if (status !== 'paid') {
    if (existing && !existing.voided) {
      existing.voided = true
      existing.voidReason = `Booking ${booking.ref} is no longer marked paid`
      await existing.save()
      await notify(
        'Booking receipt voided',
        `${existing.ref} — ${booking.currency} ${existing.amount} was reversed because ${booking.ref} is ${status}.`,
        booking.ref,
        { ...actor, action: 'Booking receipt voided' },
      )
    }
    return existing ?? null
  }

  /* Nothing to record when the booking has no value yet. */
  if (amount <= 0) return existing ?? null

  const method = ['bank', 'momo', 'cash', 'card'].includes(booking.payment?.method)
    ? booking.payment.method
    : 'cash'

  /* A receipt already exists — update it instead of writing a second one. */
  if (existing) {
    existing.method = method
    existing.amount = amount
    existing.currency = booking.currency || existing.currency
    existing.reference = booking.payment?.reference || existing.reference
    existing.voided = false
    existing.voidReason = ''
    await existing.save()
    return existing
  }

  const payment = await Payment.create({
    ref: newPaymentRef(),
    booking: booking._id,
    room: booking.room ?? null,
    roomNumber: booking.roomNumber || '',
    purpose: 'rent',
    method,
    amount,
    currency: booking.currency || 'USD',
    reference: booking.payment?.reference || '',
    receivedBy: req?.admin?.name || req?.admin?.username || '',
    notes: `Booking ${booking.ref} — ${booking.guest?.fullName ?? ''}`.trim(),
    paidAt: booking.payment?.paidAt ?? new Date(),
  })

  await notify(
    'Booking paid',
    `${payment.ref} — ${booking.currency} ${amount} by ${method} received for ${booking.ref} (${booking.guest?.fullName ?? 'guest'}), recorded by ${actor.actor}${actor.role ? ` (${actor.role})` : ''}.`,
    booking.ref,
    actor,
  )

  return payment
}

/**
 * GET /api/bookings/lookup?ref=MC-XXXXXX&phone=...
 * Lets a guest check their own booking without signing in. The phone
 * number must match the one used when booking.
 */
export async function lookupBooking(req, res) {
  const ref = str(req.query.ref, 24).toUpperCase()
  const phone = str(req.query.phone, 40)
  if (!ref) return res.status(400).json({ error: 'Enter your booking reference.' })
  if (digits(phone).length < 6) {
    return res.status(400).json({ error: 'Enter the phone number you booked with.' })
  }

  const booking = await Booking.findOne({ ref: new RegExp(`^${escapeRegex(ref)}$`, 'i') })
  if (!booking || !samePhoneTail(booking.guest.phone, req.query.phone)) {
    return res.status(404).json({ error: 'No booking matches that reference and phone number.' })
  }

  res.json({ booking: publicBooking(booking) })
}

/**
 * GET /api/bookings/availability?property=<slug>&checkIn=&checkOut=
 * `propertyId` is accepted as an alias, matching POST /api/bookings.
 * True when no confirmed/pending stay overlaps the requested window.
 */
export async function checkAvailability(req, res) {
  const slug = str(req.query.property ?? req.query.propertyId, 80).toLowerCase()
  const checkIn = isoDate(req.query.checkIn)
  const checkOut = isoDate(req.query.checkOut)

  const property = await Property.findOne({ slug })
  if (!property) return res.status(404).json({ error: 'Residence not found.' })
  if (!checkIn || !checkOut) {
    return res.status(400).json({ error: 'Entry and exit dates are required.' })
  }
  if (nightsBetween(checkIn, checkOut) < 1) {
    return res.status(400).json({ error: 'The exit date must be after the entry date.' })
  }

  const clashes = await Booking.countDocuments({
    property: property._id,
    status: { $in: ['pending', 'confirmed'] },
    'stay.checkIn': { $lt: checkOut },
    'stay.checkOut': { $gt: checkIn },
  })

  res.json({ available: clashes === 0, clashes, property: { id: property.id, name: property.name } })
}

/* ------------------------------------------------------------------ */
/* Admin                                                               */
/* ------------------------------------------------------------------ */

/**
 * Attach the linked receipt (if any) onto each booking, so the UI can
 * show the ledger reference and tell reception the money has actually
 * reached the report. One query for the whole page.
 *
 * The receipt is placed at the top level of the payload rather than
 * inside `payment`, because the payment subdocument is strict and would
 * silently drop an unknown path.
 */
async function withReceipts(bookings) {
  const list = Array.isArray(bookings) ? bookings : [bookings]
  const ids = list.filter(Boolean).map((b) => b._id)
  if (ids.length === 0) return bookings

  const receipts = await Payment.find({ booking: { $in: ids } }).sort({ createdAt: 1 })
  const byBooking = new Map()
  for (const r of receipts) byBooking.set(String(r.booking), r)

  for (const b of list) {
    if (!b) continue
    const r = byBooking.get(String(b._id))
    b.set('receiptId', r ? String(r._id) : null, { strict: false })
    b.set('receiptRef', r ? r.ref : null, { strict: false })
    b.set('receiptVoided', r ? r.voided : false, { strict: false })
  }
  return bookings
}

/** GET /api/bookings — filters: kind, status, q, from, to, property */
export async function listBookings(req, res) {
  const { kind, status, q, from, to, property } = req.query
  const filter = {}

  if (BOOKING_KINDS.includes(String(kind))) filter.kind = kind

  /* One status, or several comma-separated (e.g. `pending,confirmed`). */
  const statuses = String(status ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => BOOKING_STATUSES.includes(s))
  if (statuses.length === 1) filter.status = statuses[0]
  else if (statuses.length > 1) filter.status = { $in: statuses }

  /* Arrival window — matches on the entry (check-in) date. */
  const fromDate = isoDate(from)
  const toDate = isoDate(to)
  if (fromDate || toDate) {
    filter['stay.checkIn'] = {
      ...(fromDate ? { $gte: fromDate } : {}),
      ...(toDate ? { $lte: toDate } : {}),
    }
  }

  if (property && mongoose.isValidObjectId(property)) filter.property = property

  if (q) {
    const rx = new RegExp(escapeRegex(q), 'i')
    filter.$or = [
      { ref: rx },
      { item: rx },
      { propertyName: rx },
      { roomNumber: rx },
      { 'guest.fullName': rx },
      { 'guest.phone': rx },
      { 'guest.email': rx },
    ]
  }

  /* No `.lean()` — we want each document's `toJSON` (id instead of _id). */
  const bookings = await Booking.find(filter)
    .sort({ createdAt: -1 })
    .limit(500)
    .populate('property', 'name slug status')
    .populate('room', 'number name beds maxGuests pricePerNight')

  await withReceipts(bookings)

  res.json({ bookings })
}

/** GET /api/bookings/:id */
export async function getBooking(req, res) {
  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(404).json({ error: 'Booking not found.' })
  }
  const booking = await Booking.findById(req.params.id)
    .populate('property', 'name slug status')
    .populate('room', 'number name beds maxGuests pricePerNight')
  if (!booking) return res.status(404).json({ error: 'Booking not found.' })
  await withReceipts(booking)
  res.json({ booking })
}

/**
 * PATCH /api/bookings/:id
 * Accepts `status` and/or the payment fields a manager tracks.
 */
export async function updateBooking(req, res) {
  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(404).json({ error: 'Booking not found.' })
  }
  const booking = await Booking.findById(req.params.id)
  if (!booking) return res.status(404).json({ error: 'Booking not found.' })

  const { status, payment, propertyId, roomId } = req.body ?? {}
  let paymentTouched = false

  if (BOOKING_STATUSES.includes(status) && status !== booking.status) {
    booking.status = status
    /* Name the person who made the change, and what they changed. */
    const actor = actorOf(req, { action: `Booking ${status}` })
    await notify(
      `Booking ${status}`,
      `${booking.ref} — ${booking.guest.fullName} is now ${status}. ${
        actor.source === 'staff' ? `By ${actor.actor}${actor.role ? ` (${actor.role})` : ''}.` : ''
      }`.trim(),
      booking.ref,
      actor,
    )
  }

  if (payment && typeof payment === 'object') {
    if (typeof payment.method === 'string') booking.payment.method = str(payment.method, 20)
    if (typeof payment.reference === 'string') booking.payment.reference = str(payment.reference, 60)
    if (typeof payment.amountPaid === 'number') booking.payment.amountPaid = Math.max(0, payment.amountPaid)
    if (['unpaid', 'partial', 'paid'].includes(payment.status)) {
      booking.payment.status = payment.status
      booking.payment.paidAt = payment.status === 'paid' ? new Date() : null
      /* Leaving `paid` clears the settled amount so balances read true. */
      if (payment.status === 'unpaid') booking.payment.amountPaid = 0
    }
    paymentTouched = true
  }

  /*
   * A cancelled or rejected booking can never keep its money in the
   * report, so treat that as a payment change and reverse the receipt.
   */
  if (['cancelled', 'rejected'].includes(booking.status) && booking.payment?.status === 'paid') {
    booking.payment.status = 'unpaid'
    booking.payment.paidAt = null
    booking.payment.amountPaid = 0
    paymentTouched = true
  }

  /* Re-assign the booking to another residence. */
  if (propertyId !== undefined) {
    if (!propertyId) {
      booking.property = null
    } else if (mongoose.isValidObjectId(propertyId)) {
      const property = await Property.findById(propertyId)
      if (!property) return res.status(404).json({ error: 'Residence not found.' })
      booking.property = property._id
      booking.propertyName = property.name
    }
  }

  /*
   * Reception allocating a specific room. This is the deliberate act
   * that turns a website request into a reserved unit — nothing assigns
   * a room automatically.
   */
  if (roomId !== undefined) {
    const actor = actorOf(req, { action: 'Room assigned' })
    if (!roomId) {
      booking.room = null
      booking.roomNumber = ''
      await notify(
        'Room unassigned',
        `${booking.ref} — the room was cleared by ${actor.actor}${actor.role ? ` (${actor.role})` : ''}.`,
        booking.ref,
        { ...actor, action: 'Room unassigned' },
      )
    } else if (mongoose.isValidObjectId(roomId)) {
      const room = await Room.findById(roomId)
      if (!room) return res.status(404).json({ error: 'Room not found.' })
      if (Number(booking.stay?.guests) > room.maxGuests) {
        return res.status(400).json({ error: `This room fits up to ${room.maxGuests} guests.` })
      }
      booking.room = room._id
      booking.roomNumber = room.number
      booking.propertyName = room.name
      await notify(
        'Room assigned',
        `${booking.ref} — ${actor.actor}${actor.role ? ` (${actor.role})` : ''} assigned room ${room.number} (${room.name}).`,
        booking.ref,
        actor,
      )
    }
  }

  await booking.save()

  /* Once the flag is settled, make the money show up in the report. */
  if (paymentTouched) await syncBookingReceipt(booking, req)

  await booking.populate('property', 'name slug status')
  await booking.populate('room', 'number name beds maxGuests pricePerNight')
  await withReceipts(booking)
  res.json({ booking })
}

/** DELETE /api/bookings/:id */
export async function deleteBooking(req, res) {
  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(404).json({ error: 'Booking not found.' })
  }
  const removed = await Booking.findByIdAndDelete(req.params.id)
  if (!removed) return res.status(404).json({ error: 'Booking not found.' })

  /* Never leave money floating: reverse any receipt this booking raised. */
  await Payment.updateMany(
    { booking: removed._id, voided: false },
    { $set: { voided: true, voidReason: `Booking ${removed.ref} deleted` } },
  )

  res.json({ ok: true })
}
