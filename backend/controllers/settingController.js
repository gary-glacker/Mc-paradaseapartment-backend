import { CURRENCIES, currencyConfig, DEFAULT_CURRENCY, getSetting } from '../utils/currency.js'
import { HttpError, actorOf, notify, str } from '../utils/helpers.js'

/**
 * GET /api/settings/currency
 * Public — the website, the tenant portal and the dashboard all read the
 * same currency block. It contains no secrets, only the base currency,
 * the alternate currency and the manual rate.
 */
export async function getCurrencySetting(_req, res) {
  res.json({ currency: await currencyConfig() })
}

/**
 * GET /api/settings
 * The full settings row, for the dashboard. Admin only.
 */
export async function getSettings(_req, res) {
  const s = await getSetting()
  res.json({
    settings: {
      displayCurrency: s.displayCurrency,
      baseCurrency: s.baseCurrency,
      alternateCurrency: s.alternateCurrency,
      exchangeRate: s.exchangeRate,
      rateNote: s.rateNote,
      updatedAt: s.updatedAt,
    },
    currency: await currencyConfig(),
  })
}

/**
 * PATCH /api/settings
 * Update the currency configuration. Admin only.
 *
 * Guards the invariants that keep reports sane:
 *  - base and alternate must be different currencies,
 *  - the rate must be a positive number,
 *  - the display currency must be one of base/alternate.
 */
export async function updateSettings(req, res) {
  const body = req.body ?? {}
  const s = await getSetting()

  const base = str(body.baseCurrency, 6) || s.baseCurrency
  const alternate = str(body.alternateCurrency, 6) || s.alternateCurrency
  const display = str(body.displayCurrency, 6) || s.displayCurrency

  if (!CURRENCIES.includes(base)) throw new HttpError(400, `Unsupported base currency: ${base}.`)
  if (!CURRENCIES.includes(alternate)) throw new HttpError(400, `Unsupported alternate currency: ${alternate}.`)
  if (base === alternate) throw new HttpError(400, 'The base and alternate currencies must be different.')
  if (!CURRENCIES.includes(display)) throw new HttpError(400, `Unsupported display currency: ${display}.`)
  if (display !== base && display !== alternate) {
    throw new HttpError(400, 'The display currency must be either the base or the alternate currency.')
  }

  let exchangeRate = s.exchangeRate
  if (body.exchangeRate !== undefined) {
    exchangeRate = Number(body.exchangeRate)
    if (!Number.isFinite(exchangeRate) || exchangeRate <= 0) {
      throw new HttpError(400, 'The exchange rate must be a number greater than zero.')
    }
  }

  const before = { displayCurrency: s.displayCurrency, baseCurrency: s.baseCurrency, exchangeRate: s.exchangeRate }

  s.baseCurrency = base
  s.alternateCurrency = alternate
  s.displayCurrency = display
  s.exchangeRate = exchangeRate
  if (body.rateNote !== undefined) s.rateNote = str(body.rateNote, 120)
  await s.save()

  /* Tell the team the moment the money maths changes. */
  const changed = []
  if (before.baseCurrency !== base) changed.push(`base → ${base}`)
  if (before.displayCurrency !== display) changed.push(`display → ${display}`)
  if (Number(before.exchangeRate) !== Number(exchangeRate)) {
    changed.push(`rate → 1 ${base} = ${Number(exchangeRate).toLocaleString('en-US')} ${alternate}`)
  }

  if (changed.length) {
    await notify(
      'Currency settings updated',
      `Currency configuration changed: ${changed.join(', ')}.`,
      null,
      actorOf(req, { action: 'Currency settings updated' }),
    )
  }

  res.json({ settings: s.toJSON(), currency: await currencyConfig(), changed })
}

/** POST /api/settings/currency/reset — restore the built-in defaults. */
export async function resetCurrency(_req, res) {
  const s = await getSetting()
  Object.assign(s, DEFAULT_CURRENCY)
  await s.save()
  res.json({ settings: s.toJSON(), currency: await currencyConfig() })
}
