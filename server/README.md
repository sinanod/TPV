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

## Cobros, facturas e impresión

- `src/billing.ts`: cobros (totales o parciales, efectivo con cambio,
  tarjeta, pagos móviles que llegan de la nube) y emisión de la factura
  simplificada al completar la cuenta. Las operaciones de cobro se ejecutan
  de una en una para que la numeración y el encadenamiento no se crucen.
- `src/fiscal/verifactu.ts`: registro de alta VERI*FACTU (XML según el XSD
  oficial de `../specs/aeat`), huella SHA-256 y URL del QR tributario. Solo
  se usa si el restaurante activó VERI*FACTU en el portal.
- `src/printing/`: tickets de cocina/barra por familia, cuenta previa y
  ticket con QR. `escpos.ts` para impresoras de red (TCP 9100), `html.ts` +
  `agent.ts` para las instaladas en el PC (las imprime la app de escritorio).
- `src/settings.ts`: datos fiscales, serie de facturación y VERI*FACTU tal y
  como llegan del portal.

Sin vincular, se puede probar todo menos VERI*FACTU (sin datos fiscales no
hay registro): da de alta impresoras en la tabla `Printer` y asígnalas a las
familias (`Category.printerId`).

## Tests

```bash
npm test
```

Usan su propia base de datos (`test.db`), impresoras de red simuladas y un
agente de impresión simulado. Incluyen los ejemplos oficiales de huella de
la AEAT y validan el XML generado contra el XSD (si está `xmllint`).

La prueba completa junto con la nube (vinculación, cobro, envío a una AEAT
simulada, email y pago desde el móvil) es `node ../scripts/e2e.mjs`.
