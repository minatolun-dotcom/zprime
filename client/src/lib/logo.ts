// R-74: company logo conversion. The operator may upload ANY image their
// browser can render (JPEG, PNG, WebP, GIF, AVIF, BMP, SVG…) — this decodes
// it via the platform's own <img> pipeline, downscales to ≤512px on the long
// side (aspect preserved, never upscales), and re-encodes PNG. The server
// then stores/validates PNG bytes only: no native image dependency, and the
// SVG script surface never reaches the database (SVG is decoded by the
// browser's image pipeline, not executed).
export async function fileToLogoPng(file: File): Promise<Blob> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("Could not read that file as an image"));
      el.src = url;
    });
    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;
    if (!w || !h) throw new Error("Image has no dimensions");
    const MAX = 512;
    const scale = Math.min(1, MAX / Math.max(w, h));
    const cw = Math.max(1, Math.round(w * scale));
    const ch = Math.max(1, Math.round(h * scale));
    const canvas = document.createElement("canvas");
    canvas.width = cw;
    canvas.height = ch;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas unavailable in this browser");
    ctx.drawImage(img, 0, 0, cw, ch);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!blob) throw new Error("PNG conversion failed");
    return blob;
  } finally {
    URL.revokeObjectURL(url);
  }
}
