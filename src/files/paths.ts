const MAX_STEM_CHARS = 80;
const MAX_EXT_CHARS = 16;

const IMAGE_MIMES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/heic', 'image/heif']);

// Pairing and conversation ids become folder names, so anything outside a safe set is replaced.
export function safeSegment(id: string): string {
  const safe = id.replace(/[^A-Za-z0-9._-]/g, '_').replace(/^\.+/, '_');
  return safe.length > 0 ? safe : '_';
}

// `<id>-<name>` with the extension kept when a long name is cut.
export function fileName(id: string, name: string): string {
  const safe = safeSegment(name.trim() || 'file');
  const dot = safe.lastIndexOf('.');
  const ext = dot > 0 && safe.length - dot <= MAX_EXT_CHARS ? safe.slice(dot) : '';
  const stem = (ext ? safe.slice(0, dot) : safe).slice(0, MAX_STEM_CHARS);
  return `${safeSegment(id)}-${stem}${ext}`;
}

export function isImage(mime: string): boolean {
  return IMAGE_MIMES.has(mime.toLowerCase());
}
