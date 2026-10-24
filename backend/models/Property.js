import mongoose from 'mongoose'
import { asJson } from './jsonTransform.js'

const { Schema } = mongoose

/**
 * A residence the property manager rents out. `slug` mirrors the id the
 * public site uses (e.g. `deluxe-studio`), so a booking made on the
 * website can be linked back to the exact unit.
 */
const propertySchema = new Schema(
  {
    slug: { type: String, required: true, unique: true, trim: true, lowercase: true },
    name: { type: String, required: true, trim: true },
    kind: {
      type: String,
      enum: ['studio', 'suite', 'family', 'penthouse'],
      default: 'studio',
      index: true,
    },
    tagline: { type: String, default: '', trim: true },
    description: { type: String, default: '', trim: true },

    pricePerNight: { type: Number, default: 0, min: 0 },
    currency: { type: String, default: 'USD' },

    /** Maximum occupancy; `guests` is the total the manager enforces. */
    guests: { type: Number, default: 2, min: 1 },
    adults: { type: Number, default: 2, min: 1 },
    children: { type: Number, default: 0, min: 0 },

    beds: { type: Number, default: 1, min: 0 },
    bedrooms: { type: Number, default: 1, min: 0 },
    bathrooms: { type: Number, default: 1, min: 0 },
    sizeM2: { type: Number, default: 0, min: 0 },
    floor: { type: String, default: '', trim: true },

    amenities: { type: [String], default: [] },
    images: { type: [String], default: [] },

    /* Management state */
    status: {
      type: String,
      enum: ['available', 'occupied', 'maintenance'],
      default: 'available',
      index: true,
    },
    /** Unpublished units stay in the manager's list but are not bookable. */
    active: { type: Boolean, default: true, index: true },
    notes: { type: String, default: '', trim: true },
  },
  { timestamps: true, toJSON: asJson() },
)

export const Property = mongoose.models.Property ?? mongoose.model('Property', propertySchema)
