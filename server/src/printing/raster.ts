import { PNG } from "pngjs";

// Las impresoras térmicas solo imprimen puntos negros: el logo se reduce al
// ancho en puntos del papel y se pasa a 1 bit, con tramado (Floyd–Steinberg)
// para fotos y degradados o con umbral para logos de colores planos.

export interface GrayImage {
  width: number;
  height: number;
  /** Un byte por píxel: 0 = negro, 255 = blanco */
  gray: Uint8Array;
}

export interface Bitmap {
  width: number;
  height: number;
  /** Filas de `width / 8` bytes, el bit más alto es el píxel de la izquierda; 1 = punto negro */
  bits: Uint8Array;
}

export function decodePng(png: Buffer): GrayImage {
  const img = PNG.sync.read(png);
  const gray = new Uint8Array(img.width * img.height);
  for (let i = 0; i < gray.length; i++) {
    const a = img.data[i * 4 + 3] / 255;
    // Luminancia (Rec. 601) sobre fondo blanco
    const l = 0.299 * img.data[i * 4] + 0.587 * img.data[i * 4 + 1] + 0.114 * img.data[i * 4 + 2];
    gray[i] = Math.round(l * a + 255 * (1 - a));
  }
  return { width: img.width, height: img.height, gray };
}

/** Reduce por media de áreas (o amplía al vecino más cercano). */
export function resize(src: GrayImage, width: number): GrayImage {
  const height = Math.max(1, Math.round((src.height * width) / src.width));
  const out = new Uint8Array(width * height);
  const sx = src.width / width;
  const sy = src.height / height;
  for (let y = 0; y < height; y++) {
    const y0 = Math.floor(y * sy);
    const y1 = Math.max(y0 + 1, Math.min(src.height, Math.floor((y + 1) * sy)));
    for (let x = 0; x < width; x++) {
      const x0 = Math.floor(x * sx);
      const x1 = Math.max(x0 + 1, Math.min(src.width, Math.floor((x + 1) * sx)));
      let sum = 0;
      for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) sum += src.gray[yy * src.width + xx];
      out[y * width + x] = Math.round(sum / ((y1 - y0) * (x1 - x0)));
    }
  }
  return { width, height, gray: out };
}

export function toBitmap(img: GrayImage, style: "DITHER" | "THRESHOLD"): Bitmap {
  const { width, height } = img;
  const rowBytes = Math.ceil(width / 8);
  const bits = new Uint8Array(rowBytes * height);
  const buf = Float32Array.from(img.gray);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const black = buf[i] < 128;
      if (black) bits[y * rowBytes + (x >> 3)] |= 0x80 >> (x & 7);
      if (style === "DITHER") {
        const err = buf[i] - (black ? 0 : 255);
        if (x + 1 < width) buf[i + 1] += (err * 7) / 16;
        if (y + 1 < height) {
          if (x > 0) buf[i + width - 1] += (err * 3) / 16;
          buf[i + width] += (err * 5) / 16;
          if (x + 1 < width) buf[i + width + 1] += err / 16;
        }
      }
    }
  }
  return { width: rowBytes * 8, height, bits };
}

/** Puntos imprimibles por línea: 576 en papel de 80 mm, 384 en el de 58 mm (203 ppp). */
export function printableDots(widthMm: number) {
  return widthMm >= 80 ? 576 : 384;
}
