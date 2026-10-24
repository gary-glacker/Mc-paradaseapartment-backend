import mongoose from 'mongoose'
import { asJson } from './jsonTransform.js'

const { Schema } = mongoose

const agreementTemplateSchema = new Schema(
  {
    name: { type: String, required: true, default: 'Standard Rental Agreement', trim: true },
    slug: { type: String, required: true, unique: true, trim: true },
    isActive: { type: Boolean, default: true },
    templateFile: { type: String, default: 'templates/agreement-template.docx' },
    defaultTerms: { type: [String], default: [] },
    inventoryDefaults: { type: Schema.Types.Mixed, default: {} },
    createdBy: { type: String, default: '', trim: true },
    updatedBy: { type: String, default: '', trim: true },
  },
  { timestamps: true, toJSON: asJson() },
)

export const AgreementTemplate = mongoose.models.AgreementTemplate ?? mongoose.model('AgreementTemplate', agreementTemplateSchema)
