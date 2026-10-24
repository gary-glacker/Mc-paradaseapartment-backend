import { Router } from 'express'
import * as payments from '../controllers/paymentController.js'
import { asyncHandler as ah } from '../middleware/asyncHandler.js'
import { requireAuth } from '../middleware/requireAuth.js'

const router = Router()

router.use(requireAuth)

router.get('/', ah(payments.listPayments))
router.post('/', ah(payments.createPayment))

router.patch('/:id/void', ah(payments.voidPayment))
router.delete('/:id', ah(payments.deletePayment))

export default router
