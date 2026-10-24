import { Router } from 'express'
import * as customers from '../controllers/customerController.js'
import { asyncHandler as ah } from '../middleware/asyncHandler.js'
import { requireAuth } from '../middleware/requireAuth.js'

const router = Router()

/* Every customer route is staff-only. */
router.use(requireAuth)

router.get('/', ah(customers.listCustomers))
router.post('/', ah(customers.createCustomer))

router.get('/:id', ah(customers.getCustomer))
router.patch('/:id', ah(customers.updateCustomer))
router.delete('/:id', ah(customers.deleteCustomer))
router.post('/:id/password', ah(customers.setCustomerPassword))

export default router
