// Chat photo rules that need no browser: what may be picked, how big it ends up, and what a stored path looks like.

/** Originals up to 5 MB. */
export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
/** The longest side after shrinking. */
export const PHOTO_SIDE = 1600;
/** JPEG quality of the shrunk photo. */
export const PHOTO_QUALITY = 0.82;

const TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const PATH = /^([0-9a-f-]{36})\/[0-9a-f-]{36}\.jpg$/;

/** The size to draw a photo at: the longest side at most `max`, the shape kept, never bigger than it was. */
export function fitWithin(width: number, height: number, max = PHOTO_SIDE): { width: number; height: number } {
  const scale = Math.min(1, max / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** Why a picked file can't be a chat photo ('type' or 'size'), or null when it can. Checked before any upload. */
export function photoProblem(file: { type: string; size: number }): 'type' | 'size' | null {
  if (!TYPES.has(file.type)) return 'type';
  if (file.size > MAX_PHOTO_BYTES) return 'size';
  return null;
}

/** A stored chat photo: `<user id>/<file id>.jpg` in that user's own folder. */
export function isChatPhotoPath(path: string, userId: string): boolean {
  return PATH.exec(path)?.[1] === userId;
}

/** The shape of a stored chat photo path, whoever's folder it is in. */
export const CHAT_PHOTO_PATH = PATH;
