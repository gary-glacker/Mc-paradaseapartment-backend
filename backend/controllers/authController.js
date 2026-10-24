import { Admin, Session } from '../models/index.js'
import { SESSION_TTL_MS, hashPassword, newToken, verifyPassword } from '../utils/auth.js'
import { publicAdmin, str } from '../utils/helpers.js'

/** POST /api/auth/login */
export async function login(req, res) {
  const { username = '', password = '' } = req.body ?? {}
  const admin = await Admin.findOne({ username: String(username).trim().toLowerCase() })
  if (!admin || !verifyPassword(String(password), admin.password)) {
    return res.status(401).json({ error: 'Incorrect username or password.' })
  }

  const token = newToken()
  await Session.create({
    token,
    admin: admin._id,
    expiresAt: new Date(Date.now() + SESSION_TTL_MS),
  })

  res.json({ token, user: publicAdmin(admin) })
}

/** GET /api/auth/me */
export async function me(req, res) {
  res.json({ user: publicAdmin(req.admin) })
}

/** POST /api/auth/logout */
export async function logout(req, res) {
  await Session.deleteOne({ _id: req.session._id })
  res.json({ ok: true })
}

/** POST /api/auth/password */
export async function changePassword(req, res) {
  const { currentPassword = '', newPassword = '' } = req.body ?? {}
  if (String(newPassword).length < 8) {
    return res.status(400).json({ error: 'New password must be at least 8 characters.' })
  }
  if (!verifyPassword(String(currentPassword), req.admin.password)) {
    return res.status(401).json({ error: 'Current password is incorrect.' })
  }

  req.admin.password = hashPassword(String(newPassword))
  await req.admin.save()

  // Everything except the current session is signed out.
  await Session.deleteMany({ admin: req.admin._id, _id: { $ne: req.session._id } })
  res.json({ ok: true })
}

/** PUT /api/auth/profile */
export async function updateProfile(req, res) {
  const { name, username } = req.body ?? {}
  if (name) req.admin.name = str(name, 60)

  if (username) {
    const next = str(username, 40).toLowerCase()
    const taken = await Admin.findOne({ username: next, _id: { $ne: req.admin._id } })
    if (taken) return res.status(409).json({ error: 'That username is already taken.' })
    req.admin.username = next
  }

  await req.admin.save()
  res.json({ user: publicAdmin(req.admin) })
}
