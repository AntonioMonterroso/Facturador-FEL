'use strict';
// Datos de prueba compartidos por las validaciones XML y JSON.
const stub = { addEventListener() {}, classList: { toggle() {}, remove() {} }, set onclick(v) {} };
global.document = { getElementById: () => stub, querySelectorAll: () => [] };
global.window = { addEventListener() {} };
global.location = { hash: '' };
global.localStorage = {
  getItem: () => JSON.stringify({ emisor: { nit: '123456', nombre: 'FEL TEST', comercial: 'ESTABLECIMIENTO DE PRUEBA', direccion: '4 AVENIDA 15-70 ZONA 10', codigoPostal: '01001', municipio: 'Guatemala', departamento: 'Guatemala', serie: 'FACE-A', correo: 'correo@outlook.com' } }),
  setItem() {}
};
const { generarXML, generarJSON } = require('../app.js');

const base = {
  fecha: '2022-07-01T17:28:00Z', uuid: 'FRONT-67C1-4545-BA1E-AA3C115E18D6',
  cliente: { nit: '77454820', nombre: 'DIGIFACT SERVICIOS SOCIEDAD ANONIMA', direccion: '4ta avenida 15-70 zona 10', correo: 'receptor@digifact.com.gt' },
  items: [{ descripcion: 'LECHE DOS PINOS ENTERA LIQUIDA LITRO', cantidad: 2, precio: 50, descuento: 10 }, { descripcion: 'prueba', cantidad: 1, precio: 31, descuento: 0, servicio: true }]
};
const origen = { autorizacion: 'D21E95C9-00FB-443B-AD08-71514F021E47', numero: '16467003', fecha: '2022-06-29', motivo: 'Devolucion' };
const expo = { destinatario: 'juanito', direccion: 'direccion 1', incoterm: 'EXW', moneda: 'USD' };
const abonos = [{ fecha: '2022-07-10', monto: 100 }, { fecha: '2022-07-17', monto: 21 }];
const casos = {
  'FACT': { tipo: 'FACT' },
  'FACT CF': { tipo: 'FACT', cliente: { nit: 'CF', nombre: 'CONSUMIDOR FINAL' } },
  'FACT CUI': { tipo: 'FACT', cliente: { nit: '3730617490101', nombre: 'Julio Cifuentes' } },
  'FACT exportación': { tipo: 'FACT', exportacion: expo },
  'FACT adenda': { tipo: 'FACT', adenda: [['Vendedor', 'vendedor1'], ['Numero de Compra', '1']] },
  'FACT ESPECT': { tipo: 'FACT', espect: { CodigoEvento: '001', NombreEvento: 'Concierto', NombreLocalidad: 'Cayala', PrecioAdmision: '325.50', NumeroBoleto: '12222' } },
  'FACT CCA': { tipo: 'FACT', cca: [{ NITtercero: '112706517', NumeroDocumento: '1', FechaDocumento: '2022-06-03', Descripcion: 'x', BaseImponible: '100.00', MontoCobroDAI: '0.00', MontoCobroIVA: '12.00', MontoCobroOtros: '0.00', MontoCobroTotal: '12.00' }] },
  'FCAM': { tipo: 'FCAM', abonos },
  'FCAM exportación': { tipo: 'FCAM', abonos, exportacion: expo },
  'NCRE': { tipo: 'NCRE', origen },
  'NDEB': { tipo: 'NDEB', origen: { ...origen, motivo: '' } },
  'NDEB exportación': { tipo: 'NDEB', origen, exportacion: { moneda: 'GTQ', incoterm: 'EXW' } },
  'NABN': { tipo: 'NABN' },
  'RECI': { tipo: 'RECI', recibo: { tipo: 'Universidad', campos: { NombreAlumno: 'Julio', Carne: '201801677', UnidadAcademica: '08' } } },
  'RDON': { tipo: 'RDON', personeria: '734' },
  'FESP': { tipo: 'FESP' },
  'FPEC': { tipo: 'FPEC', numeroAcceso: '100002886' },
  'FCPC': { tipo: 'FCPC', numeroAcceso: '100002886', abonos },
  'FARP': { tipo: 'FARP', numeroAcceso: '100002886' },
  'FCRP': { tipo: 'FCRP', numeroAcceso: '100002886', abonos }
};


module.exports = { generarXML, generarJSON, base, casos };
