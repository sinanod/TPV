import "dotenv/config";
import { execSync } from "child_process";
import fs from "fs";
import path from "path";

// CA de pruebas, certificado del servidor AEAT simulado y certificado del
// restaurante (PFX) para probar el envío con autenticación de cliente (mTLS).
function generateCertificates(dir: string) {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const run = (cmd: string) => execSync(cmd, { cwd: dir, stdio: "ignore" });
  run('openssl req -x509 -newkey rsa:2048 -nodes -keyout ca.key -out ca.pem -days 2 -subj "/CN=CA de pruebas"');
  fs.writeFileSync(path.join(dir, "server.ext"), "subjectAltName=IP:127.0.0.1\n");
  run('openssl req -newkey rsa:2048 -nodes -keyout server.key -out server.csr -subj "/CN=127.0.0.1"');
  run("openssl x509 -req -in server.csr -CA ca.pem -CAkey ca.key -CAcreateserial -out server.pem -days 2 -extfile server.ext");
  run('openssl req -newkey rsa:2048 -nodes -keyout client.key -out client.csr -subj "/CN=BAR PEPE SL/serialNumber=IDCES-B76543214"');
  run("openssl x509 -req -in client.csr -CA ca.pem -CAkey ca.key -CAcreateserial -out client.pem -days 2");
  run("openssl pkcs12 -export -out client.pfx -inkey client.key -in client.pem -certfile ca.pem -passout pass:secreto");
}

export default function setup() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("Define TEST_DATABASE_URL para los tests");
  execSync("npx prisma db push --force-reset --skip-generate", {
    stdio: "ignore",
    env: { ...process.env, DATABASE_URL: url },
  });
  generateCertificates(path.join(__dirname, ".certs"));
}
