import { Router } from 'express'
import * as bookings from '../controllers/bookingController.js'
import { asyncHandler as ah } from '../middleware/asyncHandler.js'
import { requireAuth } from '../middleware/requireAuth.js'

const router = Router()

/* Public — the website submits here and guests check their own booking. */
router.post('/', ah(bookings.createBooking))
router.get('/lookup', ah(bookings.lookupBooking))
router.get('/availability', ah(bookings.checkAvailability))

/* Admin — the dashboard reads and manages every request. */
router.get('/', requireAuth, ah(bookings.listBookings))
router.get('/:id', requireAuth, ah(bookings.getBooking))
router.patch('/:id', requireAuth, ah(bookings.updateBooking))
router.delete('/:id', requireAuth, ah(bookings.deleteBooking))

export default router
