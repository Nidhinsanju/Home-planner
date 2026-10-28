// Turns an uploaded floor-plan image into a compact data URL for the plan background.
// Large scans are scaled down (they are only traced over, so ~2000px is plenty) and
// re-encoded as JPEG on white, which keeps saved plans small.

import { pixelsFromRGBA, drawingMask, setDrawingMask } from '../plan/wallMask';

const loadImage = (src: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error('That image could not be read.'));
    el.src = src;
  });

// Draws the image at most `maxSide` pixels on its longer side, as a JPEG on white.
function toJpeg(img: HTMLImageElement, maxSide: number) {
  const k = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
  const width = Math.max(1, Math.round(img.naturalWidth * k));
  const height = Math.max(1, Math.round(img.naturalHeight * k));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Your browser could not process the image.');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(img, 0, 0, width, height);
  // Small enough to send: the host refuses requests over 4.5 MB (Vercel), and a save or a
  // chat message carries the image plus the plan. A busy scan is compressed a little more.
  let image = '';
  for (const quality of [0.85, 0.75, 0.65, 0.55]) {
    image = canvas.toDataURL('image/jpeg', quality);
    if (image.length <= MAX_IMAGE_CHARS) break;
  }
  return { image, width, height };
}

const MAX_IMAGE_CHARS = 3_000_000; // ~2.2 MB of JPEG as a data URL

export async function loadBackgroundImage(file: File): Promise<{ src: string; aspect: number }> {
  if (!/^image\/(png|jpeg|webp|gif|bmp)$/.test(file.type)) {
    throw new Error('Please upload a PNG or JPG image. For a PDF, export the page as an image first.');
  }
  const url = URL.createObjectURL(file);
  try {
    const { image, width, height } = toJpeg(await loadImage(url), 2000);
    return { src: image, aspect: height / width };
  } finally {
    URL.revokeObjectURL(url);
  }
}

// Decodes a background image into its pixels (brightness), at the size the vision model read it, so
// building from the drawing can line the rooms up with the walls on it (see plan/wallMask.ts).
// Done once per image; later calls return at once.
const pendingMasks = new Map<string, Promise<void>>();
export function loadDrawingMask(src: string): Promise<void> {
  if (drawingMask(src)) return Promise.resolve();
  let p = pendingMasks.get(src);
  if (!p) {
    p = loadImage(src).then(img => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) throw new Error('Your browser could not process the image.');
      ctx.drawImage(img, 0, 0);
      const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
      setDrawingMask(src, pixelsFromRGBA(data, canvas.width, canvas.height));
    }).finally(() => pendingMasks.delete(src));
    pendingMasks.set(src, p);
  }
  return p;
}

// Pixel size of a background image. The vision model gets the image exactly as stored (up to
// 2000 px on the long side, see loadBackgroundImage): small text like 9' 11" must stay legible.
export async function imageSize(src: string) {
  const img = await loadImage(src);
  return { width: img.naturalWidth, height: img.naturalHeight };
}
