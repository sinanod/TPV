# TPV Desktop

Shell de Electron que arranca el servidor TPV (`../server`) y lo muestra como
aplicación de escritorio. El mismo proceso queda escuchando en la red local,
así que la app Android y cualquier navegador de la misma WiFi pueden
conectarse a la IP que se muestra en la franja inferior de la ventana.

## Desarrollo

```bash
cd ../server && npm install && npx prisma migrate dev && npm run seed
cd ../web && npm install && npm run build   # el servidor sirve este build
cd ../desktop && npm install
npm run dev
```

## Empaquetado

```bash
cd ../server && npm install && npm run build
cd ../web && npm install && npm run build
cd ../desktop && npm install && npm run build
```
