# TPV Server (local)

Servidor del TPV que corre en el PC de cada restaurante: API REST +
Socket.IO + SQLite. Lo arranca la app de escritorio y a él se conectan la UI
del TPV y la app Android por la red local. Ver `../ARCHITECTURE.md`.

## Uso

```bash
cp .env.example .env
npm install
npx prisma migrate dev   # crea server/dev.db
npm run seed             # datos de demo para modo autónomo (sin portal)
npm run dev              # http://localhost:4000
```

Usuarios de demo (PIN): `0000` admin, `1111`/`2222` camareros, `9999` cocina.

## Vinculación con el portal

Desde la pantalla de login del TPV («Portal: sin vincular · Configurar») o
por API:

```bash
curl -X POST http://localhost:4000/api/setup/cloud/link \
  -H 'Content-Type: application/json' \
  -d '{"cloudUrl":"https://mi-tpv.azurewebsites.net","username":"barpepe","password":"...","deviceName":"PC barra"}'
curl http://localhost:4000/api/setup/cloud          # estado, cola pendiente, último error
```

Al vincular, la carta, las mesas y el personal pasan a ser los del portal
(requiere no tener mesas abiertas). Desvincular pide la contraseña del
restaurante. El código está en `src/cloud/`: `sync.ts` (worker, vinculación),
`outbox.ts` (cola de eventos) y `config.ts` (aplicar la configuración).
