# Especificaciones oficiales VERI*FACTU (AEAT)

Copias de los esquemas oficiales para validar en los tests, sin red, el XML
que generan el TPV local y la nube.

| Fichero | Origen |
|---|---|
| `SuministroInformacion.xsd`, `SuministroLR.xsd`, `RespuestaSuministro.xsd`, `SistemaFacturacion.wsdl` | `https://prewww2.aeat.es/static_files/common/internet/dep/aplicaciones/es/aeat/tikeV1.0/cont/ws/` (versión 1.0) |
| `xmldsig-core-schema.xsd` | `https://www.w3.org/TR/xmldsig-core/xmldsig-core-schema.xsd` |

Única modificación: en `SuministroInformacion.xsd` el `import` de xmldsig apunta
al fichero local (`schemaLocation="xmldsig-core-schema.xsd"`) en vez de a la
URL del W3C.

Documentación técnica usada (portal de desarrolladores de la AEAT,
«Sistemas Informáticos de Facturación y Sistemas VERI*FACTU»):

- Especificaciones técnicas para la generación de la huella o hash, v0.1.2
  (27/08/2024). Sus tres ejemplos son los vectores de prueba de
  `server/src/fiscal/verifactu.test.ts`.
- Detalle de las especificaciones técnicas del código QR de la factura, v0.5.0.
- Descripción de servicios web, v1.0.3.
- Preguntas frecuentes de empresas de desarrollo (04/12/2025).

Si la AEAT publica nuevas versiones, sustituye estos ficheros y vuelve a pasar
los tests de `server/` y `cloud/server/`.
