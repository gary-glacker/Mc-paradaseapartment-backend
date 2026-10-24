import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'

/** Hash a password with scrypt + a random salt. Stored as `salt:hash`. */
export const hashPassword = (password) => {
  const salt = randomBytes(16).toString('hex')
  const hash = scryptSync(password, salt, 64).toString('hex')
  return `${salt}:${hash}`
}

/** Constant-time verification of a password against a stored `salt:hash`. */
export const verifyPassword = (password, stored) => {
  const [salt, hash] = String(stored ?? '').split(':')
  if (!salt || !hash) return false
  const test = scryptSync(password, salt, 64)
  const expected = Buffer.from(hash, 'hex')
  return expected.length === test.length && timingSafeEqual(expected, test)
}

/** Opaque bearer token for a session. */
export const newToken = () => randomBytes(32).toString('hex')

/** Short, human-friendly booking reference — e.g. `MC-7F3K2A`. */
export const newBookingRef = () => `MC-${randomBytes(3).toString('hex').toUpperCase()}`

/** Build a short prefixed reference, e.g. `TN-4F9K2A`, `PY-3M8Q2K`. */
export const newRef = (prefix) => `${prefix}-${randomBytes(3).toString('hex').toUpperCase()}`

/** Customer accounts, tenancies, payments and maintenance requests. */
export const newCustomerCode = () => newRef('CU')
export const newTenancyRef = () => newRef('TN')
export const newPaymentRef = () => newRef('PY')
export const newMaintenanceRef = () => newRef('MT')

/** Sessions last 7 days by default. */
export const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7
