'use strict';
// Genera el XML de cada tipo de documento y lo valida contra docs/NUCSchema.xsd con xmllint.
// Uso: node test/validar-xml.js
const fs = require('fs'), os = require('os'), path = require('path');
const { spawnSync } = require('child_process');
const { generarXML, base, casos } = require('./casos.js');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fel-xml-'));
const xsd = path.join(__dirname, '..', 'docs', 'NUCSchema.xsd');
let fallos = 0;
for (const [nombre, extra] of Object.entries(casos)) {
  const xml = generarXML({ ...base, ...extra });
  const archivo = path.join(dir, nombre.replace(/\W+/g, '_') + '.xml');
  fs.writeFileSync(archivo, xml);
  const r = spawnSync('xmllint', ['--noout', '--schema', xsd, archivo], { encoding: 'utf8' });
  const ok = r.status === 0;
  if (!ok) fallos++;
  console.log((ok ? 'OK    ' : 'FALLA ') + nombre + (ok ? '' : '\n' + (r.stderr || '').split('\n').slice(0, 4).join('\n')));
}
console.log(fallos ? `\n${fallos} caso(s) con errores (XML en ${dir})` : '\nTodos los XML son válidos según el esquema.');
process.exit(fallos ? 1 : 0);
