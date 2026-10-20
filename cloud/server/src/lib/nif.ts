// Validación de NIF españoles (DNI, NIE y NIF de personas jurídicas) con su
// carácter de control, para no enviar a la AEAT registros que va a rechazar.

const DNI_LETTERS = "TRWAGMYFPDXBNJZSQVHLCKE";
const CIF_CONTROL_LETTERS = "JABCDEFGHI";

export function normalizeNif(nif: string) {
  return nif.toUpperCase().replace(/[\s.-]/g, "");
}

export function isValidNif(input: string): boolean {
  const nif = normalizeNif(input);
  if (nif.length !== 9) return false;

  if (/^\d{8}[A-Z]$/.test(nif)) return DNI_LETTERS[Number(nif.slice(0, 8)) % 23] === nif[8];

  if (/^[XYZ]\d{7}[A-Z]$/.test(nif)) {
    const number = "XYZ".indexOf(nif[0]) + nif.slice(1, 8);
    return DNI_LETTERS[Number(number) % 23] === nif[8];
  }

  if (/^[ABCDEFGHJNPQRSUVW]\d{7}[0-9A-J]$/.test(nif)) {
    const digits = nif.slice(1, 8);
    let sum = 0;
    for (let i = 0; i < 7; i++) {
      const d = Number(digits[i]);
      if (i % 2 === 0) {
        const doubled = d * 2;
        sum += Math.floor(doubled / 10) + (doubled % 10);
      } else {
        sum += d;
      }
    }
    const control = (10 - (sum % 10)) % 10;
    const last = nif[8];
    // Según el tipo de entidad el control es una letra, un dígito o ambos valen
    if ("PQRSNW".includes(nif[0])) return last === CIF_CONTROL_LETTERS[control];
    if ("ABEH".includes(nif[0])) return last === String(control);
    return last === String(control) || last === CIF_CONTROL_LETTERS[control];
  }

  return false;
}
