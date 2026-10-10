'use strict';
// Prueba el servidor intermedio contra un Digifact SIMULADO (no es Digifact real).
// Verifica el flujo: login -> envío del XML con token -> reintento si el token venció -> errores.
const http = require('http');
const assert = require('assert');

const llamadas = { login: [], nuc: [], anular: [], shared: [] };
let tokenActual = 'TOKEN-1', modo = 'ok';
const falso = http.createServer((req, res) => {
  const trozos = [];
  req.on('data', c => trozos.push(c));
  req.on('end', () => {
    const cuerpo = Buffer.concat(trozos).toString('utf8');
    const url = new URL(req.url, 'http://x');
    res.setHeader('Content-Type', 'application/json');
    if (url.pathname === '/api/login/get_token') {
      llamadas.login.push(JSON.parse(cuerpo));
      return res.end(JSON.stringify({ token: tokenActual }));
    }
    if (url.pathname === '/api/v2/transform/nuc') {
      llamadas.nuc.push({ query: Object.fromEntries(url.searchParams), auth: req.headers.authorization, tipo: req.headers['content-type'], cuerpo });
      if (req.headers.authorization !== tokenActual) { res.statusCode = 401; return res.end('{}'); }
      if (modo === 'error') return res.end(JSON.stringify({ code: 5001, message: 'Error en contenido del XML', description: 'NIT inválido' }));
      return res.end(JSON.stringify({ code: 1, authNumber: 'AAAA-BBBB', batch: 'AAAA', serial: '123', issuedTimeStamp: '2026-01-01T10:00:00', enrolledTimeStamp: '2026-01-01T10:00:05', responseData1: 'eG1s', responseData3: 'cGRm' }));
    }
    if (url.pathname === '/api/Shared') {
      llamadas.shared.push({ query: Object.fromEntries(url.searchParams), auth: req.headers.authorization, metodo: req.method });
      if (req.headers.authorization !== tokenActual) { res.statusCode = 401; return res.end('{}'); }
      if (url.searchParams.get('DATA2') === 'AUTHNUMBER|00000000-0000-0000-0000-000000000000') return res.end(JSON.stringify({ REQUEST_DATA: [{ Codigo: '0', Mensaje: 'No encontrado' }], RESPONSE: [] }));
      return res.end(JSON.stringify({ REQUEST_DATA: [{ Codigo: '1', Mensaje: 'Procesado' }], RESPONSE: [{ TIPO_DTE: 'FACT', GUID: 'BDE0DEC2-5ABE-468E-A6F1-0AB3637F2764', SERIE: 'A001', NUMERO: '5', TOTAL: 100.0, DTE: 'PD94' }] }));
    }
    if (url.pathname === '/api/CancelFelGT') {
      llamadas.anular.push({ auth: req.headers.authorization, tipo: req.headers['content-type'], cuerpo: JSON.parse(cuerpo) });
      if (req.headers.authorization !== tokenActual) { res.statusCode = 401; return res.end('{}'); }
      return res.end(JSON.stringify(modo === 'error' ? { code: 9, message: 'No se puede anular' } : { code: 1, message: 'Documento anulado' }));
    }
    res.statusCode = 404; res.end('{}');
  });
});

const post = (puerto, cuerpo, cabeceras) => new Promise((resolve, reject) => {
  const req = http.request({ port: puerto, method: 'POST', path: '/api/certificar', headers: cabeceras }, res => {
    const t = []; res.on('data', c => t.push(c));
    res.on('end', () => resolve({ status: res.statusCode, json: JSON.parse(Buffer.concat(t).toString() || '{}') }));
  });
  req.on('error', reject); req.end(cuerpo);
});
const postA = (puerto, cuerpo, cabeceras) => new Promise((resolve, reject) => {
  const req = http.request({ port: puerto, method: 'POST', path: '/api/anular', headers: cabeceras }, res => {
    const t = []; res.on('data', c => t.push(c));
    res.on('end', () => resolve({ status: res.statusCode, json: JSON.parse(Buffer.concat(t).toString() || '{}') }));
  });
  req.on('error', reject); req.end(cuerpo);
});
const getC = (puerto, query, cabeceras) => new Promise((resolve, reject) => {
  http.get({ port: puerto, path: '/api/consultar' + query, headers: cabeceras }, res => {
    const t = []; res.on('data', c => t.push(c));
    res.on('end', () => resolve({ status: res.statusCode, json: JSON.parse(Buffer.concat(t).toString() || '{}') }));
  }).on('error', reject);
});
const JSON_H = { 'Content-Type': 'application/json', 'X-Requested-With': 'facturador' };

falso.listen(0, '127.0.0.1', async () => {
  Object.assign(process.env, { DIGIFACT_BASE: 'http://127.0.0.1:' + falso.address().port, DIGIFACT_USUARIO: 'USER_TEST', DIGIFACT_CLAVE: 'secreto', DIGIFACT_NIT: '123456' });
  const { servidor } = require('../server.js');
  servidor.listen(0, '127.0.0.1', async () => {
    const p = servidor.address().port;
    const xml = JSON.stringify({ xml: '<?xml version="1.0"?><Root></Root>' });
    try {
      // 1) Camino feliz
      let r = await post(p, xml, JSON_H);
      assert.strictEqual(r.status, 200); assert.strictEqual(r.json.ok, true);
      assert.deepStrictEqual([r.json.autorizacion, r.json.serie, r.json.numero], ['AAAA-BBBB', 'AAAA', '123']);
      assert.strictEqual(llamadas.login[0].Username, 'GT.000000123456.USER_TEST');
      assert.strictEqual(llamadas.login[0].Password, 'secreto');
      assert.strictEqual(llamadas.nuc[0].auth, 'TOKEN-1');
      assert.strictEqual(llamadas.nuc[0].tipo, 'application/xml');
      assert.strictEqual(llamadas.nuc[0].query.TAXID, '000000123456');
      assert.strictEqual(llamadas.nuc[0].query.USERNAME, 'USER_TEST');
      assert.ok(!JSON.stringify(r.json).includes('secreto'), 'la respuesta no debe incluir la clave');
      // 2) Token vencido: se vuelve a iniciar sesión una sola vez y se reintenta
      tokenActual = 'TOKEN-2';
      r = await post(p, xml, JSON_H);
      assert.strictEqual(r.status, 200); assert.strictEqual(llamadas.login.length, 2);
      // 3) Error de contenido devuelto por Digifact
      modo = 'error';
      r = await post(p, xml, JSON_H);
      assert.strictEqual(r.status, 422); assert.strictEqual(r.json.ok, false); assert.strictEqual(r.json.codigo, 5001);
      // 4) Defensas: sin cabecera propia, sin XML, y JSON roto
      assert.strictEqual((await post(p, xml, { 'Content-Type': 'application/json' })).status, 400);
      assert.strictEqual((await post(p, JSON.stringify({ xml: 'hola' }), JSON_H)).status, 400);
      assert.strictEqual((await post(p, '{no es json', JSON_H)).status, 400);
      // 5) Anulación
      modo = 'ok';
      const anul = { autorizacion: '5B5BA194-22C5-4377-99D4-B8F86820533D', idReceptor: 'CF', fechaEmision: '2022-10-04T10:25:09', motivo: 'Error en datos' };
      r = await postA(p, JSON.stringify(anul), JSON_H);
      assert.strictEqual(r.status, 200); assert.strictEqual(r.json.ok, true);
      assert.deepStrictEqual(llamadas.anular[0].cuerpo, { Taxid: '123456', Autorizacion: anul.autorizacion, IdReceptor: 'CF', FechaEmisionDocumentoAnular: anul.fechaEmision, MotivoAnulacion: 'Error en datos', Username: 'USER_TEST' });
      assert.strictEqual(llamadas.anular[0].tipo, 'application/json');
      modo = 'error';
      r = await postA(p, JSON.stringify(anul), JSON_H);
      assert.strictEqual(r.status, 422); assert.strictEqual(r.json.ok, false); assert.strictEqual(r.json.mensaje, 'No se puede anular');
      assert.strictEqual((await postA(p, JSON.stringify({ ...anul, autorizacion: 'x' }), JSON_H)).status, 400);
      assert.strictEqual((await postA(p, JSON.stringify({ ...anul, motivo: '  ' }), JSON_H)).status, 400);
      assert.strictEqual((await postA(p, JSON.stringify(anul), { 'Content-Type': 'application/json' })).status, 400);
      // 6) Consulta de un documento certificado
      tokenActual = 'TOKEN-2'; modo = 'ok';
      const H = { 'X-Requested-With': 'facturador' };
      r = await getC(p, '?autorizacion=BDE0DEC2-5ABE-468E-A6F1-0AB3637F2764', H);
      assert.strictEqual(r.status, 200); assert.deepStrictEqual([r.json.ok, r.json.tipo, r.json.serie, r.json.numero, r.json.total], [true, 'FACT', 'A001', '5', 100]);
      assert.deepStrictEqual(llamadas.shared[0].query, { COUNTRY: 'GT', TAXID: '000000123456', DATA1: 'SHARED_GETDTEINFO', DATA2: 'AUTHNUMBER|BDE0DEC2-5ABE-468E-A6F1-0AB3637F2764', USERNAME: 'USER_TEST' });
      assert.strictEqual(llamadas.shared[0].metodo, 'GET');
      r = await getC(p, '?autorizacion=00000000-0000-0000-0000-000000000000', H);
      assert.strictEqual(r.status, 422); assert.strictEqual(r.json.ok, false); assert.strictEqual(r.json.mensaje, 'No encontrado');
      assert.strictEqual((await getC(p, '?autorizacion=x', H)).status, 400);
      assert.strictEqual((await getC(p, '?autorizacion=BDE0DEC2-5ABE-468E-A6F1-0AB3637F2764', {})).status, 400);
      console.log('OK    servidor intermedio (certificar, consultar, anular, token vencido, errores y defensas)');
    } catch (e) {
      console.log('FALLA servidor intermedio\n' + e.message); process.exitCode = 1;
    } finally { servidor.close(); falso.close(); }
  });
});
