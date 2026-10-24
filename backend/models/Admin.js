import mongoose from 'mongoose'
import { asJson } from './jsonTransform.js'

const { Schema } = mongoose

/** A dashboard user. Passwords are scrypt hashes (`salt:hash`). */
const adminSchema = new Schema(
  {
    username: { type: String, required: true, unique: true, lowercase: true, trim: true },
    name: { type: String, default: 'Administrator', trim: true },
    role: { type: String, default: 'Admin' },
    /* Optional — used to receive "new booking" alerts. */
    email: { type: String, default: '', trim: true, lowercase: true },
    password: { type: String, required: true },
  },
  { timestamps: true, toJSON: asJson() },
)

export const Admin = mongoose.models.Admin ?? mongoose.model('Admin', adminSchema)
