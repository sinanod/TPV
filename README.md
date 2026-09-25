# TPV

TPV de hostelería al estilo MissTipsi, pensado para dar servicio a muchos
restaurantes:

- **Cada restaurante** tiene su TPV local: app de escritorio (que hace de
  servidor) + app Android para las comandas. Funciona aunque se caiga
  internet.
- **Un portal en Azure** para todos: cada restaurante entra con el usuario y
  contraseña que le das de alta tú, ve su estado en vivo y sus ventas, y
  gestiona carta, mesas y personal. No se puede usar como TPV.

Diseño completo en [`ARCHITECTURE.md`](./ARCHITECTURE.md). Despliegue en
Azure y alta de restaurantes en [`cloud/README.md`](./cloud/README.md).

| Carpeta | Qué es |
|---|---|
| `server/` | Servidor del TPV local (Node + SQLite) con sincronización a la nube |
| `web/` | Interfaz del TPV local |
| `desktop/` | App de escritorio (Electron): arranca el servidor y muestra el TPV |
| `android/` | App de comandas para camareros (Kotlin + Compose) |
| `cloud/server/` | Backend del portal (Node + PostgreSQL), CLI de altas |
| `cloud/portal/` | Web del portal de administración (React) |
| `cloud/infra/` | Plantilla Bicep para Azure |

## Probar todo en local

```bash
# 1. Portal en la nube (necesita PostgreSQL)
cd cloud/server && cp .env.example .env && npm install
npx prisma migrate dev
npm run tenant -- create --name "Bar Pepe" --username barpepe --password pepe-demo-2026 --demo
npm run dev                                   # http://localhost:8080
cd ../portal && npm install && npm run dev    # http://localhost:5174

# 2. TPV local
cd server && cp .env.example .env && npm install
npx prisma migrate dev && npm run seed
cd ../web && npm install && npm run build     # el servidor sirve este build
cd ../server && npm run dev                   # http://localhost:4000

# 3. Vincular: abre http://localhost:4000 → «Portal: sin vincular · Configurar»
#    → http://localhost:8080, barpepe / pepe-demo-2026
#    Entra en el TPV con PIN 1111 (camarera de demo) o 0000 (encargado).

# App de escritorio (arranca su propio servidor local)
cd desktop && npm install && npm run dev
```

La app Android (`android/`) se abre en Android Studio; en el login se pone la
IP del PC del restaurante (la muestra la app de escritorio) y el PIN.
