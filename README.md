# Facturador FEL (SAT Guatemala)

Sistema de facturación electrónica para Guatemala que genera los documentos en formato NUC de Digifact
(XML y JSON), los certifica, los consulta, descarga su PDF y los anula.

## Cómo usarlo

```bash
export DIGIFACT_USUARIO="tu_usuario"
export DIGIFACT_CLAVE="tu_clave"
export DIGIFACT_NIT="tu_nit"
npm start            # abre http://127.0.0.1:3000
```

Sin las variables de entorno la app funciona como borrador local (no certifica).
Las credenciales viven solo en el servidor; nunca se envían al navegador.

## Pruebas y producción

| Ambiente | `DIGIFACT_BASE` |
|---|---|
| Pruebas (por defecto) | `https://testnucgt.digifact.com` |
| Producción | `https://nucgt.digifact.com/gt.com.apinuc` |

**No cambies a producción hasta haber probado todo en pruebas.** En producción cada certificación es un
documento fiscal real ante la SAT y una anulación no se puede deshacer.

## Qué hace

- Emite factura, cambiaria (con abonos), notas de crédito y débito, nota de abono, factura especial,
  recibos y los de pequeño contribuyente y régimen primario, con sus complementos.
- Valida el NIT (módulo 11) y acepta CF y CUI.
- Botones por documento: Certificar, Verificar en Digifact, Descargar PDF certificado y Anular ante la SAT.
- Los datos se guardan en el navegador (exporta un respaldo desde la pantalla Emisor).

## Pruebas automáticas

```bash
npm test
```

Valida el XML contra `docs/NUCSchema.xsd` (requiere `xmllint`), el JSON contra `docs/NUCSchema.json`
(requiere Python con `jsonschema`) y el servidor contra un Digifact **simulado**.

## Pendiente de confirmar contra Digifact real

- Separador de `FORMAT` al certificar (se usa `XML|HTML|PDF`; configurable con `DIGIFACT_FORMAT`).
- Formato exacto de la respuesta de la anulación.
- Códigos de documento: la documentación lista `FACM` para la cambiaria y los ejemplos usan `FCAM`.
- Tipo de ítem: la documentación pide `BIEN`/`SERVICIO` y los ejemplos usan `Bien`/`Servicio`.
- Sin implementar: nota de crédito total (`/api/cert/ncredtotal`), consulta de NIT, monto en letras,
  detalle por línea, `FEPE` y pequeño contribuyente con impuesto de turismo.
