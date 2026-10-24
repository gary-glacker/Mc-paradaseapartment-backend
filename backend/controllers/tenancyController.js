import mongoose from 'mongoose'
import { Booking, Customer, Maintenance, Payment, Room, Tenancy } from '../models/index.js'
import { newTenancyRef } from '../utils/auth.js'
import { actorOf, digits, escapeRegex, int, isoDate, nightsBetween, notify, str } from '../utils/helpers.js'
import { publicRoom } from './roomController.js'

/* ------------------------------------------------------------------ */
/* Reference data                                                      */
/* ------------------------------------------------------------------ */

/** Default house rules printed on every agreement. */
export const DEFAULT_TERMS = [
  'The tenant agrees to occupy the room for the period stated above.',
  'Rent is payable per night at the rate stated above.',
  'The room is handed over clean and must be returned in the same condition.',
  'Free gym access is included for the duration of the tenancy.',
  'Noise must be kept down between 22:00 and 07:00.',
  'Any damage to the room or its furniture will be charged to the tenant.',
  'Maintenance issues must be reported through the tenant portal.',
  'The property may end the tenancy for non-payment or breach of these terms.',
]

/** What reception hands over at check-in, by default. */
export const DEFAULT_REQUIREMENTS = [
  'Room key / access card',
  'Signed rental agreement',
  'Linen and towels',
  'Gym access pass registration',
  'Emergency contact sheet',
]

/* ------------------------------------------------------------------ */
/* Shaping                                                             */
/* ------------------------------------------------------------------ */

/** The tenancy as the dashboard sees it. */
export const publicTenancy = (t) => ({
  id: String(t._id),
  ref: t.ref,
  customer: t.customer?._id ? String(t.customer._id) : t.customer ? String(t.customer) : null,
  room: t.room?._id ? String(t.room._id) : t.room ? String(t.room) : null,
  roomNumber: t.roomNumber,
  roomName: t.roomName,
  booking: t.booking?._id ? String(t.booking._id) : t.booking ? String(t.booking) : null,
  checkIn: t.checkIn,
  checkOut: t.checkOut,
  nights: t.nights,
  guests: t.guests,
  pricePerNight: t.pricePerNight,
  currency: t.currency,
  total: t.total,
  status: t.status,
  gymIncluded: t.gymIncluded,
  agreement: {
    reference: t.agreement?.reference ?? '',
    code: t.agreement?.code ?? '',
    status: t.agreement?.status ?? 'draft',
    approvedBy: t.agreement?.approvedBy ?? '',
    approvedAt: t.agreement?.approvedAt ?? null,
    signedAt: t.agreement?.signedAt ?? null,
    tenantSignature: t.agreement?.tenantSignature ?? '',
    staffSignature: t.agreement?.staffSignature ?? '',
    terms: t.agreement?.terms ?? [],
    body: t.agreement?.body ?? '',
    data: t.agreement?.data ?? {},
    docxUrl: t.agreement?.docxUrl ?? '',
    pdfUrl: t.agreement?.pdfUrl ?? '',
  },
  requirements: (t.requirements ?? []).map((r) => ({
    label: r.label,
    done: r.done,
    doneAt: r.doneAt,
  })),
  createdBy: t.createdBy,
  notes: t.notes,
  createdAt: t.createdAt,
  updatedAt: t.updatedAt,
})

/** The same record enriched for the admin table (customer + room shown). */
const expandTenancy = (t) => ({
  ...publicTenancy(t),
  customerName: t.customer?.fullName ?? '',
  customerPhone: t.customer?.phone ?? '',
  customerNationalId: t.customer?.nationalId ?? '',
  customerCode: t.customer?.code ?? '',
  roomDetail: t.room ? publicRoom(t.room) : null,
  bookingRef: t.booking?.ref ?? '',
})

/** Whole days between today and a `YYYY-MM-DD` date (negative when past). */
const daysUntil = (date) => {
  if (!date) return null
  const target = Date.parse(`${date}T00:00:00`)
  if (Number.isNaN(target)) return null
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return Math.round((target - today.getTime()) / 86_400_000)
}

/* ------------------------------------------------------------------ */
/* Agreement generation                                                */
/* ------------------------------------------------------------------ */

/**
 * Render the rental agreement body. Kept as plain text so it can be
 * shown in the dashboard, the tenant portal, or printed as-is.
 */
export function renderAgreement({ customer, room, tenancy, propertyName = 'MC Paradise Apartment' }) {
  const lines = [
    `RENTAL AGREEMENT — ${tenancy.ref}`,
    '',
    `Property: ${propertyName}`,
    `Room: ${room.number}${room.name ? ` — ${room.name}` : ''}`,
    `Beds: ${room.beds}  ·  Max guests: ${room.maxGuests}`,
    '',
    'THE TENANT',
    `Full name: ${customer.fullName}`,
    `National ID: ${customer.nationalId}`,
    `Phone: ${customer.phone}`,
    `Email: ${customer.email || '—'}`,
    `Address: ${customer.address || '—'}`,
    '',
    'THE PERIOD',
    `Entry (check-in): ${tenancy.checkIn}`,
    `Exit (check-out): ${tenancy.checkOut}`,
    `Nights: ${tenancy.nights}`,
    '',
    'THE RENT',
    `Rate per night: ${tenancy.currency} ${tenancy.pricePerNight}`,
    `Total: ${tenancy.currency} ${tenancy.total}`,
    `Gym access: ${tenancy.gymIncluded ? 'Included free of charge' : 'Not included'}`,
    '',
    'SIGNATURES',
    `Tenant: ${tenancy.agreement?.tenantSignature || '________________'}`,
    `For the property: ${tenancy.agreement?.staffSignature || '________________'}`,
  ]
  return lines.join('\n')
}

/* ------------------------------------------------------------------ */
/* Admin — tenancy management                                          */
/* ------------------------------------------------------------------ */

/** GET /api/tenancies?status=&room=&customer=&q= */
export async function listTenancies(req, res) {
  const { status = '', room = '', customer = '', q = '' } = req.query
  const query = {}

  if (status) query.status = status
  if (mongoose.isValidObjectId(room)) query.room = room
  if (mongoose.isValidObjectId(customer)) query.customer = customer
  if (q) {
    const rx = new RegExp(escapeRegex(str(q, 60)), 'i')
    query.$or = [{ ref: rx }, { roomNumber: rx }, { roomName: rx }]
  }

  const tenancies = await Tenancy.find(query)
    .sort({ createdAt: -1 })
    .limit(500)
    .populate('customer')
    .populate('room')
    .populate('booking', 'ref')

  res.json({ tenancies: tenancies.map(expandTenancy) })
}

/** GET /api/tenancies/:id */
export async function getTenancy(req, res) {
  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(404).json({ error: 'Tenancy not found.' })
  }
  const tenancy = await Tenancy.findById(req.params.id)
    .populate('customer')
    .populate('room')
    .populate('booking', 'ref')

  if (!tenancy) return res.status(404).json({ error: 'Tenancy not found.' })

  const payments = await Payment.find({ tenancy: tenancy._id, voided: false }).sort({ paidAt: -1 })
  const paid = payments.reduce((sum, p) => sum + p.amount, 0)

  res.json({
    tenancy: expandTenancy(tenancy),
    payments: payments.map((p) => p.toJSON()),
    totals: {
      paid,
      balance: Math.max(0, tenancy.total - paid),
    },
    daysRemaining: daysUntil(tenancy.checkOut),
  })
}

/**
 * POST /api/tenancies
 * The reception flow: confirm a booking by turning it into a tenancy.
 * Either `customerId` (an existing customer) or the customer fields —
 * reception can register the person in the same step.
 */
export async function createTenancy(req, res) {
  const b = req.body ?? {}

  const checkIn = isoDate(b.checkIn)
  const checkOut = isoDate(b.checkOut)
  if (!checkIn || !checkOut) {
    return res.status(400).json({ error: 'Entry and exit dates are required.' })
  }
  if (nightsBetween(checkIn, checkOut) < 1) {
    return res.status(400).json({ error: 'The exit date must be after the entry date.' })
  }

  /* Resolve the room. */
  const roomId = b.roomId ?? b.room
  if (!mongoose.isValidObjectId(roomId)) {
    return res.status(400).json({ error: 'Select a room for this tenancy.' })
  }
  const room = await Room.findById(roomId)
  if (!room) return res.status(404).json({ error: 'Room not found.' })
  if (room.status === 'maintenance') {
    return res.status(409).json({ error: `Room ${room.number} is under maintenance.` })
  }

  /* Refuse double-booking the same room. */
  const clash = await Tenancy.findOne({
    room: room._id,
    status: { $in: ['pending', 'active'] },
    checkIn: { $lt: checkOut },
    checkOut: { $gt: checkIn },
  })
  if (clash && b.force !== true) {
    return res.status(409).json({
      error: `Room ${room.number} is already booked for those dates (${clash.ref}).`,
      clash: publicTenancy(clash),
    })
  }

  /* Resolve the customer. */
  let customer = null
  if (mongoose.isValidObjectId(b.customerId)) {
    customer = await Customer.findById(b.customerId)
    if (!customer) return res.status(404).json({ error: 'Customer not found.' })
  } else {
    return res.status(400).json({ error: 'Register the customer first, then create the tenancy.' })
  }

  const nights = nightsBetween(checkIn, checkOut)
  const pricePerNight = Number(b.pricePerNight) >= 0 ? Number(b.pricePerNight) : room.pricePerNight
  const total = Number(b.total) >= 0 ? Number(b.total) : nights * pricePerNight

  const tenancy = await Tenancy.create({
    ref: newTenancyRef(),
    customer: customer._id,
    room: room._id,
    roomNumber: room.number,
    roomName: room.name,
    booking: mongoose.isValidObjectId(b.bookingId) ? b.bookingId : null,
    checkIn,
    checkOut,
    nights,
    guests: Math.max(1, int(b.guests) || 1),
    pricePerNight,
    currency: str(b.currency, 6) || room.currency || 'USD',
    total,
    status: b.status === 'active' ? 'active' : 'pending',
    gymIncluded: b.gymIncluded !== false,
    requirements: (Array.isArray(b.requirements) && b.requirements.length
      ? b.requirements
      : DEFAULT_REQUIREMENTS
    ).map((r) => ({ label: str(typeof r === 'string' ? r : r?.label, 120) })),
    agreement: { terms: DEFAULT_TERMS },
    createdBy: req.admin?.name || req.admin?.username || '',
    notes: str(b.notes, 600),
  })

  /* Link back from the booking, and mark it confirmed. */
  if (tenancy.booking) {
    await Booking.updateOne(
      { _id: tenancy.booking },
      { $set: { status: 'confirmed', room: room._id } },
    )
  }
  if (room.status === 'available') {
    room.status = 'occupied'
    await room.save()
  }

  /* Reception allocated the room — say who, and to whom. */
  const actor = actorOf(req, { action: 'Room assigned at check-in' })
  await notify(
    'Room assigned',
    `${actor.actor}${actor.role ? ` (${actor.role})` : ''} assigned Room ${room.number} to ${customer.fullName} · ${tenancy.ref} (${checkIn} → ${checkOut}).`,
    tenancy.ref,
    actor,
  )
  await notify(
    'Tenancy created',
    `${tenancy.ref} — ${customer.fullName} in Room ${room.number} (${checkIn} → ${checkOut}), created by ${actor.actor}.`,
    tenancy.ref,
    actorOf(req, { action: 'Tenancy created' }),
  )

  await tenancy.populate('customer')
  await tenancy.populate('room')
  res.status(201).json({ tenancy: expandTenancy(tenancy), daysRemaining: daysUntil(checkOut) })
}

/** PATCH /api/tenancies/:id */
export async function updateTenancy(req, res) {
  const tenancy = await Tenancy.findById(req.params.id)
  if (!tenancy) return res.status(404).json({ error: 'Tenancy not found.' })

  const b = req.body ?? {}

  if (b.checkIn !== undefined) {
    const v = isoDate(b.checkIn)
    if (!v) return res.status(400).json({ error: 'Invalid entry date.' })
    tenancy.checkIn = v
  }
  if (b.checkOut !== undefined) {
    const v = isoDate(b.checkOut)
    if (!v) return res.status(400).json({ error: 'Invalid exit date.' })
    tenancy.checkOut = v
  }
  if (nightsBetween(tenancy.checkIn, tenancy.checkOut) < 1) {
    return res.status(400).json({ error: 'The exit date must be after the entry date.' })
  }
  tenancy.nights = nightsBetween(tenancy.checkIn, tenancy.checkOut)

  if (b.roomId !== undefined && mongoose.isValidObjectId(b.roomId)) {
    const room = await Room.findById(b.roomId)
    if (!room) return res.status(404).json({ error: 'Room not found.' })
    tenancy.room = room._id
    tenancy.roomNumber = room.number
    tenancy.roomName = room.name
  }

  if (b.guests !== undefined) tenancy.guests = Math.max(1, int(b.guests))
  if (b.pricePerNight !== undefined) tenancy.pricePerNight = Math.max(0, Number(b.pricePerNight) || 0)
  if (b.gymIncluded !== undefined) tenancy.gymIncluded = Boolean(b.gymIncluded)
  if (b.notes !== undefined) tenancy.notes = str(b.notes, 600)
  if (b.total !== undefined) {
    tenancy.total = Math.max(0, Number(b.total) || 0)
  } else {
    tenancy.total = tenancy.nights * tenancy.pricePerNight
  }

  if (b.status !== undefined) {
    if (!['pending', 'active', 'ended', 'cancelled'].includes(b.status)) {
      return res.status(400).json({ error: 'Unknown tenancy status.' })
    }
    tenancy.status = b.status
  }
  if (Array.isArray(b.requirements)) {
    tenancy.requirements = b.requirements.map((r) => ({
      label: str(typeof r === 'string' ? r : r?.label, 120),
      done: Boolean(typeof r === 'object' ? r?.done : false),
      doneAt: typeof r === 'object' && r?.done ? new Date() : null,
    }))
  }

  await tenancy.save()
  await tenancy.populate('customer')
  await tenancy.populate('room')
  res.json({ tenancy: expandTenancy(tenancy) })
}

/** POST /api/tenancies/:id/requirements/:index — tick an item off. */
export async function toggleRequirement(req, res) {
  const tenancy = await Tenancy.findById(req.params.id)
  if (!tenancy) return res.status(404).json({ error: 'Tenancy not found.' })

  const index = Number(req.params.index)
  const item = tenancy.requirements[index]
  if (!item) return res.status(404).json({ error: 'Requirement not found.' })

  item.done = req.body?.done === undefined ? !item.done : Boolean(req.body.done)
  item.doneAt = item.done ? new Date() : null

  await tenancy.save()
  res.json({ tenancy: publicTenancy(tenancy) })
}

/**
 * POST /api/tenancies/:id/sign
 * Both parties sign the agreement. The tenant's typed name is the
 * signature; the signed body is frozen onto the record.
 */
export async function signAgreement(req, res) {
  const tenancy = await Tenancy.findById(req.params.id).populate('customer').populate('room')
  if (!tenancy) return res.status(404).json({ error: 'Tenancy not found.' })

  const tenantSignature = str(req.body?.tenantSignature, 120)
  const staffSignature = str(req.body?.staffSignature, 120) || req.admin?.name || req.admin?.username || ''
  if (!tenantSignature) return res.status(400).json({ error: 'The tenant must sign the agreement.' })
  if (!staffSignature) return res.status(400).json({ error: 'Reception must countersign the agreement.' })

  tenancy.agreement.tenantSignature = tenantSignature
  tenancy.agreement.staffSignature = staffSignature
  tenancy.agreement.signedAt = new Date()
  tenancy.agreement.reference = tenancy.agreement.reference || `${tenancy.ref}-AGR`
  tenancy.agreement.body = renderAgreement({
    customer: tenancy.customer,
    room: tenancy.room,
    tenancy,
  })

  /* A signed agreement activates the tenancy. */
  if (tenancy.status === 'pending') tenancy.status = 'active'

  await tenancy.save()
  const actor = actorOf(req, { action: 'Agreement signed' })
  await notify(
    'Agreement signed',
    `${tenancy.customer.fullName} signed for Room ${tenancy.roomNumber} · ${tenancy.ref}. Countersigned by ${actor.actor}${actor.role ? ` (${actor.role})` : ''}.`,
    tenancy.ref,
    actor,
  )

  res.json({ tenancy: expandTenancy(tenancy) })
}

/** POST /api/tenancies/:id/end — check the tenant out. */
export async function endTenancy(req, res) {
  const tenancy = await Tenancy.findById(req.params.id).populate('room')
  if (!tenancy) return res.status(404).json({ error: 'Tenancy not found.' })

  tenancy.status = 'ended'
  if (req.body?.notes) tenancy.notes = str(req.body.notes, 600)
  await tenancy.save()

  /* Free the room when no other active tenancy holds it. */
  if (tenancy.room) {
    const others = await Tenancy.countDocuments({
      room: tenancy.room._id,
      status: 'active',
    })
    if (!others) {
      await Room.updateOne({ _id: tenancy.room._id }, { $set: { status: 'available' } })
    }
  }

  const checkOutActor = actorOf(req, { action: 'Checked out' })
  await notify(
    'Tenancy ended',
    `${checkOutActor.actor}${checkOutActor.role ? ` (${checkOutActor.role})` : ''} checked out ${tenancy.ref}. The room is free again.`,
    tenancy.ref,
    checkOutActor,
  )
  res.json({ tenancy: publicTenancy(tenancy) })
}

/** DELETE /api/tenancies/:id */
export async function deleteTenancy(req, res) {
  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(404).json({ error: 'Tenancy not found.' })
  }
  const tenancy = await Tenancy.findById(req.params.id)
  if (!tenancy) return res.status(404).json({ error: 'Tenancy not found.' })

  const payments = await Payment.countDocuments({ tenancy: tenancy._id })
  if (payments && req.query.force !== 'true') {
    return res.status(409).json({
      error: `This tenancy has ${payments} payment record(s). Void them first, or delete with force.`,
      payments,
    })
  }

  await Maintenance.updateMany({ tenancy: tenancy._id }, { $set: { tenancy: null } })
  if (req.query.force === 'true') {
    await Payment.updateMany({ tenancy: tenancy._id }, { $set: { tenancy: null } })
  }
  await Tenancy.deleteOne({ _id: tenancy._id })
  res.json({ ok: true })
}

/* ------------------------------------------------------------------ */
/* Portal — the tenant's own view                                       */
/* ------------------------------------------------------------------ */

/** Shape of a tenancy as the tenant sees it, with day counters. */
export const tenantView = (t) => ({
  ...publicTenancy(t),
  roomDetail: t.room && t.room.beds ? publicRoom(t.room) : null,
  daysRemaining: t.status === 'active' ? daysUntil(t.checkOut) : null,
  daysUntilStart: daysUntil(t.checkIn),
})

/** GET /api/portal/tenancies */
export async function myTenancies(req, res) {
  const tenancies = await Tenancy.find({ customer: req.customer._id })
    .sort({ createdAt: -1 })
    .populate('room')

  res.json({ tenancies: tenancies.map(tenantView) })
}

/** GET /api/portal/tenancies/:id */
export async function myTenancy(req, res) {
  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(404).json({ error: 'Tenancy not found.' })
  }
  const tenancy = await Tenancy.findById(req.params.id).populate('room')
  if (!tenancy || String(tenancy.customer) !== String(req.customer._id)) {
    return res.status(404).json({ error: 'Tenancy not found.' })
  }

  const payments = await Payment.find({ tenancy: tenancy._id, voided: false }).sort({ paidAt: -1 })
  const paid = payments.reduce((sum, p) => sum + p.amount, 0)

  res.json({
    tenancy: tenantView(tenancy),
    payments: payments.map((p) => ({
      ref: p.ref,
      amount: p.amount,
      currency: p.currency,
      method: p.method,
      purpose: p.purpose,
      paidAt: p.paidAt,
      notes: p.notes,
    })),
    totals: { paid, balance: Math.max(0, tenancy.total - paid) },
  })
}

/**
 * GET /api/portal/tenancies/:id/agreement
 * Returns the agreement text; regenerates it if it was never frozen.
 */
export async function myAgreement(req, res) {
  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(404).json({ error: 'Tenancy not found.' })
  }
  const tenancy = await Tenancy.findById(req.params.id).populate('room')
  if (!tenancy || String(tenancy.customer) !== String(req.customer._id)) {
    return res.status(404).json({ error: 'Tenancy not found.' })
  }

  const body =
    tenancy.agreement.body ||
    renderAgreement({ customer: req.customer, room: tenancy.room, tenancy })

  res.json({
    agreement: {
      reference: tenancy.agreement.reference || `${tenancy.ref}-AGR`,
      signedAt: tenancy.agreement.signedAt,
      tenantSignature: tenancy.agreement.tenantSignature,
      staffSignature: tenancy.agreement.staffSignature,
      terms: tenancy.agreement.terms ?? [],
      body,
      signed: Boolean(tenancy.agreement.signedAt),
    },
  })
}

/** GET /api/portal/dashboard — everything the portal home needs in one call. */
export async function portalDashboard(req, res) {
  const customer = req.customer

  const tenancies = await Tenancy.find({ customer: customer._id })
    .sort({ createdAt: -1 })
    .populate('room')

  const active = tenancies.find((t) => t.status === 'active') ?? null
  const payments = await Payment.find({ customer: customer._id, voided: false }).sort({ paidAt: -1 })
  const openIssues = await Maintenance.countDocuments({
    customer: customer._id,
    status: { $in: ['open', 'in_progress'] },
  })

  const paid = payments.reduce((sum, p) => sum + p.amount, 0)

  res.json({
    customer: {
      code: customer.code,
      fullName: customer.fullName,
      nationalId: customer.nationalId,
      phone: customer.phone,
      email: customer.email,
      role: customer.role,
      gymIncluded: customer.gymIncluded,
    },
    activeTenancy: active ? tenantView(active) : null,
    tenancies: tenancies.map(tenantView),
    payments: payments.map((p) => ({
      ref: p.ref,
      amount: p.amount,
      currency: p.currency,
      method: p.method,
      purpose: p.purpose,
      paidAt: p.paidAt,
    })),
    totals: {
      paid,
      outstanding: active ? Math.max(0, active.total - paid) : 0,
    },
    openIssues,
    /* Free gym pass is valid while a tenancy is active. */
    gymPass: active && active.gymIncluded
      ? {
          active: true,
          roomNumber: active.roomNumber,
          validFrom: active.checkIn,
          validTo: active.checkOut,
          daysRemaining: daysUntil(active.checkOut),
        }
      : { active: false },
  })
}

/** Confirms a phone number belongs to the signed-in customer. */
export const ownsPhone = (customer, phone) => digits(customer.phone) === digits(phone)
