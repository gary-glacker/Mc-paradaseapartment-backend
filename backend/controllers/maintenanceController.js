import mongoose from 'mongoose'
import { Customer, Maintenance, Room, Tenancy } from '../models/index.js'
import { newMaintenanceRef } from '../utils/auth.js'
import { actorOf, escapeRegex, int, notify, str } from '../utils/helpers.js'

const CATEGORIES = ['plumbing', 'electrical', 'furniture', 'appliance', 'cleaning', 'other']
const URGENCIES = ['low', 'normal', 'high']
const PRIORITIES = ['low', 'normal', 'high', 'urgent']
const STATUSES = ['open', 'in_progress', 'resolved', 'rejected']

/* ------------------------------------------------------------------ */
/* Shaping                                                             */
/* ------------------------------------------------------------------ */

/** The request as the dashboard sees it. */
export const publicMaintenance = (m) => ({
  id: String(m._id),
  ref: m.ref,
  customer: m.customer?._id ? String(m.customer._id) : m.customer ? String(m.customer) : null,
  room: m.room?._id ? String(m.room._id) : m.room ? String(m.room) : null,
  tenancy: m.tenancy?._id ? String(m.tenancy._id) : m.tenancy ? String(m.tenancy) : null,
  roomNumber: m.roomNumber,
  category: m.category,
  title: m.title,
  description: m.description,
  urgency: m.urgency,
  priority: m.priority,
  status: m.status,
  assignedTo: m.assignedTo,
  resolution: m.resolution,
  resolvedAt: m.resolvedAt,
  photo: m.photo,
  updates: (m.updates ?? []).map((u) => ({ at: u.at, by: u.by, text: u.text })),
  createdAt: m.createdAt,
  updatedAt: m.updatedAt,
})

const expand = (m) => ({
  ...publicMaintenance(m),
  customerName: m.customer?.fullName ?? '',
  customerPhone: m.customer?.phone ?? '',
})

/* ------------------------------------------------------------------ */
/* Tenant portal                                                       */
/* ------------------------------------------------------------------ */

/**
 * POST /api/portal/maintenance
 * A tenant reports something broken in their room. The room and
 * tenancy are taken from their active tenancy, not from the request.
 */
export async function createRequest(req, res) {
  const b = req.body ?? {}
  const title = str(b.title, 140)
  if (!title) return res.status(400).json({ error: 'Describe what needs fixing.' })

  const active = await Tenancy.findOne({
    customer: req.customer._id,
    status: { $in: ['pending', 'active'] },
  }).sort({ createdAt: -1 })

  const request = await Maintenance.create({
    ref: newMaintenanceRef(),
    customer: req.customer._id,
    room: active?.room ?? null,
    tenancy: active?._id ?? null,
    roomNumber: active?.roomNumber ?? '',
    category: CATEGORIES.includes(b.category) ? b.category : 'other',
    title,
    description: str(b.description, 1000),
    urgency: URGENCIES.includes(b.urgency) ? b.urgency : 'normal',
    priority: URGENCIES.includes(b.urgency) ? b.urgency : 'normal',
    status: 'open',
    photo: str(b.photo, 300),
    updates: [{ by: req.customer.fullName, text: 'Request submitted.' }],
  })

  await notify(
    'New maintenance request',
    `${request.ref} — ${req.customer.fullName} (Room ${request.roomNumber || '—'}): ${title}`,
    null,
    actorOf(null, { source: 'guest', action: 'Maintenance requested' }),
  )

  res.status(201).json({ request: publicMaintenance(request) })
}

/** GET /api/portal/maintenance */
export async function myRequests(req, res) {
  const requests = await Maintenance.find({ customer: req.customer._id }).sort({ createdAt: -1 })
  res.json({ requests: requests.map(publicMaintenance) })
}

/** GET /api/portal/maintenance/:id */
export async function myRequest(req, res) {
  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(404).json({ error: 'Request not found.' })
  }
  const request = await Maintenance.findById(req.params.id)
  if (!request || String(request.customer) !== String(req.customer._id)) {
    return res.status(404).json({ error: 'Request not found.' })
  }
  res.json({ request: publicMaintenance(request) })
}

/* ------------------------------------------------------------------ */
/* Reception                                                           */
/* ------------------------------------------------------------------ */

/** GET /api/maintenance?status=&priority=&category=&q= */
export async function listRequests(req, res) {
  const { status = '', priority = '', category = '', q = '' } = req.query
  const query = {}

  if (status) query.status = status
  if (priority) query.priority = priority
  if (category) query.category = category
  if (q) {
    const rx = new RegExp(escapeRegex(str(q, 60)), 'i')
    query.$or = [{ ref: rx }, { title: rx }, { roomNumber: rx }, { description: rx }]
  }

  const requests = await Maintenance.find(query)
    .sort({ status: 1, priority: -1, createdAt: -1 })
    .limit(500)
    .populate('customer')

  res.json({ requests: requests.map(expand) })
}

/** GET /api/maintenance/:id */
export async function getRequest(req, res) {
  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(404).json({ error: 'Request not found.' })
  }
  const request = await Maintenance.findById(req.params.id).populate('customer')
  if (!request) return res.status(404).json({ error: 'Request not found.' })
  res.json({ request: expand(request) })
}

/**
 * PATCH /api/maintenance/:id
 * Reception triages: sets priority, assigns a technician, resolves.
 * Each change is appended to the request timeline.
 */
export async function updateRequest(req, res) {
  const request = await Maintenance.findById(req.params.id)
  if (!request) return res.status(404).json({ error: 'Request not found.' })

  const b = req.body ?? {}
  const by = req.admin?.name || req.admin?.username || 'Reception'
  const timeline = []

  if (PRIORITIES.includes(b.priority) && b.priority !== request.priority) {
    request.priority = b.priority
    timeline.push(`Priority set to ${b.priority}.`)
  }
  if (CATEGORIES.includes(b.category)) request.category = b.category
  if (b.assignedTo !== undefined) {
    const next = str(b.assignedTo, 80)
    if (next !== request.assignedTo) {
      request.assignedTo = next
      timeline.push(next ? `Assigned to ${next}.` : 'Assignment cleared.')
    }
  }
  if (b.resolution !== undefined) request.resolution = str(b.resolution, 1000)

  if (STATUSES.includes(b.status) && b.status !== request.status) {
    request.status = b.status
    if (b.status === 'resolved') {
      request.resolvedAt = new Date()
      timeline.push('Marked as resolved.')
    } else {
      request.resolvedAt = null
      timeline.push(`Status set to ${b.status.replace('_', ' ')}.`)
    }
  }

  if (b.note) timeline.push(str(b.note, 400))

  for (const text of timeline) {
    request.updates.push({ by, text })
  }

  await request.save()
  await request.populate('customer')
  res.json({ request: expand(request) })
}

/** DELETE /api/maintenance/:id */
export async function deleteRequest(req, res) {
  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(404).json({ error: 'Request not found.' })
  }
  const removed = await Maintenance.findByIdAndDelete(req.params.id)
  if (!removed) return res.status(404).json({ error: 'Request not found.' })
  res.json({ ok: true })
}

/** GET /api/maintenance/stats — the queue at a glance. */
export async function requestStats(_req, res) {
  const [byStatus, byPriority, byCategory, open] = await Promise.all([
    Maintenance.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
    Maintenance.aggregate([
      { $match: { status: { $in: ['open', 'in_progress'] } } },
      { $group: { _id: '$priority', count: { $sum: 1 } } },
    ]),
    Maintenance.aggregate([{ $group: { _id: '$category', count: { $sum: 1 } } }]),
    Maintenance.countDocuments({ status: { $in: ['open', 'in_progress'] } }),
  ])

  const reduce = (rows) => Object.fromEntries(rows.map((r) => [r._id, r.count]))
  res.json({
    open,
    byStatus: reduce(byStatus),
    byPriority: reduce(byPriority),
    byCategory: reduce(byCategory),
  })
}

/** Rooms currently flagged as needing attention — used by the dashboard. */
export async function roomsWithIssues(_req, res) {
  const rows = await Maintenance.aggregate([
    { $match: { status: { $in: ['open', 'in_progress'] }, room: { $ne: null } } },
    { $group: { _id: '$room', count: { $sum: 1 } } },
  ])

  const ids = rows.map((r) => r._id)
  const rooms = await Room.find({ _id: { $in: ids } }).select('number name')
  const byId = new Map(rooms.map((r) => [String(r._id), r]))

  res.json({
    rooms: rows
      .map((r) => ({
        room: byId.get(String(r._id))?.toJSON() ?? null,
        openIssues: r.count,
      }))
      .filter((r) => r.room),
  })
}
