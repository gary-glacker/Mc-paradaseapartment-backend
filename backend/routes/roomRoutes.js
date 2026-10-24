import { Router } from 'express'
import * as rooms from '../controllers/roomController.js'
import { asyncHandler as ah } from '../middleware/asyncHandler.js'
import { requireAuth } from '../middleware/requireAuth.js'

const router = Router()

/* Public — the room catalogue the website can render. */
router.get('/public', ah(rooms.listPublicRooms))

/* Staff — room management and availability. */
router.get('/availability', requireAuth, ah(rooms.roomAvailability))
router.get('/', requireAuth, ah(rooms.listRooms))
router.post('/', requireAuth, ah(rooms.createRoom))
router.post('/bulk', requireAuth, ah(rooms.createRooms))
router.get('/:id', requireAuth, ah(rooms.getRoom))
router.patch('/:id', requireAuth, ah(rooms.updateRoom))
router.delete('/:id', requireAuth, ah(rooms.deleteRoom))

export default router
