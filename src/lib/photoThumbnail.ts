/**
 * Generate a downscaled JPEG thumbnail from an image Blob.
 *
 * Why: the gallery displays each photo in a ~220×160 tile. Decoding the
 * original 2 MB JPEG just to render a tile that small wastes RAM and CPU
 * (a 4000×3000 JPEG decoded to RGBA is ~48 MB). With 1400 photos that's
 * gigabytes of decoded pixels held by the WebView. The thumbnail is a
 * one-time per-photo cost (~30–80 KB) that lets the grid stay smooth.
 *
 * Uses HTMLImageElement + 2D canvas. createImageBitmap would be ~2× faster
 * but isn't universally supported for arbitrary mimes; the canvas path
 * works everywhere the WebView already runs.
 */
export async function generateThumbnail(
  blob: Blob,
  maxDim = 480,
  quality = 0.82,
): Promise<Blob | null> {
  const url = URL.createObjectURL(blob);
  try {
    const img = await new Promise<HTMLImageElement | null>((resolve) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => resolve(null);
      el.src = url;
    });
    if (!img || !img.naturalWidth || !img.naturalHeight) return null;

    // Preserve aspect ratio — fit longest side into `maxDim`, never upscale.
    const ratio = Math.min(
      maxDim / img.naturalWidth,
      maxDim / img.naturalHeight,
      1,
    );
    const w = Math.max(1, Math.round(img.naturalWidth * ratio));
    const h = Math.max(1, Math.round(img.naturalHeight * ratio));

    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, 0, 0, w, h);

    return await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(
        (b) => resolve(b),
        // PNGs with transparency lose alpha when converted to JPEG, but for
        // gallery thumbnails the file-size win (3–5× smaller) is worth it.
        "image/jpeg",
        quality,
      );
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}
