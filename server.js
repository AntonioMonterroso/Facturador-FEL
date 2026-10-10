'use strict';
/**
 * Servidor local del Facturador FEL (sin dependencias).
 *  - Sirve la app (index.html, styles.css, app.js).
 *  - POST /api/certificar  { xml }  -> envía el NUC-XML a Digifact y devuelve la autorización.
 *  - GET  /api/documento?autorizacion=UUID -> descarga el HTML y PDF (base64) de un documento certificado.
 *  - GET  /api/consultar?autorizacion=UUID -> consulta en Digifact un documento ya certificado.
 *  - POST /api/anular      { autorizacion, idReceptor, fechaEmision, motivo } -> anula un documento certificado.
 * Las credenciales viven solo en variables de entorno de este proceso; nunca llegan al navegador.
 *
 * Variables de entorno:
 *   DIGIFACT_USUARIO, DIGIFACT_CLAVE, DIGIFACT_NIT   credenciales de pruebas (obligatorias)
 *   DIGIFACT_BASE         base de la API (por defecto https://testnucgt.digifact.com, que es PRUEBAS)
 *                         Producción: https://nucgt.digifact.com/gt.com.apinuc
 *   DIGIFACT_FORMAT       FORMAT de la consulta (por defecto XML|HTML|PDF; sin confirmar el separador)
 *   DIGIFACT_LOGIN_PATH   ruta para pedir el token (por defecto /api/login/get_token)
 *   DIGIFACT_LOGIN_USER   usuario completo del login (por defecto GT.<NIT de 12 dígitos>.<USUARIO>)
 *   La respuesta del login trae { "token": "..." } (se acepta también Token).
 *   Por verificar con Digifact real: si TAXID va con 12 dígitos, qué valores admite FORMAT y cómo se envía el token
 *   (aquí va tal cual en la cabecera Authorization).
 *   PORT, HOST            (por defecto 3000 y 127.0.0.1)
 */
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const ENV = process.env;
const BASE = (ENV.DIGIFACT_BASE || 'https://testnucgt.digifact.com').replace(/\/$/, '');
const ESTATICOS = { '/': 'index.html', '/index.html': 'index.html', '/styles.css': 'styles.css', '/app.js': 'app.js' };
const TIPOS = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };
const MAX_CUERPO = 1024 * 1024;

/** Petición HTTP(S) simple que devuelve { status, texto }. */
function pedir(urlStr, { method = 'GET', headers = {}, cuerpo } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const lib = u.protocol === 'http:' ? http : https;
    const req = lib.request(u, { method, headers, timeout: 30000 }, res => {
      const trozos = [];
      res.on('data', c => trozos.push(c));
      res.on('end', () => resolve({ status: res.statusCode, texto: Buffer.concat(trozos).toString('utf8') }));
    });
    req.on('timeout', () => req.destroy(new Error('Tiempo de espera agotado al contactar a Digifact')));
    req.on('error', reject);
    if (cuerpo) req.write(cuerpo);
    req.end();
  });
}

let token = null; // { valor, hasta }

/** NIT sin guiones, en mayúsculas y con ceros a la izquierda hasta 12 caracteres (formato del usuario de Digifact). */
const nit12 = nit => String(nit).toUpperCase().replace(/[^0-9K]/g, '').padStart(12, '0');

function credenciales() {
  const faltan = ['DIGIFACT_USUARIO', 'DIGIFACT_CLAVE', 'DIGIFACT_NIT'].filter(k => !ENV[k]);
  if (faltan.length) throw Object.assign(new Error('Faltan variables de entorno: ' + faltan.join(', ')), { status: 500 });
  return { usuario: ENV.DIGIFACT_USUARIO, clave: ENV.DIGIFACT_CLAVE, nit: ENV.DIGIFACT_NIT };
}

/** Obtiene (y guarda en memoria) el token de Digifact. */
async function obtenerToken(forzar) {
  if (!forzar && token && token.hasta > Date.now()) return token.valor;
  const { usuario, clave, nit } = credenciales();
  const loginUser = ENV.DIGIFACT_LOGIN_USER || `GT.${nit12(nit)}.${usuario}`;
  const r = await pedir(BASE + (ENV.DIGIFACT_LOGIN_PATH || '/api/login/get_token'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    cuerpo: JSON.stringify({ Username: loginUser, Password: clave })
  });
  let j = {};
  try { j = JSON.parse(r.texto); } catch { /* respuesta no JSON */ }
  const valor = j.Token || j.token;
  if (r.status !== 200 || !valor) throw Object.assign(new Error('No se pudo iniciar sesión en Digifact (HTTP ' + r.status + ')'), { status: 502 });
  token = { valor, hasta: Date.now() + 25 * 60 * 1000 };
  return valor;
}

/** Ejecuta una petición con token; si Digifact responde 401 renueva el token y reintenta una sola vez. */
async function conToken(enviar) {
  let r = await enviar(await obtenerToken(false));
  if (r.status === 401) r = await enviar(await obtenerToken(true));
  return r;
}

async function certificar(xml) {
  const { usuario, nit } = credenciales();
  const url = `${BASE}/api/v2/transform/nuc?TAXID=${encodeURIComponent(nit12(nit))}&FORMAT=${encodeURIComponent(ENV.DIGIFACT_FORMAT || 'XML|HTML|PDF')}&USERNAME=${encodeURIComponent(usuario)}`;
  const r = await conToken(tk => pedir(url, { method: 'POST', headers: { 'Content-Type': 'application/xml', Authorization: tk }, cuerpo: xml }));
  let j;
  try { j = JSON.parse(r.texto); } catch { throw Object.assign(new Error('Respuesta inesperada de Digifact (HTTP ' + r.status + ')'), { status: 502 }); }
  if (Number(j.code) !== 1) {
    return { status: 422, cuerpo: { ok: false, codigo: j.code, mensaje: j.message || '', descripcion: j.description || '' } };
  }
  return {
    status: 200,
    cuerpo: {
      ok: true, autorizacion: j.authNumber, serie: j.batch, numero: j.serial,
      emision: j.issuedTimeStamp, certificacion: j.enrolledTimeStamp,
      xml: j.responseData1 || '', pdf: j.responseData3 || ''
    }
  };
}

/** Consulta un documento certificado (GET /api/Shared, SHARED_GETDTEINFO). */
async function consultar(autorizacion) {
  const { usuario, nit } = credenciales();
  const url = `${BASE}/api/Shared?COUNTRY=GT&TAXID=${encodeURIComponent(nit12(nit))}&DATA1=SHARED_GETDTEINFO&DATA2=${encodeURIComponent('AUTHNUMBER|' + autorizacion)}&USERNAME=${encodeURIComponent(usuario)}`;
  const r = await conToken(tk => pedir(url, { method: 'GET', headers: { Authorization: tk } }));
  let j = {};
  try { j = JSON.parse(r.texto); } catch { throw Object.assign(new Error('Respuesta inesperada de Digifact (HTTP ' + r.status + ')'), { status: 502 }); }
  const info = (j.REQUEST_DATA || [])[0] || {};
  const doc = (j.RESPONSE || [])[0];
  if (r.status !== 200 || Number(info.Codigo) !== 1 || !doc) return { status: 422, cuerpo: { ok: false, codigo: info.Codigo, mensaje: info.Mensaje || 'Documento no encontrado' } };
  return { status: 200, cuerpo: { ok: true, tipo: doc.TIPO_DTE, guid: doc.GUID, serie: doc.SERIE, numero: doc.NUMERO, total: doc.TOTAL, xml: doc.DTE || '' } };
}

/** Descarga el HTML y el PDF de un documento certificado (GET /api/GetDocument). Ambos llegan en base64. */
async function documento(autorizacion) {
  const { usuario, nit } = credenciales();
  const url = `${BASE}/api/GetDocument?AUTHNUMBER=${encodeURIComponent(autorizacion)}&TAXID=${encodeURIComponent(nit12(nit))}&FORMAT=${encodeURIComponent('HTML|PDF')}&USERNAME=${encodeURIComponent(usuario)}`;
  const r = await conToken(tk => pedir(url, { method: 'GET', headers: { Authorization: tk } }));
  let j = {};
  try { j = JSON.parse(r.texto); } catch { throw Object.assign(new Error('Respuesta inesperada de Digifact (HTTP ' + r.status + ')'), { status: 502 }); }
  const d = (j.RESPONSE || [])[0] || {};
  const html = d.ResponseData2 || d.responseData2 || '', pdf = d.ResponseData3 || d.responseData3 || '';
  if (r.status !== 200 || (!html && !pdf)) {
    const info = (j.REQUEST_DATA || [])[0] || {};
    return { status: 422, cuerpo: { ok: false, mensaje: info.Mensaje || 'Digifact no devolvió el documento' } };
  }
  return { status: 200, cuerpo: { ok: true, html, pdf } };
}

const RE_AUTORIZACION = /^[0-9A-Fa-f]{8}(-[0-9A-Fa-f]{4}){3}-[0-9A-Fa-f]{12}$/;
const RE_FECHA = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/;

/** Anula un documento certificado (POST /api/CancelFelGT). El formato de la respuesta está por verificar con Digifact real. */
async function anular({ autorizacion, idReceptor, fechaEmision, motivo }) {
  const { usuario, nit } = credenciales();
  const cuerpo = JSON.stringify({ Taxid: nit, Autorizacion: autorizacion, IdReceptor: idReceptor, FechaEmisionDocumentoAnular: fechaEmision, MotivoAnulacion: motivo, Username: usuario });
  const r = await conToken(tk => pedir(BASE + '/api/CancelFelGT', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: tk }, cuerpo }));
  let j = {};
  try { j = JSON.parse(r.texto); } catch { /* respuesta no JSON */ }
  const codigo = j.code ?? j.Code;
  // Si Digifact devuelve un código, 1 significa éxito (igual que al certificar); si no, se toma el estado HTTP.
  const ok = r.status === 200 && (codigo === undefined || Number(codigo) === 1);
  return { status: ok ? 200 : 422, cuerpo: { ok, codigo, mensaje: j.message || j.Message || '', descripcion: j.description || j.Description || '', respuesta: j } };
}

function leerCuerpo(req) {
  return new Promise((resolve, reject) => {
    let total = 0; const trozos = [];
    req.on('data', c => { total += c.length; if (total > MAX_CUERPO) { reject(Object.assign(new Error('Cuerpo demasiado grande'), { status: 413 })); req.destroy(); } else trozos.push(c); });
    req.on('end', () => resolve(Buffer.concat(trozos).toString('utf8')));
    req.on('error', reject);
  });
}

const responder = (res, status, obj) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
};

const servidor = http.createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'self'; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'");
  try {
    const ruta = new URL(req.url, 'http://localhost').pathname;
    if (req.method === 'POST' && ruta === '/api/certificar') {
      // Defensa básica contra peticiones de otros sitios: solo JSON con cabecera propia.
      if (!(req.headers['content-type'] || '').startsWith('application/json') || req.headers['x-requested-with'] !== 'facturador') {
        return responder(res, 400, { ok: false, mensaje: 'Petición no permitida' });
      }
      let datos;
      try { datos = JSON.parse(await leerCuerpo(req)); } catch (e) { if (e.status) throw e; return responder(res, 400, { ok: false, mensaje: 'JSON inválido' }); }
      if (typeof datos.xml !== 'string' || !datos.xml.includes('<Root>')) return responder(res, 400, { ok: false, mensaje: 'Falta el XML del documento' });
      const r = await certificar(datos.xml);
      return responder(res, r.status, r.cuerpo);
    }
    if (req.method === 'GET' && ruta === '/api/documento') {
      if (req.headers['x-requested-with'] !== 'facturador') return responder(res, 400, { ok: false, mensaje: 'Petición no permitida' });
      const autorizacion = new URL(req.url, 'http://localhost').searchParams.get('autorizacion') || '';
      if (!RE_AUTORIZACION.test(autorizacion)) return responder(res, 400, { ok: false, mensaje: 'Número de autorización inválido' });
      const r = await documento(autorizacion);
      return responder(res, r.status, r.cuerpo);
    }
    if (req.method === 'GET' && ruta === '/api/consultar') {
      if (req.headers['x-requested-with'] !== 'facturador') return responder(res, 400, { ok: false, mensaje: 'Petición no permitida' });
      const autorizacion = new URL(req.url, 'http://localhost').searchParams.get('autorizacion') || '';
      if (!RE_AUTORIZACION.test(autorizacion)) return responder(res, 400, { ok: false, mensaje: 'Número de autorización inválido' });
      const r = await consultar(autorizacion);
      return responder(res, r.status, r.cuerpo);
    }
    if (req.method === 'POST' && ruta === '/api/anular') {
      if (!(req.headers['content-type'] || '').startsWith('application/json') || req.headers['x-requested-with'] !== 'facturador') {
        return responder(res, 400, { ok: false, mensaje: 'Petición no permitida' });
      }
      let d;
      try { d = JSON.parse(await leerCuerpo(req)); } catch (e) { if (e.status) throw e; return responder(res, 400, { ok: false, mensaje: 'JSON inválido' }); }
      const motivo = typeof d.motivo === 'string' ? d.motivo.trim() : '';
      if (!RE_AUTORIZACION.test(d.autorizacion || '')) return responder(res, 400, { ok: false, mensaje: 'Número de autorización inválido' });
      if (!RE_FECHA.test(d.fechaEmision || '')) return responder(res, 400, { ok: false, mensaje: 'Fecha de emisión inválida' });
      if (typeof d.idReceptor !== 'string' || !d.idReceptor.trim() || d.idReceptor.length > 20) return responder(res, 400, { ok: false, mensaje: 'Receptor inválido' });
      if (!motivo || motivo.length > 200) return responder(res, 400, { ok: false, mensaje: 'Indica el motivo de la anulación (máximo 200 caracteres)' });
      const r = await anular({ autorizacion: d.autorizacion, idReceptor: d.idReceptor.trim(), fechaEmision: d.fechaEmision, motivo });
      return responder(res, r.status, r.cuerpo);
    }
    if (req.method === 'GET' && ESTATICOS[ruta]) {
      const archivo = ESTATICOS[ruta];
      res.writeHead(200, { 'Content-Type': TIPOS[path.extname(archivo)] });
      return fs.createReadStream(path.join(__dirname, archivo)).pipe(res);
    }
    responder(res, 404, { ok: false, mensaje: 'No encontrado' });
  } catch (e) {
    responder(res, e.status || 500, { ok: false, mensaje: e.message });
  }
});

if (require.main === module) {
  const puerto = Number(ENV.PORT) || 3000, host = ENV.HOST || '127.0.0.1';
  servidor.listen(puerto, host, () => console.log(`Facturador FEL en http://${host}:${puerto} (Digifact: ${BASE})`));
}
module.exports = { servidor };
