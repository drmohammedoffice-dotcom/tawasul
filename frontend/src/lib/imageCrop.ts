/** Crop image File to a square-ish JPEG blob using canvas. */
export async function cropImageFile(
  file: File,
  opts: { sx: number; sy: number; sw: number; sh: number; outSize?: number }
): Promise<File> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('image load failed'));
      el.src = url;
    });
    const size = opts.outSize || 1080;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas unsupported');
    ctx.drawImage(img, opts.sx, opts.sy, opts.sw, opts.sh, 0, 0, size, size);
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('encode failed'))), 'image/jpeg', 0.88);
    });
    return new File([blob], file.name.replace(/\.\w+$/, '') + '-crop.jpg', { type: 'image/jpeg' });
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Center-crop to max square from image. */
export async function centerSquareCrop(file: File): Promise<File> {
  return centerAspectCrop(file, 1);
}

/** Center-crop to a target width/height ratio (e.g. 1 or 3/4). */
export async function centerAspectCrop(file: File, ratioWoverH: number): Promise<File> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('image load failed'));
      el.src = url;
    });
    const nw = img.naturalWidth;
    const nh = img.naturalHeight;
    const target = Math.max(0.01, ratioWoverH);
    let sw: number;
    let sh: number;
    if (nw / nh > target) {
      sh = nh;
      sw = nh * target;
    } else {
      sw = nw;
      sh = nw / target;
    }
    const sx = (nw - sw) / 2;
    const sy = (nh - sh) / 2;
    const outW = Math.round(Math.min(1080, sw));
    const outH = Math.round(outW / target);
    const canvas = document.createElement('canvas');
    canvas.width = outW;
    canvas.height = outH;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas unsupported');
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, outW, outH);
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('encode failed'))), 'image/jpeg', 0.88);
    });
    return new File([blob], file.name.replace(/\.\w+$/, '') + '-crop.jpg', { type: 'image/jpeg' });
  } finally {
    URL.revokeObjectURL(url);
  }
}
