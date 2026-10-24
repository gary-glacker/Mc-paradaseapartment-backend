/* ============================================================
   MC PARADISE — database bootstrap
   ------------------------------------------------------------
   Connects to MongoDB, creates the admin account on first run,
   and brings older documents forward to the current shape.
   No demo content is seeded: bookings, residences and pages all
   start empty and are created through the dashboard.
   ============================================================ */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import mongoose from 'mongoose'
import 'dotenv/config'
import { hashPassword } from '../utils/auth.js'
import { Booking, Property, Admin } from '../models/index.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const LEGACY_FILE = path.join(__dirname, '..', 'data', 'db.json')

export const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/mc_paradise'

/* ------------------------------------------------------------------ */
/* Connection                                                          */
/* ------------------------------------------------------------------ */

export async function connectDb() {
  mongoose.set('strictQuery', true)
  await mongoose.connect(MONGODB_URI, { serverSelectionTimeoutMS: 8000 })
  return mongoose.connection
}

export const disconnectDb = () => mongoose.disconnect()

/* ------------------------------------------------------------------ */
/* Migrations                                                          */
/* ------------------------------------------------------------------ */

/** Create the admin account if it does not exist yet. */
export async function seedAdmin() {
  const username = (process.env.ADMIN_USERNAME || 'admin').toLowerCase()
  const existing = await Admin.findOne({ username })
  if (existing) return { created: false, username }

  await Admin.create({
    username,
    name: process.env.ADMIN_NAME || 'Administrator',
    role: 'Admin',
    password: hashPassword(process.env.ADMIN_PASSWORD || 'admin123'),
  })
  return { created: true, username }
}

/**
 * Bring older bookings forward: the first version stored a single
 * `dates` block; we now keep `stay` (entry / exit) and `schedule`.
 */
export async function migrateLegacyBookings() {
  const stale = await Booking.collection
    .find({ dates: { $exists: true } })
    .project({ dates: 1, item: 1, stay: 1, propertyName: 1 })
    .toArray()

  if (!stale.length) return { migrated: 0 }

  const ops = stale.map((b) => {
    const d = b.dates ?? {}
    const stay = b.stay && b.stay.checkIn ? b.stay : {
      checkIn: d.checkIn ?? null,
      checkOut: d.checkOut ?? null,
      nights: d.nights ?? 0,
      adults: d.adults ?? d.guests ?? 0,
      children: d.children ?? 0,
      guests: d.guests ?? 0,
      rooms: d.rooms ?? 1,
    }

    return {
      updateOne: {
        filter: { _id: b._id },
        update: {
          $set: {
            stay,
            schedule: {
              startDate: d.startDate ?? null,
              date: d.date ?? null,
              time: d.time ?? null,
              people: d.people ?? 0,
            },
            propertyName: b.propertyName || b.item || '',
          },
          $unset: { dates: '' },
        },
      },
    }
  })

  await Booking.collection.bulkWrite(ops, { ordered: false })
  return { migrated: ops.length }
}

/**
 * On very first run, pull across anything from the old JSON store so
 * existing bookings are not lost.
 */
export async function importLegacyJson() {
  if (!fs.existsSync(LEGACY_FILE)) return { imported: 0 }
  if ((await Booking.estimatedDocumentCount()) > 0) return { imported: 0 }

  try {
    const data = JSON.parse(fs.readFileSync(LEGACY_FILE, 'utf8'))
    const bookings = Array.isArray(data.bookings) ? data.bookings : []
    if (!bookings.length) return { imported: 0 }

    const docs = bookings.map((b) => {
      const d = b.dates ?? {}
      return {
        ref: b.ref || `MC-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
        kind: b.kind,
        status: b.status || 'pending',
        propertyName: b.item || '',
        item: b.item || '',
        detail: b.detail || '',
        total: Number(b.total) || 0,
        currency: b.currency || 'USD',
        guest: b.guest,
        stay: {
          checkIn: d.checkIn ?? null,
          checkOut: d.checkOut ?? null,
          nights: d.nights ?? 0,
          adults: d.guests ?? 0,
          children: 0,
          guests: d.guests ?? 0,
          rooms: 1,
        },
        schedule: {
          startDate: d.startDate ?? null,
          date: d.date ?? null,
          time: d.time ?? null,
          people: d.people ?? 0,
        },
        createdAt: b.createdAt ? new Date(b.createdAt) : new Date(),
        updatedAt: b.updatedAt ? new Date(b.updatedAt) : undefined,
      }
    })

    await Booking.insertMany(docs, { ordered: false })
    return { imported: docs.length }
  } catch (err) {
    console.warn('[db] Legacy import skipped:', err.message)
    return { imported: 0 }
  }
}

/**
 * Attach apartment bookings that predate the residence catalogue to the
 * matching residence, so the Properties page shows real occupancy.
 */
export async function linkBookingsToProps() {
  const properties = await Property.find().select('name')
  if (!properties.length) return { linked: 0 }

  let linked = 0
  for (const p of properties) {
    const res = await Booking.updateMany(
      { kind: 'apartment', property: null, propertyName: p.name },
      { $set: { property: p._id } },
    )
    linked += res.modifiedCount ?? 0
  }
  return { linked }
}

/** Run every migration step in order. */
export async function seedDatabase() {
  const admin = await seedAdmin()
  const legacy = await importLegacyJson()
  const migration = await migrateLegacyBookings()
  const linked = await linkBookingsToProps()
  return { admin, legacy, migration, linked }
}
