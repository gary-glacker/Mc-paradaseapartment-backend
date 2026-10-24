import { Router } from 'express'
import * as settings from '../controllers/settingController.js'
import { asyncHandler as ah } from '../middleware/asyncHandler.js'
import { requireAuth } from '../middleware/requireAuth.js'
import { adminOnly, frontDesk } from '../middleware/requireScope.js'

const router = Router()

/*
 * The currency block is public: the website and the tenant portal both
 * need the rate to show prices, and it contains no secrets.
 */
router.get('/currency', ah(settings.getCurrencySetting))

/* The full settings row and any change are Admin-only. */
router.get('/', requireAuth, adminOnly, ah(settings.getSettings))
router.patch('/', requireAuth, adminOnly, ah(settings.updateSettings))
router.post('/currency/reset', requireAuth, adminOnly, ah(settings.resetCurrency))

/* Reception may read the currency block (it is public anyway) — kept
   explicit so the front desk's allowed surface is documented in code. */
router.get('/currency/private', requireAuth, frontDesk, ah(settings.getCurrencySetting))

export default router
