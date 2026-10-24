import { Router } from 'express'
import * as pages from '../controllers/pageController.js'
import { asyncHandler as ah } from '../middleware/asyncHandler.js'
import { requireAuth } from '../middleware/requireAuth.js'
import { adminOnly } from '../middleware/requireScope.js'

const router = Router()

router.get('/', ah(pages.listPublicPages))
/* Website page controls belong to an Admin. */
router.get('/admin', requireAuth, adminOnly, ah(pages.listAdminPages))
router.patch('/:slug', requireAuth, adminOnly, ah(pages.updatePageStatus))

export default router
