import mongoose from 'mongoose'
import { asJson } from './jsonTransform.js'

const { Schema } = mongoose

/**
 * A single money movement against a tenancy, booking or room. The
 * financial report sums these by method (bank / momo / cash) and by
 * room, so every figure the manager sees traces back to a receipt.
 */
const paymentRecordSchema = new Schema(
  {
    /** Public receipt reference, e.g. `PY-3M8Q2K`. */
    ref: { type: String, required: true, unique: true, trim: true },

    customer: { type: Schema.Types.ObjectId, ref: 'Customer', default: null, index: true },
    tenancy: { type: Schema.Types.ObjectId, ref: 'Tenancy', default: null, index: true },
    booking: { type: Schema.Types.ObjectId, ref: 'Booking', default: null, index: true },
    room: { type: Schema.Types.ObjectId, ref: 'Room', default: null, index: true },
    roomNumber: { type: String, default: '', trim: true },

    /** What the money was for. */
    purpose: {
      type: String,
      enum: ['rent', 'deposit', 'service', 'gym', 'restaurant', 'other'],
      default: 'rent',
      index: true,
    },

    method: {
      type: String,
      enum: ['bank', 'momo', 'cash', 'card'],
      required: true,
      index: true,
    },
    amount: { type: Number, required: true, min: 0 },
    /** Always the **base** currency — every report sums this field. */
    currency: { type: String, default: 'USD' },

    /**
     * What the desk actually typed, in whatever currency they used.
     * Kept so a receipt can show the original figure alongside the
     * converted, stored amount.
     */
    enteredAmount: { type: Number, default: 0, min: 0 },
    enteredCurrency: { type: String, default: '' },

    /** Bank slip number, MoMo transaction id, or receipt number. */
    reference: { type: String, default: '', trim: true },
    paidAt: { type: Date, default: Date.now, index: true },

    /** Who took the money at the desk. */
    receivedBy: { type: String, default: '', trim: true },
    notes: { type: String, default: '', trim: true },

    /** Reversals stay on the record rather than being deleted. */
    voided: { type: Boolean, default: false, index: true },
    voidReason: { type: String, default: '', trim: true },
  },
  { timestamps: true, toJSON: asJson() },
)

paymentRecordSchema.index({ createdAt: -1 })

export const Payment =
  mongoose.models.Payment ?? mongoose.model('Payment', paymentRecordSchema)
