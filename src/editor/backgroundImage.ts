// Turns an uploaded floor-plan image into a compact data URL for the plan background.
// Large scans are scaled down (they are only traced over, so ~2000px is plenty) and
// re-encoded as JPEG on white, which keeps saved plans small.

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
  return { image: canvas.toDataURL('image/jpeg', 0.85), width, height };
}

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

// A smaller copy of a background image for the vision model (faster to read), with its size.
export async function shrinkForVision(src: string, maxSide = 1024) {
  return toJpeg(await loadImage(src), maxSide);
}
