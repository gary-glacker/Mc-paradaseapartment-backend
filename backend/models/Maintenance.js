import mongoose from 'mongoose'
import { asJson } from './jsonTransform.js'

const { Schema } = mongoose

/** One note on the maintenance timeline (created / assigned / resolved). */
const updateSchema = new Schema(
  {
    at: { type: Date, default: Date.now },
    by: { type: String, default: '', trim: true },
    text: { type: String, default: '', trim: true },
  },
  { _id: false },
)

/**
 * A repair or service request raised by a tenant from their portal,
 * triaged and closed off by reception.
 */
const maintenanceSchema = new Schema(
  {
    /** Public reference, e.g. `MT-8K2P1Q`. */
    ref: { type: String, required: true, unique: true, trim: true },

    customer: { type: Schema.Types.ObjectId, ref: 'Customer', required: true, index: true },
    room: { type: Schema.Types.ObjectId, ref: 'Room', default: null, index: true },
    tenancy: { type: Schema.Types.ObjectId, ref: 'Tenancy', default: null },
    roomNumber: { type: String, default: '', trim: true },

    category: {
      type: String,
      enum: ['plumbing', 'electrical', 'furniture', 'appliance', 'cleaning', 'other'],
      default: 'other',
      index: true,
    },
    title: { type: String, required: true, trim: true },
    description: { type: String, default: '', trim: true },

    /**
     * Urgency as the tenant sees it, and the priority reception sets
     * once they have triaged it — they are not always the same.
     */
    urgency: { type: String, enum: ['low', 'normal', 'high'], default: 'normal' },
    priority: {
      type: String,
      enum: ['low', 'normal', 'high', 'urgent'],
      default: 'normal',
      index: true,
    },

    status: {
      type: String,
      enum: ['open', 'in_progress', 'resolved', 'rejected'],
      default: 'open',
      index: true,
    },

    assignedTo: { type: String, default: '', trim: true },
    resolution: { type: String, default: '', trim: true },
    resolvedAt: { type: Date, default: null },

    /** Optional photo reference of the problem. */
    photo: { type: String, default: '', trim: true },

    updates: { type: [updateSchema], default: [] },
  },
  { timestamps: true, toJSON: asJson() },
)

maintenanceSchema.index({ createdAt: -1 })

export const Maintenance =
  mongoose.models.Maintenance ?? mongoose.model('Maintenance', maintenanceSchema)
