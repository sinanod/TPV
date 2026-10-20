import type { LogoStyle } from "../types";

// Mismo proceso que hace el TPV antes de mandar el logo a la impresora
// térmica (server/src/printing/raster.ts), para que la vista previa enseñe lo
// que de verdad saldrá en el papel: solo puntos negros a 203 ppp.

export const LOGO_MAX_WIDTH = 576;
export const LOGO_MAX_HEIGHT = 320;

/** Puntos imprimibles por línea: 576 en papel de 80 mm, 384 en el de 58 mm. */
export const printableDots = (paperMm: number) => (paperMm >= 80 ? 576 : 384);
/** Caracteres por línea con la fuente normal. */
export const columnsFor = (paperMm: number) => (paperMm >= 80 ? 48 : 32);

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("No se ha podido leer la imagen"));
    img.src = src;
  });
}

/**
 * Prepara la imagen que elige el restaurante para subirla: la reduce para que
 * quepa en 576×320 (el máximo útil en el papel), pone la transparencia sobre
 * blanco y la convierte a PNG.
 */
export async function prepareLogo(file: File): Promise<{ base64: string; width: number; height: number }> {
  if (!file.type.startsWith("image/")) throw new Error("Elige una imagen (PNG, JPG, WebP o SVG)");
  if (file.size > 10 * 1024 * 1024) throw new Error("La imagen ocupa demasiado (máximo 10 MB)");
  // Como data: y no blob:, que la política de seguridad del portal no permite en imágenes
  const url = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("No se ha podido leer el archivo"));
    reader.readAsDataURL(file);
  });
  const img = await loadImage(url);
  const w0 = img.naturalWidth || 300;
  const h0 = img.naturalHeight || 150;
  const scale = Math.min(1, LOGO_MAX_WIDTH / w0, LOGO_MAX_HEIGHT / h0);
  const width = Math.max(16, Math.round(w0 * scale));
  const height = Math.max(16, Math.round(h0 * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, width, height);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, 0, 0, width, height);
  return { base64: canvas.toDataURL("image/png").split(",")[1], width, height };
}

/**
 * Dibuja en `canvas` el logo tal y como lo imprimirá la térmica: reducido al
 * ancho en puntos que le toca y pasado a blanco y negro.
 */
export function renderThermal(
  canvas: HTMLCanvasElement,
  img: HTMLImageElement,
  paperMm: number,
  sizePercent: number,
  style: LogoStyle,
) {
  const dots = printableDots(paperMm);
  const width = Math.max(8, Math.min(dots, Math.round((dots * sizePercent) / 100 / 8) * 8));
  const height = Math.max(1, Math.round((img.naturalHeight * width) / img.naturalWidth));
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(img, 0, 0, width, height);
  const data = ctx.getImageData(0, 0, width, height);
  const px = data.data;

  const buf = new Float32Array(width * height);
  for (let i = 0; i < buf.length; i++) buf[i] = 0.299 * px[i * 4] + 0.587 * px[i * 4 + 1] + 0.114 * px[i * 4 + 2];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const black = buf[i] < 128;
      if (style === "DITHER") {
        const err = buf[i] - (black ? 0 : 255);
        if (x + 1 < width) buf[i + 1] += (err * 7) / 16;
        if (y + 1 < height) {
          if (x > 0) buf[i + width - 1] += (err * 3) / 16;
          buf[i + width] += (err * 5) / 16;
          if (x + 1 < width) buf[i + width + 1] += err / 16;
        }
      }
      const v = black ? 0 : 255;
      px[i * 4] = px[i * 4 + 1] = px[i * 4 + 2] = v;
      px[i * 4 + 3] = 255;
    }
  }
  ctx.putImageData(data, 0, 0);
  return { width, height, dots };
}
