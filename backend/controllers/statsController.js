import { Booking, Notification } from '../models/index.js'
import { dayKey, startOfToday } from '../utils/helpers.js'

/**
 * GET /api/stats
 * Everything the Overview page shows: counters, revenue, a 14-day
 * intake chart, arrival pressure and the most recent requests.
 */
export async function getStats(req, res) {
  const today = dayKey(startOfToday())
  const since = new Date(startOfToday())
  since.setDate(since.getDate() - 13)

  const [total, kindAgg, statusAgg, revenueAgg, daily, recent, unread, todayCount, arrivals, nightsAgg] =
    await Promise.all([
      Booking.countDocuments(),
      Booking.aggregate([{ $group: { _id: '$kind', n: { $sum: 1 } } }]),
      Booking.aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }]),
      Booking.aggregate([
        { $match: { status: 'confirmed' } },
        { $group: { _id: null, total: { $sum: '$total' } } },
      ]),
      Booking.aggregate([
        { $match: { createdAt: { $gte: since } } },
        {
          $group: {
            _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
            n: { $sum: 1 },
          },
        },
      ]),
      Booking.find().sort({ createdAt: -1 }).limit(6),
      Notification.countDocuments({ read: false }),
      Booking.countDocuments({ createdAt: { $gte: startOfToday() } }),

      /* Guests arriving today or later, still live. */
      Booking.countDocuments({
        'stay.checkIn': { $gte: today },
        status: { $in: ['pending', 'confirmed'] },
      }),

      /* Total nights sold across confirmed stays. */
      Booking.aggregate([
        { $match: { status: 'confirmed', kind: 'apartment' } },
        { $group: { _id: null, nights: { $sum: '$stay.nights' } } },
      ]),
    ])

  const byKind = { apartment: 0, gym: 0, restaurant: 0 }
  for (const g of kindAgg) byKind[g._id] = g.n

  const byStatus = { pending: 0, confirmed: 0, rejected: 0, cancelled: 0 }
  for (const s of statusAgg) byStatus[s._id] = s.n

  const perDay = Object.fromEntries(daily.map((d) => [d._id, d.n]))
  const last14 = []
  for (let i = 13; i >= 0; i -= 1) {
    const d = new Date(startOfToday())
    d.setDate(d.getDate() - i)
    const key = dayKey(d)
    last14.push({ date: key, count: perDay[key] ?? 0 })
  }

  res.json({
    total,
    revenue: revenueAgg[0]?.total ?? 0,
    byKind,
    byStatus,
    last14,
    recent,
    unread,
    todayCount,
    upcomingArrivals: arrivals,
    nightsSold: nightsAgg[0]?.nights ?? 0,
  })
}
