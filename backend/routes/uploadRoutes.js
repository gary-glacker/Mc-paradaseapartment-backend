import { Router } from 'express'
import * as uploads from '../controllers/uploadController.js'
import { asyncHandler as ah } from '../middleware/asyncHandler.js'
import { requireAuth } from '../middleware/requireAuth.js'

const router = Router()

/*
 * Any signed-in staff member may upload — reception needs the customer
 * ID photo, and reception manages rooms too. The API secret never
 * leaves the server: the browser asks for a signature and posts the
 * file straight to Cloudinary.
 */
router.get('/config', requireAuth, ah(uploads.getUploadConfig))
router.post('/sign', requireAuth, ah(uploads.signUploadRequest))

export default router
