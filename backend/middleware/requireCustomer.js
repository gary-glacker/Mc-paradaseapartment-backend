import { CustomerSession } from '../models/index.js'

/**
 * Reads `Authorization: Bearer <token>` for the **tenant portal** and
 * attaches `req.customer` / `req.session`.
 *
 * Deliberately separate from `requireAuth`: a customer token can never
 * reach the admin API, and a staff token can never reach the portal.
 */
export async function requireCustomer(req, res, next) {
  try {
    const header = req.headers.authorization || ''
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : null
    if (!token) return res.status(401).json({ error: 'Not signed in.' })

    const session = await CustomerSession.findOne({ token }).populate('customer')
    if (!session || !session.customer) {
      if (session) await CustomerSession.deleteOne({ _id: session._id })
      return res.status(401).json({ error: 'Session expired. Please sign in again.' })
    }
    if (session.expiresAt.getTime() < Date.now()) {
      await CustomerSession.deleteOne({ _id: session._id })
      return res.status(401).json({ error: 'Session expired. Please sign in again.' })
    }
    if (!session.customer.active) {
      return res.status(403).json({ error: 'This account is not active. Please contact reception.' })
    }

    req.customer = session.customer
    req.session = session
    next()
  } catch (err) {
    next(err)
  }
}

/**
 * Restricts a staff route to a set of roles. Chain it after
 * `requireAuth`, e.g. `requireAuth, requireRole('Admin')`.
 */
export function requireRole(...allowed) {
  return (req, res, next) => {
    const role = req.admin?.role ?? ''
    if (!allowed.includes(role)) {
      return res.status(403).json({
        error: 'Your role does not allow this action.',
        required: allowed,
      })
    }
    next()
  }
}

export default requireCustomer
