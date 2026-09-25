# TPV Server

API REST + WebSocket (Socket.IO) para el TPV. Ver `../ARCHITECTURE.md` para el
contrato completo.

## Uso

```bash
cp .env.example .env
npm install
npx prisma migrate dev --name init   # crea server/dev.db
npm run seed                          # usuarios, mesas y catálogo de demo
npm run dev                           # http://localhost:4000
```

Usuarios de demo (login por PIN): `0000` (admin), `1111`/`2222` (camareros),
`9999` (cocina).
