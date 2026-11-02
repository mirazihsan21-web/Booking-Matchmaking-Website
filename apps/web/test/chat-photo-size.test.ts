import { describe, expect, it } from 'vitest';
import { fitWithin, isChatPhotoPath, MAX_PHOTO_BYTES, PHOTO_QUALITY, PHOTO_SIDE, photoProblem } from '../lib/chat/photo-size';

const USER = '0f1e2d3c-4b5a-4968-8776-655443322110';
const OTHER = '11111111-2222-4333-8444-555555555555';
const FILE = '9a8b7c6d-5e4f-4321-8765-0123456789ab';

describe('fitWithin', () => {
  it('shrinks the longest side to 1600 px, keeping the shape', () => {
    expect(fitWithin(4000, 3000)).toEqual({ width: 1600, height: 1200 });
    expect(fitWithin(1080, 1920)).toEqual({ width: 900, height: 1600 });
    expect(fitWithin(1601, 1)).toEqual({ width: 1600, height: 1 });
  });

  it('never makes a small photo bigger', () => {
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600 });
  });

  it('uses the chat settings', () => {
    expect([PHOTO_SIDE, PHOTO_QUALITY, MAX_PHOTO_BYTES]).toEqual([1600, 0.82, 5 * 1024 * 1024]);
  });
});

describe('photoProblem', () => {
  it('takes JPEG, PNG and WebP up to 5 MB', () => {
    expect(photoProblem({ type: 'image/jpeg', size: 5 * 1024 * 1024 })).toBeNull();
    expect(photoProblem({ type: 'image/png', size: 1 })).toBeNull();
    expect(photoProblem({ type: 'image/webp', size: 1 })).toBeNull();
  });

  it('refuses other types and big files before anything is uploaded', () => {
    expect(photoProblem({ type: 'image/heic', size: 1 })).toBe('type');
    expect(photoProblem({ type: 'application/pdf', size: 1 })).toBe('type');
    expect(photoProblem({ type: 'image/png', size: 9 * 1024 * 1024 })).toBe('size');
  });
});

describe('isChatPhotoPath', () => {
  it('is a JPEG in the sender\'s own folder', () => {
    expect(isChatPhotoPath(`${USER}/${FILE}.jpg`, USER)).toBe(true);
    expect(isChatPhotoPath(`${OTHER}/${FILE}.jpg`, USER)).toBe(false);
    expect(isChatPhotoPath(`${USER}/../x.jpg`, USER)).toBe(false);
    expect(isChatPhotoPath(`${USER}/${FILE}.png`, USER)).toBe(false);
  });
});
