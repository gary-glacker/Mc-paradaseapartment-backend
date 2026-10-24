import mongoose from 'mongoose'
import { Customer, Payment, Room, Tenancy } from '../models/index.js'
import { newPaymentRef } from '../utils/auth.js'
import { actorOf, digits, int, isoDate, notify, str } from '../utils/helpers.js'
import { CURRENCIES, convertFromBase, currencyConfig, currencyConverter } from '../utils/currency.js'

const METHODS = ['bank', 'momo', 'cash', 'card']
const PURPOSES = ['rent', 'deposit', 'service', 'gym', 'restaurant', 'other']

/* ------------------------------------------------------------------ */
/* Shaping                                                             */
/* ------------------------------------------------------------------ */

export const publicPayment = (p) => ({
  id: String(p._id),
  ref: p.ref,
  customer: p.customer?._id ? String(p.customer._id) : p.customer ? String(p.customer) : null,
  tenancy: p.tenancy?._id ? String(p.tenancy._id) : p.tenancy ? String(p.tenancy) : null,
  booking: p.booking?._id ? String(p.booking._id) : p.booking ? String(p.booking) : null,
  room: p.room?._id ? String(p.room._id) : p.room ? String(p.room) : null,
  roomNumber: p.roomNumber,
  purpose: p.purpose,
  method: p.method,
  amount: p.amount,
  currency: p.currency,
  enteredAmount: p.enteredAmount ?? 0,
  enteredCurrency: p.enteredCurrency ?? '',
  reference: p.reference,
  paidAt: p.paidAt,
  receivedBy: p.receivedBy,
  notes: p.notes,
  voided: p.voided,
  voidReason: p.voidReason,
  createdAt: p.createdAt,
})

const expand = (p) => ({
  ...publicPayment(p),
  customerName: p.customer?.fullName ?? '',
  customerCode: p.customer?.code ?? '',
})

/* ------------------------------------------------------------------ */
/* Recording money                                                     */
/* ------------------------------------------------------------------ */

/**
 * POST /api/payments
 * Reception records what the tenant paid, and how. The room, tenancy
 * and customer are derived from the tenancy when one is given, so the
 * financial report can group everything correctly.
 */
export async function createPayment(req, res) {
  const b = req.body ?? {}

  const method = METHODS.includes(b.method) ? b.method : null
  if (!method) {
    return res.status(400).json({ error: 'Choose a payment method (bank, momo, cash or card).' })
  }

  const amount = Number(b.amount)
  if (!Number.isFinite(amount) || amount <= 0) {
    return res.status(400).json({ error: 'Enter an amount greater than zero.' })
  }

  /*
   * Reception may type the amount in the display currency (e.g. RWF).
   * It is converted into the base currency for storage, and the entry is
   * preserved so the receipt still shows exactly what was handed over.
   */
  const { config, toBase } = await currencyConverter()
  const entered = CURRENCIES.includes(b.currency) ? b.currency : config.base
  const baseAmount = toBase(amount, entered)

  const doc = {
    ref: newPaymentRef(),
    method,
    amount: baseAmount,
    currency: config.base,
    enteredAmount: amount,
    enteredCurrency: entered,
    purpose: PURPOSES.includes(b.purpose) ? b.purpose : 'rent',
    reference: str(b.reference, 80),
    receivedBy: req.admin?.name || req.admin?.username || '',
    notes: str(b.notes, 600),
    paidAt: b.paidAt ? new Date(b.paidAt) : new Date(),
  }

  /* Prefer the tenancy — it tells us the customer and the room. */
  if (mongoose.isValidObjectId(b.tenancyId ?? b.tenancy)) {
    const tenancy = await Tenancy.findById(b.tenancyId ?? b.tenancy)
    if (!tenancy) return res.status(404).json({ error: 'Tenancy not found.' })
    doc.tenancy = tenancy._id
    doc.customer = tenancy.customer
    doc.room = tenancy.room
    doc.roomNumber = tenancy.roomNumber
  } else {
    if (mongoose.isValidObjectId(b.customerId ?? b.customer)) {
      const customer = await Customer.findById(b.customerId ?? b.customer)
      if (!customer) return res.status(404).json({ error: 'Customer not found.' })
      doc.customer = customer._id
    }
    if (mongoose.isValidObjectId(b.roomId ?? b.room)) {
      const room = await Room.findById(b.roomId ?? b.room)
      if (!room) return res.status(404).json({ error: 'Room not found.' })
      doc.room = room._id
      doc.roomNumber = room.number
    }
    if (mongoose.isValidObjectId(b.bookingId ?? b.booking)) doc.booking = b.bookingId ?? b.booking
  }

  const payment = await Payment.create(doc)
  await payment.populate('customer')

  if (payment.amount >= 100) {
    const actor = actorOf(req, { action: 'Payment recorded' })
    await notify(
      'Payment received',
      `${payment.ref} — ${payment.currency} ${payment.amount} by ${method} (${payment.roomNumber || 'general'}), recorded by ${actor.actor}${actor.role ? ` (${actor.role})` : ''}.`,
      null,
      actor,
    )
  }

  res.status(201).json({ payment: expand(payment) })
}

/** GET /api/payments?method=&purpose=&customer=&from=&to=&q= */
export async function listPayments(req, res) {
  const { method = '', purpose = '', customer = '', from = '', to = '', q = '' } = req.query
  const query = {}

  if (METHODS.includes(method)) query.method = method
  if (PURPOSES.includes(purpose)) query.purpose = purpose
  if (mongoose.isValidObjectId(customer)) query.customer = customer

  const fromDate = isoDate(from)
  const toDate = isoDate(to)
  if (fromDate || toDate) {
    query.paidAt = {
      ...(fromDate ? { $gte: new Date(`${fromDate}T00:00:00`) } : {}),
      ...(toDate ? { $lte: new Date(`${toDate}T23:59:59`) } : {}),
    }
  }
  if (q) query.$or = [{ ref: new RegExp(q, 'i') }, { reference: new RegExp(q, 'i') }]

  const payments = await Payment.find(query)
    .sort({ paidAt: -1 })
    .limit(1000)
    .populate('customer')

  const total = payments.filter((p) => !p.voided).reduce((s, p) => s + p.amount, 0)
  res.json({ payments: payments.map(expand), total })
}

/**
 * PATCH /api/payments/:id/void
 * Money is never deleted — a mistake is reversed so the audit trail
 * survives and the report still balances.
 */
export async function voidPayment(req, res) {
  const payment = await Payment.findById(req.params.id)
  if (!payment) return res.status(404).json({ error: 'Payment not found.' })
  if (payment.voided) return res.status(409).json({ error: 'This payment is already voided.' })

  payment.voided = true
  payment.voidReason = str(req.body?.reason, 300) || 'Voided by reception'
  await payment.save()

  res.json({ payment: publicPayment(payment) })
}

/** DELETE /api/payments/:id — hard delete, deliberately awkward. */
export async function deletePayment(req, res) {
  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(404).json({ error: 'Payment not found.' })
  }
  const removed = await Payment.findByIdAndDelete(req.params.id)
  if (!removed) return res.status(404).json({ error: 'Payment not found.' })
  res.json({ ok: true })
}

/* ------------------------------------------------------------------ */
/* Financial reporting                                                 */
/* ------------------------------------------------------------------ */

/** Round to cents so floating-point noise never reaches the UI. */
const money = (n) => Math.round((Number(n) || 0) * 100) / 100

/**
 * Build the range filter shared by every report.
 * Defaults to the current month.
 */
function rangeFilter({ from, to } = {}) {
  const start = isoDate(from)
  const end = isoDate(to)
  const query = {}

  if (start || end) {
    query.paidAt = {
      ...(start ? { $gte: new Date(`${start}T00:00:00`) } : {}),
      ...(end ? { $lte: new Date(`${end}T23:59:59`) } : {}),
    }
  }
  return query
}

/**
 * GET /api/reports/financial?from=&to=
 * The whole financial picture in one call: collected vs expected,
 * broken down by method, purpose and room, plus outstanding balances
 * and the raw ledger for CSV export.
 */
export async function financialReport(req, res) {
  const from = isoDate(req.query.from)
  const to = isoDate(req.query.to)
  const filter = rangeFilter({ from, to })

  /*
   * Reporting currency. Amounts are stored in the base currency, so a
   * request for RWF converts every figure at the very end — the sums
   * themselves always add like-for-like.
   */
  const config = await currencyConfig()
  const want = CURRENCIES.includes(req.query.currency) ? req.query.currency : config.base
  const rate = config.exchangeRate
  /** base → the requested reporting currency. */
  const show = (n) => money(convertFromBase(n, want, config))

  const [payments, byMethod, byPurpose, byRoom, tenancies] = await Promise.all([
    Payment.find({ ...filter, voided: false })
      .sort({ paidAt: -1 })
      .limit(2000)
      .populate('customer'),

    Payment.aggregate([
      { $match: { ...filter, voided: false } },
      { $group: { _id: '$method', amount: { $sum: '$amount' }, count: { $sum: 1 } } },
      { $sort: { amount: -1 } },
    ]),

    Payment.aggregate([
      { $match: { ...filter, voided: false } },
      { $group: { _id: '$purpose', amount: { $sum: '$amount' }, count: { $sum: 1 } } },
      { $sort: { amount: -1 } },
    ]),

    Payment.aggregate([
      { $match: { ...filter, voided: false, room: { $ne: null } } },
      {
        $group: {
          _id: '$room',
          roomNumber: { $first: '$roomNumber' },
          amount: { $sum: '$amount' },
          count: { $sum: 1 },
        },
      },
      { $sort: { amount: -1 } },
    ]),

    Tenancy.find({ status: { $in: ['pending', 'active'] } }),
  ])

  /* Expected rent is every active tenancy's total; collected is what
     has actually been received against those tenancies. */
  const tenancyIds = tenancies.map((t) => t._id)
  const paidByTenancy = await Payment.aggregate([
    { $match: { tenancy: { $in: tenancyIds }, voided: false } },
    { $group: { _id: '$tenancy', paid: { $sum: '$amount' } } },
  ])
  const paidMap = new Map(paidByTenancy.map((r) => [String(r._id), r.paid]))

  const expected = tenancies.reduce((s, t) => s + t.total, 0)
  const collectedOnActive = tenancyIds.reduce((s, id) => s + (paidMap.get(String(id)) ?? 0), 0)
  const collectedInRange = payments.reduce((s, p) => s + p.amount, 0)

  const outstanding = tenancies
    .map((t) => {
      const paid = paidMap.get(String(t._id)) ?? 0
      return {
        tenancyRef: t.ref,
        roomNumber: t.roomNumber,
        total: show(t.total),
        paid: show(paid),
        balance: show(Math.max(0, t.total - paid)),
        checkIn: t.checkIn,
        checkOut: t.checkOut,
        currency: want,
      }
    })
    .filter((t) => t.balance > 0)
    .sort((a, b) => b.balance - a.balance)

  /* Month-by-month series for the chart. */
  const monthly = await Payment.aggregate([
    { $match: { voided: false } },
    {
      $group: {
        _id: { $dateToString: { format: '%Y-%m', date: '$paidAt' } },
        amount: { $sum: '$amount' },
        count: { $sum: 1 },
      },
    },
    { $sort: { _id: 1 } },
    { $limit: 24 },
  ])

  res.json({
    range: { from, to },
    currency: { ...config, reporting: want, rate },
    summary: {
      collected: show(collectedInRange),
      expected: show(expected),
      collectedOnActive: show(collectedOnActive),
      outstanding: show(Math.max(0, expected - collectedOnActive)),
      payments: payments.length,
      activeTenancies: tenancies.length,
    },
    byMethod: byMethod.map((r) => ({ method: r._id, amount: show(r.amount), count: r.count })),
    byPurpose: byPurpose.map((r) => ({ purpose: r._id, amount: show(r.amount), count: r.count })),
    byRoom: byRoom.map((r) => ({
      room: String(r._id),
      roomNumber: r.roomNumber,
      amount: show(r.amount),
      count: r.count,
    })),
    monthly: monthly.map((r) => ({ month: r._id, amount: show(r.amount), count: r.count })),
    outstanding,

    /* The raw ledger — what the CSV export writes out. */
    ledger: payments.map((p) => ({
      ref: p.ref,
      paidAt: p.paidAt,
      customer: p.customer?.fullName ?? '',
      customerCode: p.customer?.code ?? '',
      roomNumber: p.roomNumber,
      method: p.method,
      purpose: p.purpose,
      amount: show(p.amount),
      /* The stored (base) amount, kept so nothing is ever ambiguous. */
      baseAmount: money(p.amount),
      currency: want,
      baseCurrency: config.base,
      reference: p.reference,
      receivedBy: p.receivedBy,
    })),
  })
}

/**
 * GET /api/reports/summary
 * The headline numbers for the Overview page.
 */
export async function dashboardSummary(_req, res) {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1)

  const dayKey = (d) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  const startKey = dayKey(today)

  const [
    rooms,
    occupiedRooms,
    customers,
    activeTenancies,
    arrivalsToday,
    departuresToday,
    openIssues,
    monthPayments,
    todayPayments,
  ] = await Promise.all([
    Room.countDocuments({ active: true }),
    Tenancy.distinct('room', { status: 'active', checkOut: { $gte: startKey } }),
    Customer.countDocuments({ active: true }),
    Tenancy.countDocuments({ status: 'active' }),
    Tenancy.countDocuments({ checkIn: startKey, status: { $in: ['pending', 'active'] } }),
    Tenancy.countDocuments({ checkOut: startKey, status: { $in: ['pending', 'active'] } }),
    import('../models/index.js').then(({ Maintenance }) =>
      Maintenance.countDocuments({ status: { $in: ['open', 'in_progress'] } }),
    ),
    Payment.aggregate([
      { $match: { voided: false, paidAt: { $gte: monthStart } } },
      { $group: { _id: null, amount: { $sum: '$amount' }, count: { $sum: 1 } } },
    ]),
    Payment.aggregate([
      { $match: { voided: false, paidAt: { $gte: today } } },
      { $group: { _id: null, amount: { $sum: '$amount' }, count: { $sum: 1 } } },
    ]),
  ])

  res.json({
    rooms: {
      total: rooms,
      occupied: occupiedRooms.length,
      available: Math.max(0, rooms - occupiedRooms.length),
      occupancyRate: rooms ? Math.round((occupiedRooms.length / rooms) * 100) : 0,
    },
    customers,
    activeTenancies,
    arrivalsToday,
    departuresToday,
    openIssues,
    currency: await currencyConfig(),
    revenue: {
      thisMonth: money(monthPayments[0]?.amount ?? 0),
      thisMonthCount: monthPayments[0]?.count ?? 0,
      today: money(todayPayments[0]?.amount ?? 0),
      todayCount: todayPayments[0]?.count ?? 0,
    },
  })
}

/** Utility kept for other modules that need a digits-only comparison. */
export const samePhone = (a, b) => digits(a) === digits(b)

/** Exposed for the seed script — validates a payment method. */
export const isPaymentMethod = (m) => METHODS.includes(m)

/** Exposed for the seed script. */
export const paymentAmount = (v) => money(v)
