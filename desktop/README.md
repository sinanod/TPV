# TPV Desktop

Shell de Electron que arranca el servidor TPV (`../server`) y lo muestra como
aplicación de escritorio. El mismo proceso queda escuchando en la red local,
así que la app Android y cualquier navegador de la misma WiFi pueden
conectarse a la IP que se muestra en la franja inferior de la ventana.

## Impresoras USB

Las impresoras de tickets de red las usa directamente el servidor. Para las
que están instaladas en este PC (USB o compartidas, con su driver), la app
hace de agente de impresión (`printAgent.js`): se conecta al servidor local
con un token que genera al arrancar, le informa de las impresoras que tiene
el sistema (llegan al portal para elegirlas al crear la impresora «instalada
en el PC») e imprime en silencio los tickets que le manda el servidor. Si la
app está cerrada o la impresora no existe, el TPV lo avisa como un fallo de
impresión que se puede reintentar.

## Desarrollo

```bash
cd ../server && npm install && npx prisma migrate dev && npm run seed
cd ../web && npm install && npm run build   # el servidor sirve este build
cd ../desktop && npm install
npm run dev
```

Para conectar este TPV con el portal del restaurante: en la pantalla de login,
«Portal: sin vincular · Configurar» → dirección del portal + usuario y
contraseña del restaurante.

## Empaquetado

```bash
cd ../server && npm install && npm run build
cd ../web && npm install && npm run build
cd ../desktop && npm install && npm run build
```

Pendiente antes de instalar en restaurantes: el instalador todavía no prepara
la base de datos del servidor local (definir `DATABASE_URL` en la carpeta de
datos del usuario, generar un `JWT_SECRET` propio y aplicar las migraciones al
arrancar). En modo desarrollo se usa `server/.env`.
