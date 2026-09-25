# TPV

Réplica funcional de un TPV de hostelería al estilo MissTipsi: control del
salón en tiempo real desde la web, un servidor local que hace también de
app de escritorio, y una app Android para que los camareros manden comandas.

Ver [`ARCHITECTURE.md`](./ARCHITECTURE.md) para el diseño completo (modelo de
datos, API REST y eventos en tiempo real).

## Componentes

| Carpeta    | Qué es                                                          |
|------------|------------------------------------------------------------------|
| `server/`  | API REST + WebSocket (Node/Express/Socket.IO/Prisma+SQLite)      |
| `web/`     | Panel de control en tiempo real (React + Vite)                  |
| `desktop/` | App de escritorio (Electron): arranca el servidor + carga el panel web |
| `android/` | App de comandas para camareros (Kotlin + Jetpack Compose)        |

## Arrancar todo en local

```bash
# 1. Servidor + datos de demo
cd server && npm install
npx prisma migrate dev --name init
npm run seed
npm run dev                      # http://localhost:4000

# 2. Panel web (en otra terminal)
cd web && npm install && npm run dev   # http://localhost:5173

# 3. App de escritorio (arranca su propio servidor embebido)
cd web && npm run build          # el servidor sirve este build en producción
cd desktop && npm install && npm run dev
```

La app Android (`android/`) se abre y compila desde Android Studio; en el
login se introduce la URL del servidor (la IP local que muestra la app de
escritorio) y el PIN del camarero.

Usuarios de demo (PIN): `0000` admin, `1111`/`2222` camareros, `9999` cocina.
