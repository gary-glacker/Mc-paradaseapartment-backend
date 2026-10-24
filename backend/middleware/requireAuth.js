import { Session } from '../models/index.js'

/**
 * Reads `Authorization: Bearer <token>`, verifies the session against
 * MongoDB and attaches `req.admin` / `req.session`.
 */
export async function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization || ''
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : null
    if (!token) return res.status(401).json({ error: 'Not signed in.' })

    const session = await Session.findOne({ token }).populate('admin')
    if (!session || !session.admin) {
      if (session) await Session.deleteOne({ _id: session._id })
      return res.status(401).json({ error: 'Session expired. Please sign in again.' })
    }
    if (session.expiresAt.getTime() < Date.now()) {
      await Session.deleteOne({ _id: session._id })
      return res.status(401).json({ error: 'Session expired. Please sign in again.' })
    }

    req.admin = session.admin
    req.session = session
    next()
  } catch (err) {
    next(err)
  }
}

export default requireAuth
