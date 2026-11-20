let counter = 0;

/**
 * Client-side ids for media items and device presets. crypto.randomUUID is only available in
 * secure contexts (HTTPS / localhost), so fall back to a time + counter + random id.
 * Only call from event handlers or effects, never during render.
 */
export function createClientId(prefix = 'id') {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return `${prefix}_${crypto.randomUUID()}`;
    }
  } catch {
    /* fall through */
  }
  counter += 1;
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36)}${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}
