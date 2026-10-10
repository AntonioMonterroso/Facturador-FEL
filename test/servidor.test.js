'use strict';
// Prueba el servidor intermedio contra un Digifact SIMULADO (no es Digifact real).
// Verifica el flujo: login -> envío del XML con token -> reintento si el token venció -> errores.
const http = require('http');
const assert = require('assert');

const llamadas = { login: [], nuc: [] };
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
      console.log('OK    servidor intermedio (flujo, token vencido, errores y defensas)');
    } catch (e) {
      console.log('FALLA servidor intermedio\n' + e.message); process.exitCode = 1;
    } finally { servidor.close(); falso.close(); }
  });
});
