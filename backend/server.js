/* ============================================================
   MC PARADISE — API entry point
   ------------------------------------------------------------
   Only wiring lives here: middleware, routers, the built site
   and the boot sequence. Business logic is in ./controllers,
   data shapes in ./models and endpoints in ./routes.
   ============================================================ */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import cors from 'cors'
import express from 'express'
import 'dotenv/config'
import { MONGODB_URI, connectDb, disconnectDb, seedDatabase } from './config/db.js'
import { errorHandler, notFound } from './middleware/errorHandler.js'
import routes from './routes/index.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PORT = Number(process.env.PORT || 4000)

/** The built website lives in Frontend/dist (served here in production). */
const DIST = path.join(__dirname, '..', 'Frontend', 'dist')

const app = express()

app.use(cors({
  origin: process.env.CORS_ORIGIN?.split(',').map((o) => o.trim()).filter(Boolean) || '*',
  credentials: true,
}))
app.use(express.json({ limit: '256kb' }))
app.use(express.urlencoded({ extended: true, limit: '256kb' }))

/* ------------------------------- API ------------------------------- */

app.use('/api', routes)

/* -------------------------- static website ------------------------- */

if (fs.existsSync(DIST)) {
  app.use(express.static(DIST))
  app.get('*', (req, res) => {
    res.sendFile(path.join(DIST, 'index.html'))
  })
} else {
  app.get('/', (_req, res) => {
    res.json({
      service: 'mc-paradise-api',
      hint: 'The website build was not found. Run `npm run build` in Frontend/.',
    })
  })
}

/* ------------------------------ errors ----------------------------- */

app.use(notFound)
app.use(errorHandler)

/* ------------------------------- boot ------------------------------ */

async function start() {
  try {
    await connectDb()
    const seeded = await seedDatabase()

    const server = app.listen(PORT, () => {
      console.log(`\n  MongoDB          →  ${MONGODB_URI}`)
      console.log(`  MC Paradise API  →  http://localhost:${PORT}`)
      if (seeded.admin.created) {
        console.log(`  Admin created    →  ${seeded.admin.username}`)
        console.log(`                     password: ${process.env.ADMIN_PASSWORD || 'admin123'}`)
      } else {
        console.log(`  Admin sign-in    →  username: ${seeded.admin.username}`)
      }
      if (seeded.legacy.imported) {
        console.log(`  Imported         →  ${seeded.legacy.imported} booking(s) from the old JSON store`)
      }
      if (seeded.migration.migrated) {
        console.log(`  Migrated         →  ${seeded.migration.migrated} booking(s) to the entry/exit shape`)
      }
      if (seeded.linked.linked) {
        console.log(`  Linked           →  ${seeded.linked.linked} booking(s) to a residence`)
      }
      console.log('')
    })

    const shutdown = async () => {
      server.close()
      await disconnectDb()
      process.exit(0)
    }
    process.on('SIGINT', shutdown)
    process.on('SIGTERM', shutdown)
  } catch (err) {
    console.error('\n  Could not start the API.')
    console.error('  MongoDB URI:', MONGODB_URI)
    console.error('  Reason:', err.message)
    console.error('\n  Is MongoDB running? Start it, or set MONGODB_URI in backend/.env\n')
    process.exit(1)
  }
}

start()
