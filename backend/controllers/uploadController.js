import {
  UPLOAD_PURPOSES,
  cloudinaryConfigured,
  cloudinaryPublicConfig,
  signUpload,
} from '../utils/cloudinary.js'
import { str } from '../utils/helpers.js'

/**
 * GET /api/uploads/config
 * What the browser needs to upload: whether Cloudinary is configured,
 * the cloud name, the folder and the upload endpoint. Never returns the
 * API secret — uploads are signed server-side.
 */
export async function getUploadConfig(_req, res) {
  const config = cloudinaryPublicConfig()
  res.json({
    config: {
      ...config,
      /* Where the browser POSTs the file after signing. */
      uploadUrl: config.cloudName
        ? `https://api.cloudinary.com/v1_1/${config.cloudName}/image/upload`
        : '',
      purposes: UPLOAD_PURPOSES,
    },
  })
}

/**
 * POST /api/uploads/sign
 * Signs a single upload. The browser sends the returned `signature`,
 * `timestamp`, `apiKey` and `folder` along with the file to Cloudinary.
 */
export async function signUploadRequest(req, res) {
  if (!cloudinaryConfigured()) {
    return res.status(503).json({
      error:
        'Image uploads are not configured. Add CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET to backend/.env and restart the API.',
    })
  }

  const purpose = str(req.body?.purpose, 40) || 'general'
  const signed = signUpload(purpose)

  res.json({
    upload: {
      ...signed,
      uploadUrl: `https://api.cloudinary.com/v1_1/${process.env.CLOUDINARY_CLOUD_NAME?.trim()}/image/upload`,
      purpose,
    },
  })
}
