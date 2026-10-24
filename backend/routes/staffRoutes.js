import { Router } from 'express'
import * as staff from '../controllers/staffController.js'
import { asyncHandler as ah } from '../middleware/asyncHandler.js'
import { requireAuth } from '../middleware/requireAuth.js'
import { requireRole } from '../middleware/requireCustomer.js'

/**
 * Staff account management. Only an Admin may create or remove
 * colleagues — reception can see the roster but not change it.
 */
const router = Router()

router.use(requireAuth)

router.get('/', ah(staff.listStaff))

router.post('/', requireRole('Admin'), ah(staff.createStaff))
router.patch('/:id', requireRole('Admin'), ah(staff.updateStaff))
router.delete('/:id', requireRole('Admin'), ah(staff.deleteStaff))
router.post('/:id/password', requireRole('Admin'), ah(staff.setStaffPassword))

export default router
