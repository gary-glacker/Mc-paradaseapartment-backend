import { Router } from 'express'
import * as notifications from '../controllers/notificationController.js'
import { asyncHandler as ah } from '../middleware/asyncHandler.js'
import { requireAuth } from '../middleware/requireAuth.js'
import { adminOnly } from '../middleware/requireScope.js'

const router = Router()

router.get('/', requireAuth, ah(notifications.listNotifications))
router.post('/read', requireAuth, ah(notifications.markRead))
/* Wiping the whole audit feed is destructive — Admins only. */
router.delete('/', requireAuth, adminOnly, ah(notifications.clearNotifications))

export default router
