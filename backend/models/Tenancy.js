import mongoose from 'mongoose'
import { asJson } from './jsonTransform.js'

const { Schema } = mongoose

/**
 * The signed rental agreement between the property and the tenant.
 * Stored on the tenancy so the tenant's portal can display exactly
 * what was agreed, and who signed it.
 */
const agreementSchema = new Schema(
  {
    /** Serial the two parties reference on the printed copy. */
    reference: { type: String, default: '', trim: true },
    code: { type: String, default: '', trim: true, index: true },
    status: { type: String, enum: ['draft', 'pending_approval', 'approved', 'rejected'], default: 'draft' },
    approvedBy: { type: String, default: '', trim: true },
    approvedAt: { type: Date, default: null },
    signedAt: { type: Date, default: null },
    /** Typed full name of the tenant as their signature. */
    tenantSignature: { type: String, default: '', trim: true },
    /** Typed full name of the staff member who countersigned. */
    staffSignature: { type: String, default: '', trim: true },
    /** Free-text terms shown on the agreement. */
    terms: { type: [String], default: [] },
    /** Generated body of the agreement, stored for the record. */
    body: { type: String, default: '' },
    /** Fillable agreement data matching the template (parties, rent, deposit, inventory, etc.) */
    data: { type: Schema.Types.Mixed, default: {} },
    /** Generated files */
    docxUrl: { type: String, default: '', trim: true },
    pdfUrl: { type: String, default: '', trim: true },
    /** Sharing */
    shareToken: { type: String, default: '', trim: true },
    sharedAt: { type: Date, default: null },
  },
  { _id: false },
)

/**
 * Everything reception hands over at check-in: keys, access cards,
 * towels, house rules and any extra requirements for the room.
 */
const requirementSchema = new Schema(
  {
    label: { type: String, required: true, trim: true },
    /** Whether reception has handed this over / checked it off. */
    done: { type: Boolean, default: false },
    doneAt: { type: Date, default: null },
  },
  { _id: false },
)

const tenancySchema = new Schema(
  {
    /** Public reference, e.g. `TN-4F9K2A`. */
    ref: { type: String, required: true, unique: true, trim: true },

    customer: { type: Schema.Types.ObjectId, ref: 'Customer', required: true, index: true },
    room: { type: Schema.Types.ObjectId, ref: 'Room', required: true, index: true },
    /** Snapshot so history survives a room rename. */
    roomNumber: { type: String, default: '', trim: true },
    roomName: { type: String, default: '', trim: true },

    /** Booking that started this tenancy, when there was one. */
    booking: { type: Schema.Types.ObjectId, ref: 'Booking', default: null },

    checkIn: { type: String, required: true }, // YYYY-MM-DD
    checkOut: { type: String, required: true }, // YYYY-MM-DD
    nights: { type: Number, default: 0, min: 0 },
    guests: { type: Number, default: 1, min: 1 },

    /** Locked-in rate for this tenancy. */
    pricePerNight: { type: Number, default: 0, min: 0 },
    currency: { type: String, default: 'USD' },
    /** Nights x rate, before any discount. */
    total: { type: Number, default: 0, min: 0 },

    status: {
      type: String,
      enum: ['pending', 'active', 'ended', 'cancelled'],
      default: 'pending',
      index: true,
    },

    /** Free gym access included with the tenancy. */
    gymIncluded: { type: Boolean, default: true },
 
    agreement: { type: agreementSchema, default: () => ({}) },
    requirements: { type: [requirementSchema], default: [] },
    agreementTemplate: { type: Schema.Types.ObjectId, ref: 'AgreementTemplate', default: null },

    /** Who created the tenancy at the desk. */
    createdBy: { type: String, default: '', trim: true },
    notes: { type: String, default: '', trim: true },
  },
  { timestamps: true, toJSON: asJson() },
)

/* Reporting-friendly indexes. */
tenancySchema.index({ checkIn: 1 })
tenancySchema.index({ createdAt: -1 })

export const Tenancy = mongoose.models.Tenancy ?? mongoose.model('Tenancy', tenancySchema)
