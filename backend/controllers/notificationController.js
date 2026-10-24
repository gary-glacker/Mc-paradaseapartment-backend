import mongoose from 'mongoose'
import { Notification } from '../models/index.js'

/** GET /api/notifications */
export async function listNotifications(req, res) {
  const [notifications, unread] = await Promise.all([
    Notification.find().sort({ createdAt: -1 }).limit(50),
    Notification.countDocuments({ read: false }),
  ])
  res.json({ notifications, unread })
}

/** POST /api/notifications/read — marks one (by id) or all as read. */
export async function markRead(req, res) {
  const { id } = req.body ?? {}
  if (id && mongoose.isValidObjectId(id)) {
    await Notification.updateOne({ _id: id }, { read: true })
  } else {
    await Notification.updateMany({ read: false }, { read: true })
  }
  res.json({ unread: await Notification.countDocuments({ read: false }) })
}

/** DELETE /api/notifications — clears the whole feed. */
export async function clearNotifications(req, res) {
  await Notification.deleteMany({})
  res.json({ ok: true, unread: 0 })
}
