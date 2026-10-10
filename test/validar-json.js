'use strict';
// Genera el JSON de cada tipo de documento y lo valida contra docs/NUCSchema.json (draft-04).
// Requiere Python con el paquete jsonschema. Uso: node test/validar-json.js
const fs = require('fs'), os = require('os'), path = require('path');
const { spawnSync } = require('child_process');
const { generarJSON, base, casos } = require('./casos.js');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fel-json-'));
for (const [nombre, extra] of Object.entries(casos)) {
  fs.writeFileSync(path.join(dir, nombre.replace(/\W+/g, '_') + '.json'), generarJSON({ ...base, ...extra }));
}
const r = spawnSync('python3', ['-I', path.join(__dirname, 'validar_json.py'), path.join(__dirname, '..', 'docs', 'NUCSchema.json'), dir], { encoding: 'utf8' });
process.stdout.write(r.stdout + (r.stderr || ''));
process.exit(r.status || 0);
