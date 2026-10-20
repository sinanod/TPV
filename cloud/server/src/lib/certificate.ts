import crypto from "crypto";
import forge from "node-forge";
import { config } from "../config";
import { HttpError } from "./http";

// Certificados electrónicos de los restaurantes para remitir a la AEAT.
// Se guardan cifrados (AES-256-GCM) y solo se descifran en memoria al enviar.

function key() {
  if (!config.certEncryptionKey) {
    throw new HttpError(503, "Falta CERT_ENCRYPTION_KEY en el servidor: no se pueden guardar certificados");
  }
  return config.certEncryptionKey;
}

export function encrypt(data: Buffer): Buffer {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const body = Buffer.concat([cipher.update(data), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]);
}

export function decrypt(blob: Buffer): Buffer {
  const decipher = crypto.createDecipheriv("aes-256-gcm", key(), blob.subarray(0, 12));
  decipher.setAuthTag(blob.subarray(12, 28));
  return Buffer.concat([decipher.update(blob.subarray(28)), decipher.final()]);
}

export interface CertificateInfo {
  subject: string;
  notAfter: Date;
}

/** Comprueba que el PFX abre con la contraseña, que contiene clave privada y que no ha caducado. */
export function inspectPfx(pfx: Buffer, password: string): CertificateInfo {
  let p12: forge.pkcs12.Pkcs12Pfx;
  try {
    p12 = forge.pkcs12.pkcs12FromAsn1(forge.asn1.fromDer(pfx.toString("binary")), password);
  } catch {
    throw new HttpError(400, "No se pudo abrir el certificado: revisa el fichero (.pfx/.p12) y la contraseña");
  }
  const keys = p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag] ?? [];
  const plainKeys = p12.getBags({ bagType: forge.pki.oids.keyBag })[forge.pki.oids.keyBag] ?? [];
  if (!keys.length && !plainKeys.length) throw new HttpError(400, "El fichero no contiene la clave privada del certificado");

  const certs = (p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] ?? [])
    .map((b) => b.cert)
    .filter((c): c is forge.pki.Certificate => !!c);
  // El de la persona/entidad es el que no es CA
  const cert = certs.find((c) => !c.getExtension("basicConstraints") || !(c.getExtension("basicConstraints") as { cA?: boolean }).cA) ?? certs[0];
  if (!cert) throw new HttpError(400, "El fichero no contiene ningún certificado");

  const notAfter = cert.validity.notAfter;
  if (notAfter.getTime() < Date.now()) throw new HttpError(400, `El certificado caducó el ${notAfter.toLocaleDateString("es-ES")}`);

  // Por OID: los certificados de la FNMT llevan el NIF en serialNumber (2.5.4.5)
  const attr = (oid: string) => cert.subject.attributes.find((a) => a.type === oid)?.value as string | undefined;
  const subject = [attr("2.5.4.3"), attr("2.5.4.5"), attr("2.5.4.10")].filter(Boolean).join(" · ");
  return { subject: subject || "Certificado sin nombre", notAfter };
}
