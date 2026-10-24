import { Router } from 'express'
import * as maintenance from '../controllers/maintenanceController.js'
import { asyncHandler as ah } from '../middleware/asyncHandler.js'
import { requireAuth } from '../middleware/requireAuth.js'

const router = Router()

router.use(requireAuth)

router.get('/stats', ah(maintenance.requestStats))
router.get('/rooms-with-issues', ah(maintenance.roomsWithIssues))

router.get('/', ah(maintenance.listRequests))
router.get('/:id', ah(maintenance.getRequest))
router.patch('/:id', ah(maintenance.updateRequest))
router.delete('/:id', ah(maintenance.deleteRequest))

export default router
