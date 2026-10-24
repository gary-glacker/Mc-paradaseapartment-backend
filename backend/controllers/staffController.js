import mongoose from 'mongoose'
import { Admin, Session } from '../models/index.js'
import { hashPassword } from '../utils/auth.js'
import { publicAdmin, str } from '../utils/helpers.js'

/** The staff roles the dashboard understands. */
export const STAFF_ROLES = ['Admin', 'Reception']

/**
 * GET /api/staff
 * Who can sign into the dashboard. Only an Admin sees this list.
 */
export async function listStaff(_req, res) {
  const staff = await Admin.find({}).sort({ createdAt: 1 })
  res.json({ staff: staff.map(publicAdmin) })
}

/**
 * POST /api/staff
 * Admin creates a reception (or another admin) account with a password.
 */
export async function createStaff(req, res) {
  const b = req.body ?? {}
  const username = str(b.username, 40).toLowerCase()
  const name = str(b.name, 60) || username
  const password = String(b.password ?? '')
  const role = STAFF_ROLES.includes(b.role) ? b.role : 'Reception'

  if (!username) return res.status(400).json({ error: 'Username is required.' })
  if (!/^[a-z0-9._-]{3,}$/.test(username)) {
    return res.status(400).json({ error: 'Username must be at least 3 characters (letters, numbers, . _ -).' })
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters.' })
  }

  const taken = await Admin.findOne({ username })
  if (taken) return res.status(409).json({ error: 'That username is already taken.' })

  const admin = await Admin.create({
    username,
    name,
    role,
    email: str(b.email, 160).toLowerCase(),
    password: hashPassword(password),
  })

  res.status(201).json({ staff: publicAdmin(admin) })
}

/** PATCH /api/staff/:id — rename or change a staff member's role. */
export async function updateStaff(req, res) {
  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(404).json({ error: 'Staff member not found.' })
  }
  const admin = await Admin.findById(req.params.id)
  if (!admin) return res.status(404).json({ error: 'Staff member not found.' })

  const b = req.body ?? {}

  if (b.name !== undefined) admin.name = str(b.name, 60) || admin.name
  if (b.email !== undefined) admin.email = str(b.email, 160).toLowerCase()

  if (b.username !== undefined) {
    const next = str(b.username, 40).toLowerCase()
    if (next && next !== admin.username) {
      const taken = await Admin.findOne({ username: next, _id: { $ne: admin._id } })
      if (taken) return res.status(409).json({ error: 'That username is already taken.' })
      admin.username = next
    }
  }

  if (b.role !== undefined) {
    if (!STAFF_ROLES.includes(b.role)) {
      return res.status(400).json({ error: 'Unknown role.' })
    }
    /* Never leave the system without an admin. */
    if (admin.role === 'Admin' && b.role !== 'Admin') {
      const admins = await Admin.countDocuments({ role: 'Admin' })
      if (admins <= 1) {
        return res.status(409).json({ error: 'At least one Admin account must remain.' })
      }
    }
    admin.role = b.role
  }

  await admin.save()
  res.json({ staff: publicAdmin(admin) })
}

/** POST /api/staff/:id/password — an Admin resets a colleague's password. */
export async function setStaffPassword(req, res) {
  const admin = await Admin.findById(req.params.id)
  if (!admin) return res.status(404).json({ error: 'Staff member not found.' })

  const password = String(req.body?.password ?? '')
  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters.' })
  }

  admin.password = hashPassword(password)
  await admin.save()
  await Session.deleteMany({ admin: admin._id })
  res.json({ ok: true })
}

/** DELETE /api/staff/:id */
export async function deleteStaff(req, res) {
  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(404).json({ error: 'Staff member not found.' })
  }
  const admin = await Admin.findById(req.params.id)
  if (!admin) return res.status(404).json({ error: 'Staff member not found.' })

  if (String(admin._id) === String(req.admin._id)) {
    return res.status(409).json({ error: 'You cannot delete your own account.' })
  }
  if (admin.role === 'Admin') {
    const admins = await Admin.countDocuments({ role: 'Admin' })
    if (admins <= 1) return res.status(409).json({ error: 'At least one Admin account must remain.' })
  }

  await Session.deleteMany({ admin: admin._id })
  await Admin.deleteOne({ _id: admin._id })
  res.json({ ok: true })
}
