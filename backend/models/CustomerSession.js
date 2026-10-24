import mongoose from 'mongoose'
import { asJson } from './jsonTransform.js'

const { Schema } = mongoose

/**
 * A signed-in customer session for the tenant portal. Kept separate
 * from staff sessions so a customer token can never reach the admin
 * API, and vice versa. The TTL index cleans expired rows automatically.
 */
const customerSessionSchema = new Schema(
  {
    token: { type: String, required: true, unique: true },
    customer: { type: Schema.Types.ObjectId, ref: 'Customer', required: true },
    expiresAt: { type: Date, required: true, index: { expires: 0 } },
  },
  { timestamps: true, toJSON: asJson() },
)

export const CustomerSession =
  mongoose.models.CustomerSession ?? mongoose.model('CustomerSession', customerSessionSchema)
