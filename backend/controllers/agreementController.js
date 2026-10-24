import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import mongoose from 'mongoose'
import { Tenancy, Customer, Room, AgreementTemplate } from '../models/index.js'
import { generateAgreementDocx, generateAgreementCode } from '../utils/agreementGenerator.js'
import { actorOf, notify, str } from '../utils/helpers.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

/**
 * GET /api/agreements/templates - List agreement templates
 */
export async function listTemplates(req, res) {
  const templates = await AgreementTemplate.find().sort({ createdAt: -1 })
  res.json({ templates })
}

/**
 * POST /api/agreements/templates - Create agreement template
 */
export async function createTemplate(req, res) {
  const b = req.body ?? {}
  const template = await AgreementTemplate.create({
    name: str(b.name, 120) || 'Standard Rental Agreement',
    slug: str(b.slug, 60) || 'standard',
    defaultTerms: Array.isArray(b.defaultTerms) ? b.defaultTerms : [],
    inventoryDefaults: b.inventoryDefaults || {},
    createdBy: req.admin?.name || req.admin?.username || '',
  })
  res.status(201).json({ template })
}

/**
 * GET /api/tenancies/:id/agreement/form - Get agreement form data for filling
 */
export async function getAgreementForm(req, res) {
  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(404).json({ error: 'Tenancy not found.' })
  }
  const tenancy = await Tenancy.findById(req.params.id)
    .populate('customer')
    .populate('room')
  if (!tenancy) return res.status(404).json({ error: 'Tenancy not found.' })

  const template = await AgreementTemplate.findOne({ isActive: true }).sort({ createdAt: -1 })

  res.json({
    tenancy: {
      id: tenancy._id,
      ref: tenancy.ref,
      checkIn: tenancy.checkIn,
      checkOut: tenancy.checkOut,
      nights: tenancy.nights,
      pricePerNight: tenancy.pricePerNight,
      total: tenancy.total,
      currency: tenancy.currency,
      gymIncluded: tenancy.gymIncluded,
    },
    customer: tenancy.customer ? {
      id: tenancy.customer._id,
      fullName: tenancy.customer.fullName,
      nationalId: tenancy.customer.nationalId,
      phone: tenancy.customer.phone,
      email: tenancy.customer.email,
      address: tenancy.customer.address,
    } : null,
    room: tenancy.room ? {
      id: tenancy.room._id,
      number: tenancy.room.number,
      name: tenancy.room.name,
      floor: tenancy.room.floor,
      beds: tenancy.room.beds,
      maxGuests: tenancy.room.maxGuests,
    } : null,
    agreement: tenancy.agreement,
    template: template ? {
      id: template._id,
      name: template.name,
      defaultTerms: template.defaultTerms,
      inventoryDefaults: template.inventoryDefaults,
    } : null,
  })
}

/**
 * PUT /api/tenancies/:id/agreement/form - Save agreement form data
 */
export async function saveAgreementForm(req, res) {
  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(404).json({ error: 'Tenancy not found.' })
  }
  const tenancy = await Tenancy.findById(req.params.id)
  if (!tenancy) return res.status(404).json({ error: 'Tenancy not found.' })

  const b = req.body ?? {}
  
  if (!tenancy.agreement) {
    tenancy.agreement = {}
  }
  
  // Initialize agreement if not exists
  if (!tenancy.agreement.data) {
    tenancy.agreement.data = {}
  }
  
  // Save form data
  tenancy.agreement.data = {
    ...tenancy.agreement.data,
    landlordName: b.landlordName || 'MC PARADISE APARTMENTS',
    landlordManager: b.landlordManager || 'MANAGER',
    depositAmount: b.depositAmount || 0,
    depositCurrency: b.depositCurrency || tenancy.currency,
    paymentTerms: b.paymentTerms || '',
    noticePeriod: b.noticePeriod || '',
    extensionTerms: b.extensionTerms || '',
    otherConditions: b.otherConditions || '',
    additionalTerms: b.additionalTerms || '',
    inventory: Array.isArray(b.inventory) ? b.inventory : [],
    customTerms: Array.isArray(b.customTerms) ? b.customTerms : [],
    ...b,
  }
  
  if (!tenancy.agreement.code && tenancy.agreement.status !== 'approved') {
    tenancy.agreement.code = generateAgreementCode()
    tenancy.agreement.reference = tenancy.agreement.reference || tenancy.agreement.code
  }
  
  if (tenancy.agreement.status === 'draft' || !tenancy.agreement.status) {
    tenancy.agreement.status = 'draft'
  }
  
  await tenancy.save()
  
  res.json({ 
    tenancy: {
      id: tenancy._id,
      agreement: tenancy.agreement,
    }
  })
}

/**
 * POST /api/tenancies/:id/agreement/generate - Generate agreement document
 */
export async function generateAgreement(req, res) {
  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(404).json({ error: 'Tenancy not found.' })
  }
  const tenancy = await Tenancy.findById(req.params.id)
    .populate('customer')
    .populate('room')
  if (!tenancy) return res.status(404).json({ error: 'Tenancy not found.' })

  try {
    // Ensure agreement code exists
    if (!tenancy.agreement.code) {
      tenancy.agreement.code = generateAgreementCode()
      tenancy.agreement.reference = tenancy.agreement.code
    }
    
    const agreementData = {
      agreementCode: tenancy.agreement.code,
      agreementDate: new Date().toISOString().split('T')[0],
      tenant: tenancy.customer,
      room: tenancy.room,
      tenancy: tenancy,
      landlordName: tenancy.agreement.data?.landlordName || 'MC PARADISE APARTMENTS',
      landlordManager: tenancy.agreement.data?.landlordManager || 'MANAGER',
      depositAmount: tenancy.agreement.data?.depositAmount || 0,
      depositCurrency: tenancy.agreement.data?.depositCurrency || tenancy.currency,
      paymentTerms: tenancy.agreement.data?.paymentTerms || '',
      noticePeriod: tenancy.agreement.data?.noticePeriod || '',
      extensionTerms: tenancy.agreement.data?.extensionTerms || '',
      otherConditions: tenancy.agreement.data?.otherConditions || '',
      additionalTerms: tenancy.agreement.data?.additionalTerms || '',
      inventory: tenancy.agreement.data?.inventory || [],
      ...tenancy.agreement.data,
    }
    
    const docxBuffer = await generateAgreementDocx(agreementData)
    
    // Save to uploads/agreement directory
    const agreementsDir = path.join(__dirname, '..', 'uploads', 'agreements')
    if (!fs.existsSync(agreementsDir)) {
      fs.mkdirSync(agreementsDir, { recursive: true })
    }
    
    const filename = `${tenancy.agreement.code}_${Date.now()}.docx`
    const filepath = path.join(agreementsDir, filename)
    fs.writeFileSync(filepath, docxBuffer)
    
    tenancy.agreement.docxUrl = `/uploads/agreements/${filename}`
    tenancy.agreement.status = 'pending_approval'
    tenancy.agreement.body = `Agreement ${tenancy.agreement.code} generated on ${new Date().toISOString()}`
    
    await tenancy.save()
    
    const actor = actorOf(req, { action: 'Agreement generated' })
    await notify(
      'Agreement generated',
      `${tenancy.agreement.code} generated for ${tenancy.customer?.fullName} (Room ${tenancy.roomNumber}) by ${actor.actor}.`,
      tenancy.ref,
      actor,
    )
    
    res.json({
      success: true,
      agreement: {
        code: tenancy.agreement.code,
        status: tenancy.agreement.status,
        docxUrl: tenancy.agreement.docxUrl,
      }
    })
  } catch (error) {
    console.error('Agreement generation error:', error)
    res.status(500).json({ error: error.message || 'Failed to generate agreement' })
  }
}

/**
 * POST /api/tenancies/:id/agreement/approve - Approve agreement
 */
export async function approveAgreement(req, res) {
  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(404).json({ error: 'Tenancy not found.' })
  }
  const tenancy = await Tenancy.findById(req.params.id)
    .populate('customer')
  if (!tenancy) return res.status(404).json({ error: 'Tenancy not found.' })

  tenancy.agreement.status = 'approved'
  tenancy.agreement.approvedBy = req.admin?.name || req.admin?.username || ''
  tenancy.agreement.approvedAt = new Date()
  
  await tenancy.save()
  
  const actor = actorOf(req, { action: 'Agreement approved' })
  await notify(
    'Agreement approved',
    `${tenancy.agreement.code} approved for ${tenancy.customer?.fullName} by ${actor.actor}.`,
    tenancy.ref,
    actor,
  )
  
  res.json({ 
    success: true,
    agreement: tenancy.agreement
  })
}

/**
 * POST /api/tenancies/:id/agreement/reject - Reject agreement
 */
export async function rejectAgreement(req, res) {
  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(404).json({ error: 'Tenancy not found.' })
  }
  const tenancy = await Tenancy.findById(req.params.id)
  if (!tenancy) return res.status(404).json({ error: 'Tenancy not found.' })

  tenancy.agreement.status = 'draft'
  await tenancy.save()
  
  res.json({ 
    success: true,
    agreement: tenancy.agreement
  })
}

/**
 * GET /api/tenancies/:id/agreement/download - Download agreement
 */
export async function downloadAgreement(req, res) {
  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(404).json({ error: 'Tenancy not found.' })
  }
  const tenancy = await Tenancy.findById(req.params.id)
  if (!tenancy) return res.status(404).json({ error: 'Tenancy not found.' })

  if (!tenancy.agreement.docxUrl) {
    return res.status(404).json({ error: 'Agreement not generated yet.' })
  }

  const filepath = path.join(__dirname, '..', tenancy.agreement.docxUrl.replace(/^\//, ''))
  
  if (!fs.existsSync(filepath)) {
    return res.status(404).json({ error: 'Agreement file not found.' })
  }

  const filename = `${tenancy.agreement.code || tenancy.ref}_Rental_Agreement.docx`
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
  res.sendFile(filepath)
}

/**
 * GET /api/portal/tenancies/:id/agreement/download - Portal download
 */
export async function portalDownloadAgreement(req, res) {
  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(404).json({ error: 'Tenancy not found.' })
  }
  const tenancy = await Tenancy.findById(req.params.id)
  if (!tenancy || String(tenancy.customer) !== String(req.customer._id)) {
    return res.status(404).json({ error: 'Tenancy not found.' })
  }

  if (!tenancy.agreement.docxUrl || tenancy.agreement.status !== 'approved') {
    return res.status(404).json({ error: 'Agreement not available for download.' })
  }

  const filepath = path.join(__dirname, '..', tenancy.agreement.docxUrl.replace(/^\//, ''))
  
  if (!fs.existsSync(filepath)) {
    return res.status(404).json({ error: 'Agreement file not found.' })
  }

  const filename = `${tenancy.agreement.code || tenancy.ref}_Rental_Agreement.docx`
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
  res.sendFile(filepath)
}
