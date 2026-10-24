/**
 * Shared `toJSON` options: every document leaves the API with a string
 * `id` instead of `_id`, and without the internal `__v` counter.
 */
export const asJson = (extra) => ({
  versionKey: false,
  transform(_doc, ret) {
    ret.id = String(ret._id)
    delete ret._id
    return extra ? extra(ret) : ret
  },
})
