'use strict';

/* ---------- Utilidades ---------- */
const IVA = 0.12;
const TIPOS = { FACT: 'Factura', FCAM: 'Factura cambiaria', NCRE: 'Nota de crédito' };
const money = n => 'Q ' + (Number(n) || 0).toLocaleString('es-GT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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
function calcular(items) {
  let total = 0, descuento = 0;
  const lineas = items.map(it => {
    const bruto = r2(it.cantidad * it.precio);
    const desc = r2(Math.min(it.descuento || 0, bruto));
    const t = r2(bruto - desc);
    total += t; descuento += desc;
    const gravable = r2(t / (1 + IVA));
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
  const e = S.emisor, x = esc, c = calcular(f.items);
  const dir = (d, cp, mun, dep) => `<AddressInfo>
        <Address>${x(d)}</Address><City>${x(cp)}</City><District>${x(mun)}</District><State>${x(dep)}</State><Country>GT</Country>
      </AddressInfo>`;
  let totIva = 0;
  const items = c.lineas.map(l => {
    const grav = Number(r6(l.total / (1 + IVA))), iva = Number(r6(l.total - grav));
    totIva += iva;
    return `
    <Item>
      <Type>${l.servicio ? 'Servicio' : 'Bien'}</Type>
      <Description>${x(l.descripcion)}</Description>
      <Qty>${r6(l.cantidad)}</Qty>
      <UnitOfMeasure>UNI</UnitOfMeasure>
      <Price>${r6(l.precio)}</Price>
      <Discounts><Discount><Amount>${l.desc.toFixed(2)}</Amount></Discount></Discounts>
      <Taxes><Tax>
        <Code>1</Code><Description>IVA</Description>
        <TaxableAmount>${r6(grav)}</TaxableAmount><Amount>${r6(iva)}</Amount>
      </Tax></Taxes>
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
    <Currency>GTQ</Currency>
  </Header>
  <Seller>
    <TaxID>${x(e.nit)}</TaxID>
    <TaxIDAdditionalInfo><Info Name="AfiliacionIVA" Value="GEN"/></TaxIDAdditionalInfo>
    <Name>${x(e.nombre)}</Name>
    <Contact><EmailList><Email>${x(e.correo)}</Email></EmailList></Contact>
    <AdditionlInfo>
      <Info Name="TipoFrase" Data="1" Value="1"/>
      <Info Name="Escenario" Data="1" Value="1"/>
    </AdditionlInfo>
    <BranchInfo>
      <Code>1</Code>
      <Name>${x(e.comercial || e.nombre)}</Name>
      ${dir(e.direccion, e.codigoPostal || '01001', e.municipio || 'Guatemala', e.departamento || 'Guatemala')}
    </BranchInfo>
  </Seller>
  <Buyer>
    <TaxID>${x(f.cliente.nit)}</TaxID>
    <Name>${x(f.cliente.nombre)}</Name>
    ${f.cliente.correo ? `<Contact><EmailList><Email>${x(f.cliente.correo)}</Email></EmailList></Contact>` : ''}
    ${dir(f.cliente.direccion || 'Ciudad', '01001', 'Guatemala', 'Guatemala')}
  </Buyer>
  <Items>${items}
  </Items>
  <Totals>
    <TotalTaxes><TotalTax><Description>IVA</Description><Amount>${r6(totIva)}</Amount></TotalTax></TotalTaxes>
    <GrandTotal><InvoiceTotal>${r6(c.total)}</InvoiceTotal></GrandTotal>
  </Totals>
  <AdditionalDocumentInfo>
    <AdditionalInfo>
      <Code>${x(f.uuid)}</Code>
      <Type>ADENDA</Type>
      <AditionalInfo><Info Name="VALIDAR_REFERENCIA_INTERNA" Value="NO_VALIDAR"/></AditionalInfo>
    </AdditionalInfo>
  </AdditionalDocumentInfo>
</Root>
`;
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
  const v = vigentes().map(f => ({ f, c: calcular(f.items) }));
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
    <td class="r">${money(calcular(f.items).total)}</td>
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
      <div><label for="nit">NIT del receptor</label><input id="nit" value="CF" autocomplete="off"><div class="err" id="nitErr"></div></div>
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
    const c = calcular(items);
    $('tot').innerHTML = `<div><span>Subtotal sin IVA</span><span>${money(c.gravable)}</span></div><div><span>IVA 12%</span><span>${money(c.iva)}</span></div><div class="grand"><span>Total</span><span>${money(c.total)}</span></div>`;
    rows.querySelectorAll('tr').forEach((tr, i) => { const t = tr.querySelector('[data-t]'); if (t) t.textContent = money(c.lineas[i].total); });
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
  $('cli').onchange = e => {
    const c = S.clientes[e.target.value];
    $('nit').value = c ? c.nit : 'CF'; $('nom').value = c ? c.nombre : 'Consumidor Final';
  };
  $('nit').oninput = () => { $('nitErr').textContent = validarNIT($('nit').value) ? '' : 'NIT inválido (revisa el dígito verificador)'; };

  $('form').onsubmit = e => {
    e.preventDefault();
    const nit = normNIT($('nit').value), nombre = $('nom').value.trim();
    if (!validarNIT(nit)) return toast('El NIT del receptor no es válido');
    if (!nombre) return toast('Falta el nombre del receptor');
    if (items.some(i => !i.descripcion.trim() || !(i.cantidad > 0))) return toast('Completa la descripción y cantidad de cada línea');
    const c = calcular(items);
    if (c.total <= 0) return toast('El total debe ser mayor a cero');
    if (nit === 'CF' && c.total > 2500) return toast('Consumidor final: máximo Q2,500 por documento. Indica un NIT.');
    const tipo = $('tipo').value, serie = S.emisor.serie || 'FACE-A';
    const k = serie + '|' + tipo;
    S.correlativo[k] = (S.correlativo[k] || 0) + 1;
    const f = { uuid: uuid(), tipo, serie, numero: S.correlativo[k], fecha: new Date().toISOString(), cliente: { nit, nombre, direccion: '' }, items: items.map(i => ({ ...i, descripcion: i.descripcion.trim() })), anulada: false };
    S.facturas.push(f); guardar();
    toast('Documento emitido'); location.hash = '#/factura/' + f.uuid;
  };
  pintarFilas();
}

function vistaFactura(id) {
  const f = S.facturas.find(x => x.uuid === id);
  if (!f) { view().innerHTML = '<p class="empty">Documento no encontrado.</p>'; return; }
  const c = calcular(f.items), e = S.emisor;
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
    <button class="btn" id="xml">Descargar XML (Digifact)</button>
    ${f.anulada ? '' : '<button class="btn danger" id="void">Anular</button>'}
    <a class="btn" href="#/facturas">Volver</a>
  </div>`;
  $('print').onclick = () => window.print();
  $('xml').onclick = () => descargar(`${f.tipo}-${f.serie}-${f.numero}.xml`, generarXML(f), 'application/xml');
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

if (typeof module !== 'undefined') module.exports = { validarNIT, calcular, generarXML };
