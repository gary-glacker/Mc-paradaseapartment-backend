import mongoose from 'mongoose'
import { asJson } from './jsonTransform.js'

const { Schema } = mongoose

/**
 * A customer (tenant / guest) with their own portal login. Reception
 * creates the account — usually while confirming a booking — and picks
 * the role. Sign-in is by phone number or national ID.
 */
const customerSchema = new Schema(
  {
    /** Human-friendly identifier the reception desk can quote. */
    code: { type: String, required: true, unique: true, trim: true },

    fullName: { type: String, required: true, trim: true },
    /** National ID / passport number. Required and unique per person. */
    nationalId: { type: String, required: true, unique: true, trim: true },
    phone: { type: String, required: true, trim: true, index: true },
    email: { type: String, default: '', trim: true, lowercase: true },

    address: { type: String, default: '', trim: true },
    /** Optional photo/scan reference for the ID document. */
    idDocument: { type: String, default: '', trim: true },

    /** scrypt hash (`salt:hash`) — same format as staff accounts. */
    password: { type: String, required: true },

    role: {
      type: String,
      enum: ['tenant', 'guest'],
      default: 'tenant',
      index: true,
    },

    /** Free gym access is included with every active tenancy. */
    gymIncluded: { type: Boolean, default: true },

    active: { type: Boolean, default: true, index: true },
    notes: { type: String, default: '', trim: true },

    /** Who registered them, for the audit trail. */
    registeredBy: { type: String, default: '', trim: true },
  },
  { timestamps: true, toJSON: asJson() },
)

export const Customer =
  mongoose.models.Customer ?? mongoose.model('Customer', customerSchema)
