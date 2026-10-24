import { randomBytes } from 'node:crypto'

// In-memory token store; fine for dev/single instance
const tokens = new Map()

export function createResetToken(customerId) {
  const token = randomBytes(32).toString('hex')
  const expires = Date.now() + 60 * 60 * 1000 // 1 hour
  tokens.set(token, { customerId: String(customerId), expires })
  return token
}

export function verifyResetToken(token) {
  const entry = tokens.get(token)
  if (!entry) return null
  if (Date.now() > entry.expires) {
    tokens.delete(token)
    return null
  }
  return entry.customerId
}

export function consumeResetToken(token) {
  const entry = verifyResetToken(token)
  if (!entry) return null
  tokens.delete(token)
  return entry
}
