/**
 * Shared JSON shaping: expose `id`, hide `_id`/`__v`, and strip any field listed in `hidden`.
 * Secrets are additionally `select: false`, so they are absent unless explicitly requested.
 */
export function jsonPlugin(schema, { hidden = [] } = {}) {
  schema.set('toJSON', {
    virtuals: false,
    versionKey: false,
    transform(_doc, ret) {
      ret.id = String(ret._id);
      delete ret._id;
      for (const key of hidden) delete ret[key];
      return ret;
    },
  });
}
