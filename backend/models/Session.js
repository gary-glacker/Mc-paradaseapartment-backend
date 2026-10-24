import mongoose from 'mongoose'
import { asJson } from './jsonTransform.js'

const { Schema } = mongoose

/**
 * A signed-in dashboard session. The TTL index lets MongoDB delete the
 * document automatically once `expiresAt` passes — no cron required.
 */
const sessionSchema = new Schema(
  {
    token: { type: String, required: true, unique: true },
    admin: { type: Schema.Types.ObjectId, ref: 'Admin', required: true },
    expiresAt: { type: Date, required: true, index: { expires: 0 } },
  },
  { timestamps: true, toJSON: asJson() },
)

export const Session = mongoose.models.Session ?? mongoose.model('Session', sessionSchema)
