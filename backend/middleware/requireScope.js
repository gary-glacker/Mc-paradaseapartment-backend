import { requireRole } from './requireCustomer.js'

/*
 * Role-based access for the dashboard API.
 *
 * Two roles exist today:
 *
 *   Admin      — everything, including staff accounts, properties and
 *                the website page controls.
 *   Reception  — the front desk. Sees and works with the day-to-day:
 *                bookings, check-in/tenancies, customers, rooms,
 *                maintenance, the financial reports and notifications.
 *                Cannot manage staff accounts, properties or site pages.
 *
 * `FRONT_DESK` is the explicit list, so a new route is denied to
 * reception until someone decides otherwise — safe by default.
 */
export const ADMIN_ONLY = ['Admin']
export const FRONT_DESK = ['Admin', 'Reception']

/** Allows only Admins. */
export const adminOnly = requireRole(...ADMIN_ONLY)

/** Allows Admins and Reception (the front desk). */
export const frontDesk = requireRole(...FRONT_DESK)
