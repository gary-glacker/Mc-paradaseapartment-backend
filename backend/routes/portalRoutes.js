import { Router } from 'express'
import * as portal from '../controllers/customerController.js'
import * as tenancies from '../controllers/tenancyController.js'
import * as maintenance from '../controllers/maintenanceController.js'
import * as agreements from '../controllers/agreementController.js'
import { asyncHandler as ah } from '../middleware/asyncHandler.js'
import { requireCustomer } from '../middleware/requireCustomer.js'

/**
 * The tenant self-service portal. Everything here is scoped to the
 * signed-in customer — a token from the dashboard cannot be used.
 */
const router = Router()

/* Public routes. */
router.post('/login', ah(portal.customerLogin))
router.post('/forgot-password', ah(portal.forgotPassword))
router.post('/reset-password', ah(portal.resetPassword))

/* Everything below needs a customer session. */
router.use(requireCustomer)

router.get('/me', ah(portal.customerMe))
router.post('/logout', ah(portal.customerLogout))
router.post('/password', ah(portal.customerChangePassword))

router.get('/dashboard', ah(tenancies.portalDashboard))

router.get('/tenancies', ah(tenancies.myTenancies))
router.get('/tenancies/:id', ah(tenancies.myTenancy))
router.get('/tenancies/:id/agreement', ah(tenancies.myAgreement))
router.get('/tenancies/:id/agreement/download', ah(agreements.portalDownloadAgreement))

router.get('/maintenance', ah(maintenance.myRequests))
router.post('/maintenance', ah(maintenance.createRequest))
router.get('/maintenance/:id', ah(maintenance.myRequest))

export default router
