import type { SupabaseClient } from '@supabase/supabase-js';
import { fitWithin, PHOTO_QUALITY, photoProblem } from './photo-size';

// Chat photos in the browser: shrink a picked file, upload it to your own folder, and get short-lived links to show
// photos you may see (the bucket's row rules decide; the links last 10 minutes).

const BUCKET = 'chat-photos';
const LINK_SECONDS = 600;

/**
 * A picked file as a shrunk JPEG (longest side 1600 px), or why it can't be used. Nothing is uploaded here. The
 * camera's rotation is applied, and see-through parts (a PNG's) come out white — a JPEG has no transparency and
 * would turn them black.
 */
export async function prepareChatPhoto(file: File): Promise<{ blob: Blob } | { problem: 'type' | 'size' | 'unreadable' }> {
  const problem = photoProblem(file);
  if (problem) return { problem };
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const { width, height } = fitWithin(bitmap.width, bitmap.height);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) return { problem: 'unreadable' };
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, width, height);
    context.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', PHOTO_QUALITY));
    return blob ? { blob } : { problem: 'unreadable' };
  } catch {
    return { problem: 'unreadable' };
  }
}

/** Uploads a shrunk photo to `<user id>/<new id>.jpg` as the signed-in user; the path, or null if it failed. */
export async function uploadChatPhoto(db: SupabaseClient, userId: string, blob: Blob): Promise<string | null> {
  const path = `${userId}/${crypto.randomUUID()}.jpg`;
  const { error } = await db.storage.from(BUCKET).upload(path, blob, { contentType: 'image/jpeg' });
  return error ? null : path;
}

/** Links to the photos this person may see (others are simply left out). */
export async function signedPhotoUrls(db: SupabaseClient, paths: string[]): Promise<Map<string, string>> {
  const urls = new Map<string, string>();
  const wanted = [...new Set(paths)];
  if (wanted.length === 0) return urls;
  const { data, error } = await db.storage.from(BUCKET).createSignedUrls(wanted, LINK_SECONDS);
  if (error) return urls;
  for (const item of data ?? []) {
    if (item.path && item.signedUrl && !item.error) urls.set(item.path, item.signedUrl);
  }
  return urls;
}
