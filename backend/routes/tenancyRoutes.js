import { Router } from 'express'
import * as tenancies from '../controllers/tenancyController.js'
import * as agreements from '../controllers/agreementController.js'
import { asyncHandler as ah } from '../middleware/asyncHandler.js'
import { requireAuth } from '../middleware/requireAuth.js'

const router = Router()

router.use(requireAuth)

router.get('/', ah(tenancies.listTenancies))
router.post('/', ah(tenancies.createTenancy))

router.get('/:id', ah(tenancies.getTenancy))
router.patch('/:id', ah(tenancies.updateTenancy))
router.delete('/:id', ah(tenancies.deleteTenancy))

router.post('/:id/sign', ah(tenancies.signAgreement))
router.post('/:id/end', ah(tenancies.endTenancy))
router.post('/:id/requirements/:index', ah(tenancies.toggleRequirement))

// Agreement builder
router.get('/:id/agreement/form', ah(agreements.getAgreementForm))
router.put('/:id/agreement/form', ah(agreements.saveAgreementForm))
router.post('/:id/agreement/generate', ah(agreements.generateAgreement))
router.post('/:id/agreement/approve', ah(agreements.approveAgreement))
router.post('/:id/agreement/reject', ah(agreements.rejectAgreement))
router.get('/:id/agreement/download', ah(agreements.downloadAgreement))

export default router
