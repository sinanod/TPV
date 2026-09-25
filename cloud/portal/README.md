# Portal del restaurante (nube)

Portal web con el que cada restaurante administra su TPV desde cualquier sitio. Es **solo de administración**: no permite abrir mesas, añadir productos, enviar comandas ni cobrar.

- **En directo**: resumen del día, plano del salón, comandas abiertas y servidores locales vinculados (solo lectura).
- **Ventas**: tickets cobrados por rango de fechas, desglose por día y forma de pago, exportación a CSV.
- **Carta**, **Salón** y **Personal**: configuración que se sincroniza con el servidor local del restaurante.

React 18 + TypeScript + Vite, CSS propio y `socket.io-client`. Habla con `cloud/server` por rutas relativas (`/api` y `/socket.io`).

## Desarrollo

Necesitas el backend `cloud/server` en marcha (con su `.env` apuntando a PostgreSQL) y un restaurante creado con la CLI:

```bash
cd cloud/server
npm run tenant -- create --name "Bar Pepe" --username barpepe --demo
npm run dev                      # escucha en el puerto 8080
```

Después, en otra terminal:

```bash
cd cloud/portal
npm install
npm run dev                      # http://localhost:5174
```

Vite redirige `/api` y `/socket.io` al backend. Si no está en `http://localhost:8080`:

```bash
VITE_API_TARGET=http://localhost:8090 npm run dev
```

## Producción

```bash
npm run build
```

Genera `dist/`, que `cloud/server` sirve directamente desde el mismo dominio (no hace falta configurar CORS).
