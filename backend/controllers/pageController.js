import { Booking, Page } from '../models/index.js'
import { PAGE_KIND, SITE_SECTIONS } from '../utils/helpers.js'

/**
 * Create any section rows that are missing. Sections are defined in
 * code (SITE_SECTIONS); this only ever *inserts*, so a manager's
 * live/hidden choice is never overwritten. Called on dashboard read
 * so the Site pages screen always has something to show.
 */
export async function ensureSections() {
  const ops = SITE_SECTIONS.map((s) => ({
    updateOne: {
      filter: { slug: s.slug },
      update: {
        $set: { label: s.label, path: s.path, description: s.description, order: s.order },
        $setOnInsert: { status: 'live' },
      },
      upsert: true,
    },
  }))
  const res = await Page.bulkWrite(ops, { ordered: false })
  return res.upsertedCount ?? 0
}

/** GET /api/pages — public visibility list used by the live site. */
export async function listPublicPages(req, res) {
  const pages = await Page.find().sort({ order: 1, createdAt: 1 })
  res.json({
    pages: pages.map(({ slug, label, path, status }) => ({ id: slug, label, path, status })),
  })
}

/** GET /api/pages/admin — every section plus how many bookings it brought in. */
export async function listAdminPages(req, res) {
  await ensureSections()

  const [pages, grouped] = await Promise.all([
    Page.find().sort({ order: 1, createdAt: 1 }),
    Booking.aggregate([
      { $group: { _id: '$kind', n: { $sum: 1 }, revenue: { $sum: '$total' } } },
    ]),
  ])

  const counts = Object.fromEntries(grouped.map((g) => [g._id, g.n]))
  const revenue = Object.fromEntries(grouped.map((g) => [g._id, g.revenue ?? 0]))

  res.json({
    pages: pages.map((p) => {
      const kind = PAGE_KIND[p.slug]
      return {
        ...p.toJSON(),
        bookings: kind ? (counts[kind] ?? 0) : 0,
        revenue: kind ? (revenue[kind] ?? 0) : 0,
      }
    }),
  })
}

/** PATCH /api/pages/:slug */
export async function updatePageStatus(req, res) {
  const { status } = req.body ?? {}
  if (status !== 'live' && status !== 'hidden') {
    return res.status(400).json({ error: 'Status must be "live" or "hidden".' })
  }
  const page = await Page.findOneAndUpdate({ slug: req.params.slug }, { status }, { new: true })
  if (!page) return res.status(404).json({ error: 'Page not found.' })
  res.json({ page })
}
