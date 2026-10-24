import mongoose from 'mongoose'
import { asJson } from './jsonTransform.js'

const { Schema } = mongoose

/**
 * A public section of the website. The manager can publish or hide each
 * one, and the live site removes hidden sections.
 */
const pageSchema = new Schema(
  {
    slug: { type: String, required: true, unique: true },
    label: { type: String, required: true },
    path: { type: String, required: true },
    description: { type: String, default: '' },
    order: { type: Number, default: 0 },
    status: { type: String, enum: ['live', 'hidden'], default: 'live' },
  },
  { timestamps: true, toJSON: asJson((ret) => ({ ...ret, id: ret.slug })) },
)

export const Page = mongoose.models.Page ?? mongoose.model('Page', pageSchema)
