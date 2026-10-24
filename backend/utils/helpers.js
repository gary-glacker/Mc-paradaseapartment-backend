import { Notification } from '../models/index.js'

/** Only these values are accepted from the client. */
export const BOOKING_KINDS = ['apartment', 'gym', 'restaurant']
export const BOOKING_STATUSES = ['pending', 'confirmed', 'rejected', 'cancelled']
export const PROPERTY_STATUSES = ['available', 'occupied', 'maintenance']

/** Maps a site-page slug to the booking category it owns. */
export const PAGE_KIND = { apartments: 'apartment', gym: 'gym', restaurant: 'restaurant' }

/**
 * The sections of the public website the manager can publish or hide.
 * This is the single source of truth — it lives in code, not in the
 * database, so a fresh install starts with nothing until the dashboard
 * asks for them to be created (POST /api/pages/sync).
 */
export const SITE_SECTIONS = [
  { slug: 'home', label: 'Home', path: '/', description: 'Hero, stats and quick booking.', order: 1 },
  { slug: 'about', label: 'About', path: '/#about', description: 'Story, founders and timeline.', order: 2 },
  { slug: 'services', label: 'Services', path: '/#services', description: 'All guest services.', order: 3 },
  { slug: 'apartments', label: 'Apartments', path: '/#apartments', description: 'Residences and pricing.', order: 4 },
  { slug: 'restaurant', label: 'Restaurant', path: '/#restaurant', description: 'Menu and reservations.', order: 5 },
  { slug: 'gym', label: 'Gym', path: '/#gym', description: 'Plans and Find-us map.', order: 6 },
  { slug: 'gallery', label: 'Gallery', path: '/#gallery', description: 'Photo gallery.', order: 7 },
  { slug: 'contact', label: 'Contact', path: '/#contact', description: 'Contact form and map.', order: 8 },
]

/** Midnight today, in server-local time. */
export const startOfToday = () => {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d
}

/** `YYYY-MM-DD` for a Date, in server-local time. */
export const dayKey = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

/** Escape user input before building a RegExp from it. */
export const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Keep only digits, so `+250 788 382 569` and `250788382569` match. */
export const digits = (s) => String(s ?? '').replace(/\D/g, '')

/** Trim + cap a string coming from a request body. */
export const str = (v, max = 400) => String(v ?? '').trim().slice(0, max)

/** Coerce to a non-negative integer. */
export const int = (v) => {
  const n = Number(v)
  return Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : 0
}

/** Trim a date-ish string down to `YYYY-MM-DD`, or null. */
export const isoDate = (v) => {
  if (!v) return null
  const s = String(v).slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null
}

/** Whole nights between two `YYYY-MM-DD` strings (min 0). */
export const nightsBetween = (from, to) => {
  if (!from || !to) return 0
  const a = Date.parse(`${from}T00:00:00Z`)
  const b = Date.parse(`${to}T00:00:00Z`)
  if (Number.isNaN(a) || Number.isNaN(b) || b <= a) return 0
  return Math.round((b - a) / 86_400_000)
}

/** The safe subset of an admin document returned to clients. */
export const publicAdmin = (a) => ({
  id: String(a._id),
  username: a.username,
  name: a.name,
  role: a.role,
  email: a.email ?? '',
})

/** Raise a response the error middleware understands. */
export class HttpError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

/**
 * Who performed an action, for the notification feed.
 *
 * Accepts the Express `req` and returns the actor block, or a plain
 * descriptor for automated/public events:
 *   actorOf(req)                    → the signed-in staff member
 *   actorOf(req, { source: 'guest' }) → a website visitor
 *   actorOf()                       → the system
 */
export const actorOf = (req, { source, action } = {}) => {
  if (source === 'guest') {
    return { action: action ?? '', actor: 'Website guest', role: 'Guest', source: 'guest' }
  }
  if (source === 'system' || !req?.admin) {
    return { action: action ?? '', actor: 'System', role: '', source: 'system' }
  }
  return {
    action: action ?? '',
    actor: req.admin.name || req.admin.username || 'Staff',
    role: req.admin.role || '',
    source: 'staff',
  }
}

/**
 * Create a dashboard notification.
 *
 * Back-compatible with the original `notify(title, body, ref)` call, and
 * accepts a fourth argument describing who did it and what they did:
 *   notify('Booking confirmed', '…', ref, actorOf(req, { action: 'Booking confirmed' }))
 */
export const notify = (title, body, bookingRef = null, actor = null) =>
  Notification.create({
    title,
    body,
    bookingRef,
    action: actor?.action ?? '',
    actor: actor?.actor ?? '',
    role: actor?.role ?? '',
    source: actor?.source ?? 'system',
  })
