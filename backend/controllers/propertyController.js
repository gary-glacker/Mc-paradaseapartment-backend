import mongoose from 'mongoose'
import { Booking, Property } from '../models/index.js'
import { PROPERTY_STATUSES, dayKey, int, startOfToday, str } from '../utils/helpers.js'

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

const slugify = (s) =>
  str(s, 80)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

/** Build the writable fields from a request body (never trust the client). */
const readPropertyBody = (body = {}, { partial = false } = {}) => {
  const out = {}
  const put = (key, value) => {
    if (value !== undefined) out[key] = value
  }

  if (body.name !== undefined || !partial) put('name', str(body.name, 80))
  if (body.slug !== undefined || (!partial && body.name)) {
    put('slug', slugify(body.slug || body.name))
  }
  if (body.kind !== undefined) {
    put('kind', ['studio', 'suite', 'family', 'penthouse'].includes(body.kind) ? body.kind : 'studio')
  }
  put('tagline', body.tagline !== undefined ? str(body.tagline, 200) : undefined)
  put('description', body.description !== undefined ? str(body.description, 2000) : undefined)
  put('pricePerNight', body.pricePerNight !== undefined ? int(body.pricePerNight) : undefined)
  put('currency', body.currency !== undefined ? str(body.currency, 6) || 'USD' : undefined)
  put('guests', body.guests !== undefined ? Math.max(1, int(body.guests)) : undefined)
  put('adults', body.adults !== undefined ? Math.max(1, int(body.adults)) : undefined)
  put('children', body.children !== undefined ? int(body.children) : undefined)
  put('beds', body.beds !== undefined ? int(body.beds) : undefined)
  put('bedrooms', body.bedrooms !== undefined ? int(body.bedrooms) : undefined)
  put('bathrooms', body.bathrooms !== undefined ? int(body.bathrooms) : undefined)
  put('sizeM2', body.sizeM2 !== undefined ? int(body.sizeM2) : undefined)
  put('floor', body.floor !== undefined ? str(body.floor, 20) : undefined)
  put('notes', body.notes !== undefined ? str(body.notes, 600) : undefined)

  if (body.status !== undefined) {
    put('status', PROPERTY_STATUSES.includes(body.status) ? body.status : 'available')
  }
  if (body.active !== undefined) put('active', Boolean(body.active))

  if (Array.isArray(body.amenities)) {
    out.amenities = body.amenities.map((a) => str(a, 60)).filter(Boolean).slice(0, 40)
  }
  if (Array.isArray(body.images)) {
    out.images = body.images.map((i) => str(i, 300)).filter(Boolean).slice(0, 20)
  }

  if (!partial) {
    out.amenities ??= []
    out.images ??= []
  }

  return out
}

/** Per-property booking counters, so the list can show occupancy at a glance. */
async function bookingStatsByProperty() {
  const today = dayKey(startOfToday())

  const [counts, upcoming] = await Promise.all([
    Booking.aggregate([
      { $match: { property: { $ne: null } } },
      {
        $group: {
          _id: '$property',
          bookings: { $sum: 1 },
          pending: { $sum: { $cond: [{ $eq: ['$status', 'pending'] }, 1, 0] } },
          confirmed: { $sum: { $cond: [{ $eq: ['$status', 'confirmed'] }, 1, 0] } },
          nights: {
            $sum: {
              $cond: [{ $eq: ['$status', 'confirmed'] }, { $ifNull: ['$stay.nights', 0] }, 0],
            },
          },
          revenue: {
            $sum: {
              $cond: [{ $eq: ['$status', 'confirmed'] }, { $ifNull: ['$total', 0] }, 0],
            },
          },
        },
      },
    ]),
    Booking.aggregate([
      {
        $match: {
          property: { $ne: null },
          status: { $in: ['pending', 'confirmed'] },
          'stay.checkIn': { $gte: today },
        },
      },
      {
        $group: {
          _id: '$property',
          nextArrival: { $min: '$stay.checkIn' },
        },
      },
    ]),
  ])

  const map = new Map()
  for (const c of counts) map.set(String(c._id), c)
  for (const u of upcoming) {
    const row = map.get(String(u._id)) ?? { _id: u._id, bookings: 0, pending: 0, confirmed: 0, nights: 0, revenue: 0 }
    row.nextArrival = u.nextArrival
    map.set(String(u._id), row)
  }
  return map
}

/* ------------------------------------------------------------------ */
/* Public                                                              */
/* ------------------------------------------------------------------ */

/** GET /api/properties/public — bookable residences for the website. */
export async function listPublicProperties(req, res) {
  const properties = await Property.find({ active: true }).sort({ pricePerNight: 1 })
  res.json({
    properties: properties.map((p) => ({
      id: p.slug,
      name: p.name,
      kind: p.kind,
      tagline: p.tagline,
      pricePerNight: p.pricePerNight,
      currency: p.currency,
      guests: p.guests,
      beds: p.beds,
      bedrooms: p.bedrooms,
      bathrooms: p.bathrooms,
      sizeM2: p.sizeM2,
      amenities: p.amenities,
      images: p.images,
      status: p.status,
    })),
  })
}

/* ------------------------------------------------------------------ */
/* Admin                                                               */
/* ------------------------------------------------------------------ */

/** GET /api/properties */
export async function listProperties(req, res) {
  const [properties, stats] = await Promise.all([
    Property.find().sort({ pricePerNight: 1 }),
    bookingStatsByProperty(),
  ])

  res.json({
    properties: properties.map((p) => {
      const s = stats.get(String(p._id))
      return {
        ...p.toJSON(),
        bookings: s?.bookings ?? 0,
        pending: s?.pending ?? 0,
        confirmed: s?.confirmed ?? 0,
        nightsSold: s?.nights ?? 0,
        revenue: s?.revenue ?? 0,
        nextArrival: s?.nextArrival ?? null,
      }
    }),
  })
}

/** GET /api/properties/:id — the residence plus its bookings. */
export async function getProperty(req, res) {
  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(404).json({ error: 'Residence not found.' })
  }
  const property = await Property.findById(req.params.id)
  if (!property) return res.status(404).json({ error: 'Residence not found.' })

  const bookings = await Booking.find({ property: property._id }).sort({ 'stay.checkIn': 1 })
  res.json({ property, bookings })
}

/** POST /api/properties */
export async function createProperty(req, res) {
  const body = readPropertyBody(req.body ?? {})
  if (!body.name) return res.status(400).json({ error: 'A name is required.' })
  if (!body.slug) return res.status(400).json({ error: 'A name or slug is required.' })

  const property = await Property.create(body)
  res.status(201).json({ property })
}

/** PATCH /api/properties/:id */
export async function updateProperty(req, res) {
  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(404).json({ error: 'Residence not found.' })
  }
  const property = await Property.findById(req.params.id)
  if (!property) return res.status(404).json({ error: 'Residence not found.' })

  Object.assign(property, readPropertyBody(req.body ?? {}, { partial: true }))
  await property.save()
  res.json({ property })
}

/** DELETE /api/properties/:id — refuses while bookings still reference it. */
export async function deleteProperty(req, res) {
  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(404).json({ error: 'Residence not found.' })
  }
  const property = await Property.findById(req.params.id)
  if (!property) return res.status(404).json({ error: 'Residence not found.' })

  const linked = await Booking.countDocuments({ property: property._id })
  if (linked > 0 && req.query.force !== 'true') {
    return res.status(409).json({
      error: `${linked} booking(s) still reference this residence. Reassign them first, or repeat with ?force=true.`,
      bookings: linked,
    })
  }

  if (linked > 0) {
    await Booking.updateMany({ property: property._id }, { $set: { property: null } })
  }
  await property.deleteOne()
  res.json({ ok: true, detachedBookings: linked })
}
