import { FormEvent, useRef, useState } from "react";
import type { Settings } from "../types";
import { api } from "../lib/api";
import { formatDate } from "../lib/format";
import { confirmAndRun, toast } from "../lib/notify";

const MAX_BYTES = 140_000;

async function fileToBase64(file: File) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

type Props = { verifactu: Settings["verifactu"]; onSaved: (s: Settings) => void };

export function CertificateBox({ verifactu, onSaved }: Props) {
  const cert = verifactu.certificate;
  const [replacing, setReplacing] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const daysLeft = cert?.notAfter ? Math.floor((new Date(cert.notAfter).getTime() - Date.now()) / 86_400_000) : null;

  async function upload(e: FormEvent) {
    e.preventDefault();
    if (!file) return;
    setError(null);
    if (file.size > MAX_BYTES) {
      setError("El fichero es demasiado grande para ser un certificado (.pfx/.p12)");
      return;
    }
    setBusy(true);
    try {
      const saved = await api.uploadCertificate(await fileToBase64(file), password);
      onSaved(saved);
      setFile(null);
      setReplacing(false);
      if (fileInput.current) fileInput.current.value = "";
      toast("Certificado guardado");
    } catch (err) {
      setError((err as Error).message);
    }
    setPassword("");
    setBusy(false);
  }

  async function remove() {
    await confirmAndRun(
      "¿Borrar el certificado electrónico? Sin él no se pueden enviar los tickets a Hacienda.",
      async () => onSaved(await api.deleteCertificate()),
      "Certificado borrado",
    );
  }

  return (
    <div className="sub-panel">
      <h3>Certificado electrónico</h3>
      {cert ? (
        <div className="cert-info">
          <p>
            <strong>{cert.subject}</strong>
            <br />
            <span className={daysLeft !== null && daysLeft < 30 ? "warn-text" : "muted"}>
              {cert.notAfter && `Caduca el ${formatDate(cert.notAfter)}`}
              {daysLeft !== null && daysLeft < 30 && ` (quedan ${Math.max(daysLeft, 0)} días: renuévalo)`}
            </span>
          </p>
          <div className="row-actions">
            {!replacing && (
              <button type="button" className="btn small" onClick={() => setReplacing(true)}>
                Sustituir
              </button>
            )}
            <button type="button" className="btn small danger" onClick={remove}>
              Borrar certificado
            </button>
          </div>
        </div>
      ) : (
        <p className="muted small">
          Hace falta el certificado de la empresa o de su representante (fichero .pfx o .p12, el que se exporta desde el
          navegador o te da la FNMT) para firmar los envíos a Hacienda. Se guarda cifrado.
        </p>
      )}
      {(!cert || replacing) && (
        <form className="cert-form" onSubmit={upload} aria-label="Subir certificado">
          <label>
            Fichero del certificado
            <input
              ref={fileInput}
              type="file"
              accept=".pfx,.p12,application/x-pkcs12"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              required
            />
          </label>
          <label>
            Contraseña del certificado
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              required
            />
          </label>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <div className="row-actions start">
            <button className="btn primary" disabled={busy || !file}>
              {busy ? "Comprobando…" : "Subir certificado"}
            </button>
            {replacing && (
              <button type="button" className="btn ghost" onClick={() => setReplacing(false)}>
                Cancelar
              </button>
            )}
          </div>
        </form>
      )}
    </div>
  );
}
