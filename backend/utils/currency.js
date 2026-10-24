import { Setting } from '../models/index.js'

/**
 * Currency configuration.
 *
 * Every amount in the database is stored in a single **base** currency
 * (USD by default). The manager can additionally *display and enter*
 * amounts in a second currency (RWF) using a manually maintained rate,
 * e.g. `1 USD = 1300 RWF`.
 *
 * Keeping one base means financial reports never add dollars to francs.
 * Conversion happens at the edges — when reading a price into the UI and
 * when a payment is typed in the alternate currency.
 */

export const CURRENCIES = ['USD', 'RWF']

/** Symbols used when a bare number has to be shown with its currency. */
export const CURRENCY_SYMBOL = { USD: '$', RWF: 'FRw' }

/** The built-in fallback, used before any Setting row exists. */
export const DEFAULT_CURRENCY = {
  displayCurrency: 'USD',
  baseCurrency: 'USD',
  alternateCurrency: 'RWF',
  exchangeRate: 1300,
  rateNote: '',
}

/** The singleton settings row, created on first read if necessary. */
export async function getSetting() {
  const found = await Setting.findOneAndUpdate(
    { key: 'system' },
    { $setOnInsert: { key: 'system', ...DEFAULT_CURRENCY } },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  )
  return found
}

/**
 * The currency block the browser needs. Public — it carries no secrets,
 * so the website can fetch the rate without signing in.
 */
export async function currencyConfig() {
  const s = await getSetting()
  const base = CURRENCIES.includes(s.baseCurrency) ? s.baseCurrency : 'USD'
  const alternate = CURRENCIES.includes(s.alternateCurrency) ? s.alternateCurrency : 'RWF'
  const display = CURRENCIES.includes(s.displayCurrency) ? s.displayCurrency : base
  const exchangeRate = Number(s.exchangeRate) > 0 ? Number(s.exchangeRate) : DEFAULT_CURRENCY.exchangeRate

  return {
    base,
    alternate,
    display,
    exchangeRate,
    rateNote: s.rateNote ?? '',
    /** e.g. `1 USD = 1,300 RWF`. */
    rateLabel: `1 ${base} = ${exchangeRate.toLocaleString('en-US')} ${alternate}`,
    symbols: CURRENCY_SYMBOL,
    available: CURRENCIES,
    updatedAt: s.updatedAt,
  }
}

/**
 * Convert an amount **stored in the base currency** into `target`.
 * Unknown targets and a bad rate fall back to the base amount unchanged,
 * so a broken setting can never distort a report.
 */
export function convertFromBase(amount, target, config) {
  const n = Number(amount) || 0
  const base = config?.base ?? 'USD'
  const alternate = config?.alternate ?? 'RWF'
  const rate = Number(config?.exchangeRate) || 0

  if (target === base || !rate) return n
  if (target === alternate) return base === 'USD' ? n * rate : n / rate
  return n
}

/**
 * Convert an amount the staff typed **in `source`** back into the base
 * currency, so it can be stored. Mirrors `convertFromBase` in reverse.
 */
export function convertToBase(amount, source, config) {
  const n = Number(amount) || 0
  const base = config?.base ?? 'USD'
  const alternate = config?.alternate ?? 'RWF'
  const rate = Number(config?.exchangeRate) || 0

  if (source === base || !rate) return n
  if (source === alternate) return base === 'USD' ? n / rate : n * rate
  return n
}

/** Round to two decimals, the way money is stored and summed. */
export const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100

/**
 * A pre-built converter for a request: `toBase(amount, currency)` stores
 * a typed amount, `fromBase(amount, currency)` reads one back out.
 */
export async function currencyConverter() {
  const config = await currencyConfig()
  return {
    config,
    toBase: (amount, source) => round2(convertToBase(amount, source, config)),
    fromBase: (amount, target) => round2(convertFromBase(amount, target, config)),
  }
}
