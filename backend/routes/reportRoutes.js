import { Router } from 'express'
import * as reports from '../controllers/paymentController.js'
import * as tenancyReports from '../controllers/tenancyController.js'
import { asyncHandler as ah } from '../middleware/asyncHandler.js'
import { requireAuth } from '../middleware/requireAuth.js'

const router = Router()

router.use(requireAuth)

/* Headline figures for the Overview page. */
router.get('/summary', ah(reports.dashboardSummary))

/* The full financial report + ledger for CSV export. */
router.get('/financial', ah(reports.financialReport))

/* Room occupancy report with bookings, days remaining, check-in/check-out */
router.get('/rooms', ah(tenancyReports.roomOccupancyReport))

export default router
