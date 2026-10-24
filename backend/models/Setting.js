import mongoose from 'mongoose'
import { asJson } from './jsonTransform.js'

const { Schema } = mongoose

/**
 * System-wide settings. There is exactly one document, identified by a
 * fixed `key`, so the API can always `findOne`/`upsert` it.
 *
 * Currently this holds the currency configuration: an amount is stored
 * in one base currency (USD) and can be *displayed and entered* in a
 * second currency (RWF) using a manually maintained exchange rate.
 * Keeping a single base in the database means reports never have to mix
 * currencies when they add things up.
 */
const settingSchema = new Schema(
  {
    /** Singleton discriminator — always `system`. */
    key: { type: String, required: true, unique: true, default: 'system' },

    /* ----------------------------- currency ----------------------------- */

    /** What reception enters and the public site shows by default: `USD` or `RWF`. */
    displayCurrency: { type: String, enum: ['USD', 'RWF'], default: 'USD' },

    /** The currency every amount is *stored* in. Reports always sum this. */
    baseCurrency: { type: String, enum: ['USD', 'RWF'], default: 'USD' },

    /**
     * How many units of the alternate currency one base unit is worth.
     * With a USD base and an RWF alternate: `1 USD = exchangeRate RWF`.
     * Must be greater than zero.
     */
    exchangeRate: { type: Number, default: 1300, min: 0.0001 },

    /** The currency `exchangeRate` converts *into*. */
    alternateCurrency: { type: String, enum: ['USD', 'RWF'], default: 'RWF' },

    /** Shown next to the rate in the dashboard, e.g. `Bank of Kigali, 22 Oct 2026`. */
    rateNote: { type: String, default: '', trim: true },
  },
  { timestamps: true, toJSON: asJson((ret) => ({ ...ret, id: ret._id?.toString() })) },
)

export const Setting = mongoose.models.Setting ?? mongoose.model('Setting', settingSchema)
