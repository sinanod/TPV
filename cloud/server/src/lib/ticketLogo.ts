import crypto from "crypto";
import { PNG } from "pngjs";
import { HttpError } from "./http";

// 576 puntos = ancho útil de una impresora térmica de 80 mm a 203 ppp. El
// portal ya redimensiona la imagen antes de subirla; aquí solo se comprueba.
export const LOGO_MAX_WIDTH = 576;
export const LOGO_MAX_HEIGHT = 320;
const MAX_UPLOAD_BYTES = 1024 * 1024;

/**
 * Valida el PNG que sube el restaurante y lo vuelve a codificar desde los
 * píxeles: así no se guarda ni se reparte nada más que la imagen (sin
 * metadatos ni bloques extra) y la transparencia queda sobre blanco, que es
 * el color del papel.
 */
export function sanitizeLogo(input: Buffer) {
  if (input.length > MAX_UPLOAD_BYTES) throw new HttpError(400, "El logo ocupa demasiado (máximo 1 MB)");
  let png: PNG;
  try {
    png = PNG.sync.read(input);
  } catch {
    throw new HttpError(400, "El archivo no es una imagen PNG válida");
  }
  const { width, height, data } = png;
  if (width < 16 || height < 16) throw new HttpError(400, "El logo es demasiado pequeño (mínimo 16×16 píxeles)");
  if (width > LOGO_MAX_WIDTH || height > LOGO_MAX_HEIGHT) {
    throw new HttpError(400, `El logo no puede superar ${LOGO_MAX_WIDTH}×${LOGO_MAX_HEIGHT} píxeles`);
  }

  const out = new PNG({ width, height, colorType: 2, inputColorType: 6, inputHasAlpha: true });
  let blank = true;
  for (let i = 0; i < width * height * 4; i += 4) {
    const a = data[i + 3] / 255;
    for (let c = 0; c < 3; c++) {
      const v = Math.round(data[i + c] * a + 255 * (1 - a));
      out.data[i + c] = v;
      if (v < 240) blank = false;
    }
    out.data[i + 3] = 255;
  }
  if (blank) throw new HttpError(400, "El logo está en blanco: en el ticket no se vería nada");

  const clean = PNG.sync.write(out, { colorType: 2 });
  return { png: clean, width, height, hash: crypto.createHash("sha256").update(clean).digest("hex").slice(0, 32) };
}
