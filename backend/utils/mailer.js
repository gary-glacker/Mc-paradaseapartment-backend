/* ============================================================
   MC PARADISE — transactional email
   ------------------------------------------------------------
   Shows the booking and adds the SMTP settings to .env, then the
   app sends:

     · the guest a confirmation with their reference, room, dates,
       total and the customer-service number
     · every staff member who has an email address a heads-up that
       a new booking has arrived

   Email is **never allowed to break a booking**. If SMTP is not
   configured, or the send fails, the failure is logged and a
   notification is recorded — the booking still succeeds.

   Configure in backend/.env (see .env.example):
     SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASSWORD,
     MAIL_FROM, PUBLIC_SITE_URL
   ============================================================ */

import nodemailer from 'nodemailer'
import { Admin } from '../models/index.js'

let transporter = null
let configured = null

/** True when the host/user/password are all present. */
export function mailConfigured() {
  if (configured !== null) return configured
  configured = Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASSWORD)
  return configured
}

/** The `from` header, falling back to the SMTP user. */
const fromAddress = () =>
  process.env.MAIL_FROM || process.env.SMTP_USER || 'no-reply@mc-paradiseapartment.com'

/** The public site URL, for links inside emails. */
const siteUrl = () => (process.env.PUBLIC_SITE_URL || 'http://localhost:4000').replace(/\/+$/, '')

/**
 * Builds the pooled SMTP transport once. Returns null when email has
 * not been configured, so callers can skip quietly.
 */
function getTransport() {
  if (!mailConfigured()) return null
  if (transporter) return transporter

  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: String(process.env.SMTP_SECURE).toLowerCase() === 'true',
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD },
    /*
     * Some antivirus suites (Avast, Kaspersky, ESET…) intercept mail
     * over TLS and present their own certificate, which Node does not
     * trust. Setting SMTP_TLS_RELAXED=true accepts that local scanner's
     * certificate so mail can leave the machine. Leave it false in
     * production / on a normal network.
     */
    tls:
      String(process.env.SMTP_TLS_RELAXED).toLowerCase() === 'true'
        ? { rejectUnauthorized: false }
        : undefined,
  })
  return transporter
}

/**
 * Sends one message. Never throws — returns
 * `{ sent: true }` or `{ sent: false, reason }`.
 */
export async function sendMail({ to, subject, text, html }) {
  const to_ = Array.isArray(to) ? to.filter(Boolean) : [to].filter(Boolean)
  if (to_.length === 0) return { sent: false, reason: 'no recipients' }

  const tx = getTransport()
  if (!tx) return { sent: false, reason: 'SMTP is not configured' }

  try {
    await tx.sendMail({ from: fromAddress(), to: to_.join(', '), subject, text, html })
    console.log(`[mail] sent "${subject}" → ${to_.join(', ')}`)
    return { sent: true, to: to_ }
  } catch (err) {
    console.error(`[mail] failed "${subject}" → ${to_.join(', ')}: ${err?.message}`)
    return { sent: false, reason: err?.message || 'send failed' }
  }
}

/* ------------------------------------------------------------------ */
/* Templates                                                           */
/* ------------------------------------------------------------------ */

const esc = (s) =>
  String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])

/** Wrap body HTML in a simple, tasteful email shell. */
function shell(title, rows, footer = '') {
  const body = rows
    .map(
      ([k, v]) =>
        `<tr><td style="padding:6px 0;color:#78716c;font-size:13px">${esc(k)}</td>` +
        `<td style="padding:6px 0;color:#1c1917;font-size:13px;font-weight:600;text-align:right">${esc(v)}</td></tr>`,
    )
    .join('')

  return `<!doctype html><html><body style="margin:0;background:#f5f5f4;font-family:Helvetica,Arial,sans-serif">
  <div style="max-width:520px;margin:0 auto;padding:24px">
    <div style="background:#0c0a09;border-radius:16px 16px 0 0;padding:22px 24px">
      <div style="color:#d4af37;font-size:11px;letter-spacing:.22em;text-transform:uppercase">MC Paradise Apartment</div>
      <div style="color:#fafaf9;font-size:20px;font-weight:700;margin-top:6px">${esc(title)}</div>
    </div>
    <div style="background:#ffffff;padding:22px 24px;border-radius:0 0 16px 16px">
      <table style="width:100%;border-collapse:collapse">${body}</table>
      ${footer ? `<p style="margin:18px 0 0;font-size:13px;color:#57534e;line-height:1.6">${footer}</p>` : ''}
      <p style="margin:20px 0 0;font-size:12px;color:#a8a29e">
        MC Paradise Apartment · Powered by Kwandagroup
      </p>
    </div>
  </div></body></html>`
}

/**
 * The guest's booking confirmation.
 *
 * `booking` is a Booking document; `supportPhone` is shown so the guest
 * knows who to call.
 */
export function guestBookingEmail(booking, supportPhone = '') {
  const stay = booking.stay ?? {}
  const money = (n) => `$${Number(n ?? 0).toLocaleString()} ${booking.currency || 'USD'}`
  const rows = [
    ['Reference', booking.ref],
    ['Room', booking.propertyName || booking.item || '—'],
    ['Check-in', stay.checkIn || '—'],
    ['Check-out', stay.checkOut || '—'],
    ['Nights', String(stay.nights ?? '')],
    ['Guests', String(stay.guests ?? '')],
    ['Total', money(booking.total)],
  ]

  const footer =
    `We have received your request and our team is reviewing it. ` +
    (supportPhone
      ? `Questions? Call our front desk on <strong>${esc(supportPhone)}</strong> and quote reference <strong>${esc(booking.ref)}</strong>.`
      : `Please quote reference <strong>${esc(booking.ref)}</strong> when you contact us.`) +
    `<br/><br/><a href="${siteUrl()}/my-booking" style="color:#b8860b">Check your booking online →</a>`

  const text =
    `MC Paradise Apartment — booking received\n\n` +
    rows.map(([k, v]) => `${k}: ${v}`).join('\n') +
    (supportPhone ? `\n\nFront desk: ${supportPhone}` : '') +
    `\nCheck your booking: ${siteUrl()}/my-booking\n`

  return {
    subject: `Booking received — ${booking.ref} · MC Paradise Apartment`,
    html: shell('Booking received', rows, footer),
    text,
  }
}

/** The staff alert for a new booking. */
export function staffBookingEmail(booking, guestPhone = '') {
  const stay = booking.stay ?? {}
  const rows = [
    ['Reference', booking.ref],
    ['Room requested', booking.propertyName || booking.item || '—'],
    ['Guest', booking.guest?.fullName || '—'],
    ['Phone', guestPhone || booking.guest?.phone || '—'],
    ['Check-in', stay.checkIn || '—'],
    ['Check-out', stay.checkOut || '—'],
    ['Nights', String(stay.nights ?? '')],
    ['Guests', String(stay.guests ?? '')],
    ['Total', `$${Number(booking.total ?? 0).toLocaleString()} ${booking.currency || 'USD'}`],
  ]

  return {
    subject: `New booking ${booking.ref} — ${booking.guest?.fullName || 'guest'} (awaiting assignment)`,
    html: shell(
      'New booking received',
      rows,
      `No room has been assigned yet — open the dashboard to allocate one.<br/><br/>` +
        `<a href="${siteUrl()}/admin/check-in" style="color:#b8860b">Go to Check-in →</a>`,
    ),
    text:
      `New booking awaiting assignment\n\n` +
      rows.map(([k, v]) => `${k}: ${v}`).join('\n') +
      `\n\nAssign a room: ${siteUrl()}/admin/check-in\n`,
  }
}

/** Every staff account that has an email address on file. */
export async function staffRecipients() {
  const staff = await Admin.find({ email: { $nin: ['', null] } }).select('email').lean()
  return [...new Set(staff.map((s) => String(s.email).trim()).filter(Boolean))]
}
