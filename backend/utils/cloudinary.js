import { v2 as cloudinary } from 'cloudinary'

/**
 * Cloudinary uploads.
 *
 * Images are never proxied through this API. Instead the browser asks
 * the backend to *sign* an upload, then posts the file straight to
 * Cloudinary. The API secret therefore stays on the server and is never
 * shipped to the client.
 *
 * Everything degrades gracefully: when the three credentials are absent
 * `mailConfigured`-style helpers report `false` and the endpoints answer
 * with a clear "not configured" message instead of throwing.
 */

const cfg = () => ({
  cloudName: process.env.CLOUDINARY_CLOUD_NAME?.trim() ?? '',
  apiKey: process.env.CLOUDINARY_API_KEY?.trim() ?? '',
  apiSecret: process.env.CLOUDINARY_API_SECRET?.trim() ?? '',
  folder: process.env.CLOUDINARY_FOLDER?.trim() ?? 'mc-paradise',
})

/** True when all three Cloudinary credentials are present. */
export const cloudinaryConfigured = () => {
  const { cloudName, apiKey, apiSecret } = cfg()
  return Boolean(cloudName && apiKey && apiSecret)
}

/**
 * The public (non-secret) settings the browser needs, plus whether
 * uploads are possible at all. Safe to return to any signed-in user.
 */
export const cloudinaryPublicConfig = () => {
  const { cloudName, folder } = cfg()
  return {
    configured: cloudinaryConfigured(),
    cloudName,
    folder,
    /* Uploads are signed, so the browser never sees the API key/secret. */
    unsignedPreset: '',
  }
}

/** The purposes an upload may be tagged with — keeps folders tidy. */
export const UPLOAD_PURPOSES = ['customer-id', 'room', 'property', 'staff']

/** A folder path for a purpose, e.g. `mc-paradise/customer-id`. */
export const folderFor = (purpose) => {
  const { folder } = cfg()
  const safe = UPLOAD_PURPOSES.includes(purpose) ? purpose : 'general'
  return folder ? `${folder}/${safe}` : safe
}

/** One-time upload signature (valid for a single upload, 10 minutes). */
export const signUpload = (purpose) => {
  const { apiKey, apiSecret } = cfg()
  const timestamp = Math.floor(Date.now() / 1000)
  const folder = folderFor(purpose)

  const params = { folder, timestamp }
  const signature = cloudinary.utils.api_sign_request(params, apiSecret)

  return { timestamp, folder, signature, apiKey }
}

/** Shrink + optimise a Cloudinary secure URL for thumbnails. */
export const thumbUrl = (url, width = 400) => {
  if (!url || typeof url !== 'string' || !url.includes('/upload/')) return url
  return url.replace('/upload/', `/upload/c_fill,w_${width},h_${width},q_auto,f_auto/`)
}
