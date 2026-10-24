import mongoose from 'mongoose'
import { asJson } from './jsonTransform.js'

const { Schema } = mongoose

/** Weekly housekeeping / service offerings tied to a room. */
const amenitySchema = new Schema(
  {
    key: { type: String, required: true, trim: true },
    label: { type: String, required: true, trim: true },
    /** Whether the guest must pay extra for this amenity. */
    chargeable: { type: Boolean, default: false },
    price: { type: Number, default: 0, min: 0 },
  },
  { _id: false },
)

/**
 * A physical rentable room. The building has a fixed set of rooms;
 * each one knows its bed count and nightly rate, which is what drives
 * the price the reception desk quotes.
 */
const roomSchema = new Schema(
  {
    /** Short human code, e.g. `R-101`. Unique per building. */
    number: { type: String, required: true, unique: true, trim: true },
    name: { type: String, default: '', trim: true },

    floor: { type: String, default: '', trim: true },
    sizeM2: { type: Number, default: 0, min: 0 },

    /**
     * Number of beds — the pricing driver. The manager sets
     * `pricePerNight` explicitly, so a 2-bed room can be 80 and a
     * 1-bed room 50 without hard-coding the rule.
     */
    beds: { type: Number, required: true, min: 1, index: true },
    bedrooms: { type: Number, default: 1, min: 0 },
    bathrooms: { type: Number, default: 1, min: 0 },
    /** Maximum people allowed to stay. */
    maxGuests: { type: Number, default: 2, min: 1 },

    pricePerNight: { type: Number, required: true, min: 0 },
    currency: { type: String, default: 'USD' },

    amenities: {
      type: [amenitySchema],
      default: [
        { key: 'wifi', label: 'High-speed Wi-Fi' },
        { key: 'tv', label: 'Smart TV' },
        { key: 'ac', label: 'Air conditioning' },
      ],
    },
    images: { type: [String], default: [] },

    /**
     * occupancy is derived from bookings, but the manager can also take
     * a room out of service for repairs.
     */
    status: {
      type: String,
      enum: ['available', 'occupied', 'maintenance'],
      default: 'available',
      index: true,
    },
    /** Rooms not published are hidden from the website catalogue. */
    active: { type: Boolean, default: true, index: true },
    notes: { type: String, default: '', trim: true },
  },
  { timestamps: true, toJSON: asJson() },
)

export const Room = mongoose.models.Room ?? mongoose.model('Room', roomSchema)
