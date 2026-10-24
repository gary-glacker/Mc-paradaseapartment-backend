import mongoose from 'mongoose'
import { asJson } from './jsonTransform.js'

const { Schema } = mongoose

/** Date-only values are kept as `YYYY-MM-DD` strings — the UI never needs a timezone. */
const guestSchema = new Schema(
  {
    fullName: { type: String, required: true, trim: true },
    phone: { type: String, required: true, trim: true },
    email: { type: String, default: '', trim: true, lowercase: true },
    notes: { type: String, default: '', trim: true },
  },
  { _id: false },
)

/** Entry / exit dates for a stay (apartment bookings). */
const staySchema = new Schema(
  {
    checkIn: { type: String, default: null }, // date d'entrée  — entry
    checkOut: { type: String, default: null }, // date de sortie — exit
    nights: { type: Number, default: 0, min: 0 },
    adults: { type: Number, default: 0, min: 0 },
    children: { type: Number, default: 0, min: 0 },
    guests: { type: Number, default: 0, min: 0 },
    rooms: { type: Number, default: 0, min: 0 },
  },
  { _id: false },
)

/** One-off dates for gym subscriptions and restaurant tables. */
const scheduleSchema = new Schema(
  {
    startDate: { type: String, default: null },
    date: { type: String, default: null },
    time: { type: String, default: null },
    people: { type: Number, default: 0, min: 0 },
  },
  { _id: false },
)

/** What the guest owes and whether it has been settled. */
const paymentSchema = new Schema(
  {
    method: { type: String, default: '' }, // bank | cash | card
    status: { type: String, enum: ['unpaid', 'partial', 'paid'], default: 'unpaid' },
    reference: { type: String, default: '' },
    amountPaid: { type: Number, default: 0, min: 0 },
    paidAt: { type: Date, default: null },
  },
  { _id: false },
)

const bookingSchema = new Schema(
  {
    ref: { type: String, required: true, unique: true, trim: true },
    kind: { type: String, required: true, enum: ['apartment', 'gym', 'restaurant'], index: true },
    status: {
      type: String,
      required: true,
      enum: ['pending', 'confirmed', 'rejected', 'cancelled'],
      default: 'pending',
      index: true,
    },

    /* Link back to the residence being booked (apartment bookings only). */
    property: { type: Schema.Types.ObjectId, ref: 'Property', default: null, index: true },
    propertyName: { type: String, default: '', trim: true },

    /* Set once reception confirms the booking into a physical room. */
    room: { type: Schema.Types.ObjectId, ref: 'Room', default: null, index: true },
    roomNumber: { type: String, default: '', trim: true },

    /*
     * What the guest asked for on the website. This is a preference, not
     * a reservation — reception still assigns the real room, which may be
     * a different unit.
     */
    requestedRoom: { type: Schema.Types.ObjectId, ref: 'Room', default: null },
    requestedRoomNumber: { type: String, default: '', trim: true },

    item: { type: String, default: '', trim: true },
    detail: { type: String, default: '', trim: true },
    total: { type: Number, default: 0, min: 0 },
    currency: { type: String, default: 'USD' },

    guest: { type: guestSchema, required: true },
    stay: { type: staySchema, default: () => ({}) },
    schedule: { type: scheduleSchema, default: () => ({}) },
    payment: { type: paymentSchema, default: () => ({}) },

    /*
     * Derived, read-only fields the API fills in on every response so the
     * UI can show the linked financial receipt. They are never written to
     * the collection — `bookingController` sets them in memory only.
     */
    receiptId: { type: String, default: null },
    receiptRef: { type: String, default: null },
    receiptVoided: { type: Boolean, default: false },
  },
  { timestamps: true, toJSON: asJson() },
)

/* Reporting-friendly indexes. */
bookingSchema.index({ 'stay.checkIn': 1 })
bookingSchema.index({ createdAt: -1 })

export const Booking = mongoose.models.Booking ?? mongoose.model('Booking', bookingSchema)
