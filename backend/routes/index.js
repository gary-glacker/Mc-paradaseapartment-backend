import { Router } from 'express'
import agreementRoutes from './agreementRoutes.js'
import authRoutes from './authRoutes.js'
import bookingRoutes from './bookingRoutes.js'
import customerRoutes from './customerRoutes.js'
import maintenanceRoutes from './maintenanceRoutes.js'
import notificationRoutes from './notificationRoutes.js'
import pageRoutes from './pageRoutes.js'
import paymentRoutes from './paymentRoutes.js'
import portalRoutes from './portalRoutes.js'
import propertyRoutes from './propertyRoutes.js'
import reportRoutes from './reportRoutes.js'
import roomRoutes from './roomRoutes.js'
import settingRoutes from './settingRoutes.js'
import staffRoutes from './staffRoutes.js'
import statsRoutes from './statsRoutes.js'
import tenancyRoutes from './tenancyRoutes.js'
import uploadRoutes from './uploadRoutes.js'

/**
 * Every API router, mounted under `/api`. Keeping the paths here means
 * `server.js` only has to say `app.use('/api', routes)`.
 */
const router = Router()

router.get('/health', (_req, res) => res.json({ ok: true, service: 'mc-paradise-api' }))

/* Staff dashboard */
router.use('/auth', authRoutes)
router.use('/staff', staffRoutes)
router.use('/bookings', bookingRoutes)
router.use('/properties', propertyRoutes)
router.use('/rooms', roomRoutes)
router.use('/customers', customerRoutes)
router.use('/tenancies', tenancyRoutes)
router.use('/maintenance', maintenanceRoutes)
router.use('/payments', paymentRoutes)
router.use('/reports', reportRoutes)
router.use('/pages', pageRoutes)
router.use('/notifications', notificationRoutes)
router.use('/stats', statsRoutes)
router.use('/uploads', uploadRoutes)
router.use('/settings', settingRoutes)
router.use('/agreements', agreementRoutes)

/* Tenant self-service portal */
router.use('/portal', portalRoutes)

export default router
