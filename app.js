'use strict';

/* ---------- Utilidades ---------- */
const IVA = 0.12;
const TIPOS = { FACT: 'Factura', FCAM: 'Factura cambiaria', NCRE: 'Nota de crédito', NDEB: 'Nota de débito', FESP: 'Factura especial', NABN: 'Nota de abono', RDON: 'Recibo por donación', RECI: 'Recibo', FPEC: 'Factura pequeño contribuyente', FCPC: 'Cambiaria pequeño contribuyente' };
const EXENTOS = new Set(['NABN', 'RDON', 'RECI', 'FPEC', 'FCPC']); // sin IVA
const calcF = f => calcular(f.items, EXENTOS.has(f.tipo) || !!f.exportacion); // exportación: IVA 0%
const INCOTERMS = ['EXW', 'FCA', 'FAS', 'FOB', 'CFR', 'CIF', 'CPT', 'CIP', 'DAP', 'DPU', 'DDP'];
const abonosDe = f => f.abonos || [{ fecha: f.vencimiento, monto: calcF(f).total }];
const monedaDe = f => (f.exportacion && f.exportacion.moneda) || 'GTQ';
const esCUI = n => /^\d{13}$/.test(n);
// Frases del emisor por tipo: [código, TipoFrase, Escenario]. FESP y notas no llevan frases.
const FRASES = { FACT: [['1', '1', '1']], FCAM: [['1', '1', '1']], NABN: [['1', '9', '16'], ['2', '9', '17']], RDON: [['1', '4', '4']], RECI: [['1', '4', '5']], FPEC: [['1', '3', '1'], ['2', '11', '1']], FCPC: [['1', '3', '1'], ['2', '11', '1']] };
const AFILIACION = { FPEC: 'PEC', FCPC: 'PEC' }; // el resto va como GEN
const esCambiaria = t => t === 'FCAM' || t === 'FCPC';
const NUM_ACCESO = new Set(['FPEC', 'FCPC']);
const numAcceso = () => String(100000000 + crypto.getRandomValues(new Uint32Array(1))[0] % 900000000);
/** Datos de cabecera adicionales: [nombre, valor]. */
const infoCab = f => [...(f.tipo === 'RDON' ? [['TipoPersoneria', f.personeria]] : []), ...(f.exportacion ? [['Exp', 'SI']] : []), ...(f.numeroAcceso ? [['NumeroAcceso', f.numeroAcceso]] : [])];
/** Datos opcionales del recibo que viajan en la adenda, según el tipo: [nombre, etiqueta, opciones?]. */
const RECI_CAMPOS = {
  Universidad: [['NombreAlumno', 'Nombre del alumno'], ['Carne', 'Carné'], ['UnidadAcademica', 'Unidad académica']],
  Colegio: [['NombreAlumno', 'Nombre del alumno'], ['Carne', 'Carné'], ['Grado', 'Grado'], ['Seccion', 'Sección'], ['Jornada', 'Jornada'], ['TipoDePago', 'Tipo de pago'], ['NoReferencia', 'No. de referencia'], ['Banco', 'Banco'], ['Total', 'Total pagado'], ['Observaciones', 'Observaciones']],
  Inmobiliaria: [['MZ', 'Manzana (MZ)'], ['APTO', 'Apartamento / lote'], ['TipoPago', 'Tipo de pago', ['Abono', 'Cancelado']]]
};
const infoRecibo = f => f.recibo ? [['Tipo', f.recibo.tipo], ...RECI_CAMPOS[f.recibo.tipo].map(([n]) => [n, f.recibo.campos[n]])].filter(([, v]) => v) : [];
const RET_ISR = 0.05; // Retención ISR de FESP sobre el monto gravable (tasa de 5%; no contempla el tramo de 7%)
const esNota = t => t === 'NCRE' || t === 'NDEB';
const money = (n, mon = 'GTQ') => (mon === 'USD' ? 'US$ ' : 'Q ') + (Number(n) || 0).toLocaleString('es-GT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const r2 = n => Math.round((n + Number.EPSILON) * 100) / 100;
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16); })).toUpperCase();

/** Valida un NIT guatemalteco (módulo 11, dígito verificador 0-9 o K). */
function validarNIT(nit) {
  nit = String(nit || '').toUpperCase().replace(/[\s-]/g, '');
  if (nit === 'CF') return true;
  if (!/^\d+[0-9K]$/.test(nit)) return false;
  const cuerpo = nit.slice(0, -1), dv = nit.slice(-1);
  let suma = 0;
  for (let i = 0; i < cuerpo.length; i++) suma += Number(cuerpo[i]) * (cuerpo.length + 1 - i);
  const v = (11 - (suma % 11)) % 11;
  return dv === (v === 10 ? 'K' : String(v));
}
const normNIT = n => String(n || '').toUpperCase().replace(/[\s-]/g, '') || 'CF';

/** Los precios incluyen IVA (práctica común en Guatemala). */
function calcular(items, exento = false) {
  let total = 0, descuento = 0;
  const lineas = items.map(it => {
    const bruto = r2(it.cantidad * it.precio);
    const desc = r2(Math.min(it.descuento || 0, bruto));
    const t = r2(bruto - desc);
    total += t; descuento += desc;
    const gravable = exento ? t : r2(t / (1 + IVA));
    return { ...it, bruto, desc, total: t, gravable, iva: r2(t - gravable) };
  });
  total = r2(total);
  const gravable = r2(lineas.reduce((a, l) => a + l.gravable, 0));
  return { lineas, total, descuento: r2(descuento), gravable, iva: r2(total - gravable) };
}

/* ---------- Estado ---------- */
const KEY = 'facturador-fel-v1';
const vacio = () => ({
  emisor: { nit: '', nombre: '', comercial: '', direccion: '', codigoPostal: '01001', municipio: 'Guatemala', departamento: 'Guatemala', serie: 'FACE-A', correo: '' },
  clientes: [], facturas: [], correlativo: {}
});
let S = vacio();
try { S = { ...vacio(), ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { /* storage no disponible */ }
const guardar = () => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch { /* ignorar */ } };

function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 2400);
}

/* ---------- XML Digifact (formato "Root", NUC Guatemala) ---------- */
const r6 = n => (Math.round((n + Number.EPSILON) * 1e6) / 1e6).toFixed(6);
/** Fecha en hora de Guatemala (UTC-6, sin horario de verano), p. ej. 2022-07-01T11:28:00-06:00 */
const fechaGT = iso => new Date(new Date(iso).getTime() - 6 * 3600e3).toISOString().slice(0, 19) + '-06:00';

function generarXML(f) {
  const e = S.emisor, x = esc, c = calcF(f), expo = f.exportacion;
  const fr = FRASES[f.tipo] && (expo ? [...FRASES[f.tipo], ['2', '4', '1']] : FRASES[f.tipo]);
  const dir = (d, cp, mun, dep) => `<AddressInfo>
        <Address>${x(d)}</Address><City>${x(cp)}</City><District>${x(mun)}</District><State>${x(dep)}</State><Country>GT</Country>
      </AddressInfo>`;
  let totIva = 0, totGrav = 0;
  const items = c.lineas.map(l => {
    const grav = expo || EXENTOS.has(f.tipo) ? l.total : Number(r6(l.total / (1 + IVA))), iva = expo || EXENTOS.has(f.tipo) ? 0 : Number(r6(l.total - grav));
    totIva += iva; totGrav += grav;
    return `
    <Item>
      <Type>${l.servicio ? 'Servicio' : 'Bien'}</Type>
      <Description>${x(l.descripcion)}</Description>
      <Qty>${r6(l.cantidad)}</Qty>
      <UnitOfMeasure>${l.servicio ? 'SER' : 'UNI'}</UnitOfMeasure>
      <Price>${r6(l.precio)}</Price>
      <Discounts><Discount><Amount>${l.desc.toFixed(2)}</Amount></Discount></Discounts>
${EXENTOS.has(f.tipo) ? '' : `      <Taxes><Tax>
        <Code>${expo ? 2 : 1}</Code><Description>IVA</Description>
        <TaxableAmount>${r6(grav)}</TaxableAmount><Amount>${r6(iva)}</Amount>
      </Tax></Taxes>
`}
      <Totals><TotalItem>${r6(l.total)}</TotalItem></Totals>
    </Item>`;
  }).join('');
  return `<?xml version="1.0" encoding="UTF-8"?>
<Root>
  <Version>1.00</Version>
  <CountryCode>GT</CountryCode>
  <Header>
    <DocType>${x(f.tipo)}</DocType>
    <IssuedDateTime>${fechaGT(f.fecha)}</IssuedDateTime>
    <Currency>${monedaDe(f)}</Currency>
    ${infoCab(f).length ? `<AdditionalIssueDocInfo>${infoCab(f).map(([n, v]) => `<Info Name="${n}" Value="${x(v)}"/>`).join('')}</AdditionalIssueDocInfo>` : ''}
  </Header>
  <Seller>
    <TaxID>${x(e.nit)}</TaxID>
    <TaxIDAdditionalInfo><Info Name="AfiliacionIVA" Value="${AFILIACION[f.tipo] || 'GEN'}"/></TaxIDAdditionalInfo>
    <Name>${x(e.nombre)}</Name>
    ${e.correo ? `<Contact><EmailList><Email>${x(e.correo)}</Email></EmailList></Contact>` : ''}
    ${fr ? `<AdditionlInfo>${fr.map(([d, t, es]) => `
      <Info Name="TipoFrase" Data="${d}" Value="${t}"/>
      <Info Name="Escenario" Data="${d}" Value="${es}"/>`).join('')}
    </AdditionlInfo>` : ''}
    <BranchInfo>
      <Code>1</Code>
      <Name>${x(e.comercial || e.nombre)}</Name>
      ${dir(e.direccion, e.codigoPostal || '01001', e.municipio || 'Guatemala', e.departamento || 'Guatemala')}
    </BranchInfo>
  </Seller>
  <Buyer>
    <TaxID>${x(f.cliente.nit)}</TaxID>${esCUI(f.cliente.nit) ? '\n    <TaxIDType>CUI</TaxIDType>' : ''}
    <Name>${x(f.cliente.nombre)}</Name>
    ${f.cliente.correo ? `<Contact><EmailList><Email>${x(f.cliente.correo)}</Email></EmailList></Contact>` : ''}
    ${dir(f.cliente.direccion || 'Ciudad', '01001', 'Guatemala', 'Guatemala')}
  </Buyer>
  <Items>${items}
  </Items>
  <Totals>
    ${EXENTOS.has(f.tipo) ? '' : `<TotalTaxes><TotalTax><Description>IVA</Description><Amount>${r6(totIva)}</Amount></TotalTax></TotalTaxes>
    `}
    <GrandTotal><InvoiceTotal>${r6(c.total)}</InvoiceTotal></GrandTotal>
  </Totals>
  <AdditionalDocumentInfo>${expo && !esNota(f.tipo) ? `
    <AdditionalInfo>
      <Code>EXP</Code>
      <Type>COMPLEMENTO</Type>
      <AditionalInfo>
        <Info Name="NombreConsignatarioODestinatario" Value="${x(expo.destinatario)}"/>
        <Info Name="DireccionConsignatarioODestinatario" Value="${x(expo.direccion)}"/>
        <Info Name="INCOTERM" Data="" Value="${x(expo.incoterm)}"/>
      </AditionalInfo>
    </AdditionalInfo>` : ''}${f.tipo === 'FESP' ? `
    <AdditionalInfo>
      <Code>FESP</Code>
      <Type>COMPLEMENTO</Type>
      <AditionalInfo>
        <Info Name="RetencionISR" Value="${r6(totGrav * RET_ISR)}"/>
        <Info Name="RetencionIVA" Value="${r6(totIva)}"/>
        <Info Name="TotalMenosRetenciones" Value="${r6(c.total - Number(r6(totGrav * RET_ISR)) - Number(r6(totIva)))}"/>
      </AditionalInfo>
    </AdditionalInfo>` : ''}${esCambiaria(f.tipo) ? `
    <AdditionalInfo>
      <Code>FCAMB</Code>
      <Type>COMPLEMENTO</Type>
      <AditionalData>${abonosDe(f).map((a, i) => `
        <Data>
          <Info Name="NumeroAbono" Value="${i + 1}"/>
          <Info Name="FechaVencimiento" Value="${x(a.fecha)}"/>
          <Info Name="MontoAbono" Value="${Number(a.monto).toFixed(2)}"/>
        </Data>`).join('')}
      </AditionalData>
    </AdditionalInfo>` : ''}${esNota(f.tipo) ? `
    <AdditionalInfo>
      <Code>${f.tipo}</Code>
      <Type>COMPLEMENTO</Type>
      <AditionalInfo>
        <Info Name="NumeroAutorizacionDocumentoOrigen" Value="${x(f.origen.autorizacion)}"/>
        <Info Name="FechaEmisionDocumentoOrigen" Value="${x(f.origen.fecha)}"/>${f.origen.motivo ? `
        <Info Name="MotivoAjuste" Value="${x(f.origen.motivo)}"/>` : ''}
        <Info Name="SerieDocumentoOrigen" Value="${x(f.origen.autorizacion.slice(0, 8))}"/>
        <Info Name="NumeroDocumentoOrigen" Value="${x(f.origen.numero)}"/>
      </AditionalInfo>
    </AdditionalInfo>` : ''}
    <AdditionalInfo>
      <Code>${x(f.uuid)}</Code>
      <Type>ADENDA</Type>
      <AditionalInfo>
        <Info Name="VALIDAR_REFERENCIA_INTERNA" Value="NO_VALIDAR"/>${infoRecibo(f).map(([n, v]) => `
        <Info Name="${n}" Value="${x(v)}"/>`).join('')}
      </AditionalInfo>
    </AdditionalInfo>
  </AdditionalDocumentInfo>
</Root>
`;
}

/** Mismo documento en el formato JSON de Digifact. */
function generarJSON(f) {
  const e = S.emisor, c = calcF(f);
  const dir = (d, cp, mun, dep) => ({ Address: d, City: cp, District: mun, State: dep, Country: 'GT' });
  const exento = EXENTOS.has(f.tipo), expo = f.exportacion;
  let totIva = 0, totGrav = 0;
  const Items = c.lineas.map((l, i) => {
    const grav = exento || expo ? l.total : Number(r6(l.total / (1 + IVA))), iva = exento || expo ? 0 : Number(r6(l.total - grav));
    totIva += iva; totGrav += grav;
    return {
      Number: String(i + 1), Codes: null, Type: l.servicio ? 'Servicio' : 'Bien', Description: l.descripcion,
      Qty: r6(l.cantidad), UnitOfMeasure: l.servicio ? 'SER' : 'UNI', Price: r6(l.precio),
      Discounts: { Discount: [{ Amount: l.desc.toFixed(2) }] },
      Taxes: exento ? null : { Tax: [{ Code: expo ? '2' : '1', Description: 'IVA', TaxableAmount: r6(grav), Amount: r6(iva) }] },
      Totals: { TotalItem: r6(l.total) }
    };
  });
  const Buyer = { TaxID: f.cliente.nit, ...(esCUI(f.cliente.nit) ? { TaxIDType: 'CUI' } : {}), Name: f.cliente.nombre, AddressInfo: dir(f.cliente.direccion || 'Ciudad', '01001', 'Guatemala', 'Guatemala') };
  if (f.cliente.correo) Buyer.Contact = { EmailList: { Email: [f.cliente.correo] } };
  return JSON.stringify({
    Version: '1.00', CountryCode: 'GT',
    Header: { DocType: f.tipo, IssuedDateTime: fechaGT(f.fecha), Currency: monedaDe(f), ...(infoCab(f).length ? { AdditionalIssueDocInfo: infoCab(f).map(([Name, Value]) => ({ Name, Data: null, Value })) } : {}) },
    Seller: {
      TaxID: e.nit, TaxIDAdditionalInfo: [{ Name: 'AfiliacionIVA', Data: null, Value: AFILIACION[f.tipo] || 'GEN' }], Name: e.nombre,
      ...(e.correo ? { Contact: { EmailList: { Email: [e.correo] } } } : {}),
      ...(FRASES[f.tipo] ? { AdditionlInfo: (expo ? [...FRASES[f.tipo], ['2', '4', '1']] : FRASES[f.tipo]).flatMap(([d, tf, esc]) => [{ Name: 'TipoFrase', Data: d, Value: tf }, { Name: 'Escenario', Data: d, Value: esc }]) } : {}),
      BranchInfo: { Code: '1', Name: e.comercial || e.nombre, AddressInfo: dir(e.direccion, e.codigoPostal || '01001', e.municipio || 'Guatemala', e.departamento || 'Guatemala') }
    },
    Buyer, ThirdParties: null, Items,
    Totals: { ...(exento ? {} : { TotalTaxes: { TotalTax: [{ Description: 'IVA', Amount: r6(totIva) }] } }), GrandTotal: { InvoiceTotal: r6(c.total) } },
    AdditionalDocumentInfo: { AdditionalInfo: [
      ...(expo && !esNota(f.tipo) ? [{
        Code: 'EXP', Type: 'COMPLEMENTO',
        AditionalInfo: [
          { Name: 'NombreConsignatarioODestinatario', Data: null, Value: expo.destinatario },
          { Name: 'DireccionConsignatarioODestinatario', Data: null, Value: expo.direccion },
          { Name: 'INCOTERM', Data: '', Value: expo.incoterm }
        ]
      }] : []),
      ...(esCambiaria(f.tipo) ? [{
        Code: 'FCAMB', Type: 'COMPLEMENTO',
        AditionalData: { Data: abonosDe(f).map((a, i) => ({ Info: [
          { Name: 'NumeroAbono', Data: null, Value: String(i + 1) },
          { Name: 'FechaVencimiento', Data: null, Value: a.fecha },
          { Name: 'MontoAbono', Data: null, Value: Number(a.monto).toFixed(2) }
        ] })) }
      }] : []),
      ...(f.tipo === 'FESP' ? [{
        Code: 'FESP', Type: 'COMPLEMENTO',
        AditionalInfo: [
          { Name: 'RetencionISR', Data: null, Value: r6(totGrav * RET_ISR) },
          { Name: 'RetencionIVA', Data: null, Value: r6(totIva) },
          { Name: 'TotalMenosRetenciones', Data: null, Value: r6(c.total - Number(r6(totGrav * RET_ISR)) - Number(r6(totIva))) }
        ]
      }] : []),
      ...(esNota(f.tipo) ? [{
        Code: f.tipo, Type: 'COMPLEMENTO',
        AditionalInfo: [
          { Name: 'NumeroAutorizacionDocumentoOrigen', Data: null, Value: f.origen.autorizacion },
          { Name: 'FechaEmisionDocumentoOrigen', Data: null, Value: f.origen.fecha },
          ...(f.origen.motivo ? [{ Name: 'MotivoAjuste', Data: null, Value: f.origen.motivo }] : []),
          { Name: 'SerieDocumentoOrigen', Data: null, Value: f.origen.autorizacion.slice(0, 8) },
          { Name: 'NumeroDocumentoOrigen', Data: null, Value: f.origen.numero }
        ]
      }] : []),
      { Code: f.uuid, Type: 'ADENDA', AditionalInfo: [{ Name: 'VALIDAR_REFERENCIA_INTERNA', Data: null, Value: 'NO_VALIDAR' }, ...infoRecibo(f).map(([Name, Value]) => ({ Name, Data: null, Value }))] }
    ] }
  }, null, 2);
}

function descargar(nombre, texto, tipo) {
  const url = URL.createObjectURL(new Blob([texto], { type: tipo }));
  const a = Object.assign(document.createElement('a'), { href: url, download: nombre });
  document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
}

/* ---------- Vistas ---------- */
const $ = id => document.getElementById(id);
const view = () => $('view');
const vigentes = () => S.facturas.filter(f => !f.anulada);

function vistaResumen() {
  const hoy = new Date(), mes = hoy.toISOString().slice(0, 7);
  const v = vigentes().filter(f => monedaDe(f) === 'GTQ').map(f => ({ f, c: calcF(f) }));
  const sgn = x => (x.f.tipo === 'NCRE' ? -1 : 1);
  const del = v.filter(x => x.f.fecha.startsWith(mes));
  const sum = (arr, k) => r2(arr.reduce((a, x) => a + sgn(x) * x.c[k], 0));
  // últimos 6 meses
  const meses = [...Array(6)].map((_, i) => { const d = new Date(hoy.getFullYear(), hoy.getMonth() - 5 + i, 1); return d.toISOString().slice(0, 7); });
  const datos = meses.map(m => sum(v.filter(x => x.f.fecha.startsWith(m)), 'total'));
  const max = Math.max(...datos, 1);
  const nombreMes = m => new Date(m + '-15').toLocaleDateString('es-GT', { month: 'short' });
  const recientes = S.facturas.slice(-5).reverse();
  view().innerHTML = `
    <div class="grid kpis">
      <div class="card kpi"><span>Facturado este mes</span><strong>${money(sum(del, 'total'))}</strong></div>
      <div class="card kpi"><span>IVA por pagar (mes)</span><strong>${money(sum(del, 'iva'))}</strong></div>
      <div class="card kpi"><span>Documentos emitidos</span><strong>${S.facturas.length}</strong></div>
      <div class="card kpi"><span>Clientes</span><strong>${S.clientes.length}</strong></div>
    </div>
    ${S.emisor.nit ? '' : '<div class="card">⚠️ Configura los datos del <a href="#/config">emisor</a> antes de facturar.</div>'}
    <div class="card"><h2>Ventas de los últimos 6 meses</h2>
      <div class="bars">${datos.map((d, i) => `<div title="${money(d)}"><i style="height:${Math.max(d, 0) / max * 100}%"></i>${nombreMes(meses[i])}</div>`).join('')}</div></div>
    <div class="card"><h2>Recientes</h2>${tablaFacturas(recientes)}</div>`;
}

function tablaFacturas(lista) {
  if (!lista.length) return '<p class="empty">Aún no hay documentos.</p>';
  return `<div class="table-wrap"><table><thead><tr><th>Documento</th><th>Fecha</th><th>Cliente</th><th class="r">Total</th><th>Estado</th><th></th></tr></thead><tbody>
    ${lista.map(f => `<tr><td>${esc(TIPOS[f.tipo])} ${esc(f.serie)}-${f.numero}</td><td>${esc(f.fecha.slice(0, 10))}</td><td>${esc(f.cliente.nombre)}</td>
    <td class="r">${money(calcF(f).total, monedaDe(f))}</td>
    <td><span class="badge ${f.anulada ? 'bad' : 'ok'}">${f.anulada ? 'Anulada' : 'Emitida'}</span></td>
    <td><a class="btn sm" href="#/factura/${esc(f.uuid)}">Ver</a></td></tr>`).join('')}</tbody></table></div>`;
}

function vistaFacturas() {
  view().innerHTML = `<div class="card"><input id="q" placeholder="Buscar por cliente, NIT o número…" aria-label="Buscar"><div id="lista" style="margin-top:12px"></div></div>`;
  const pintar = () => {
    const q = $('q').value.toLowerCase();
    const l = S.facturas.filter(f => `${f.cliente.nombre} ${f.cliente.nit} ${f.serie}-${f.numero}`.toLowerCase().includes(q)).reverse();
    $('lista').innerHTML = tablaFacturas(l);
  };
  $('q').addEventListener('input', pintar); pintar();
}

function vistaNueva() {
  if (!S.emisor.nit) { toast('Configura primero el emisor'); location.hash = '#/config'; return; }
  const items = [{ descripcion: '', cantidad: 1, precio: 0, descuento: 0, servicio: false }];
  view().innerHTML = `
  <form id="form" class="card" novalidate>
    <div class="grid two">
      <div><label for="tipo">Tipo de documento</label><select id="tipo">${Object.entries(TIPOS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></div>
      <div><label for="cli">Cliente guardado</label><select id="cli"><option value="">— Consumidor final —</option>${S.clientes.map((c, i) => `<option value="${i}">${esc(c.nombre)} (${esc(c.nit)})</option>`).join('')}</select></div>
      <div id="expo" style="grid-column:1/-1"><label><input type="checkbox" id="xc" style="width:auto"> Exportación (IVA 0%)</label>
        <div id="xf" class="grid two" hidden style="margin-top:8px">
          <div><label for="xd">Consignatario / destinatario</label><input id="xd"></div>
          <div><label for="xr">Dirección del destinatario</label><input id="xr"></div>
          <div><label for="xi">INCOTERM</label><select id="xi">${INCOTERMS.map(i => `<option>${i}</option>`).join('')}</select></div>
          <div><label for="xm">Moneda</label><select id="xm"><option value="USD">USD</option><option value="GTQ">GTQ</option></select></div>
        </div></div>
      <div id="rec" hidden style="grid-column:1/-1">
        <label for="rt">Tipo de recibo</label>
        <select id="rt"><option value="">Ninguno</option>${Object.keys(RECI_CAMPOS).map(t => `<option>${t}</option>`).join('')}</select>
        <div id="recf" class="grid two" style="margin-top:8px"></div>
      </div>
      <div id="pers" hidden><label for="pf">Tipo de personería (RDON)</label><input id="pf" value="734" inputmode="numeric"></div>
      <div id="venc" hidden style="grid-column:1/-1"><label>Abonos (factura cambiaria)</label><div id="abs"></div><button type="button" class="btn sm" id="abAdd">+ Abono</button><div class="hint">Con un solo abono se cobra el total; con varios, la suma debe igualar el total.</div></div>
      <div id="orig" class="grid two" hidden style="grid-column:1/-1">
        <div><label for="oa">Autorización del documento origen</label><input id="oa" autocomplete="off"></div>
        <div><label for="on">Número del documento origen</label><input id="on" inputmode="numeric"></div>
        <div><label for="of">Fecha de emisión del origen</label><input id="of" type="date"></div>
        <div><label for="om">Motivo del ajuste (opcional)</label><input id="om"></div>
      </div>
      <div><label for="nit">NIT o CUI del receptor</label><input id="nit" value="CF" autocomplete="off"><div class="err" id="nitErr"></div></div>
      <div><label for="nom">Nombre del receptor</label><input id="nom" value="Consumidor Final"></div>
    </div>
    <h2 style="margin-top:24px">Detalle</h2>
    <div class="table-wrap"><table><thead><tr><th>Descripción</th><th style="width:90px">Cant.</th><th style="width:120px">Precio (con IVA)</th><th style="width:110px">Descuento</th><th style="width:60px">Serv.</th><th class="r" style="width:110px">Total</th><th></th></tr></thead><tbody id="rows"></tbody></table></div>
    <button type="button" class="btn sm" id="add">+ Agregar línea</button>
    <div class="totals" id="tot"></div>
    <div class="actions"><button class="btn primary">Emitir documento</button></div>
  </form>`;

  const rows = $('rows');
  const pintarFilas = () => {
    rows.innerHTML = items.map((it, i) => `<tr data-i="${i}">
      <td><input data-k="descripcion" value="${esc(it.descripcion)}" placeholder="Producto o servicio" aria-label="Descripción"></td>
      <td><input data-k="cantidad" type="number" min="0.01" step="any" value="${it.cantidad}" aria-label="Cantidad"></td>
      <td><input data-k="precio" type="number" min="0" step="0.01" value="${it.precio}" aria-label="Precio"></td>
      <td><input data-k="descuento" type="number" min="0" step="0.01" value="${it.descuento}" aria-label="Descuento"></td>
      <td><input data-k="servicio" type="checkbox" ${it.servicio ? 'checked' : ''} aria-label="Es servicio"></td>
      <td class="r" data-t>${money(it.cantidad * it.precio - it.descuento)}</td>
      <td><button type="button" class="btn sm danger" data-del aria-label="Quitar línea">✕</button></td></tr>`).join('');
    totales();
  };
  const totales = () => {
    const expo = expoOn(), mon = expo ? $('xm').value : 'GTQ';
    const c = calcular(items, EXENTOS.has($('tipo').value) || expo);
    $('tot').innerHTML = `<div><span>Subtotal sin IVA</span><span>${money(c.gravable, mon)}</span></div><div><span>IVA ${expo ? '0% (exportación)' : '12%'}</span><span>${money(c.iva, mon)}</span></div><div class="grand"><span>Total</span><span>${money(c.total, mon)}</span></div>`;
    rows.querySelectorAll('tr').forEach((tr, i) => { const t = tr.querySelector('[data-t]'); if (t) t.textContent = money(c.lineas[i].total, mon); });
  };
  rows.addEventListener('input', e => {
    const tr = e.target.closest('tr'); if (!tr) return;
    const k = e.target.dataset.k, it = items[tr.dataset.i];
    it[k] = k === 'descripcion' ? e.target.value : k === 'servicio' ? e.target.checked : Math.max(0, parseFloat(e.target.value) || 0);
    totales();
  });
  rows.addEventListener('click', e => {
    if (!e.target.closest('[data-del]')) return;
    if (items.length > 1) { items.splice(e.target.closest('tr').dataset.i, 1); pintarFilas(); }
  });
  $('add').onclick = () => { items.push({ descripcion: '', cantidad: 1, precio: 0, descuento: 0, servicio: false }); pintarFilas(); };
  const abonos = [{ fecha: new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10), monto: 0 }];
  const pintarAbonos = () => {
    $('abs').innerHTML = abonos.map((a, i) => `<div class="grid two" style="grid-template-columns:1fr 1fr auto;margin-bottom:6px" data-a="${i}">
      <input type="date" data-f="fecha" value="${a.fecha}" aria-label="Fecha de vencimiento">
      <input type="number" min="0" step="0.01" data-f="monto" value="${a.monto || ''}" placeholder="Monto" aria-label="Monto del abono" ${abonos.length === 1 ? 'disabled' : ''}>
      ${abonos.length > 1 ? '<button type="button" class="btn sm danger" data-q aria-label="Quitar abono">✕</button>' : '<span></span>'}</div>`).join('');
  };
  $('abs').addEventListener('input', e => { const d = e.target.closest('[data-a]'); if (d) abonos[d.dataset.a][e.target.dataset.f] = e.target.dataset.f === 'monto' ? parseFloat(e.target.value) || 0 : e.target.value; });
  $('abs').addEventListener('click', e => { if (e.target.closest('[data-q]')) { abonos.splice(e.target.closest('[data-a]').dataset.a, 1); pintarAbonos(); } });
  $('abAdd').onclick = () => { abonos.push({ fecha: abonos[abonos.length - 1].fecha, monto: 0 }); pintarAbonos(); };
  pintarAbonos();
  $('rt').onchange = () => {
    $('recf').innerHTML = (RECI_CAMPOS[$('rt').value] || []).map(([n, l, op], i) => `<div><label for="rf${i}">${l}</label>${op
      ? `<select id="rf${i}" data-n="${n}">${op.map(o => `<option>${o}</option>`).join('')}</select>`
      : `<input id="rf${i}" data-n="${n}">`}</div>`).join('');
  };
  const expoOn = () => ['FACT', 'FCAM', 'NCRE', 'NDEB'].includes($('tipo').value) && $('xc').checked;
  $('xm').onchange = () => totales();
  $('xc').onchange = () => { $('xf').hidden = !$('xc').checked || esNota($('tipo').value); totales(); };
  $('tipo').onchange = () => { $('expo').hidden = !['FACT', 'FCAM', 'NCRE', 'NDEB'].includes($('tipo').value); $('xf').hidden = !$('xc').checked || esNota($('tipo').value); $('venc').hidden = !esCambiaria($('tipo').value); $('orig').hidden = !esNota($('tipo').value); $('pers').hidden = $('tipo').value !== 'RDON'; $('rec').hidden = !['RECI', 'RDON'].includes($('tipo').value); totales(); };
  $('cli').onchange = e => {
    const c = S.clientes[e.target.value];
    $('nit').value = c ? c.nit : 'CF'; $('nom').value = c ? c.nombre : 'Consumidor Final';
  };
  $('nit').oninput = () => { const n = normNIT($('nit').value); $('nitErr').textContent = validarNIT(n) || esCUI(n) ? '' : 'NIT inválido (revisa el dígito verificador) o CUI de 13 dígitos'; };

  const tipo0 = () => $('tipo').value;
  $('form').onsubmit = e => {
    e.preventDefault();
    const nit = normNIT($('nit').value), nombre = $('nom').value.trim();
    if (!validarNIT(nit) && !esCUI(nit)) return toast('El NIT o CUI del receptor no es válido');
    if (!nombre) return toast('Falta el nombre del receptor');
    if (items.some(i => !i.descripcion.trim() || !(i.cantidad > 0))) return toast('Completa la descripción y cantidad de cada línea');
    const expo = expoOn();
    const c = calcular(items, EXENTOS.has(tipo0()) || expo);
    if (c.total <= 0) return toast('El total debe ser mayor a cero');
    if (nit === 'CF' && c.total > 2500) return toast('Consumidor final: máximo Q2,500 por documento. Indica un NIT.');
    const tipo = $('tipo').value, serie = S.emisor.serie || 'FACE-A';
    const k = serie + '|' + tipo;
    const f = { uuid: uuid(), tipo, serie, numero: 0, fecha: new Date().toISOString(), cliente: { nit, nombre, direccion: '' }, items: items.map(i => ({ ...i, descripcion: i.descripcion.trim() })), anulada: false };
    if (NUM_ACCESO.has(tipo)) f.numeroAcceso = numAcceso();
    if (esCambiaria(tipo)) {
      f.abonos = abonos.map(a => ({ fecha: a.fecha, monto: abonos.length === 1 ? c.total : r2(a.monto) }));
      const hoy = f.fecha.slice(0, 10);
      if (f.abonos.some(a => !a.fecha || a.fecha < hoy)) return toast('Indica una fecha de vencimiento válida en cada abono');
      if (Math.abs(f.abonos.reduce((t, a) => t + a.monto, 0) - c.total) > 0.005) return toast('La suma de los abonos debe ser igual al total');
    }
    if (expo) {
      f.exportacion = { destinatario: $('xd').value.trim(), direccion: $('xr').value.trim(), incoterm: $('xi').value, moneda: $('xm').value };
      if (!esNota(tipo) && (!f.exportacion.destinatario || !f.exportacion.direccion)) return toast('Indica el destinatario y su dirección para la exportación');
    }
    if ((tipo === 'RECI' || tipo === 'RDON') && $('rt').value) {
      f.recibo = { tipo: $('rt').value, campos: {} };
      $('recf').querySelectorAll('[data-n]').forEach(el => { f.recibo.campos[el.dataset.n] = el.value.trim(); });
      if (f.recibo.tipo !== 'Inmobiliaria' && (!f.recibo.campos.NombreAlumno || !f.recibo.campos.Carne)) return toast('Indica el nombre del alumno y su carné');
    }
    if (tipo === 'RDON') {
      f.personeria = $('pf').value.trim();
      if (!/^\d+$/.test(f.personeria)) return toast('Indica el tipo de personería');
    }
    if (esNota(tipo)) {
      f.origen = { autorizacion: $('oa').value.trim().toUpperCase(), numero: $('on').value.trim(), fecha: $('of').value, motivo: $('om').value.trim() };
      const o = f.origen;
      if (!/^[0-9A-F]{8}(-[0-9A-F]{4}){3}-[0-9A-F]{12}$/.test(o.autorizacion) || !/^\d+$/.test(o.numero) || !o.fecha) return toast('Completa los datos del documento origen (autorización UUID, número y fecha)');
    }
    S.correlativo[k] = (S.correlativo[k] || 0) + 1;
    f.numero = S.correlativo[k];
    S.facturas.push(f); guardar();
    toast('Documento emitido'); location.hash = '#/factura/' + f.uuid;
  };
  pintarFilas();
}

function vistaFactura(id) {
  const f = S.facturas.find(x => x.uuid === id);
  if (!f) { view().innerHTML = '<p class="empty">Documento no encontrado.</p>'; return; }
  const c = calcF(f), e = S.emisor;
  view().innerHTML = `
  <article class="doc">
    <header>
      <div><h2>${esc(e.comercial || e.nombre)}</h2><div>${esc(e.nombre)}</div><div>NIT: ${esc(e.nit)}</div><div>${esc(e.direccion)}</div></div>
      <div style="text-align:right"><strong>${esc(TIPOS[f.tipo]).toUpperCase()}</strong><div>Serie: ${esc(f.serie)}</div><div>Número: ${f.numero}</div><div>${esc(new Date(f.fecha).toLocaleString('es-GT'))}</div>${f.anulada ? '<div class="voided">ANULADA</div>' : ''}</div>
    </header>
    <p><strong>Receptor:</strong> ${esc(f.cliente.nombre)}<br><strong>NIT:</strong> ${esc(f.cliente.nit)}</p>
    <div class="table-wrap"><table><thead><tr><th>Cant.</th><th>Descripción</th><th class="r">P. unit.</th><th class="r">Desc.</th><th class="r">Total</th></tr></thead><tbody>
      ${c.lineas.map(l => `<tr><td>${l.cantidad}</td><td>${esc(l.descripcion)}</td><td class="r">${money(l.precio)}</td><td class="r">${money(l.desc)}</td><td class="r">${money(l.total)}</td></tr>`).join('')}
    </tbody></table></div>
    <div class="totals"><div><span>Subtotal sin IVA</span><span>${money(c.gravable)}</span></div><div><span>IVA 12%</span><span>${money(c.iva)}</span></div><div class="grand"><span>Total</span><span>${money(c.total)}</span></div></div>
    <p class="legal">Sujeto a pagos trimestrales. · Borrador local: sin firma electrónica ni número de autorización de la SAT.<br>UUID interno: ${esc(f.uuid)}</p>
  </article>
  <div class="actions" style="max-width:820px;margin:16px auto">
    <button class="btn primary" id="print">Imprimir / PDF</button>
    ${!['FACT', 'FCAM', 'NCRE', 'NDEB', 'NABN', 'FESP', 'RECI', 'RDON', 'FPEC', 'FCPC'].includes(f.tipo) ? '' : '<button class="btn" id="xml">Descargar XML (Digifact)</button>'}
    <button class="btn" id="json">Descargar JSON (Digifact)</button>
    ${f.anulada ? '' : '<button class="btn danger" id="void">Anular</button>'}
    <a class="btn" href="#/facturas">Volver</a>
  </div>`;
  $('print').onclick = () => window.print();
  if ($('xml')) $('xml').onclick = () => descargar(`${f.tipo}-${f.serie}-${f.numero}.xml`, generarXML(f), 'application/xml');
  $('json').onclick = () => descargar(`${f.tipo}-${f.serie}-${f.numero}.json`, generarJSON(f), 'application/json');
  const v = $('void');
  if (v) v.onclick = () => {
    if (!confirm('¿Anular este documento? Esta acción no se puede deshacer.')) return;
    f.anulada = true; guardar(); toast('Documento anulado'); vistaFactura(id);
  };
}

function vistaClientes() {
  view().innerHTML = `
  <form id="fc" class="card grid two" novalidate>
    <div><label for="cn">NIT</label><input id="cn" required><div class="err" id="cnErr"></div></div>
    <div><label for="cm">Nombre</label><input id="cm" required></div>
    <div style="align-self:end"><button class="btn primary">Guardar cliente</button></div>
  </form>
  <div class="card">${S.clientes.length ? `<table><thead><tr><th>NIT</th><th>Nombre</th><th></th></tr></thead><tbody>${S.clientes.map((c, i) => `<tr><td>${esc(c.nit)}</td><td>${esc(c.nombre)}</td><td><button class="btn sm danger" data-i="${i}">Eliminar</button></td></tr>`).join('')}</tbody></table>` : '<p class="empty">Sin clientes guardados.</p>'}</div>`;
  $('fc').onsubmit = e => {
    e.preventDefault();
    const nit = normNIT($('cn').value), nombre = $('cm').value.trim();
    if (nit === 'CF' || !validarNIT(nit)) { $('cnErr').textContent = 'NIT inválido'; return; }
    if (!nombre) return;
    S.clientes.push({ nit, nombre }); guardar(); vistaClientes(); toast('Cliente guardado');
  };
  view().querySelectorAll('[data-i]').forEach(b => b.onclick = () => { S.clientes.splice(b.dataset.i, 1); guardar(); vistaClientes(); });
}

function vistaConfig() {
  const e = S.emisor;
  view().innerHTML = `
  <form id="fe" class="card grid two" novalidate>
    <div><label for="en">NIT del emisor</label><input id="en" value="${esc(e.nit)}"><div class="err" id="enErr"></div></div>
    <div><label for="eno">Razón social</label><input id="eno" value="${esc(e.nombre)}"></div>
    <div><label for="eco">Nombre comercial</label><input id="eco" value="${esc(e.comercial)}"></div>
    <div><label for="ed">Dirección fiscal</label><input id="ed" value="${esc(e.direccion)}"></div>
    <div><label for="ecp">Código postal</label><input id="ecp" value="${esc(e.codigoPostal)}"></div>
    <div><label for="emu">Municipio</label><input id="emu" value="${esc(e.municipio)}"></div>
    <div><label for="ede">Departamento</label><input id="ede" value="${esc(e.departamento)}"></div>
    <div><label for="es">Serie</label><input id="es" value="${esc(e.serie)}"></div>
    <div><label for="ec">Correo</label><input id="ec" type="email" value="${esc(e.correo)}"></div>
    <div><button class="btn primary">Guardar</button></div>
  </form>
  <div class="card"><h2>Datos</h2><div class="actions" style="margin:0">
    <button class="btn" id="exp">Exportar respaldo (JSON)</button>
    <button class="btn danger" id="rst">Borrar todo</button></div></div>`;
  $('fe').onsubmit = ev => {
    ev.preventDefault();
    const nit = normNIT($('en').value);
    if (nit === 'CF' || !validarNIT(nit)) { $('enErr').textContent = 'NIT inválido'; return; }
    if (!$('eno').value.trim()) return toast('Falta la razón social');
    S.emisor = { nit, nombre: $('eno').value.trim(), comercial: $('eco').value.trim(), direccion: $('ed').value.trim(), codigoPostal: $('ecp').value.trim(), municipio: $('emu').value.trim(), departamento: $('ede').value.trim(), serie: $('es').value.trim() || 'FACE-A', correo: $('ec').value.trim() };
    guardar(); toast('Emisor guardado');
  };
  $('exp').onclick = () => descargar('respaldo-facturador.json', JSON.stringify(S, null, 2), 'application/json');
  $('rst').onclick = () => { if (confirm('Se borrarán todos los datos de este navegador. ¿Continuar?')) { S = vacio(); guardar(); toast('Datos borrados'); location.hash = '#/'; vistaConfig(); } };
}

/* ---------- Router ---------- */
const TITULOS = { '': 'Resumen', nueva: 'Nueva factura', facturas: 'Facturas', clientes: 'Clientes', config: 'Datos del emisor', factura: 'Documento' };
function ruta() {
  const [r = '', id] = location.hash.replace(/^#\/?/, '').split('/');
  $('title').textContent = TITULOS[r] ?? 'Resumen';
  document.querySelectorAll('#nav a').forEach(a => a.classList.toggle('active', a.dataset.route === r || (r === 'factura' && a.dataset.route === 'facturas')));
  $('sidebar').classList.remove('open');
  ({ '': vistaResumen, nueva: vistaNueva, facturas: vistaFacturas, clientes: vistaClientes, config: vistaConfig, factura: () => vistaFactura(id) }[r] || vistaResumen)();
}
$('menuBtn').onclick = () => $('sidebar').classList.toggle('open');
window.addEventListener('hashchange', ruta);
ruta();

if (typeof module !== 'undefined') module.exports = { validarNIT, calcular, generarXML, generarJSON };
