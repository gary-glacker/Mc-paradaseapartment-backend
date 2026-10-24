/** Anything that reaches here had no matching route. */
export function notFound(req, res, next) {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: `No API route for ${req.method} ${req.path}` })
  }
  next()
}

/**
 * Single place that turns thrown errors into JSON responses:
 * Mongoose validation → 400, bad ObjectId → 404, duplicate key → 409.
 */
export function errorHandler(err, req, res, _next) {
  if (err?.status && err.status >= 400 && err.status < 500) {
    return res.status(err.status).json({ error: err.message })
  }
  if (err?.name === 'ValidationError') {
    const first = Object.values(err.errors ?? {})[0]
    return res.status(400).json({ error: first?.message ?? 'Invalid data.' })
  }
  if (err?.name === 'CastError') {
    return res.status(404).json({ error: 'Not found.' })
  }
  if (err?.code === 11000) {
    const field = Object.keys(err.keyPattern ?? {})[0] ?? 'record'
    return res.status(409).json({ error: `That ${field} is already in use.` })
  }
  console.error('[api]', err)
  res.status(500).json({ error: 'Something went wrong on the server.' })
}
