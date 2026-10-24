import mongoose from 'mongoose'
import { Booking, Maintenance, Room, Tenancy } from '../models/index.js'
import { escapeRegex, int, str } from '../utils/helpers.js'

/* ------------------------------------------------------------------ */
/* Shaping                                                             */
/* ------------------------------------------------------------------ */

/** The room record as the dashboard sees it. */
export const publicRoom = (r) => ({
  id: String(r._id),
  number: r.number,
  name: r.name,
  floor: r.floor,
  sizeM2: r.sizeM2,
  beds: r.beds,
  bedrooms: r.bedrooms,
  bathrooms: r.bathrooms,
  maxGuests: r.maxGuests,
  pricePerNight: r.pricePerNight,
  currency: r.currency,
  amenities: (r.amenities ?? []).map((a) => ({
    key: a.key,
    label: a.label,
    chargeable: a.chargeable,
    price: a.price,
  })),
  images: r.images ?? [],
  status: r.status,
  active: r.active,
  notes: r.notes,
  createdAt: r.createdAt,
  updatedAt: r.updatedAt,
})

/** Build the writable fields from a request body. */
const readRoomBody = (body = {}, { partial = false } = {}) => {
  const out = {}
  const put = (key, value) => {
    if (value !== undefined) out[key] = value
  }

  if (body.number !== undefined || !partial) put('number', str(body.number, 20))
  put('name', body.name !== undefined ? str(body.name, 80) : undefined)
  put('floor', body.floor !== undefined ? str(body.floor, 20) : undefined)
  put('notes', body.notes !== undefined ? str(body.notes, 600) : undefined)

  const nums = {
    sizeM2: [0, 1000],
    beds: [1, 20],
    bedrooms: [0, 20],
    bathrooms: [0, 20],
    maxGuests: [1, 40],
    pricePerNight: [0, 1_000_000],
  }
  for (const [key, [min, max]] of Object.entries(nums)) {
    if (body[key] === undefined) continue
    const n = Number(body[key])
    out[key] = Number.isFinite(n) ? Math.min(max, Math.max(min, Math.trunc(n))) : min
  }

  if (body.amenities !== undefined && Array.isArray(body.amenities)) {
    out.amenities = body.amenities
      .map((a) => ({
        key: str(a?.key ?? a?.label, 40).toLowerCase().replace(/[^a-z0-9]+/g, '-'),
        label: str(a?.label ?? a?.key, 80),
        chargeable: Boolean(a?.chargeable),
        price: Math.max(0, Number(a?.price) || 0),
      }))
      .filter((a) => a.key && a.label)
  }

  if (body.images !== undefined && Array.isArray(body.images)) {
    out.images = body.images.map((i) => str(i, 300)).filter(Boolean).slice(0, 20)
  }

  if (body.status !== undefined) {
    put(
      'status',
      ['available', 'occupied', 'maintenance'].includes(body.status) ? body.status : 'available',
    )
  }
  put('active', body.active !== undefined ? Boolean(body.active) : undefined)

  return out
}

/* ------------------------------------------------------------------ */
/* Admin — room management                                             */
/* ------------------------------------------------------------------ */

/** GET /api/rooms?search=&beds=&status=&active= */
export async function listRooms(req, res) {
  const { search = '', status = '', active = '', beds = '' } = req.query
  const query = {}

  if (status) query.status = status
  if (active === 'true') query.active = true
  if (active === 'false') query.active = false
  if (beds) query.beds = int(beds)
  if (search) {
    const rx = new RegExp(escapeRegex(str(search, 60)), 'i')
    query.$or = [{ number: rx }, { name: rx }, { floor: rx }]
  }

  const rooms = await Room.find(query).sort({ number: 1 })
  res.json({ rooms: rooms.map(publicRoom), total: rooms.length })
}

/** GET /api/rooms/availability?checkIn=&checkOut= — free rooms for a window. */
export async function roomAvailability(req, res) {
  const checkIn = str(req.query.checkIn, 10)
  const checkOut = str(req.query.checkOut, 10)
  if (!checkIn || !checkOut) {
    return res.status(400).json({ error: 'checkIn and checkOut are required.' })
  }

  const rooms = await Room.find({ active: true }).sort({ number: 1 })

  /* A room is busy when another tenancy overlaps the window. Two stays
     overlap when one starts before the other ends. */
  const busy = await Tenancy.find({
    status: { $in: ['pending', 'active'] },
    checkIn: { $lt: checkOut },
    checkOut: { $gt: checkIn },
  }).select('room')

  const busyIds = new Set(busy.map((t) => String(t.room)))
  const free = rooms.filter((r) => !busyIds.has(String(r._id)) && r.status !== 'maintenance')
  const taken = rooms.filter((r) => busyIds.has(String(r._id)))

  res.json({
    checkIn,
    checkOut,
    available: free.map(publicRoom),
    occupied: taken.map(publicRoom),
    unavailable: rooms.filter((r) => r.status === 'maintenance').map(publicRoom),
  })
}

/** GET /api/rooms/:id */
export async function getRoom(req, res) {
  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(404).json({ error: 'Room not found.' })
  }
  const room = await Room.findById(req.params.id)
  if (!room) return res.status(404).json({ error: 'Room not found.' })

  const [tenancies, openIssues] = await Promise.all([
    Tenancy.find({ room: room._id }).sort({ checkIn: -1 }).limit(50),
    Maintenance.countDocuments({ room: room._id, status: { $in: ['open', 'in_progress'] } }),
  ])

  res.json({
    room: publicRoom(room),
    tenancies: tenancies.map((t) => t.toJSON()),
    openIssues,
  })
}

/** POST /api/rooms */
export async function createRoom(req, res) {
  const fields = readRoomBody(req.body ?? {})
  if (!fields.number) return res.status(400).json({ error: 'Room number is required.' })
  if (!fields.beds) return res.status(400).json({ error: 'Number of beds is required.' })
  if (!fields.pricePerNight && fields.pricePerNight !== 0) {
    return res.status(400).json({ error: 'Price per night is required.' })
  }

  const exists = await Room.findOne({ number: fields.number })
  if (exists) return res.status(409).json({ error: `Room ${fields.number} already exists.` })

  const room = await Room.create(fields)
  res.status(201).json({ room: publicRoom(room) })
}

/** POST /api/rooms/bulk — create several rooms in one call (initial setup). */
export async function createRooms(req, res) {
  const items = Array.isArray(req.body?.rooms) ? req.body.rooms : []
  if (!items.length) return res.status(400).json({ error: 'Provide a `rooms` array.' })

  const created = []
  const skipped = []

  for (const item of items) {
    const fields = readRoomBody(item)
    if (!fields.number || !fields.beds) {
      skipped.push({ number: fields.number || '(missing)', reason: 'number and beds are required' })
      continue
    }
    const exists = await Room.findOne({ number: fields.number })
    if (exists) {
      skipped.push({ number: fields.number, reason: 'already exists' })
      continue
    }
    try {
      created.push(await Room.create(fields))
    } catch (err) {
      if (err?.code !== 11000) throw err
      skipped.push({ number: fields.number, reason: 'already exists' })
    }
  }

  res.status(201).json({
    rooms: created.map(publicRoom),
    created: created.length,
    skipped,
  })
}

/** PATCH /api/rooms/:id */
export async function updateRoom(req, res) {
  const room = await Room.findById(req.params.id)
  if (!room) return res.status(404).json({ error: 'Room not found.' })

  const fields = readRoomBody(req.body ?? {}, { partial: true })
  if (fields.number && fields.number !== room.number) {
    const clash = await Room.findOne({ number: fields.number, _id: { $ne: room._id } })
    if (clash) return res.status(409).json({ error: `Room ${fields.number} already exists.` })
  }

  Object.assign(room, fields)
  await room.save()
  res.json({ room: publicRoom(room) })
}

/** DELETE /api/rooms/:id — blocked while a tenancy references it. */
export async function deleteRoom(req, res) {
  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(404).json({ error: 'Room not found.' })
  }
  const room = await Room.findById(req.params.id)
  if (!room) return res.status(404).json({ error: 'Room not found.' })

  const [tenancies, bookings] = await Promise.all([
    Tenancy.countDocuments({ room: room._id }),
    Booking.countDocuments({ room: room._id }),
  ])

  if ((tenancies || bookings) && req.query.force !== 'true') {
    return res.status(409).json({
      error: 'This room is referenced by existing tenancies or bookings.',
      tenancies,
      bookings,
    })
  }

  await Maintenance.updateMany({ room: room._id }, { $set: { room: null } })
  await Room.deleteOne({ _id: room._id })
  res.json({ ok: true })
}

/* ------------------------------------------------------------------ */
/* Public — the booking site only sees published, available rooms      */
/* ------------------------------------------------------------------ */

/** GET /api/rooms/public */
export async function listPublicRooms(_req, res) {
  const rooms = await Room.find({ active: true }).sort({ pricePerNight: 1, number: 1 })
  res.json({
    rooms: rooms.map((r) => ({
      id: String(r._id),
      number: r.number,
      name: r.name || `Room ${r.number}`,
      floor: r.floor,
      beds: r.beds,
      maxGuests: r.maxGuests,
      pricePerNight: r.pricePerNight,
      currency: r.currency,
      amenities: (r.amenities ?? []).map((a) => a.label),
      images: r.images ?? [],
      status: r.status,
    })),
    total: rooms.length,
  })
}
