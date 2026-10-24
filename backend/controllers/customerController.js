import mongoose from 'mongoose'
import { randomBytes } from 'node:crypto'
import { Customer, CustomerSession, Tenancy, Payment } from '../models/index.js'
import {
  SESSION_TTL_MS,
  hashPassword,
  newCustomerCode,
  newToken,
  verifyPassword,
} from '../utils/auth.js'
import { digits, escapeRegex, int, str } from '../utils/helpers.js'
import { createResetToken, consumeResetToken } from '../utils/resetTokens.js'
import { sendMail } from '../utils/mailer.js'

/* ------------------------------------------------------------------ */
/* Shaping                                                             */
/* ------------------------------------------------------------------ */

/** The customer record as the dashboard sees it (never the hash). */
export const publicCustomer = (c) => ({
  id: String(c._id),
  code: c.code,
  fullName: c.fullName,
  nationalId: c.nationalId,
  phone: c.phone,
  email: c.email,
  address: c.address,
  idDocument: c.idDocument,
  role: c.role,
  gymIncluded: c.gymIncluded,
  active: c.active,
  notes: c.notes,
  registeredBy: c.registeredBy,
  createdAt: c.createdAt,
  updatedAt: c.updatedAt,
})

/** Build the writable fields from a request body. */
const readCustomerBody = (body = {}, { partial = false } = {}) => {
  const out = {}
  const put = (key, value) => {
    if (value !== undefined) out[key] = value
  }

  if (body.fullName !== undefined || !partial) put('fullName', str(body.fullName, 120))
  if (body.nationalId !== undefined || !partial) put('nationalId', str(body.nationalId, 60))
  if (body.phone !== undefined || !partial) put('phone', str(body.phone, 40))
  put('email', body.email !== undefined ? str(body.email, 160).toLowerCase() : undefined)
  put('address', body.address !== undefined ? str(body.address, 200) : undefined)
  put('idDocument', body.idDocument !== undefined ? str(body.idDocument, 300) : undefined)
  put('notes', body.notes !== undefined ? str(body.notes, 600) : undefined)
  put('gymIncluded', body.gymIncluded !== undefined ? Boolean(body.gymIncluded) : undefined)
  put('active', body.active !== undefined ? Boolean(body.active) : undefined)

  if (body.role !== undefined) {
    put('role', ['tenant', 'guest'].includes(body.role) ? body.role : 'tenant')
  }

  return out
}

/** Reject anything that would collide with an existing customer. */
async function checkUnique(fields, excludeId = null) {
  const checks = []
  if (fields.nationalId) {
    checks.push(['nationalId', 'A customer with this national ID already exists.'])
  }
  if (fields.phone) {
    checks.push(['phone', 'A customer with this phone number already exists.'])
  }

  for (const [key, message] of checks) {
    const query = { [key]: fields[key] }
    if (excludeId) query._id = { $ne: excludeId }
    if (await Customer.findOne(query).select('_id')) return message
  }
  return null
}

/* ------------------------------------------------------------------ */
/* Admin — customer management                                         */
/* ------------------------------------------------------------------ */

/** GET /api/customers?search=&role=&active=&page=&limit= */
export async function listCustomers(req, res) {
  const { search = '', role = '', active = '' } = req.query
  const page = Math.max(1, int(req.query.page) || 1)
  const limit = Math.min(100, Math.max(1, int(req.query.limit) || 50))

  const query = {}
  if (role) query.role = role
  if (active === 'true') query.active = true
  if (active === 'false') query.active = false
  if (search) {
    const rx = new RegExp(escapeRegex(str(search, 60)), 'i')
    query.$or = [{ fullName: rx }, { phone: rx }, { nationalId: rx }, { code: rx }, { email: rx }]
  }

  const [customers, total] = await Promise.all([
    Customer.find(query)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit),
    Customer.countDocuments(query),
  ])

  res.json({
    customers: customers.map(publicCustomer),
    total,
    page,
    pages: Math.max(1, Math.ceil(total / limit)),
  })
}

/** GET /api/customers/:id — profile with tenancies and payment history. */
export async function getCustomer(req, res) {
  const customer = await Customer.findById(req.params.id)
  if (!customer) return res.status(404).json({ error: 'Customer not found.' })

  const [tenancies, payments] = await Promise.all([
    Tenancy.find({ customer: customer._id }).sort({ checkIn: -1 }),
    Payment.find({ customer: customer._id, voided: false }).sort({ paidAt: -1 }),
  ])

  const paid = payments.reduce((sum, p) => sum + p.amount, 0)

  res.json({
    customer: publicCustomer(customer),
    tenancies: tenancies.map((t) => t.toJSON()),
    payments: payments.map((p) => p.toJSON()),
    totals: { paid },
  })
}

/**
 * POST /api/customers
 * Reception registers a customer and sets their portal password.
 */
export async function createCustomer(req, res) {
  const b = req.body ?? {}
  const fields = readCustomerBody(b)

  if (!fields.fullName) return res.status(400).json({ error: 'Full name is required.' })
  if (!fields.nationalId) return res.status(400).json({ error: 'National ID is required.' })
  if (!fields.phone) return res.status(400).json({ error: 'Phone number is required.' })

  const password = String(b.password ?? '')
  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters.' })
  }

  const clash = await checkUnique(fields)
  if (clash) return res.status(409).json({ error: clash })

  fields.password = hashPassword(password)
  fields.registeredBy = req.admin?.name || req.admin?.username || ''

  /* `code` is generated here so the desk always has an identifier. */
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const customer = await Customer.create({ ...fields, code: newCustomerCode() })
      return res.status(201).json({ customer: publicCustomer(customer) })
    } catch (err) {
      if (err?.code !== 11000) throw err
      /* Duplicate — retry only when it was the generated code. */
      if (!String(err.message).includes('code_1')) throw err
    }
  }
  return res.status(409).json({ error: 'Could not allocate a customer code. Please retry.' })
}

/** PATCH /api/customers/:id */
export async function updateCustomer(req, res) {
  const customer = await Customer.findById(req.params.id)
  if (!customer) return res.status(404).json({ error: 'Customer not found.' })

  const b = req.body ?? {}
  const fields = readCustomerBody(b, { partial: true })

  const clash = await checkUnique(fields, customer._id)
  if (clash) return res.status(409).json({ error: clash })

  Object.assign(customer, fields)
  await customer.save()
  res.json({ customer: publicCustomer(customer) })
}

/** POST /api/customers/:id/password — reception resets a portal password. */
export async function setCustomerPassword(req, res) {
  const customer = await Customer.findById(req.params.id)
  if (!customer) return res.status(404).json({ error: 'Customer not found.' })

  const password = String(req.body?.password ?? '')
  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters.' })
  }

  customer.password = hashPassword(password)
  await customer.save()
  /* Force a fresh sign-in everywhere. */
  await CustomerSession.deleteMany({ customer: customer._id })
  res.json({ ok: true })
}

/**
 * DELETE /api/customers/:id
 * Blocked while an active tenancy exists, unless `?force=true`.
 */
export async function deleteCustomer(req, res) {
  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(404).json({ error: 'Customer not found.' })
  }
  const customer = await Customer.findById(req.params.id)
  if (!customer) return res.status(404).json({ error: 'Customer not found.' })

  const active = await Tenancy.countDocuments({
    customer: customer._id,
    status: { $in: ['pending', 'active'] },
  })
  if (active && req.query.force !== 'true') {
    return res.status(409).json({
      error: `This customer has ${active} open tenancy(ies). End them first, or delete with force.`,
      activeTenancies: active,
    })
  }

  await CustomerSession.deleteMany({ customer: customer._id })
  await Customer.deleteOne({ _id: customer._id })
  res.json({ ok: true })
}

/* ------------------------------------------------------------------ */
/* Customer portal — authentication                                     */
/* ------------------------------------------------------------------ */

/** Sign in with phone, national ID, email or customer code + password. */
async function findCustomerForLogin(identifier) {
  const value = str(identifier, 160)
  if (!value) return null

  /* Exact match on email, phone, national ID or customer code first. */
  const lower = value.toLowerCase()
  const direct = await Customer.findOne({
    $or: [
      { email: lower },
      { phone: value },
      { nationalId: value },
      { code: value.toUpperCase() },
    ],
  })
  if (direct) return direct

  /* Fall back to a suffix comparison on the digits, so the desk can
     type `0788111222` for a number stored as `+250 788 111 222`. */
  const wanted = digits(value)
  if (wanted.length >= 6) {
    const tail = wanted.slice(-9)
    const candidates = await Customer.find({}).select('phone nationalId')
    const match = candidates.find((c) => {
      const phone = digits(c.phone)
      return phone.endsWith(tail) || digits(c.nationalId).endsWith(tail)
    })
    if (match) return Customer.findById(match._id)
  }
  return null
}

/** The same suffix rule, exposed so other controllers can reuse it. */
export const samePhoneTail = (a, b) => {
  const x = digits(a)
  const y = digits(b)
  if (x.length < 6 || y.length < 6) return x === y
  const len = Math.min(9, x.length, y.length)
  return x.slice(-len) === y.slice(-len)
}

/** POST /api/portal/login */
export async function customerLogin(req, res) {
  const { identifier = '', phone = '', email = '', password = '' } = req.body ?? {}
  const customer = await findCustomerForLogin(identifier || phone || email)

  if (!customer || !verifyPassword(String(password), customer.password)) {
    return res.status(401).json({ error: 'Incorrect login details or password.' })
  }
  if (!customer.active) {
    return res.status(403).json({ error: 'This account is not active. Please contact reception.' })
  }

  const token = newToken()
  await CustomerSession.create({
    token,
    customer: customer._id,
    expiresAt: new Date(Date.now() + SESSION_TTL_MS),
  })

  res.json({ token, customer: publicCustomer(customer) })
}

/** GET /api/portal/me */
export async function customerMe(req, res) {
  res.json({ customer: publicCustomer(req.customer) })
}

/** POST /api/portal/logout */
export async function customerLogout(req, res) {
  await CustomerSession.deleteOne({ _id: req.session._id })
  res.json({ ok: true })
}

/** POST /api/portal/password — a customer changes their own password. */
export async function customerChangePassword(req, res) {
  const { currentPassword = '', newPassword = '' } = req.body ?? {}
  if (String(newPassword).length < 6) {
    return res.status(400).json({ error: 'New password must be at least 6 characters.' })
  }
  if (!verifyPassword(String(currentPassword), req.customer.password)) {
    return res.status(401).json({ error: 'Current password is incorrect.' })
  }

  req.customer.password = hashPassword(String(newPassword))
  await req.customer.save()
  await CustomerSession.deleteMany({
    customer: req.customer._id,
    _id: { $ne: req.session._id },
  })
  res.json({ ok: true })
}

/** POST /api/portal/forgot-password */
export async function forgotPassword(req, res) {
  const { email = '', identifier = '' } = req.body ?? {}
  const value = str(email || identifier, 160).toLowerCase()
  if (!value) {
    return res.status(400).json({ error: 'Enter your email address.' })
  }

  const customer = await Customer.findOne({ email: value, active: true })
  if (!customer) {
    // Don't reveal if account exists
    return res.json({ ok: true, message: 'If an account exists with that email, a new password has been sent.' })
  }

  const newPassword = randomBytes(4).toString('hex') // 8 chars
  customer.password = hashPassword(newPassword)
  await customer.save()
  await CustomerSession.deleteMany({ customer: customer._id })

  await sendMail({
    to: customer.email,
    subject: 'Your MC Paradise Apartment new password',
    text: `Hello ${customer.fullName},\n\nYour password has been reset.\n\nNew password: ${newPassword}\n\nYou can sign in at: ${process.env.PUBLIC_SITE_URL || 'http://localhost:5173'}/portal/login\n\nFor security, please change this password after signing in.\n\nMC Paradise Apartment`,
    html: `<p>Hello ${customer.fullName},</p><p>Your password has been reset.</p><p><strong>New password:</strong> ${newPassword}</p><p>You can sign in here: <a href="${process.env.PUBLIC_SITE_URL || 'http://localhost:5173'}/portal/login">MC Paradise Tenant Portal</a></p><p>For security, please change this password after signing in.</p><p>MC Paradise Apartment</p>`,
  })

  res.json({ ok: true, message: 'A new password has been sent to your email.' })
}

/** POST /api/portal/reset-password */
export async function resetPassword(req, res) {
  const { token = '', password = '' } = req.body ?? {}
  if (!token) return res.status(400).json({ error: 'Invalid or missing reset token.' })
  if (String(password).length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters.' })
  }

  const customerId = consumeResetToken(token)
  if (!customerId) {
    return res.status(400).json({ error: 'Invalid or expired reset token.' })
  }

  const customer = await Customer.findById(customerId)
  if (!customer) return res.status(404).json({ error: 'Customer not found.' })

  customer.password = hashPassword(String(password))
  await customer.save()
  await CustomerSession.deleteMany({ customer: customer._id })

  res.json({ ok: true, message: 'Password reset successful. You can now sign in.' })
}
