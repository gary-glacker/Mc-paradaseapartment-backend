import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import Docxtemplater from 'docxtemplater'
import PizZip from 'pizzip'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

/**
 * Generate a DOCX agreement from the template using the provided data.
 * The template should contain placeholders like {tenantName}, {roomNumber}, etc.
 */
export async function generateAgreementDocx(data, templatePath = null) {
  const templateFile = templatePath || path.join(__dirname, '..', 'templates', 'agreement-template.docx')
  
  if (!fs.existsSync(templateFile)) {
    throw new Error('Agreement template not found')
  }
  
  const content = fs.readFileSync(templateFile, 'binary')
  const zip = new PizZip(content)
  const doc = new Docxtemplater(zip, {
    paragraphLoop: true,
    linebreaks: true,
  })
  
  // Prepare data with formatting
  const templateData = {
    agreementCode: data.agreementCode || '',
    agreementDate: data.agreementDate || new Date().toISOString().split('T')[0],
    tenantName: data.tenant?.fullName || '',
    tenantId: data.tenant?.nationalId || '',
    tenantPhone: data.tenant?.phone || '',
    tenantEmail: data.tenant?.email || '',
    tenantAddress: data.tenant?.address || '',
    landlordName: data.landlordName || 'MC PARADISE APARTMENTS',
    landlordManager: data.landlordManager || 'MANAGER',
    propertyName: data.propertyName || 'MC Paradise Apartments',
    roomNumber: data.room?.number || '',
    roomName: data.room?.name || '',
    roomFloor: data.room?.floor || '',
    beds: data.room?.beds || '',
    maxGuests: data.room?.maxGuests || '',
    checkIn: data.tenancy?.checkIn || '',
    checkOut: data.tenancy?.checkOut || '',
    nights: data.tenancy?.nights || 0,
    pricePerNight: data.tenancy?.pricePerNight || 0,
    currency: data.tenancy?.currency || 'USD',
    totalRent: data.tenancy?.total || 0,
    depositAmount: data.depositAmount || 0,
    depositCurrency: data.depositCurrency || data.tenancy?.currency || 'USD',
    paymentTerms: data.paymentTerms || 'As agreed',
    gymIncluded: data.tenancy?.gymIncluded ? 'YES' : 'NO',
    inventory: data.inventory || [],
    additionalTerms: data.additionalTerms || '',
    noticePeriod: data.noticePeriod || '',
    extensionTerms: data.extensionTerms || '',
    otherConditions: data.otherConditions || '',
    tenantSignatureDate: data.tenantSignatureDate || '',
    staffSignatureDate: data.staffSignatureDate || '',
    staffName: data.staffName || '',
    ...data
  }
  
  doc.render(templateData)
  const buf = doc.getZip().generate({ type: 'nodebuffer' })
  return buf
}

/**
 * Generate a unique agreement code
 */
export function generateAgreementCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  let code = 'AGR-'
  for (let i = 0; i < 8; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return code
}
