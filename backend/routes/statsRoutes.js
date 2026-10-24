import { Router } from 'express'
import * as stats from '../controllers/statsController.js'
import { asyncHandler as ah } from '../middleware/asyncHandler.js'
import { requireAuth } from '../middleware/requireAuth.js'

const router = Router()

router.get('/', requireAuth, ah(stats.getStats))

export default router
