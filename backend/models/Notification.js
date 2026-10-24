import mongoose from 'mongoose'
import { asJson } from './jsonTransform.js'

const { Schema } = mongoose

/** An in-dashboard alert, created when a booking arrives or changes. */
const notificationSchema = new Schema(
  {
    title: { type: String, required: true },
    body: { type: String, default: '' },
    bookingRef: { type: String, default: null },
    read: { type: Boolean, default: false, index: true },

    /*
     * Who/what caused the entry.
     *  - action: short verb phrase, e.g. "Booking confirmed", "Room assigned"
     *  - actor:  the dashboard user responsible ("Desk One")
     *  - role:   their role at the time ("Reception")
     *  - source: 'staff' for a person's action, 'guest' for the public
     *            website, 'system' for anything automated.
     */
    action: { type: String, default: '' },
    actor: { type: String, default: '' },
    role: { type: String, default: '' },
    source: { type: String, enum: ['staff', 'guest', 'system'], default: 'system', index: true },
  },
  { timestamps: true, toJSON: asJson() },
)

export const Notification =
  mongoose.models.Notification ?? mongoose.model('Notification', notificationSchema)
