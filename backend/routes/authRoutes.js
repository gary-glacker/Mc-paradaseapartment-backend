import { Router } from 'express'
import * as auth from '../controllers/authController.js'
import { asyncHandler as ah } from '../middleware/asyncHandler.js'
import { requireAuth } from '../middleware/requireAuth.js'

const router = Router()

router.post('/login', ah(auth.login))
router.get('/me', requireAuth, ah(auth.me))
router.post('/logout', requireAuth, ah(auth.logout))
router.post('/password', requireAuth, ah(auth.changePassword))
router.put('/profile', requireAuth, ah(auth.updateProfile))

export default router
