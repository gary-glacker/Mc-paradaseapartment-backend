import { Router } from 'express'
import * as agreements from '../controllers/agreementController.js'
import { asyncHandler as ah } from '../middleware/asyncHandler.js'
import { requireAuth } from '../middleware/requireAuth.js'

const router = Router()

// Template management
router.get('/templates', requireAuth, ah(agreements.listTemplates))
router.post('/templates', requireAuth, ah(agreements.createTemplate))

// Agreement per tenancy
router.get('/tenancies/:id/form', requireAuth, ah(agreements.getAgreementForm))
router.put('/tenancies/:id/form', requireAuth, ah(agreements.saveAgreementForm))
router.post('/tenancies/:id/generate', requireAuth, ah(agreements.generateAgreement))
router.post('/tenancies/:id/approve', requireAuth, ah(agreements.approveAgreement))
router.post('/tenancies/:id/reject', requireAuth, ah(agreements.rejectAgreement))
router.get('/tenancies/:id/download', requireAuth, ah(agreements.downloadAgreement))

export default router
