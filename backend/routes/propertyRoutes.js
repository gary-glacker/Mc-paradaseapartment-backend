import { Router } from 'express'
import * as properties from '../controllers/propertyController.js'
import { asyncHandler as ah } from '../middleware/asyncHandler.js'
import { requireAuth } from '../middleware/requireAuth.js'
import { adminOnly } from '../middleware/requireScope.js'

const router = Router()

/* Public — the residence catalogue the website can render. */
router.get('/public', ah(properties.listPublicProperties))

/* Admin — property management. Reception does not manage properties. */
router.get('/', requireAuth, adminOnly, ah(properties.listProperties))
router.post('/', requireAuth, adminOnly, ah(properties.createProperty))
router.get('/:id', requireAuth, adminOnly, ah(properties.getProperty))
router.patch('/:id', requireAuth, adminOnly, ah(properties.updateProperty))
router.delete('/:id', requireAuth, adminOnly, ah(properties.deleteProperty))

export default router
