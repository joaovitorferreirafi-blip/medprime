// ==UserScript==
// @name         MedPrime — Medição Prime Clube
// @namespace    realiza.primeclube.medprime
// @version      1.6.7
// @description  Painel de medição de empreiteiros do Prime Clube dentro do plane: lançar, boletim, croqui, conferir com o plane, contrato e base de preços. SÓ LÊ o plane (GET), nunca grava nada nele.
// @match        https://plane.realizaconstrutora.com.br/*
// @match        https://gdol.sgq2.com.br/*
// @run-at       document-idle
// @noframes
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        unsafeWindow
// @grant        GM_xmlhttpRequest
// @connect      reports-api.sgq2.com.br
// @updateURL    https://raw.githubusercontent.com/joaovitorferreirafi-blip/medprime/main/MedPrime.user.js
// @downloadURL  https://raw.githubusercontent.com/joaovitorferreirafi-blip/medprime/main/MedPrime.user.js
// ==/UserScript==
/* eslint-disable */
(function () {
'use strict';
const VERSAO = '1.6.7';
const W = (typeof unsafeWindow !== 'undefined') ? unsafeWindow : window;
// ---------------- no SGQ: o MedPrime só COPIA (lê) a lista de FVS e de áreas da obra que o próprio SGQ guarda no navegador. Não mexe em nada.
if (/(^|\.)sgq2\.com\.br$/.test(location.hostname)) {
  const copiaSGQ = () => {
    try {
      const ls = W.localStorage; const j = k => { try { return JSON.parse(ls.getItem(k) || 'null'); } catch (e) { return null; } };
      const areas = j('obra-area-dropdown'), servs = j('obra-servico-dropdown');
      const m = /[?&]id=(\d+)/.exec(location.search); const ant = (typeof GM_getValue === 'function' && GM_getValue('medprime_sgq', null)) || {};
      const idObra = m && /Obra|obra/.test(location.pathname) ? +m[1] : ant.idObra || 2072;
      if (!ls.getItem('idUsuario') || !Array.isArray(areas) || !Array.isArray(servs) || !servs.length) return;
      const novo = { idObra, idUsuario: +ls.getItem('idUsuario'), empresa: ls.getItem('empresa') || 'REALIZA',
        areas: areas.map(a => [a.idObraAreaChecklist, a.descricao]), servs: servs.map(x => [x.idChecklistServico, String(x.descricao).replace(/\s+/g, ' ').trim()]), em: new Date().toISOString() };
      if (JSON.stringify([novo.idObra, novo.idUsuario, novo.areas, novo.servs]) !== JSON.stringify([ant.idObra, ant.idUsuario, ant.areas, ant.servs])) GM_setValue('medprime_sgq', novo);
    } catch (e) { console.warn('MedPrime SGQ', e); }
  };
  setInterval(copiaSGQ, 5000); copiaSGQ();
  return;
}
const API = 'https://plane.devstroupe.com/backend/';
const KEY = 'medprime_estado_v1';
const PAL = ['#FFC000', '#92D050', '#5B9BD5', '#F47E7E', '#B18CD6', '#FF9933', '#40C2C2', '#FF99CC', '#A6A6A6', '#C6E0B4', '#B4C6E7', '#CC9966'];
const DESC_LABELS = ['DESCONTO - EPI', 'DESCONTO - ADIANTAMENTO', 'DESCONTO - MATERIAL / OUTROS'];

// ------------------------------------------------------------------ armazenamento
const store = {
  get() {
    try { if (typeof GM_getValue === 'function') { const v = GM_getValue(KEY, null); if (v) return typeof v === 'string' ? JSON.parse(v) : v; if (v === '') return null; } } catch (e) {}
    try { const v = W.localStorage.getItem(KEY); if (v) return JSON.parse(v); } catch (e) {}
    return null;
  },
  set(obj) {
    const s = obj == null ? '' : JSON.stringify(obj);
    let ok = false;
    try { if (typeof GM_setValue === 'function') { GM_setValue(KEY, s); ok = true; } } catch (e) {}
    if (!ok) { try { W.localStorage.setItem(KEY, s); } catch (e) { alert('MedPrime: não consegui salvar (' + e.message + '). Faça um backup em arquivo.'); } }
  }
};
function seedState(D) {
  const d = JSON.parse(JSON.stringify(D));
  d.lanc.forEach((l, i) => { l.ord = i; if (!l.per) l.per = l.tipo === 'P' ? D.dataMedicao : perDe(l.data || D.dataMedicao); });
  return { v: 1, dataMed: D.dataMedicao, abas: d.abas, base: d.base, lanc: d.lanc, sup: d.sup, mapa: d.mapa, logos: d.logos, cid: d.construction_id || 50,
    origem: 'planilha ' + (D.origem || 'REV46') + ' (' + D.versao + ')', dadosVersao: D.versao, salvoEm: null, ultimoBackup: null };
}
// junta uma atualização de dados (lista de preços nova etc.) sem apagar o que já foi lançado
function mesclarDados(D) {
  let nb = 0, na = 0;
  const ids = new Set(S.base.map(b => String(b.id)));
  D.base.forEach(b => { if (!ids.has(String(b.id))) { S.base.push(b); nb++; } });
  D.abas.forEach(a => { if (!S.abas.find(x => x.nome === a.nome)) { S.abas.push(a); na++; } });
  Object.keys(D.sup || {}).forEach(k => { if (!S.sup[k]) S.sup[k] = D.sup[k]; });
  S.mapa = D.mapa || S.mapa; S.logos = D.logos || S.logos; S.dadosVersao = D.versao;
  invalida(); _mapa = null; salvar();
  return { nb, na };
}
// ---------------- ajustes publicados pelo Claude (aplicados uma vez, guardados em S.ajustes)
const AJUSTES = [
  { id: '2026-11-05-fj-lucas', desc: 'FJ e Lucas da medição de 10/10/2026 iguais ao plane', ops: [
    { id: 'x26', serv: '3 - Limpeza dos apartamentos', aba: 'FJ CONSTRUÇÕES', fora: 'o plane só pagou a limpeza de 2 × R$ 560 (medição 13634)' },
    { id: 'x50', aba: 'LUCAS SERVIÇOS', servIni: '36 - 21.06.08', set: { qreal: 0.5 }, obsAdd: 'pago 50% (igual ao plane)' },
    { id: 'x52', aba: 'LUCAS SERVIÇOS', servIni: '37 - 17.01.05', set: { qreal: 33.75 } },
    { id: 'x53', aba: 'LUCAS SERVIÇOS', servIni: '38 - 17.01.04', set: { qreal: 4.3 } },
    { id: 'x55', aba: 'LUCAS SERVIÇOS', servIni: '9 - Mão de obra empreitada para proteção', fora: 'não entrou na medição 13570 do plane' }
  ], base: [{ aba: 'LUCAS SERVIÇOS', nAba: 37, qref: 33.75 }, { aba: 'LUCAS SERVIÇOS', nAba: 38, qref: 4.3 }] }
];
let AVISO = '';
function aplicarAjustes() {
  if (!S) return;
  S.ajustes = S.ajustes || [];
  AJUSTES.forEach(a => {
    if (S.ajustes.indexOf(a.id) >= 0) return;
    let n = 0;
    (a.base || []).forEach(bq => {
      const b = S.base.find(x => x.aba === bq.aba && x.nAba === bq.nAba); if (!b) return;
      const lab = rotulo(b);
      S.lanc.forEach(l => { if (l.aba === bq.aba && l.serv === lab && l.qreal == null && a.ops.every(o => o.id !== l.id)) l.qreal = b.qref; }); // congela os outros períodos
      b.qref = bq.qref; n++;
    });
    a.ops.forEach(o => {
      const l = S.lanc.find(x => x.id === o.id); if (!l || l.aba !== o.aba) return;
      if (o.serv && l.serv !== o.serv) return; if (o.servIni && (l.serv || '').indexOf(o.servIni) !== 0) return;
      if (o.fora) { l.fora = true; l.foraMotivo = o.fora; }
      if (o.set) Object.assign(l, o.set);
      if (o.obsAdd && (l.obs || '').indexOf(o.obsAdd) < 0) l.obs = (l.obs ? l.obs + ' · ' : '') + o.obsAdd;
      n++;
    });
    S.ajustes.push(a.id); invalida();
    if (n) AVISO = (AVISO ? AVISO + ' · ' : '') + a.desc;
  });
  salvar();
}
function ehBackup(o) { return o && o.v && Array.isArray(o.lanc) && Array.isArray(o.base); }
function ehDados(o) { return o && !o.v && o.versao && Array.isArray(o.base) && Array.isArray(o.mapa); }
let S = null;
function salvar() { S.salvoEm = new Date().toISOString(); store.set(S); }

// ------------------------------------------------------------------ utilidades
const $ = (sel, root) => (root || R).querySelector(sel);
const $$ = (sel, root) => Array.from((root || R).querySelectorAll(sel));
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nf = (min, max) => new Intl.NumberFormat('pt-BR', { minimumFractionDigits: min, maximumFractionDigits: max });
const NF2 = nf(2, 2), NF4 = nf(2, 4), NF0 = nf(0, 4);
const R$ = v => (v == null || v === '' || isNaN(v)) ? '' : (v < 0 ? '-R$ ' : 'R$ ') + NF2.format(Math.abs(v));
const R4 = v => (v == null || v === '' || isNaN(v)) ? '' : 'R$ ' + NF4.format(v);
const Q = v => (v == null || v === '' || isNaN(v)) ? '' : NF0.format(v);
const pct = v => (v == null || isNaN(v)) ? '' : nf(0, 1).format(v * 100) + '%';
const num = s => { if (s == null) return null; s = String(s).trim(); if (s === '') return null; s = s.replace(/\s/g, ''); if (s.indexOf(',') >= 0) s = s.replace(/\./g, '').replace(',', '.'); const v = parseFloat(s); return isNaN(v) ? null : v; };
const br = iso => iso ? iso.slice(8, 10) + '/' + iso.slice(5, 7) + '/' + iso.slice(0, 4) : '';
const isoD = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
function perDe(iso) { // período = dia 11 do mês anterior até dia 10
  const y = +iso.slice(0, 4), m = +iso.slice(5, 7), d = +iso.slice(8, 10);
  const dt = d <= 10 ? new Date(y, m - 1, 10) : new Date(y, m, 10);
  return isoD(dt);
}
function iniDe(per) { const y = +per.slice(0, 4), m = +per.slice(5, 7); return isoD(new Date(y, m - 2, 11)); }
function addMes(per, k) { const y = +per.slice(0, 4), m = +per.slice(5, 7); return isoD(new Date(y, m - 1 + k, 10)); }
const semac = s => String(s || '').toUpperCase().replace(/[ÁÀÂÃ]/g, 'A').replace(/[ÉÊ]/g, 'E').replace(/Í/g, 'I').replace(/[ÓÔÕ]/g, 'O').replace(/[ÚÜ]/g, 'U').replace(/Ç/g, 'C');
const uid = () => 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const LOGO = i => (S && S.logos && S.logos['image' + i + '.png']) || '';
function nomeAba(n) { const a = S.abas.find(x => x.nome === n); return a ? a.titulo : n; }

// ------------------------------------------------------------------ base / cálculo da linha
function itensDaAba(aba) { return S.base.filter(b => b.aba === aba); }
function rotulo(b) { return (b.nAba != null ? b.nAba + ' - ' : '') + b.serv; }
let _idx = null;
function idxBase() {
  if (_idx) return _idx;
  _idx = {};
  S.base.forEach(b => { _idx[b.aba + '|' + rotulo(b)] = b; });
  return _idx;
}
function invalida() { _idx = null; }
function itemDe(l) { return idxBase()[l.aba + '|' + l.serv] || null; }
function ehDesconto(l) { return /^DESCONTO/i.test(l.serv || ''); }
function calc(l) {
  const it = itemDe(l);
  let un = l.un, preco = l.preco, qapto;
  if (ehDesconto(l)) { un = 'R$'; preco = -1; }
  else if (it && !l.frozen && l.fonte !== 'arquivo') { un = it.un; preco = it.preco; }
  const qref = it && it.qref != null ? it.qref : (l.qapto != null ? l.qapto : 1);
  qapto = l.qreal != null ? l.qreal : (l.fonte === 'arquivo' && l.qapto != null ? l.qapto : (qref == null ? 1 : qref));
  const n = l.n == null ? 1 : l.n;
  const qt = qapto * n;
  const valor = (preco == null ? 0 : preco) * qt;
  return { it, un: un || '', preco, qapto, n, qt, valor };
}
function linhas(aba, per, tipo) {
  return S.lanc.filter(l => l.aba === aba && l.per === per && !l.fora && (l.tipo || 'E') === (tipo || 'E'))
    .sort((a, b) => (a.ord || 0) - (b.ord || 0));
}
function totais(aba, per) {
  const ex = linhas(aba, per, 'E').map(calc), pv = linhas(aba, per, 'P').map(calc);
  const bruto = ex.filter(c => c.valor > 0).reduce((s, c) => s + c.valor, 0);
  const desc = -ex.filter(c => c.valor < 0).reduce((s, c) => s + c.valor, 0);
  const prev = pv.filter(c => c.valor > 0).reduce((s, c) => s + c.valor, 0);
  const a = S.abas.find(x => x.nome === aba) || { ret: 0.05 };
  const ret = bruto * (a.ret || 0);
  return { bruto, desc, prev, ret, liq: bruto - ret - desc, nEx: ex.length, nPv: pv.length };
}
function periodosDaAba(aba) {
  return Array.from(new Set(S.lanc.filter(l => l.aba === aba && (l.tipo || 'E') === 'E').map(l => l.per))).sort();
}

// ------------------------------------------------------------------ locais (croqui) — mesma lógica da macro CroquiPrime v11
function blocos(t) {
  const r = []; const re = /\b(BLOCOS?|BL\.?|TORRES?)\s*[:\-]?\s*((?:\d{1,2}\s*(?:,|;|\/|-|E)\s*)*\d{1,2})(?!\d)/gi; let m;
  while ((m = re.exec(t))) {
    m[2].toUpperCase().replace(/[;\/\-E]/g, ',').split(',').forEach(p => { p = p.trim(); if (/^\d+$/.test(p)) { const n = +p; if (n >= 1 && n <= 15 && r.indexOf(String(n)) < 0) r.push(String(n)); } });
  }
  return r;
}
function aptos(t) {
  const out = []; const re = /\b([1-4])0([1-8])\s*(?:AO|ATE|A|-)\s*([1-4])0([1-8])\b/gi; let m;
  while ((m = re.exec(t))) {
    const f1 = +m[1], u1 = +m[2], f2 = +m[3], u2 = +m[4];
    for (let f = f1; f <= f2; f++) for (let u = (f === f1 ? u1 : 1); u <= (f === f2 ? u2 : 8); u++) { const k = f + '0' + u; if (out.indexOf(k) < 0) out.push(k); }
  }
  t = t.replace(/\b([1-4])0([1-8])\s*(?:AO|ATE|A|-)\s*([1-4])0([1-8])\b/gi, ' ');
  const re2 = /\b[1-4]0[1-8]\b/g;
  while ((m = re2.exec(t))) if (out.indexOf(m[0]) < 0) out.push(m[0]);
  return out;
}
function halls(s, ap) {
  s = String(s).toUpperCase();
  if (s.indexOf('HALL') < 0) return [];
  let m = /HALL\s*[:\-]?\s*([1-4]\s*[AB](?:\s*(?:,|E)\s*[1-4]\s*[AB])*)/.exec(s);
  if (m) { const out = []; m[1].replace(/E/g, ',').split(',').forEach(p => { p = p.replace(/\s/g, ''); if (p.length === 2) { const k = p[1] + '|' + p[0]; if (out.indexOf(k) < 0) out.push(k); } }); return out; }
  m = /HALL\s*[:\-]?\s*(?:LADO\s+)?([AB])(?![A-Z0-9])/.exec(s);
  if (m) return [1, 2, 3, 4].map(f => m[1] + '|' + f);
  if (ap && ap.length && s.indexOf('TODOS') < 0) { const out = []; ap.forEach(a => { const k = ((+a % 100) <= 4 ? 'A' : 'B') + '|' + Math.floor(+a / 100); if (out.indexOf(k) < 0) out.push(k); }); return out; }
  const out = []; for (let f = 1; f <= 4; f++) { out.push('A|' + f); out.push('B|' + f); } return out;
}
function casa(tudo, lista) {
  return String(lista || '').split(';').some(k => { k = semac(k.trim()); return k && new RegExp('\\b' + k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).test(tudo); });
}
function segmentos(loc) { return String(loc || '').replace(/\n/g, ' ').split(' ; ').map(x => x.trim()).filter(Boolean); }
function qtdAptosDoLocal(loc) {
  let n = 0;
  segmentos(loc).forEach(sg => {
    const s = semac(sg); const bl = blocos(s);
    if (!bl.length) return;
    const b = +bl[0]; let na = 0, nh = 0, ap = [];
    if (s.indexOf('TODOS') >= 0) na = b === 15 ? 16 : 32;
    else { ap = aptos(s); ap.forEach(a => { if (b !== 15 || (+a % 100) <= 4) na++; }); }
    const hl = s.indexOf('TODOS') >= 0 ? halls(s) : halls(s, ap);
    hl.forEach(h => { if (b !== 15 || h[0] === 'A') nh++; });
    n += na + (na > 0 ? nh * 0.5 : nh);
  });
  return n;
}
let _mapa = null;
function mapaObj() { if (!_mapa) { _mapa = {}; ((S && S.mapa) || []).forEach(m => { _mapa[m[0]] = { orig: m[1], kw: m[2] }; }); } return _mapa; }
function chavesDaLinha(loc, obs, serv) {
  const out = new Set();
  const viaLinha = txt => {
    const re = /\b(BLOCOS?|BL\.?|TORRES?)\b/gi; const ms = []; let m;
    while ((m = re.exec(txt))) ms.push(m.index);
    if (!ms.length) return false;
    const pre = txt.slice(0, ms[0]); const orf = aptos(pre); let ach = false;
    ms.forEach((st, k) => {
      let seg = txt.slice(st, k < ms.length - 1 ? ms[k + 1] : txt.length);
      if (k === ms.length - 1) seg += ' ' + pre;
      const pos = seg.indexOf('EXCETO'); const inc = pos >= 0 ? seg.slice(0, pos) : seg; const exc = pos >= 0 ? seg.slice(pos) : '';
      const bl = blocos(seg); let ap = aptos(inc); if (!ap.length && orf.length) ap = orf;
      const ex = aptos(exc); const hl = halls(inc, ap);
      bl.forEach(b => {
        if ((!ap.length && !hl.length) || seg.indexOf('TODOS') >= 0) { for (let f = 1; f <= 4; f++) for (let u = 1; u <= 8; u++) { const a = f + '0' + u; if (ex.indexOf(a) < 0) out.add('B|' + b + '|' + a); } }
        else ap.forEach(a => { if (ex.indexOf(a) < 0) out.add('B|' + b + '|' + a); });
        hl.forEach(h => out.add('H|' + b + '|' + h));
        ach = true;
      });
    });
    return ach;
  };
  const viaAreas = tudo => { let ach = false; Object.keys(mapaObj()).forEach(k => { if (k.startsWith('A|') && casa(tudo, mapaObj()[k].kw)) { out.add(k); ach = true; } }); return ach; };
  let t = semac(loc); let ach = viaLinha(t); ach = viaAreas(t) || ach;
  if (!ach) { const t2 = semac(loc + ' ' + (obs || '')); ach = viaLinha(t2); if (!ach) ach = viaAreas(semac(serv) + ' ' + t2); }
  return { chaves: Array.from(out).filter(k => mapaObj()[k]), achou: ach };
}

// ------------------------------------------------------------------ plane (só leitura)
let PL = { ok: false, carregando: false, erro: null, em: null, os: [], itens: {}, med: [], sups: {} };
async function apiGet(path) {
  const tok = W.localStorage.getItem('token');
  if (!tok) throw new Error('faça login no plane');
  const r = await W.fetch(API + path, { method: 'GET', headers: { Authorization: 'Bearer ' + tok } });
  if (!r.ok) throw new Error('erro ' + r.status + ' ao ler o plane');
  return r.json();
}
async function carregarPlane() {
  if (PL.carregando) return;
  PL.carregando = true; PL.erro = null; status();
  try {
    const so = await apiGet('serviceOrder/list?limit=all&construction_id=' + (S.cid || 50));
    const oss = so.items || [];
    const me = oss.length ? await apiGet('measurement/list?limit=all&service_order_ids=' + oss.map(o => o.service_order_id).join(',')) : { items: [] };
    const itens = {}, sups = {};
    oss.forEach(o => {
      if (o.supplier) sups[o.supplier_id] = o.supplier.company;
      (o.item_service_order || []).forEach(i => {
        itens[i.item_service_order_id] = { isoi: i.item_service_order_id, so: o.service_order_id, sup: o.supplier_id, ativo: o.is_active,
          item: i.item || (i.input && i.input.item) || '', desc: i.description || '', preco: +i.price, qtd: +i.quantity, medido: 0 };
      });
    });
    const med = (me.items || []).map(m => {
      if (m.supplier) sups[m.supplier_id] = m.supplier.company;
      const it = (m.input_measurements || []).map(i => ({ isoi: i.input_id, q: +i.quantity, p: +i.price, desc: i.description || i.item || '', un: (i.input && i.input.input && i.input.input.unity) || '' }));
      it.forEach(i => { if (itens[i.isoi]) { itens[i.isoi].medido += i.q; if (i.un && !itens[i.isoi].un) itens[i.isoi].un = i.un; } });
      const bruto = it.reduce((s, i) => s + i.q * i.p, 0);
      return { id: m.measurement_id, so: m.service_order_id, sup: m.supplier_id, ini: (m.start || '').slice(0, 10), fim: (m.end || '').slice(0, 10),
        tit: m.title || '', st: m.status || '', bruto, liq: +m.inputs_total_value || 0, ded: +m.deductions_total_value || 0,
        ret: m.supplier && m.supplier.type_supplier ? +m.supplier.type_supplier.discounts : null, it };
    });
    PL = { ok: true, carregando: false, erro: null, em: new Date(), os: oss.map(o => ({ so: o.service_order_id, sup: o.supplier_id, desc: o.description, ativo: o.is_active })), itens, med, sups };
  } catch (e) {
    PL.carregando = false; PL.erro = e.message;
  }
  if (PL.ok && S) { try { sincronizarBase(); } catch (e) { console.error('MedPrime sync', e); } }
  status(); render();
}
const abaDoSup = sup => S.sup[String(sup)] || '';

// ---------------- base de preços sempre igual ao plane (automático a cada leitura do plane)
let NOVIDADES = null;
const tok = s => new Set(semac(s).replace(/[^A-Z0-9 ]/g, ' ').split(/\s+/).filter(w => w.length > 2));
function simil(a, b) { const A = tok(a), B = tok(b); if (!A.size || !B.size) return 0; let n = 0; A.forEach(w => { if (B.has(w)) n++; }); return n / (A.size + B.size - n); }
function unDoTexto(t) {
  const s = semac(t);
  if (/\bM(²|2)\b|M2\b|METRO QUADRADO/.test(String(t).toUpperCase()) || /\bM2\b/.test(s)) return 'M²';
  if (/\bM(³|3)\b|\bM3\b/.test(String(t).toUpperCase())) return 'M³';
  if (/\bML\b|METRO LINEAR/.test(s)) return 'M';
  if (/\bDIARIA/.test(s)) return 'DIA'; if (/\bMES\b|MENSAL/.test(s)) return 'MÊS'; if (/\bVERBA\b|\bVB\b/.test(s)) return 'VB';
  return '';
}
// a base pode ter o preço "adotado" (ex.: diária R$ 3.000) e a OS outro preço com quantidade fracionada (R$ 60.000 × 0,05):
// é o mesmo valor. Compara preço × quantidade de referência da base com preço × quantidade da OS.
function equivalente(b, pi) {
  if (!b || !pi || b.preco == null || !isFinite(pi.preco) || !isFinite(pi.qtd)) return false;
  const vb = b.preco * (b.qref ? b.qref : 1), vp = pi.preco * pi.qtd;
  return Math.abs(vb - vp) <= Math.max(0.02, 0.005 * Math.max(Math.abs(vb), Math.abs(vp)));
}
function precoIgual(b, pi) { return b && pi && b.preco != null && Math.abs(pi.preco - b.preco) <= 0.00005; }
function perAtual() { return perDe(isoD(new Date())); }
function congelarAntigas(b) {
  const lab = rotulo(b), pa = perAtual(); let n = 0;
  S.lanc.forEach(l => {
    if (l.aba !== b.aba || l.serv !== lab || l.frozen || l.fonte === 'arquivo' || !(l.per < pa)) return;
    l.frozen = true; l.preco = b.preco; l.un = b.un; if (l.qreal == null) l.qreal = b.qref == null ? 1 : b.qref; n++;
  });
  return n;
}
function aplicarPreco(b, novo, agora, nov) {
  const de = b.preco; congelarAntigas(b); b.preco = novo; b.precoPlaneEm = agora || new Date().toISOString();
  const e = { em: b.precoPlaneEm, tipo: 'preco', aba: b.aba, serv: b.serv, de, para: novo, isoi: b.isoi }; S.logBase = S.logBase || []; S.logBase.push(e); if (nov) nov.precos.push(e);
  invalida();
}
function sincronizarBase() {
  S.logBase = S.logBase || []; S.ocultosPlane = S.ocultosPlane || [];
  const agora = new Date().toISOString(); const nov = { id: Date.now(), novos: [], precos: [], ligados: [], conferir: [], semAba: {} };
  const ligados = new Set(S.base.filter(b => b.isoi).map(b => Number(b.isoi)));
  // 1) preços: quando o preço MUDA no plane, a base acompanha sozinha.
  //    Diferenças antigas (de antes do MedPrime ler o plane pela 1ª vez) ficam para você confirmar com um clique.
  S.planePreco = S.planePreco || {};
  const vistoAntes = Object.assign({}, S.planePreco);
  S.base.forEach(b => {
    const pi = b.isoi ? PL.itens[b.isoi] : null; if (!pi || !isFinite(pi.preco)) return;
    const visto = vistoAntes[pi.isoi];
    const mudouNoPlane = visto != null && Math.abs(pi.preco - visto) > 0.00005;
    if (mudouNoPlane && b.vinc !== 'conferir') {
      // mantém a proporção quando a base usa preço adotado (equivalente) — senão vira o preço do plane
      const novo = precoIgual(b, { preco: visto }) ? pi.preco : Math.round(b.preco * pi.preco / visto * 10000) / 10000;
      aplicarPreco(b, novo, agora, nov); return;
    }
    if (precoIgual(b, pi) || equivalente(b, pi)) return;
    nov.conferir.push({ id: b.id, aba: b.aba, serv: b.serv, de: b.preco, para: pi.preco, isoi: b.isoi, qb: b.qref || 1, qp: pi.qtd });
  });
  Object.values(PL.itens).forEach(pi => { S.planePreco[pi.isoi] = pi.preco; });
  // 2) itens das OS ativas que ainda não estão na base.
  //    Antes de criar, tenta ligar a um item da base sem vínculo do mesmo empreiteiro com o MESMO VALOR
  //    (preço igual, ou preço × quantidade igual) e nome parecido. Itens criados antes pelo plane e ainda
  //    não usados entram de novo nessa conferência (limpa duplicados da versão 1.3.0).
  const usado = b => S.lanc.some(l => l.aba === b.aba && l.serv === rotulo(b));
  const reav = S.base.filter(b => b.doPlane && !usado(b));
  const reavPorIsoi = {}; reav.forEach(b => { reavPorIsoi[b.isoi] = b; });
  S.base = S.base.filter(b => reav.indexOf(b) < 0);
  const lig2 = new Set(S.base.filter(b => b.isoi && PL.itens[b.isoi]).map(b => Number(b.isoi)));
  const pend = Object.values(PL.itens).filter(pi => pi.ativo && !lig2.has(Number(pi.isoi)) && S.ocultosPlane.indexOf(pi.isoi) < 0);
  const pares = [];
  pend.forEach(pi => {
    const aba = abaDoSup(pi.sup); if (!aba) return;
    S.base.forEach(b => {
      if (b.aba !== aba || (b.isoi && PL.itens[b.isoi])) return;
      if (!(precoIgual(b, pi) || equivalente(b, pi))) return;
      const sc = Math.max(simil(b.serv, pi.item), simil(b.serv, pi.desc), simil(b.serv, pi.item + ' ' + pi.desc));
      if (sc >= 0.3) pares.push({ pi, b, sc });
    });
  });
  pares.sort((x, y) => y.sc - x.sc);
  const usadoB = new Set(), usadoP = new Set();
  pares.forEach(({ pi, b }) => {
    if (usadoB.has(b) || usadoP.has(pi.isoi)) return;
    usadoB.add(b); usadoP.add(pi.isoi);
    b.isoi = pi.isoi; b.vinc = 'auto-plane'; lig2.add(Number(pi.isoi));
    const e = { em: agora, tipo: 'ligado', aba: b.aba, serv: b.serv, isoi: pi.isoi }; nov.ligados.push(e); S.logBase.push(e);
  });
  pend.forEach(pi => {
    if (lig2.has(Number(pi.isoi))) return;
    const aba = abaDoSup(pi.sup);
    if (!aba) { const nm = PL.sups[pi.sup] || ('fornecedor ' + pi.sup); nov.semAba[pi.sup] = nov.semAba[pi.sup] || { nome: nm, n: 0 }; nov.semAba[pi.sup].n++; return; }
    if (reavPorIsoi[pi.isoi]) { S.base.push(reavPorIsoi[pi.isoi]); lig2.add(Number(pi.isoi)); return; }
    const nome = pi.item || pi.desc;
    let serv = nome;
    if (pi.desc && semac(pi.desc) !== semac(nome)) serv += ' — ' + pi.desc.replace(/\s+/g, ' ').trim().slice(0, 160);
    const nAba = Math.max(0, ...S.base.filter(b => b.aba === aba).map(b => +b.nAba || 0), ...reav.filter(b => b.aba === aba).map(b => +b.nAba || 0)) + 1;
    const id = Math.max(0, ...S.base.map(b => +b.id || 0), ...reav.map(b => +b.id || 0)) + 1;
    const a = S.abas.find(x => x.nome === aba) || {};
    const b = { id, n: Math.max(0, ...S.base.map(x => +x.n || 0)) + 1, disc: a.disc || '', emp: aba, etapa: 'OS ' + pi.so, serv, un: pi.un || unDoTexto(nome + ' ' + pi.desc) || 'UN',
      preco: pi.preco, qref: null, sit: 'Ativo', aba, isoi: pi.isoi, vinc: 'plane', nAba, doPlane: agora };
    S.base.push(b); lig2.add(Number(pi.isoi));
    const e = { em: agora, tipo: 'novo', aba, serv, para: pi.preco, isoi: pi.isoi }; nov.novos.push(e); S.logBase.push(e);
  });
  // itens criados pelo plane que agora foram ligados a um item antigo saem da base (duplicados)
  const tirados = reav.filter(b => S.base.indexOf(b) < 0).length;
  if (tirados) nov.duplicados = tirados;
  if (S.logBase.length > 600) S.logBase = S.logBase.slice(-600);
  invalida();
  if (nov.novos.length || nov.precos.length || nov.ligados.length || nov.duplicados) salvar();
  NOVIDADES = nov;
}
let LEIT_FECHADA = null;
// aviso de CADA leitura do plane: diz o que mudou nesta atualização (ou que não mudou nada)
function boxLeitura(cheio) {
  const n = NOVIDADES; if (!n || LEIT_FECHADA === n.id) return '';
  const hora = PL.em ? PL.em.toLocaleTimeString('pt-BR').slice(0, 5) : '';
  const x = `<button class="btn x" data-fechar="leit" title="fechar" style="position:absolute;right:6px;top:2px;font-size:16px;color:#7F6000">✕</button>`;
  if (!n.novos.length && !n.precos.length && !n.ligados.length)
    return `<div class="box" style="background:#E2EFDA;border-color:#A9D08E;position:relative">${x}✔ <b>Plane atualizado às ${hora}</b> — nenhum serviço novo e nenhum preço mudou nas OS desde a última leitura.</div>`;
  const porAba = {}; n.novos.forEach(e => (porAba[e.aba] = porAba[e.aba] || []).push(e));
  const abas = Object.keys(porAba).sort((a, b) => a.localeCompare(b, 'pt-BR'));
  const novos = abas.map(a => `<div style="margin:3px 0 0 10px">➕ <b>${esc(a)}</b> (${porAba[a].length}): ${porAba[a].slice(0, cheio ? 999 : 6).map(e => `${esc(e.serv)} <span class="muted">${R4(e.para)}</span>${cheio ? ` <button class="btn s w" data-ocultar="${e.isoi}" title="tirar da base (não volta mais)">não usar</button>` : ''}`).join(cheio ? '<br>' : '; ')}${!cheio && porAba[a].length > 6 ? ` <span class="muted">… e mais ${porAba[a].length - 6}</span>` : ''}</div>`).join('');
  const precos = n.precos.slice(0, cheio ? 999 : 10).map(e => `<div style="margin:3px 0 0 10px">💲 <b>${esc(e.aba)}</b>: ${esc(e.serv)} — ${R4(e.de)} → <b>${R4(e.para)}</b></div>`).join('') + (!cheio && n.precos.length > 10 ? `<div style="margin-left:10px" class="muted">… e mais ${n.precos.length - 10}</div>` : '');
  const lig = n.ligados.length ? `<div style="margin:3px 0 0 10px">🔗 ${n.ligados.length} item(ns) da base ligado(s) automaticamente à OS${cheio ? ': ' + n.ligados.map(e => `${esc(e.aba)} — ${esc(e.serv)}`).join('; ') : ''}</div>` : '';
  return `<div class="box" style="background:#FFF2CC;border-color:#F4B183;position:relative">${x}<b style="font-size:14px">🔔 Plane atualizado às ${hora} — ${n.novos.length ? `${n.novos.length} serviço(s) novo(s) em ${abas.length} empreiteiro(s)` : 'sem serviço novo'}${n.precos.length ? ` · ${n.precos.length} preço(s) mudado(s)` : ''}</b>${n.duplicados ? ` <span class="muted">(${n.duplicados} duplicado(s) removido(s))</span>` : ''}
    <div style="max-height:${cheio ? 320 : 220}px;overflow:auto">${novos}${precos}${lig}</div>
    ${n.novos.length ? `<div class="muted" style="margin-top:4px">Os serviços novos já entraram na Base de preços e já aparecem para lançar.${cheio ? '' : ' <span class="link" data-goto="base">ver na Base de preços</span>'}</div>` : ''}</div>`;
}
// pendências que continuam até você resolver: valores diferentes do plane e fornecedores sem empreiteiro
function boxNovidades(curto) {
  const n = NOVIDADES; if (!n) return '';
  const sa = Object.keys(n.semAba);
  if (!n.conferir.length && !sa.length) return '';
  const sig = 'p|' + n.conferir.map(e => e.id).join(',') + '|' + sa.join(',');
  if (S.avisoFechado === sig) return '';
  return `<div class="box" style="background:#EAF3FB;border-color:#9DC3E6;position:relative"><button class="btn x" data-fechar="${sig}" title="fechar este aviso" style="position:absolute;right:6px;top:2px;color:#1F3864;font-size:16px">✕</button><b>📋 Pendências da base de preços</b>${n.conferir.length ? ` · <span style="color:#9C5700">${n.conferir.length} valor(es) da base diferente(s) do plane para você confirmar</span>` : ''}
    ${curto && n.conferir.length ? ' — <span class="link" data-goto="base">ver na Base de preços</span>' : ''}
    ${sa.length ? `<br><span style="color:#9C0006">Fornecedor(es) com OS no plane e sem empreiteiro aqui: ${sa.map(k => `<b>${esc(n.semAba[k].nome)}</b> (${n.semAba[k].n} itens) <button class="btn s w" data-criaemp="${k}">criar empreiteiro</button>`).join(' ')}</span>` : ''}
    ${!curto && n.conferir.length ? `<div style="margin-top:8px"><b style="color:#9C5700">⚠ Valor da base diferente do plane (preço × quantidade não bate) — pode ser preço diferente ou o item ligado à OS errada:</b> <button class="btn s" data-act="usartodos">usar o preço do plane em todos</button>
      <div style="max-height:260px;overflow:auto;margin-top:4px">${n.conferir.map(e => `<div style="padding:3px 0;border-bottom:1px dotted #c9d3e3">${esc(e.aba)}: <b>${esc(e.serv.slice(0, 90))}</b> <span class="muted">(item OS ${e.isoi})</span><br>
        base ${R4(e.de)} × ${Q(e.qb)} = <b>${R$(e.de * e.qb)}</b> · plane ${R4(e.para)} × ${Q(e.qp)} = <b>${R$(e.para * e.qp)}</b> <button class="btn s w" data-usarpreco="${e.id}">usar o preço do plane</button></div>`).join('')}</div></div>` : ''}
  </div>`;
}
// medições do plane do empreiteiro no período; tipo 'P' = as que têm PREVISTA no título
function medPlane(aba, per, tipo) { return PL.med.filter(m => abaDoSup(m.sup) === aba && m.fim === per && (/PREVIST/i.test(m.tit) ? 'P' : 'E') === (tipo || 'E')); }
function stPt(s) { s = String(s || '').toUpperCase(); if (s === 'APPROVED') return 'APROVADA'; if (s.startsWith('WAI')) return 'AGUARDANDO ' + s.split('_').slice(1).join(' '); return s; }

// ------------------------------------------------------------------ interface
let host, R, VIEW = 'resumo', ABA = null, MODO = 'E', SVC = 'TODOS', BUSCA = '', FILTRO_ABA = '';
const CSS = `
:host{all:initial}
*{box-sizing:border-box;font-family:Arial,Helvetica,sans-serif}
.ov{position:fixed;inset:0;z-index:2147483000;background:#eef1f6;display:flex;flex-direction:column;color:#1b1b1b;font-size:13px}
.top{background:#1F3864;color:#fff;display:flex;align-items:center;gap:14px;padding:8px 14px;min-height:52px}
.top img{height:30px;background:#fff;border-radius:4px;padding:2px 6px}
.brand{font-weight:700;font-size:17px;letter-spacing:.3px}.brand small{display:block;font-weight:400;font-size:11px;opacity:.8}
.sp{flex:1}
.top select,.top button,.top input{font-size:12px}
.per{display:flex;align-items:center;gap:6px;background:rgba(255,255,255,.1);padding:4px 8px;border-radius:6px}
.per b{font-size:13px}
.btn{border:0;border-radius:6px;padding:7px 12px;font-weight:700;cursor:pointer;background:#2E75B6;color:#fff;font-size:12px;white-space:nowrap}
.btn:hover{filter:brightness(1.08)}.btn.g{background:#548235}.btn.r{background:#C00000}.btn.w{background:#fff;color:#1F3864;border:1px solid #c9d3e3}.btn.s{padding:4px 8px;font-size:11px}
.btn.x{background:transparent;color:#fff;font-size:20px;padding:2px 8px}
.btn:disabled{opacity:.5;cursor:default}
.main{flex:1;display:flex;min-height:0}
.nav{width:178px;background:#fff;border-right:1px solid #d5dbe6;padding:10px 8px;display:flex;flex-direction:column;gap:3px}
.nav a{display:block;padding:9px 10px;border-radius:6px;color:#1F3864;text-decoration:none;font-weight:700;cursor:pointer;font-size:13px}
.nav a:hover{background:#eef3fb}.nav a.on{background:#1F3864;color:#fff}
.nav .st{margin-top:auto;font-size:11px;color:#555;padding:8px;border-top:1px solid #e3e7ee;line-height:1.5}
.cnt{flex:1;overflow:auto;padding:16px 18px}
h2{margin:0 0 10px;font-size:18px;color:#1F3864}
.bar{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin-bottom:12px;background:#fff;padding:10px 12px;border-radius:8px;border:1px solid #dde3ec}
.bar label{font-weight:700;color:#1F3864;font-size:12px}
.bar select,.bar input{padding:6px 8px;border:1px solid #c5cedd;border-radius:5px;font-size:13px}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px;margin-bottom:12px}
.card{background:#fff;border:1px solid #dde3ec;border-radius:8px;padding:10px 12px}
.card .l{font-size:11px;color:#5a6478;font-weight:700;text-transform:uppercase}.card .v{font-size:18px;font-weight:700;color:#1F3864;margin-top:3px}
.card.gr .v{color:#2E6B1F}.card.rd .v{color:#C00000}
table.t{border-collapse:collapse;width:100%;background:#fff;font-size:12px}
.t th{background:#2E75B6;color:#fff;padding:6px 6px;font-size:11px;position:sticky;top:0;z-index:1;text-align:center}
.t td{border:1px solid #e1e6ee;padding:4px 6px;vertical-align:middle}
.t tr:hover td{background:#f6f9fd}
.t td.n{text-align:right;white-space:nowrap}.t td.c{text-align:center}
.t tfoot td{font-weight:700;background:#DDEBF7}
.t textarea{width:100%;border:1px solid transparent;background:#FFF9E6;padding:3px 4px;font-size:12px;border-radius:3px;resize:vertical;font-family:Arial}
.t input,.t select{width:100%;border:1px solid transparent;background:#FFF9E6;padding:4px;font-size:12px;border-radius:3px}
.t input:focus{border-color:#2E75B6;background:#fff;outline:0}
.t input.num{text-align:right}
.tag{display:inline-block;padding:2px 7px;border-radius:10px;font-size:11px;font-weight:700;white-space:nowrap}
.ok{background:#E2EFDA;color:#006100}.warn{background:#FFEB9C;color:#9C5700}.bad{background:#FFC7CE;color:#9C0006}.info{background:#DDEBF7;color:#1F3864}.mut{background:#eee;color:#666}
.sec{font-weight:700;color:#fff;background:#548235;padding:6px 10px;border-radius:6px 6px 0 0;margin-top:14px}
.box{background:#fff;border:1px solid #dde3ec;border-radius:8px;padding:10px 12px;margin-bottom:12px}
.muted{color:#6b7385;font-size:11px}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.link{color:#2E75B6;cursor:pointer;text-decoration:underline}
.modal{position:fixed;inset:0;background:rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center;z-index:2147483001}
.mbox{background:#fff;border-radius:10px;padding:16px;min-width:560px;max-width:92vw;max-height:90vh;overflow:auto;box-shadow:0 10px 40px rgba(0,0,0,.3)}
.pick{border-collapse:collapse;margin:8px 0}.pick td{border:1px solid #c5cedd;width:46px;height:30px;text-align:center;cursor:pointer;font-size:12px;user-select:none}
.pick td.on{background:#FFC000;font-weight:700}.pick td.h{background:#f1f1f1}.pick td.h.on{background:#FFC000}.pick th{font-size:11px;color:#1F3864;padding:2px 4px}
.areas{display:grid;grid-template-columns:repeat(4,1fr);gap:6px}.areas div{border:1px solid #c5cedd;border-radius:6px;padding:8px;cursor:pointer;text-align:center;font-size:12px}.areas div.on{background:#FFC000;font-weight:700}
.prev{background:#fff;border:1px solid #cfd6e2;box-shadow:0 2px 10px rgba(0,0,0,.06);margin:0 auto;padding:0}
.fab{position:fixed;right:18px;bottom:18px;z-index:2147482999;background:#1F3864;color:#fff;border:0;border-radius:24px;padding:11px 18px;font:700 13px Arial;cursor:pointer;box-shadow:0 3px 12px rgba(0,0,0,.35)}
`;

function abrir() {
  if (host) { host.style.display = ''; render(); return; }
  host = document.createElement('div'); host.id = 'medprime-host';
  document.body.appendChild(host);
  R = host.attachShadow({ mode: 'open' });
  R.innerHTML = `<style>${CSS}</style><div class="ov"><div class="top">
    <img id="lgTop" alt="" style="display:none">
    <div class="brand">MedPrime<small>Medição de empreiteiros · Prime Clube · Realiza Construtora</small></div>
    <div class="per">Medição de <select id="selPer"></select></div>
    <div class="sp"></div>
    <span id="plst" style="font-size:11px;opacity:.9"></span>
    <button class="btn w s" id="btPlane" title="Lê de novo as OS e as medições do plane (só leitura). Use depois de lançar ou aprovar algo lá.">↻ Atualizar plane</button>
    <button class="btn w s" id="btBkp">💾 Backup</button>
    <button class="btn x" id="btX" title="Fechar (volta ao plane)">✕</button>
  </div><div class="main"><div class="nav" id="nav"></div><div class="cnt" id="cnt"></div></div></div>`;
  $('#btX').onclick = () => { host.style.display = 'none'; };
  $('#btPlane').onclick = () => carregarPlane();
  $('#btBkp').onclick = () => { VIEW = 'config'; render(); };
  $('#selPer').onchange = e => { S.dataMed = e.target.value; salvar(); render(); };
  R.addEventListener('click', onClick);
  R.addEventListener('change', onChange);
  R.addEventListener('toggle', e => { if (e.target && e.target.dataset && e.target.dataset.fvsbox) FVS_ABERTO = e.target.open; }, true);
  R.addEventListener('input', onInput);
  render();
  if (S && !PL.ok) carregarPlane();
}
function vInicio() {
  return `<div class="box" style="max-width:760px;margin:30px auto;padding:24px"><h2>Bem-vindo ao MedPrime ${VERSAO}</h2>
   <p>Primeira vez neste Chrome: abra o arquivo de dados que o Claude deixou na pasta <b>PLANILHA PRIME CLUBE</b> (<b>MedPrime_dados_REV46.json</b>) — ele traz a base de preços, os empreiteiros e as medições da planilha.</p>
   <p>Se você já usa o MedPrime em outro computador, abra o seu <b>backup</b> (MedPrime_backup_....json).</p>
   <p style="margin-top:18px"><button class="btn g" data-act="rest">📂 Abrir arquivo de dados ou backup…</button></p>
   <p class="muted">Os dados ficam guardados só neste Chrome. O código do MedPrime se atualiza sozinho pelo Tampermonkey e não mexe nos seus dados.</p></div>`;
}
const VIEWS = [['resumo', '📊 Resumo'], ['lancar', '✏️ Lançar medição'], ['boletim', '📄 Boletim'], ['croqui', '🗺️ Croqui'], ['conferir', '✔ Conferir / Lançar no plane'], ['contrato', '📑 Contrato (OS)'], ['base', '💲 Base de preços'], ['plane', '🔎 Plane (OS e medições)'], ['config', '⚙️ Backup e ajustes']];
function status() {
  if (!R) return;
  const el = $('#plst'); if (!el) return;
  el.textContent = PL.carregando ? 'lendo o plane…' : PL.erro ? '⚠ plane: ' + PL.erro : PL.ok ? 'plane lido às ' + PL.em.toLocaleTimeString('pt-BR').slice(0, 5) : '';
}
function render() {
  if (!R) return;
  if (!$('#fileRest')) { const f = document.createElement('input'); f.type = 'file'; f.id = 'fileRest'; f.accept = '.json'; f.style.display = 'none'; R.appendChild(f);
    f.onchange = () => { const fl = f.files[0]; if (!fl) return; const rd = new FileReader(); rd.onload = () => { try { abrirArquivo(JSON.parse(rd.result)); } catch (er) { alert('Não consegui abrir: ' + er.message); } f.value = ''; }; rd.readAsText(fl); }; }
  const lg = $('#lgTop'); if (lg) { const u = LOGO(1); if (u) { lg.src = u; lg.style.display = ''; } }
  if (!S) { $('#nav').innerHTML = ''; $('#selPer').innerHTML = ''; $('#cnt').innerHTML = vInicio(); return; }
  if (S.abas) S.abas.sort((a, b) => String(a.nome).localeCompare(String(b.nome), 'pt-BR'));
  if (!S.mapa) VIEW = 'config';
  const per = S.dataMed;
  const ps = []; for (let k = -12; k <= 3; k++) ps.push(addMes(per, k));
  $('#selPer').innerHTML = ps.map(p => `<option value="${p}" ${p === per ? 'selected' : ''}>${br(p)} (${br(iniDe(p))} a ${br(p)})</option>`).join('');
  $('#nav').innerHTML = VIEWS.map(([k, t]) => `<a data-view="${k}" class="${VIEW === k ? 'on' : ''}">${t}</a>`).join('') +
    `<div class="st">MedPrime v${VERSAO}<br>${S.lanc.length} lançamentos guardados<br>salvo: ${S.salvoEm ? new Date(S.salvoEm).toLocaleString('pt-BR').slice(0, 16) : '—'}<br>backup: ${S.ultimoBackup ? br(S.ultimoBackup.slice(0, 10)) : '<b style="color:#C00000">nunca</b>'}</div>`;
  status();
  const f = { resumo: vResumo, lancar: vLancar, boletim: vBoletim, croqui: vCroqui, conferir: vConferir, contrato: vContrato, base: vBase, plane: vPlane, config: vConfig }[VIEW];
  const sc = $('#cnt').scrollTop;
  $('#cnt').innerHTML = (VIEW === 'config' ? '' : boxLeitura(VIEW === 'base')) + f();
  if (VIEW === 'lancar' || VIEW === 'base') $('#cnt').scrollTop = sc;
}
function selAba(id) {
  const ativos = S.abas.map(a => a.nome);
  if (!ABA) ABA = ativos[0];
  return `<label>Empreiteiro</label><select id="${id || 'selAba'}" data-act="aba">${ativos.map(n => `<option value="${esc(n)}" ${n === ABA ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select>`;
}

// ---------------- RESUMO
function vResumo() {
  const per = S.dataMed;
  let tb = 0, tr = 0, td = 0, tl = 0, tp = 0, tpb = 0, tpl = 0;
  const rows = S.abas.map(a => {
    const t = totais(a.nome, per); const pm = medPlane(a.nome, per); const pp = medPlane(a.nome, per, 'P');
    const ppb = pp.reduce((s, m) => s + m.bruto, 0);
    const pb = pm.reduce((s, m) => s + m.bruto, 0), pliq = pm.reduce((s, m) => s + m.liq - m.ded, 0);
    if (!t.nEx && !t.nPv && !pm.length && !pp.length) return null;
    tb += t.bruto; tr += t.ret; td += t.desc; tl += t.liq; tp += t.prev; tpb += pb; tpl += pliq;
    let st;
    if (!pm.length) st = t.bruto > 0 ? '<span class="tag warn">PREPARADA</span>' : '';
    else if (t.bruto === 0) st = '<span class="tag mut">SÓ NO PLANE</span>';
    else st = pm.every(m => stPt(m.st) === 'APROVADA') ? '<span class="tag ok">APROVADA</span>' : '<span class="tag info">LANÇADA</span>';
    const dif = pm.length && t.bruto > 0 ? Math.round((t.bruto - pb) * 100) / 100 : null;
    return `<tr><td><span class="link" data-goto="lancar" data-aba="${esc(a.nome)}">${esc(a.nome)}</span></td><td>${esc(a.disc)}</td>
      <td class="n">${R$(t.bruto)}</td><td class="c">${pct(a.ret)}</td><td class="n">${R$(t.ret)}</td><td class="n">${R$(t.desc)}</td><td class="n"><b>${R$(t.liq)}</b></td>
      <td class="n">${t.prev ? R$(t.prev) : ''}${pp.length ? `<br><span class="tag ${Math.abs(ppb - t.prev) < 0.01 ? 'ok' : 'warn'}" title="medição prevista no plane">plane ${R$(ppb)}</span>` : ''}</td><td class="c">${st}</td><td class="n">${pm.length ? R$(pb) : ''}</td><td class="n">${pm.length ? R$(pliq) : ''}</td>
      <td class="c">${dif == null ? '' : Math.abs(dif) < 0.01 ? '<span class="tag ok">igual</span>' : `<span class="tag bad">${R$(dif)}</span>`}</td>
      <td class="c"><button class="btn s w" data-goto="conferir" data-aba="${esc(a.nome)}">conferir</button></td></tr>`;
  }).filter(Boolean);
  const av = AVISO ? `<div class="box" style="background:#E2EFDA;border-color:#A9D08E;position:relative"><button class="btn x" data-fechar="aviso" title="fechar" style="position:absolute;right:6px;top:2px;color:#375623;font-size:16px">✕</button>✔ Ajuste aplicado nesta versão: <b>${esc(AVISO)}</b>. As linhas que não entraram no plane ficaram guardadas (não somam) no fim da tela Lançar.</div>` : '';
  return av + boxNovidades(true) + `<h2>Resumo da medição de ${br(per)} <span class="muted">(${br(iniDe(per))} a ${br(per)})</span></h2>
  <div class="cards"><div class="card"><div class="l">Bruto executado</div><div class="v">${R$(tb)}</div></div>
  <div class="card"><div class="l">(–) Retenções</div><div class="v">${R$(tr)}</div></div><div class="card"><div class="l">(–) Descontos</div><div class="v">${R$(td)}</div></div>
  <div class="card gr"><div class="l">Líquido a pagar</div><div class="v">${R$(tl)}</div></div><div class="card"><div class="l">Previsto (separado)</div><div class="v">${R$(tp)}</div></div>
  <div class="card"><div class="l">Bruto no plane</div><div class="v">${PL.ok ? R$(tpb) : '—'}</div></div></div>
  ${rows.length ? `<table class="t"><thead><tr><th>Empreiteiro (clique p/ lançar)</th><th>Disciplina</th><th>Bruto executado</th><th>Ret.</th><th>Retenção</th><th>Descontos</th><th>Líquido</th><th>Previsto</th><th>Situação no plane</th><th>Bruto no plane</th><th>A pagar no plane</th><th>Diferença</th><th></th></tr></thead>
  <tbody>${rows.join('')}</tbody><tfoot><tr><td colspan="2">TOTAL</td><td class="n">${R$(tb)}</td><td></td><td class="n">${R$(tr)}</td><td class="n">${R$(td)}</td><td class="n">${R$(tl)}</td><td class="n">${R$(tp)}</td><td></td><td class="n">${PL.ok ? R$(tpb) : ''}</td><td class="n">${PL.ok ? R$(tpl) : ''}</td><td colspan="2"></td></tr></tfoot></table>`
    : `<div class="box">Nenhum lançamento nem medição no plane neste período. Vá em <span class="link" data-goto="lancar">Lançar medição</span>.</div>`}
  <p class="muted">PREPARADA = está aqui mas ainda não no plane · LANÇADA/APROVADA = situação no plane · SÓ NO PLANE = tem medição no plane e nada lançado aqui. O previsto fica fora do bruto.</p>`;
}

// ---------------- LANÇAR
function vLancar() {
  const per = S.dataMed; const a = S.abas.find(x => x.nome === ABA) || S.abas[0]; ABA = a.nome;
  const t = totais(ABA, per);
  const opts = itensDaAba(ABA).map(b => `<option value="${esc(rotulo(b))}">${b.un} · ${R4(b.preco)}</option>`).join('') + DESC_LABELS.map(d => `<option value="${d}">valor em Qtd/apto real</option>`).join('');
  const linha = (l, i, tipo) => {
    const c = calc(l); const fora = !c.it && !ehDesconto(l);
    return `<tr data-id="${l.id}"><td class="c">${i + 1}</td>
      ${tipo === 'E' ? `<td style="width:118px"><input type="date" data-f="data" value="${esc(l.data || '')}"></td>` : ''}
      <td style="min-width:280px"><input list="dl-serv" data-f="serv" value="${esc(l.serv)}" title="${esc(l.serv)}">${fora ? '<span class="tag warn" title="não está na base de preços desta aba">fora da base</span>' : ''}</td>
      <td style="min-width:210px"><div style="display:flex;gap:4px;align-items:center"><textarea data-f="local" rows="2" style="flex:1">${esc(l.local)}</textarea><button class="btn s w" data-pick="${l.id}" title="escolher blocos/aptos no mapa">▦</button></div></td>
      <td style="width:64px"><input class="num" data-f="n" value="${l.n == null ? '' : Q(l.n)}"></td>
      <td style="width:70px"><input class="num" data-f="qreal" value="${l.qreal == null ? '' : Q(l.qreal)}" placeholder="${c.it && c.it.qref != null ? Q(c.it.qref) : ''}"></td>
      <td style="min-width:90px"><input data-f="obs" value="${esc(l.obs)}"></td>
      <td class="c">${esc(c.un)}</td><td class="n">${R4(c.preco)}</td><td class="n">${Q(c.qapto)}</td><td class="n">${Q(c.qt)}</td><td class="n"><b>${R$(c.valor)}</b></td>
      <td class="c" style="white-space:nowrap"><button class="btn s w" data-dup="${l.id}" title="duplicar">⧉</button> <button class="btn s r" data-del="${l.id}" title="apagar">✕</button></td></tr>`;
  };
  const ex = linhas(ABA, per, 'E'), pv = linhas(ABA, per, 'P');
  const fora = S.lanc.filter(l => l.aba === ABA && l.per === per && l.fora);
  const hist = periodosDaAba(ABA).filter(p => p !== per).reverse();
  const head = tipo => `<tr><th>#</th>${tipo === 'E' ? '<th>Data</th>' : ''}<th>Serviço (digite p/ buscar)</th><th>Local / Bloco / Aptos</th><th>Nº aptos / vezes</th><th>Qtd/apto real</th><th>Observação</th><th>Unid</th><th>Preço</th><th>Qtd/apto</th><th>Qtd total</th><th>Valor</th><th></th></tr>`;
  return `<datalist id="dl-serv">${opts}</datalist>
  <h2>Lançar medição — ${esc(a.titulo)}</h2>
  <div class="bar">${selAba()}<label>Retenção</label><input id="ret" style="width:60px" value="${nf(0, 2).format((a.ret || 0) * 100)}"> %
   <span class="sp" style="flex:1"></span><button class="btn g" data-goto="boletim">📄 Boletim</button><button class="btn" data-goto="croqui">🗺️ Croqui</button><button class="btn r" data-goto="conferir">✔ Conferir com o plane</button></div>
  <div class="cards"><div class="card"><div class="l">Bruto do período</div><div class="v">${R$(t.bruto)}</div></div><div class="card"><div class="l">(–) Retenção</div><div class="v">${R$(t.ret)}</div></div>
   <div class="card"><div class="l">(–) Descontos</div><div class="v">${R$(t.desc)}</div></div><div class="card gr"><div class="l">Líquido a pagar</div><div class="v">${R$(t.liq)}</div></div><div class="card"><div class="l">Previsto</div><div class="v">${R$(t.prev)}</div></div></div>
  <div class="sec" style="background:#1F3864">SERVIÇOS EXECUTADOS — ${br(iniDe(per))} a ${br(per)}</div>
  <table class="t"><thead>${head('E')}</thead><tbody>${ex.map((l, i) => linha(l, i, 'E')).join('')}</tbody></table>
  <div style="margin:8px 0 4px;display:flex;gap:8px"><button class="btn" data-add="E">+ Nova linha</button><button class="btn w" data-add="D">+ Desconto</button></div>
  <div class="sec" style="background:#7F6000">MEDIÇÃO PREVISTA — serviços que ainda vão ser executados (boletim e croqui separados)</div>
  <div class="box" style="border-radius:0 0 8px 8px">Previsto até: <input type="date" id="prevAte" value="${esc((pv[0] && pv[0].data) || '')}" style="padding:4px"></div>
  <table class="t"><thead>${head('P')}</thead><tbody>${pv.map((l, i) => linha(l, i, 'P')).join('')}</tbody></table>
  <div style="margin:8px 0"><button class="btn w" data-add="P">+ Linha prevista</button></div>
  ${fora.length ? `<div class="sec" style="background:#808080">LINHAS GUARDADAS QUE NÃO ENTRARAM NO PLANE (não somam)</div><table class="t"><thead><tr><th>Serviço</th><th>Local</th><th>Valor</th><th>Motivo</th><th></th></tr></thead><tbody>${fora.map(l => `<tr style="color:#777"><td>${esc(l.serv)}</td><td>${esc(l.local)}</td><td class="n">${R$(calc(Object.assign({}, l, { fora: false })).valor)}</td><td>${esc(l.foraMotivo || '')}</td><td class="c"><button class="btn s w" data-reat="${l.id}">voltar para a medição</button></td></tr>`).join('')}</tbody></table>` : ''}
  ${hist.length ? `<div class="sec" style="background:#595959">MEDIÇÕES ANTERIORES DESTE EMPREITEIRO</div><table class="t"><thead><tr><th>Medição</th><th>Linhas</th><th>Bruto</th><th>Líquido</th><th></th></tr></thead><tbody>${hist.map(p => { const tt = totais(ABA, p); return `<tr><td>${br(p)}</td><td class="c">${tt.nEx}</td><td class="n">${R$(tt.bruto)}</td><td class="n">${R$(tt.liq)}</td><td class="c"><button class="btn s w" data-irper="${p}">abrir</button></td></tr>`; }).join('')}</tbody></table>` : ''}
  <p class="muted">Tudo é salvo automaticamente no navegador a cada alteração. Faça o backup em arquivo de vez em quando (botão 💾).</p>`;
}

// ---------------- BOLETIM / CROQUI (documentos para imprimir)
function dadosDoc(tipo) {
  const per = S.dataMed; const a = S.abas.find(x => x.nome === ABA) || S.abas[0];
  const ls = linhas(a.nome, per, tipo).map(l => Object.assign({ l }, calc(l)));
  const t = totais(a.nome, per);
  const nMed = periodosDaAba(a.nome).filter(p => p <= per).length;
  const prevAte = tipo === 'P' && ls[0] ? ls[0].l.data : null;
  return { per, a, ls, t, nMed, prevAte };
}
function docBoletim(tipo) {
  const d = dadosDoc(tipo); const prev = tipo === 'P';
  const pos = d.ls.filter(x => x.valor > 0).reduce((s, x) => s + x.valor, 0);
  const neg = -d.ls.filter(x => x.valor < 0).reduce((s, x) => s + x.valor, 0);
  const ret = prev ? pos * (d.a.ret || 0) : d.t.ret;
  const linhasH = d.ls.map((x, i) => `<tr><td class="c">${prev ? 'P' : ''}${i + 1}</td><td class="c">${br(prev ? d.prevAte : x.l.data)}</td><td>${esc(x.l.serv)}</td><td>${esc(x.l.local)}</td><td class="c">${esc(x.un)}</td><td class="n">${R4(x.preco)}</td><td class="n">${Q(x.qapto)}</td><td class="n">${Q(x.n)}</td><td class="n">${Q(x.qt)}</td><td class="n"><b>${R$(x.valor)}</b></td><td class="o">${esc(x.l.obs)}</td></tr>`).join('');
  return `<div class="doc bol">
   <div class="hd"><img src="${LOGO(1)}"><div class="tt">REALIZA CONSTRUTORA — BOLETIM DE MEDIÇÃO ${prev ? 'PREVISTA' : 'DE EMPREITEIRO'}<div class="st">Obra: PRIME CLUBE · Uberlândia/MG</div></div><img src="${LOGO(2)}"></div>
   <table class="inf"><tr><td class="k">EMPREITEIRO:</td><td class="v">${esc(d.a.titulo)}</td><td class="k">Disciplina:</td><td>${esc(d.a.disc)}</td></tr>
   <tr><td class="k">PERÍODO:</td><td class="v">de ${br(iniDe(d.per))} a ${br(d.per)}</td><td class="k">Medição nº:</td><td>${d.nMed || ''}</td></tr>
   <tr><td class="k">BOLETIM DE:</td><td class="v">${prev ? 'MEDIÇÃO PREVISTA' : 'MEDIÇÃO EXECUTADA'}</td><td class="k">${prev ? 'Previsto até:' : ''}</td><td>${prev ? br(d.prevAte) : ''}</td></tr></table>
   <table class="tot"><tr><th>VALOR BRUTO</th><th>(–) RETENÇÃO ${pct(d.a.ret)}</th><th>(–) DESCONTOS</th><th class="g">VALOR LÍQUIDO A PAGAR</th></tr>
   <tr><td>${R$(pos)}</td><td>${R$(ret)}</td><td>${R$(neg)}</td><td class="g">${R$(pos - ret - neg)}</td></tr></table>
   <div class="sct">${prev ? 'SERVIÇOS PREVISTOS — a executar até ' + br(d.prevAte) : 'SERVIÇOS MEDIDOS NO PERÍODO'}</div>
   <table class="ln"><thead><tr><th>Item</th><th>${prev ? 'Previsto até' : 'Data'}</th><th>Serviço</th><th>Local / Bloco / Aptos</th><th>Unid</th><th>Preço unit.</th><th>Qtd / apto</th><th>Nº aptos</th><th>Qtd total</th><th>VALOR (R$)</th><th>Observação</th></tr></thead>
   <tbody>${linhasH || '<tr><td colspan="11" class="c">Nenhum serviço neste período.</td></tr>'}</tbody>
   <tfoot><tr><td colspan="9" style="text-align:right">TOTAL DO PERÍODO (bruto – descontos)</td><td class="n">${R$(pos - neg)}</td><td></td></tr></tfoot></table>
   <div class="ass"><div class="sct">CONFERÊNCIA E APROVAÇÃO</div><div class="row"><div>_______________________________<br>Medido por (Engenharia/Produção)<br>Data: ___/___/____</div><div>_______________________________<br>Empreiteiro (de acordo)<br>Data: ___/___/____</div><div>_______________________________<br>Aprovado (Coordenação)<br>Data: ___/___/____</div></div></div>
  </div>`;
}
function croquiPintura(ls) {
  const svc = []; const pint = {}; const avisos = [];
  ls.forEach((x, i) => {
    if (ehDesconto(x.l)) return;
    let k = svc.indexOf(x.l.serv); if (k < 0) { svc.push(x.l.serv); k = svc.length - 1; }
    if (SVC !== 'TODOS' && SVC !== x.l.serv) return;
    const r = chavesDaLinha(x.l.local, x.l.obs, x.l.serv);
    if (!r.achou) avisos.push(`• Item ${i + 1} (${x.l.serv.slice(0, 60)}): local não identificado – '${x.l.local}'`);
    r.chaves.forEach(ch => { pint[ch] = pint[ch] || []; if (pint[ch].indexOf(k) < 0) pint[ch].push(k); });
  });
  return { svc, pint, avisos };
}
function cor(arr) {
  if (!arr || !arr.length) return '';
  if (arr.length === 1) return `background:${PAL[arr[0] % 12]}`;
  const a = PAL[arr[0] % 12], b = PAL[arr[1] % 12];
  return `background:repeating-linear-gradient(135deg,${a} 0 5px,${b} 5px 10px)`;
}
function docCroqui(tipo) {
  const d = dadosDoc(tipo); const prev = tipo === 'P';
  const { svc, pint, avisos } = croquiPintura(d.ls);
  const cel = (k, txt, cls) => { const p = pint[k]; return `<td class="${cls || ''}" style="${cor(p)}">${txt}${p && p.length > 2 ? '*' : ''}</td>`; };
  const bloco = b => {
    const tem15 = b === 15;
    let h = `<table class="bl"><tr><th colspan="${tem15 ? 4 : 10}" class="bn">BLOCO ${String(b).padStart(2, '0')}${tem15 ? ' (MEIO BLOCO)' : ''}</th></tr><tr><th colspan="4">LADO A</th>${tem15 ? '' : '<th>A</th><th>B</th><th colspan="4">LADO B</th>'}</tr>`;
    for (let f = 4; f >= 1; f--) {
      h += '<tr>';
      for (let u = 1; u <= 4; u++) h += cel(`B|${b}|${f}0${u}`, `${f}0${u}`);
      if (!tem15) { h += cel(`H|${b}|A|${f}`, 'HALL', 'hl') + cel(`H|${b}|B|${f}`, 'HALL', 'hl'); for (let u = 5; u <= 8; u++) h += cel(`B|${b}|${f}0${u}`, `${f}0${u}`); }
      h += '</tr>';
    }
    return h + '</table>';
  };
  let blocosH = ''; for (let b = 1; b <= 15; b++) blocosH += `<div class="bw">${bloco(b)}</div>`;
  const areas = Object.keys(mapaObj()).filter(k => k.startsWith('A|')).map(k => `<div class="ar" style="${cor(pint[k])}">${esc(mapaObj()[k].orig)}</div>`).join('');
  const leg = svc.map((s, i) => (SVC === 'TODOS' || SVC === s) ? `<div class="lg"><span style="background:${PAL[i % 12]}"></span>${esc(s)}${prev ? ' (PREVISTO)' : ''}</div>` : '').join('');
  const obs = d.ls.filter(x => !ehDesconto(x.l) && (SVC === 'TODOS' || SVC === x.l.serv)).map((x, i) => {
    const na = qtdAptosDoLocal(x.l.local);
    const det = na > 0 && x.n === na ? `${Q(x.n)} aptos × ${Q(x.qapto)} ${x.un}/apto = ${Q(x.qt)} ${x.un}` : `${Q(x.qt)} ${x.un}`;
    return `• Item ${i + 1} – ${esc(x.l.serv)}: ${det} → ${R$(x.valor)}`;
  });
  const tot = d.ls.filter(x => SVC === 'TODOS' || SVC === x.l.serv).reduce((s, x) => s + x.valor, 0);
  const multi = Object.values(pint).some(p => p.length > 1);
  return `<div class="doc cq">
   <div class="hd"><img src="${LOGO(1)}"><div class="tt">OBRA: PRIME CLUBE – CROQUI DE MEDIÇÃO${prev ? ' PREVISTA' : ''}</div><img src="${LOGO(2)}"></div>
   <table class="inf"><tr><td class="k">EMPREITEIRO:</td><td class="v">${esc(d.a.titulo)}</td><td class="k">PERÍODO:</td><td>de ${br(iniDe(d.per))} a ${br(d.per)}</td><td class="k">Medição nº:</td><td>${d.nMed || ''}</td></tr>
   <tr><td class="k">SERVIÇO:</td><td colspan="5">${SVC === 'TODOS' ? 'TODOS OS SERVIÇOS' : esc(SVC)}</td></tr></table>
   <div class="legs">${leg || '<i>Nenhum serviço neste período.</i>'}</div>
   <div class="blocos">${blocosH}</div>
   <div class="sct">ÁREAS COMUNS / CANTEIRO</div><div class="areas2">${areas}</div>
   <div class="sct">OBSERVAÇÃO:</div><div class="obs">${obs.join('<br>')}${obs.length ? `<br><b>TOTAL DA MEDIÇÃO: ${R$(tot)}</b>` : ''}${multi ? '<br>Listrado = 2 serviços no mesmo local · * = 3 ou mais serviços.' : ''}${avisos.length ? '<br><span style="color:#C00000">' + avisos.map(esc).join('<br>') + '</span>' : ''}</div>
  </div>`;
}
const DOC_CSS = `
.doc{font-family:Arial,Helvetica,sans-serif;color:#000;background:#fff;padding:10px 14px;font-size:10px}
.doc .hd{display:flex;align-items:center;gap:12px;border-bottom:3px solid #1F3864;padding-bottom:6px;margin-bottom:6px}
.doc .hd img{height:38px}.doc .hd .tt{flex:1;text-align:center;font-weight:700;font-size:14px;color:#1F3864}.doc .hd .st{font-size:10px;font-weight:400;color:#444}
.doc table{border-collapse:collapse;width:100%}
.doc .inf td{padding:3px 4px;font-size:10.5px}.doc .inf .k{font-weight:700;width:90px;color:#1F3864}.doc .inf .v{font-weight:700;background:#FFF2CC}
.doc .tot{margin:6px 0}.doc .tot th{background:#2E75B6;color:#fff;padding:4px;font-size:10px}.doc .tot td{text-align:center;font-weight:700;font-size:12px;padding:6px;background:#DDEBF7}
.doc .tot .g{background:#375623;color:#fff}.doc .tot td.g{background:#E2EFDA;color:#000}
.doc .sct{background:#1F3864;color:#fff;font-weight:700;padding:3px 6px;margin-top:6px;font-size:10px}
.doc .ln th{background:#2E75B6;color:#fff;padding:3px;font-size:9px;border:1px solid #9fb6d3}.doc .ln td{border:1px solid #bfbfbf;padding:2px 3px;font-size:9px}
.doc .ln .n{text-align:right;white-space:nowrap}.doc .ln .c{text-align:center}.doc .ln .o{font-size:8px}.doc .ln tfoot td{font-weight:700;background:#DDEBF7;font-size:10px}
.doc .ass .row{display:flex;justify-content:space-around;text-align:center;margin-top:34px;font-size:9.5px;line-height:1.6}
.doc .legs{display:grid;grid-template-columns:1fr 1fr;gap:2px 14px;margin:4px 0;min-height:16px}.doc .lg{display:flex;align-items:center;gap:6px;font-size:9px}.doc .lg span{display:inline-block;width:26px;height:11px;border:1px solid #666;flex:none}
.doc .blocos{display:grid;grid-template-columns:repeat(3,1fr);gap:6px 10px;margin-top:4px}
.doc .bl{table-layout:fixed}.doc .bl th{background:#DDEBF7;font-size:8px;border:1px solid #8ea9cc;padding:1px}.doc .bl th.bn{background:#B4C6E7;font-size:9px}
.doc .bl td{border:1px solid #8ea9cc;text-align:center;font-size:8px;height:14px;padding:0}.doc .bl td.hl{font-size:7px;color:#444}
.doc .areas2{display:grid;grid-template-columns:repeat(4,1fr);gap:5px;margin-top:4px}.doc .ar{border:1.5px solid #1F3864;text-align:center;font-weight:700;font-size:9px;padding:6px 2px}
.doc .obs{border:1px solid #1F3864;min-height:40px;padding:4px 6px;font-size:9px;line-height:1.45}
`;
// ------------------------------------------------------------------ FVS do SGQ (relatório Monitoramento de Checklist)
const SGQ_REL = 'https://reports-api.sgq2.com.br/reports/monitoramento-checklist';
const sgq = () => { try { const v = GM_getValue('medprime_sgq', null); return v && v.servs && v.servs.length ? v : null; } catch (e) { return null; } };
const PALAVRAS_FRACAS = new Set(['EMPREITADA', 'EXECUCAO', 'PARA', 'COM', 'DOS', 'DAS', 'POR', 'INCLUSO', 'PREDIO', 'REV', 'REV00', 'REV01', 'REV02', 'REV03', 'REV04', 'AMOSTRAGEM', 'NOVO', 'FVS', 'SERVICO', 'SERVICOS', 'MAO', 'OBRA', 'INSTALACAO', 'TODOS', 'BLOCO', 'APTO', 'APARTAMENTO', 'APARTAMENTOS', 'HALL', 'ETAPA', 'LOGISTICA', 'DIARIA', 'RETRABALHO', 'AJUSTE', 'SEM', 'COMPLETA', 'TIPOS', 'CANTO', 'MEIO', 'TERREO', 'NOS', 'NAS', 'QUE', 'ESTA', 'SERA', 'DEVIDO', 'FATO']);
const SINONIMOS = [[/\bJANELAS?\b/g, 'ESQUADRIAS JANELAS'], [/\bPORTAS?\b/g, 'ESQUADRIAS PORTAS'], [/\bREJUNTAMENTO\b/g, 'REJUNTE'], [/\bCAIXAO PERDIDO\b/g, 'FIADA FALSA'],
  [/\b(PISO|PAREDE) CERAMIC\w*/g, 'REVESTIMENTO CERAMICO'], [/\bCERAMIC\w*\b/g, 'CERAMICO'], [/\bPORCELANAT\w*/g, 'PORCELANATO REVESTIMENTO'], [/\bACARTONAD\w*/g, 'ACARTONADO'], [/\bDRYWALL\b/g, 'GESSO ACARTONADO']];
const raiz = w => (w.length > 4 ? w.replace(/S$/, '') : w).slice(0, 6);
const tokFvs = (s, ehServ) => { let t = semac(s).replace(/^\s*FVS\s+\d+\s*[A-Z]?\d*\s*-?/, ' ').replace(/\b\d+(\.\d+)*\b/g, ' ');
  if (!ehServ) t = t.replace(/\(.*?\)/g, ' ');
  if (ehServ) { SINONIMOS.forEach(([re, v]) => { t = t.replace(re, v); }); if (/\bGESSO\b/.test(t) && !/ACARTONADO|FORRO|SHAFT/.test(t)) t += ' CORRIDO'; if (/\bBALDRAME\b/.test(t)) t = t.replace(/\bVIGAS?\b/g, ' '); }
  return Array.from(new Set(t.replace(/[^A-Z ]/g, ' ').split(/\s+/).filter(w => w.length > 2 && !PALAVRAS_FRACAS.has(w)).map(raiz))); };
// sugere a FVS pelo nome do serviço: a "família" da FVS (1ª palavra: IMPERMEABILIZAÇÃO, ESQUADRIAS, GESSO...) tem que aparecer no serviço
function sugereFvs(serv) {
  const g = sgq(); if (!g) return null;
  const A = new Set(tokFvs(String(serv).replace(/^\s*\d+\s*-\s*/, ''), true)); if (!A.size) return null;
  let best = null, bs = 0;
  g.servs.forEach(([id, nome]) => { const B = tokFvs(nome); if (!B.length) return; let n = 0; B.forEach(w => { if (A.has(w)) n++; }); if (!n) return;
    const sc = n / B.length * (A.has(B[0]) ? 1 : 0.5); if (sc >= bs) { bs = sc; best = id; } });
  return bs >= 0.34 ? best : null;
}
const chaveFvs = (aba, serv) => aba + '|' + serv;
function fvsDoServ(aba, serv, obs) {   // { ids:[...], salvo:true|false }
  S.fvs = S.fvs || {};
  const v = S.fvs[chaveFvs(aba, serv)];
  if (v) return { ids: v.filter(x => x !== 0), salvo: true };
  const sg = sugereFvs(serv); return { ids: sg ? [sg] : [], salvo: false };
}
const nomeFvs = id => { const g = sgq(); const x = g && g.servs.find(s => s[0] === +id); return x ? x[1] : 'FVS ' + id; };
// locais medidos -> áreas do SGQ (BLOCO 01 - APTO 108, BLOCO 01 - 00 TÉRREO, BLOCO 01, - PORTARIA ...)
function areasDoSGQ(linhasDoc) {
  // só as áreas que foram medidas: apto citado = a área do apto; sem apto citado (ex.: radier, fundação do bloco) = a área do bloco.
  // NÃO adiciona o pavimento nem o bloco inteiro quando a medição cita aptos.
  const g = sgq(); if (!g) return { ids: [], nomes: [] };
  const porNome = {}; g.areas.forEach(([id, n]) => { porNome[semac(n).replace(/\s+/g, ' ').trim()] = id; });
  const quer = new Set(); const p2 = n => String(n).padStart(2, '0');
  linhasDoc.forEach(x => {
    const loc = semac(x.l.local);
    // v1.6.4: "BLOCO 12 (TODOS OS APTOS)" sem apto/hall citado = local de BLOCO (FVS de fiada, contrapiso, radier).
    // Só vira apto quando a linha cita apto ou hall de forma explícita.
    const expl = aptos(loc).length > 0 || halls(loc).length > 0;
    chavesDaLinha(x.l.local, x.l.obs, x.l.serv).chaves.forEach(k => {
      const p = k.split('|');
      if (p[0] === 'A') { const kw = (mapaObj()[k] || {}).kw || p[1]; g.areas.forEach(([id, n]) => { if (!/^\s*BLOCO/i.test(n) && casa(semac(n), kw)) quer.add(semac(n).replace(/\s+/g, ' ').trim()); }); }
      else if (p[0] === 'B') { quer.add(expl ? `BLOCO ${p2(p[1])} - APTO ${p[2]}` : `BLOCO ${p2(p[1])}`); }
      else if (p[0] === 'H') {
        const f = +p[3], lado = p[2] === 'A' ? [1, 2, 3, 4] : [5, 6, 7, 8];
        if (expl) lado.forEach(u => quer.add(`BLOCO ${p2(p[1])} - APTO ${f * 100 + u}`)); else quer.add(`BLOCO ${p2(p[1])}`);
      }
    });
  });
  const ids = [], nomes = [];
  quer.forEach(n => { const id = porNome[semac(n)]; if (id && ids.indexOf(id) < 0) { ids.push(id); nomes.push(n); } });
  return { ids, nomes, naoAchou: Array.from(quer).filter(n => !porNome[semac(n)]) };
}
function gmPost(url, corpo, headers) {
  return new Promise((ok, falha) => {
    if (typeof GM_xmlhttpRequest !== 'function') { falha(new Error('o Tampermonkey não liberou o acesso ao SGQ (reinstale o script)')); return; }
    GM_xmlhttpRequest({ method: 'POST', url, data: JSON.stringify(corpo), headers: Object.assign({ 'Content-Type': 'application/json' }, headers), timeout: 120000,
      onload: r => { try { ok(JSON.parse(r.responseText)); } catch (e) { falha(new Error('resposta inválida do SGQ (' + r.status + ')')); } },
      onerror: () => falha(new Error('sem conexão com o SGQ')), ontimeout: () => falha(new Error('o SGQ demorou demais para responder')) });
  });
}
// pede o relatório ao SGQ (só gera relatório, não grava nada)
async function relatorioFvs(fvsIds, areaIds, mime) {
  const g = sgq(); if (!g) throw new Error('abra o SGQ uma vez (Checklist de Área da obra) para o MedPrime pegar a lista de FVS');
  const corpo = { idObra: g.idObra, idUsuario: g.idUsuario, area: areaIds.length ? areaIds.join(',') : null, statusArea: null, servico: fvsIds.join(','), statusServico: null,
    dataAberturaDe: null, dataAberturaAte: null, dataEncerramentoDe: null, dataEncerramentoAte: null, statusVerificacao: null, statusItemChecklist: null, empresaTercerizadas: null, funcionarios: null, requiredMimeType: mime };
  const j = await gmPost(SGQ_REL, corpo, { BancoSchema: g.empresa, UsuarioIdSchema: String(g.idUsuario) });
  const d = j && (j.data || j.Data); if (!j || j.status !== 'ok' || !d || !d.bytes) throw new Error('o SGQ não gerou o relatório' + (j && j.title ? ' (' + j.title + ')' : ''));
  return d;
}
const b64bytes = b64 => { const s = atob(b64); const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; };
function contarFvs(htmlB64) {
  const html = new TextDecoder('utf-8').decode(b64bytes(htmlB64));
  const doc = new DOMParser().parseFromString(html.replace(/<script[\s\S]*?<\/script>/gi, ''), 'text/html');
  return Array.from(doc.querySelectorAll('tr')).filter(tr => !tr.querySelector('tr')).map(tr => Array.from(tr.children).map(td => td.textContent.trim())).filter(c => c.length >= 15 && /FVS/.test(c[3] || '')).length;
}
function pedidoFvs() {
  const d = dadosDoc(MODO); const ls = d.ls.filter(x => !ehDesconto(x.l));
  const ids = []; ls.forEach(x => fvsDoServ(d.a.nome, x.l.serv, x.l.obs).ids.forEach(i => { if (ids.indexOf(i) < 0) ids.push(i); }));
  return { d, ls, ids, ar: areasDoSGQ(ls) };
}
let FVS_MSG = '';
// relatório de FVS organizado: lê a tabela do SGQ (só leitura) e monta uma página própria, limpa, para imprimir/salvar em PDF
function fvsLinhas(htmlB64) {
  const html = new TextDecoder('utf-8').decode(b64bytes(htmlB64)).replace(/<script[\s\S]*?<\/script>/gi, '');
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const raw = tr => Array.from(tr.children).map(td => td.textContent.replace(/\s+/g, ' ').trim());
  const seen = new Set(), out = [];
  Array.from(doc.querySelectorAll('tr')).filter(tr => !tr.querySelector('tr')).map(raw).forEach(c => {
    if (c.length < 20 || !/FVS \d/.test(c[3] || '') || c[0] === 'STATUS DA ÁREA') return;
    const k = c.slice(0, 20).join('|'); if (seen.has(k)) return; seen.add(k); out.push(c.slice(0, 20));
  });
  return out.sort((x, y) => (x[3] + x[1]).localeCompare(y[3] + y[1], 'pt-BR', { numeric: true }));
}
function fvsDoc(linhas, d) {
  const txt = v => esc(v || '');
  const grupos = {}; linhas.forEach(c => { const k = c[3] + ' — ' + c[4]; (grupos[k] = grupos[k] || []).push(c); });
  const cab = `<tr><th>Área (local)</th><th>Status da área</th><th>Status do checklist</th><th>Status da verificação</th><th>Abertura</th><th>Encerramento</th><th>Inspecionado por</th><th>Aprovado por</th><th>Itens</th><th>% aprovação</th><th>% retrabalho</th><th>% reprovação</th></tr>`;
  const corpo = Object.keys(grupos).map(k => {
    const ls = grupos[k];
    const lin = ls.map(c => `<tr><td>${txt(c[1])}</td><td>${txt(c[0])}</td><td>${txt(c[2])}</td><td>${txt(c[9])}</td><td class="c">${txt(c[10])}</td><td class="c">${txt(c[11])}</td><td>${txt(c[12])}</td><td>${txt(c[13])}</td><td class="n">${txt(c[14])}</td><td class="n">${txt(c[15])}</td><td class="n">${txt(c[17])}</td><td class="n">${txt(c[18])}</td></tr>`).join('');
    return `<div class="fvs-g"><div class="fvs-t">${txt(k)} <span class="muted">· ${ls.length} local(is)</span></div><table class="fvs-tb"><thead>${cab}</thead><tbody>${lin}</tbody></table></div>`;
  }).join('');
  return `<div class="doc fvs">
   <div class="hd"><img src="${LOGO(1)}"><div class="tt">REALIZA CONSTRUTORA — FVS (MONITORAMENTO DE CHECKLIST)<div class="st">Obra: PRIME CLUBE · Uberlândia/MG</div></div><img src="${LOGO(2)}"></div>
   <table class="inf"><tr><td class="k">EMPREITEIRO:</td><td class="v">${txt(d.a.titulo)}</td><td class="k">Medição:</td><td>${br(d.per)}</td></tr>
   <tr><td class="k">PERÍODO:</td><td class="v">de ${br(iniDe(d.per))} a ${br(d.per)}</td><td class="k">FVS:</td><td>${Object.keys(grupos).length} FVS · ${linhas.length} local(is)</td></tr></table>
   ${corpo || '<div class="box">Sem FVS para exibir.</div>'}
   <div class="muted" style="margin-top:6px;font-size:9px">Dados do SGQ (somente leitura), gerados em ${new Date().toLocaleString('pt-BR').slice(0, 16)}. Só os locais lançados nesta medição.</div>
  </div>`;
}
const FVS_CSS = `.fvs .fvs-g{margin:8px 0 10px;page-break-inside:auto}.fvs .fvs-t{background:#1F3864;color:#fff;font-weight:700;font-size:10px;padding:4px 6px}.fvs .fvs-tb{width:100%;border-collapse:collapse;font-size:8.5px}.fvs .fvs-tb th{background:#D9E2F3;border:1px solid #8EA9DB;padding:3px 4px;text-align:left}.fvs .fvs-tb td{border:1px solid #BFBFBF;padding:3px 4px;vertical-align:top}.fvs .fvs-tb tr{page-break-inside:avoid}.fvs .fvs-tb .n{text-align:right}.fvs .fvs-tb .c{text-align:center}.fvs .muted{color:#555;font-weight:400}.fvs .fvs-t .muted{color:#DDE6F5}`;
// v1.6.6: cada FVS só traz os locais das linhas da medição que usam ESSA FVS (não a união de todas)
const normLoc = v => semac(v).replace(/\s+/g, ' ').trim();
async function fvsLinhasDoPedido(p) {
  const todas = [];
  for (let i = 0; i < p.ids.length; i++) {
    const id = p.ids[i];
    FVS_MSG = `⏳ Pedindo a FVS ${i + 1} de ${p.ids.length} ao SGQ…`; render();
    const doFvs = p.ls.filter(x => fvsDoServ(p.d.a.nome, x.l.serv, x.l.obs).ids.indexOf(id) >= 0);
    const nomesF = new Set(areasDoSGQ(doFvs).nomes.map(normLoc));
    const linhas = fvsLinhas((await relatorioFvs([id], [], 'text/html')).bytes).filter(c => nomesF.has(normLoc(c[1])));
    todas.push(...linhas);
  }
  const vistos = new Set(), out = [];
  todas.forEach(c => { const k = c.join('|'); if (vistos.has(k)) return; vistos.add(k); out.push(c); });
  return out.sort((x, y) => (x[3] + x[1]).localeCompare(y[3] + y[1], 'pt-BR', { numeric: true }));
}
async function fvsRelatorio() {   // devolve o HTML organizado (ou lança erro com o motivo)
  const p = pedidoFvs();
  if (!p.ids.length) throw new Error('nenhum serviço deste empreiteiro está ligado a uma FVS — escolha a FVS de cada serviço no quadro "FVS do SGQ"');
  const linhas = await fvsLinhasDoPedido(p);
  if (!linhas.length) throw new Error('o SGQ não tem FVS desses serviços nesses locais: ' + p.ids.map(nomeFvs).join('; '));
  FVS_MSG = `✔ ${linhas.length} local(is) de FVS encontrados no SGQ.`; render();
  return fvsDoc(linhas, p.d);
}
function boxFvs() {
  const g = sgq();
  if (!g) return `<div class="box" style="background:#FFF2CC;border-color:#F4B183">📋 <b>FVS do SGQ:</b> para gerar a FVS junto com a medição, abra o <a href="https://gdol.sgq2.com.br" target="_blank" class="link">SGQ</a> (já logado) e entre na <b>Checklist de Área</b> da obra uma vez. O MedPrime copia a lista de FVS e de áreas sozinho; depois volte aqui.</div>`;
  const p = pedidoFvs(); const servs = []; const vistos = new Set();
  p.ls.forEach(x => { if (!vistos.has(x.l.serv)) { vistos.add(x.l.serv); servs.push(x.l); } });
  if (!servs.length) return '';
  const opts = (sel) => `<option value="">— escolher FVS —</option><option value="0" ${sel === 0 ? 'selected' : ''}>(este serviço não tem FVS)</option>` + g.servs.map(([id, n]) => `<option value="${id}" ${sel === id ? 'selected' : ''}>${esc(n)}</option>`).join('');
  const linhasH = servs.map(l => { const f = fvsDoServ(p.d.a.nome, l.serv, l.obs); const salvo = (S.fvs || {})[chaveFvs(p.d.a.nome, l.serv)]; const sel = salvo ? salvo[0] : (f.ids[0] || null);
    return `<tr><td>${esc(l.serv)}</td><td><select data-fvs="${esc(chaveFvs(p.d.a.nome, l.serv))}" style="max-width:520px">${opts(sel)}</select> ${salvo ? '' : f.ids.length ? '<span class="tag warn" title="sugestão pelo nome do serviço — escolha de novo para confirmar">sugerida</span>' : '<span class="tag warn">sem FVS</span>'}</td></tr>`; }).join('');
  return `<details class="box" style="background:#F3F8EC;border-color:#A9D08E" ${FVS_ABERTO ? 'open' : ''} data-fvsbox="1"><summary style="cursor:pointer"><b>📋 FVS do SGQ</b> — ${p.ids.length} FVS ligada(s) aos serviços desta medição · ${p.ar.ids.length ? p.ar.ids.length + ' área(s) do SGQ pelos locais medidos' : 'sem filtro de local'} <span class="muted">(lista do SGQ de ${br((g.em || '').slice(0, 10))})</span>${FVS_MSG ? ` · <b>${esc(FVS_MSG)}</b>` : ''}</summary>
    <table class="t" style="margin-top:6px"><thead><tr><th>Serviço medido</th><th>FVS no SGQ</th></tr></thead><tbody>${linhasH}</tbody></table>
    <div class="muted" style="margin-top:4px">Traz todas as FVS do serviço (sem filtro de data), só nos blocos/aptos/áreas lançados nesta medição. A escolha fica salva para as próximas medições.</div></details>`;
}
let FVS_ABERTO = false;
function vDoc(kind) {
  const ls = dadosDoc(MODO).ls;
  const svcs = Array.from(new Set(ls.filter(x => !ehDesconto(x.l)).map(x => x.l.serv)));
  if (SVC !== 'TODOS' && svcs.indexOf(SVC) < 0) SVC = 'TODOS';
  return `<h2>${kind === 'b' ? 'Boletim' : 'Croqui'} — ${esc(nomeAba(ABA || S.abas[0].nome))}</h2>
  <div class="bar">${selAba()}<label>Tipo</label><select data-act="modo"><option value="E" ${MODO === 'E' ? 'selected' : ''}>Medição executada</option><option value="P" ${MODO === 'P' ? 'selected' : ''}>Medição prevista</option></select>
  ${kind === 'c' ? `<label>Serviço</label><select data-act="svc" style="max-width:360px"><option value="TODOS">TODOS OS SERVIÇOS</option>${svcs.map(s => `<option value="${esc(s)}" ${s === SVC ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select>` : ''}
  <span style="flex:1"></span><button class="btn g" data-print="${kind}">🖨️ Imprimir / Salvar PDF</button>${kind === 'c' ? '<button class="btn w" data-print="c1">PDF de cada serviço</button>' : '<button class="btn w" data-print="bc">Boletim + croqui juntos</button><button class="btn w" data-print="f" title="baixa o relatório Monitoramento de Checklist do SGQ em PDF">📋 FVS (PDF)</button><button class="btn w" data-print="fx" title="baixa o mesmo relatório do SGQ em Excel">📊 FVS (Excel)</button><button class="btn w" data-print="bcf">Boletim + croqui + FVS</button>'}</div>
  ${kind === 'b' && MODO === 'E' ? boxFvs() : ''}
  <div class="prev" style="width:${kind === 'b' ? 1050 : 1120}px"><style>${DOC_CSS}</style>${kind === 'b' ? docBoletim(MODO) : docCroqui(MODO)}</div>
  <p class="muted">No "Imprimir", escolha a impressora "Salvar como PDF" — o arquivo já vem com o nome: <b>${esc(nomePdf(kind))}.pdf</b>${kind === 'b' ? ` (boletim + croqui juntos: <b>${esc(nomePdf('bc'))}.pdf</b> · FVS: <b>${esc(nomePdf('f'))}.pdf</b> ou <b>.xls</b> · tudo junto: <b>${esc(nomePdf('bcf'))}.pdf</b>)` : ''}</p>`;
}
const vBoletim = () => vDoc('b'), vCroqui = () => vDoc('c');
function nomePdf(kind) {
  const tipo = { b: 'BOLETIM', c: 'CROQUI', bc: 'CROQUI E BOLETIM', c1: 'CROQUI POR SERVIÇO', f: 'FVS', bcf: 'CROQUI, BOLETIM E FVS' }[kind] || 'BOLETIM';
  const svc = kind === 'c' && SVC !== 'TODOS' ? ' - ' + SVC : '';
  return `MEDIÇÃO ${br(S.dataMed).replace(/\//g, '-')} - ${ABA} - ${tipo}${svc}${MODO === 'P' ? ' PREVISTA' : ''}`.replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 180);
}
async function gerarFvsXls() {   // Excel montado com as mesmas linhas filtradas do PDF (tabela HTML em .xls, abre no Excel)
  const p = pedidoFvs();
  if (!p.ids.length) throw new Error('nenhum serviço deste empreiteiro está ligado a uma FVS — escolha a FVS de cada serviço no quadro "FVS do SGQ"');
  const linhas = await fvsLinhasDoPedido(p);
  if (!linhas.length) throw new Error('o SGQ não tem FVS desses serviços nesses locais: ' + p.ids.map(nomeFvs).join('; '));
  const t = v => esc(v || '');
  const cab = ['Código FVS','Nome do serviço','Área (local)','Status da área','Status do checklist','Status da verificação','Abertura','Encerramento','Inspecionado por','Aprovado por','Itens','% aprovação','% retrabalho','% reprovação'];
  const lin = linhas.map(c => `<tr><td>${t(c[3])}</td><td>${t(c[4])}</td><td>${t(c[1])}</td><td>${t(c[0])}</td><td>${t(c[2])}</td><td>${t(c[9])}</td><td>${t(c[10])}</td><td>${t(c[11])}</td><td>${t(c[12])}</td><td>${t(c[13])}</td><td>${t(c[14])}</td><td>${t(c[15])}</td><td>${t(c[17])}</td><td>${t(c[18])}</td></tr>`).join('');
  const html = `<html xmlns:x="urn:schemas-microsoft-com:office:excel"><head><meta charset="utf-8"></head><body><table border="1"><tr>${cab.map(h => `<th>${h}</th>`).join('')}</tr>${lin}</table></body></html>`;
  FVS_MSG = `✔ ${linhas.length} local(is) de FVS em Excel.`; render();
  baixar(nomePdf('f') + '.xls', new TextEncoder().encode(html), 'application/vnd.ms-excel');
  render();
}
async function imprimir(kind) {
  if (kind === 'fx') { try { await gerarFvsXls(); } catch (e) { FVS_MSG = '⚠ ' + e.message; render(); alert('FVS: ' + e.message); } return; }
  let fvsHtml = null;
  if (kind === 'f' || kind === 'bcf') { try { fvsHtml = await fvsRelatorio(); } catch (e) { FVS_MSG = '⚠ ' + e.message; render(); if (kind === 'f') { alert('FVS: ' + e.message); return; } if (!confirm('FVS: ' + e.message + '\n\nImprimir só o boletim + croqui?')) return; kind = 'bc'; } }
  let body = '', orient = 'landscape';
  const nome = nomePdf(kind);
  if (kind === 'f') { body = fvsHtml; }
  else if (kind === 'b') { body = docBoletim(MODO); }
  else if (kind === 'c') { body = docCroqui(MODO); }
  else if (kind === 'bc' || kind === 'bcf') { body = docBoletim(MODO) + '<div style="page-break-before:always"></div>' + docCroqui(MODO);
    if (fvsHtml) body += '<div style="page-break-before:always"></div>' + fvsHtml; }
  else if (kind === 'c1') {
    const keep = SVC; const svcs = Array.from(new Set(dadosDoc(MODO).ls.filter(x => !ehDesconto(x.l)).map(x => x.l.serv)));
    body = svcs.map((s, i) => { SVC = s; return (i ? '<div style="page-break-before:always"></div>' : '') + docCroqui(MODO); }).join(''); SVC = keep;
  }
  const fr = document.createElement('iframe'); fr.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
  document.body.appendChild(fr);
  const dd = fr.contentDocument; dd.open();
  dd.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(nome)}</title><style>@page{size:A4 ${orient};margin:7mm}body{margin:0;-webkit-print-color-adjust:exact;print-color-adjust:exact}${DOC_CSS}${FVS_CSS}</style></head><body>${body}</body></html>`);
  dd.close();
  // o Chrome sugere o nome do PDF pelo título da página: troca o título enquanto a janela de impressão está aberta e depois volta
  const tituloAntes = document.title; let voltou = false;
  const volta = () => { if (voltou) return; voltou = true; document.title = tituloAntes; };
  setTimeout(() => { document.title = nome; fr.contentWindow.addEventListener('afterprint', () => setTimeout(volta, 500)); fr.contentWindow.focus(); fr.contentWindow.print(); setTimeout(volta, 120000); setTimeout(() => fr.remove(), 150000); }, 400);
}

// ---------------- CONFERIR / LANÇAR NO PLANE
function vConferir() {
  const per = S.dataMed; const a = S.abas.find(x => x.nome === ABA) || S.abas[0]; ABA = a.nome;
  const ls = linhas(ABA, per, 'E').map(l => Object.assign({ l }, calc(l)));
  const pm = medPlane(ABA, per);
  const lan = pm.length > 0;
  const plQ = {}; pm.forEach(m => m.it.forEach(i => { plQ[i.isoi] = (plQ[i.isoi] || 0) + i.q; }));
  const myQ = {}; ls.forEach(x => { const is = x.it && x.it.isoi; if (is) myQ[is] = (myQ[is] || 0) + x.qt; });
  const plV = {}; pm.forEach(m => m.it.forEach(i => { plV[i.isoi] = (plV[i.isoi] || 0) + i.q * i.p; }));
  const myV = {}; ls.forEach(x => { const is = x.it && x.it.isoi; if (is) myV[is] = (myV[is] || 0) + x.valor; });
  const t = totais(ABA, per); const pb = pm.reduce((s, m) => s + m.bruto, 0);
  const rows = ls.map((x, i) => {
    const is = x.it && x.it.isoi; const pi = is ? PL.itens[is] : null;
    let conf;
    if (ehDesconto(x.l)) conf = '<span class="tag info">lançar em descontos</span>';
    else if (!is) conf = '<span class="tag bad">⚠ item sem vínculo com a OS</span>';
    else if (!PL.ok) conf = '<span class="tag mut">plane não lido</span>';
    else if (!lan) conf = '<span class="tag info">A LANÇAR</span>';
    else conf = Math.abs((plV[is] || 0) - myV[is]) < 0.015 ? '<span class="tag ok">✔ IGUAL</span>' : `<span class="tag bad">✖ DIFERENTE (plane: ${R$(plV[is] || 0)})</span>`;
    // quantidade a digitar no plane, na unidade/preço da OS (ex.: diária R$ 3.000 = 0,05 × R$ 60.000)
    const qPlane = pi && pi.preco ? (Math.abs(pi.preco - (x.preco || 0)) > 0.00005 ? x.valor / pi.preco : x.qt) : null;
    const conv = pi && qPlane != null && Math.abs(qPlane - x.qt) > 0.00005;
    const aviso = pi && conv && !equivalente(x.it, pi) ? `<span class="tag warn">preço OS ${R4(pi.preco)}</span>` : '';
    return `<tr><td class="c">${i + 1}</td><td>${esc(x.l.serv)}</td><td>${esc(x.l.local)}</td><td class="n">${Q(x.qt)}</td><td class="n">${R4(x.preco)}</td><td class="n">${R$(x.valor)}</td>
      <td class="c">${is || '—'}</td><td>${pi ? esc(pi.item) : (is && PL.ok ? '<span class="tag warn">não achado nas OS</span>' : '')}</td><td class="n">${pi ? R4(pi.preco) : ''}</td>
      <td class="n" style="background:#FFF2CC"><b>${qPlane == null ? '' : Q(Math.round(qPlane * 10000) / 10000)}</b>${conv ? '<br><span class="muted">(convertido p/ o preço da OS)</span>' : ''}</td>
      <td class="n">${is && lan ? Q(plQ[is] || 0) : ''}</td><td class="c">${conf} ${aviso}</td></tr>`;
  }).join('');
  const soPlane = []; pm.forEach(m => m.it.forEach(i => { soPlane.push(Object.assign({ med: m.id }, i)); }));
  return `<h2>Conferir / lançar no plane — ${esc(a.titulo)}</h2>
  <div class="bar">${selAba()}<span style="flex:1"></span>${PL.ok ? '' : '<span class="tag warn">plane ainda não lido</span>'}<button class="btn" data-act="plane">↻ Ler o plane de novo</button></div>
  <div class="cards"><div class="card"><div class="l">Situação no plane</div><div class="v" style="font-size:14px">${!PL.ok ? '—' : lan ? pm.map(m => `ID ${m.id} · ${stPt(m.st)}`).join('<br>') : 'NÃO LANÇADA'}</div></div>
   <div class="card"><div class="l">Bruto aqui</div><div class="v">${R$(t.bruto)}</div></div><div class="card"><div class="l">Bruto no plane</div><div class="v">${lan ? R$(pb) : '—'}</div></div>
   <div class="card ${lan && Math.abs(t.bruto - pb) > 0.01 ? 'rd' : 'gr'}"><div class="l">Diferença</div><div class="v">${lan ? R$(t.bruto - pb) : '—'}</div></div>
   <div class="card"><div class="l">A pagar no plane</div><div class="v">${lan ? R$(pm.reduce((s, m) => s + m.liq - m.ded, 0)) : '—'}</div></div></div>
  <div class="box muted">Para lançar: no plane, em cada linha escolha o item da OS da coluna <b>"Serviço no plane"</b> e digite a <b>"Qtd para digitar no plane"</b> (coluna amarela — já convertida quando o preço da OS é diferente, ex.: diária R$ 3.000 = 0,05 de R$ 60.000). A conferência compara o valor em R$. Depois de salvar lá, clique em "Ler o plane de novo" e confira a última coluna.</div>
  <table class="t"><thead><tr><th>#</th><th>Serviço (aqui)</th><th>Local</th><th>Qtd total (aqui)</th><th>Preço</th><th>Valor</th><th>ID item OS</th><th>Serviço no plane (escolher este)</th><th>Preço OS</th><th>Qtd para digitar no plane</th><th>Qtd já no plane</th><th>Conferência</th></tr></thead><tbody>${rows || '<tr><td colspan="12" class="c">Nenhuma linha executada neste período.</td></tr>'}</tbody></table>
  ${lan ? `<div class="sec">O QUE JÁ ESTÁ NO PLANE NESTA MEDIÇÃO</div><table class="t"><thead><tr><th>Medição</th><th>ID item OS</th><th>Serviço no plane</th><th>Qtd</th><th>Preço</th><th>Valor</th><th>Está aqui?</th></tr></thead><tbody>${soPlane.map(i => `<tr><td class="c">${i.med}</td><td class="c">${i.isoi}</td><td>${esc(i.desc)}</td><td class="n">${Q(i.q)}</td><td class="n">${R4(i.p)}</td><td class="n">${R$(i.q * i.p)}</td><td class="c">${myQ[i.isoi] != null ? '<span class="tag ok">✔ sim</span>' : '<span class="tag bad">✖ falta aqui</span>'}</td></tr>`).join('')}</tbody></table>` : ''}`;
}

// ---------------- CONTRATO
function vContrato() {
  const per = S.dataMed; const a = S.abas.find(x => x.nome === ABA) || S.abas[0]; ABA = a.nome;
  const lan = medPlane(ABA, per).length > 0;
  const esta = {}; linhas(ABA, per, 'E').forEach(l => { const c = calc(l); esta[l.serv] = (esta[l.serv] || 0) + c.qt; });
  let tc = 0, tm = 0, te = 0;
  const rows = itensDaAba(ABA).map(b => {
    const pi = b.isoi ? PL.itens[b.isoi] : null; const lab = rotulo(b); const e = esta[lab] || 0;
    const vc = pi ? pi.qtd * pi.preco : null, vm = pi ? pi.medido * pi.preco : null;
    if (vc) tc += vc; if (vm) tm += vm; te += e * (b.preco || 0);
    const saldo = pi ? pi.qtd - pi.medido - (lan ? 0 : e) : null;
    let st;
    if (!b.isoi) st = '<span class="tag bad">SEM ITEM NA OS</span>';
    else if (!PL.ok) st = '<span class="tag mut">plane não lido</span>';
    else if (!pi) st = '<span class="tag warn">não achado no plane</span>';
    else if (Math.abs(pi.preco - (b.preco || 0)) > 0.00005 && !equivalente(b, pi)) st = '<span class="tag warn">VALOR DIFERENTE</span>';
    else if (saldo < -0.0001) st = '<span class="tag warn">MEDIDO > QTD DA OS</span>';
    else st = '<span class="tag ok">OK</span>';
    return `<tr style="${e ? 'background:#EAF3FB' : ''}"><td class="c">${b.nAba || ''}</td><td>${esc(b.serv)}</td><td class="c">${esc(b.un)}</td><td class="n">${R4(b.preco)}</td><td class="c">${b.isoi || ''}</td><td class="n">${pi ? R4(pi.preco) : ''}</td><td class="n">${pi ? Q(pi.qtd) : ''}</td><td class="n">${pi ? Q(pi.medido) : ''}</td><td class="n">${e ? Q(e) : ''}</td><td class="n">${saldo == null ? '' : Q(saldo)}</td><td class="n">${pi && pi.qtd ? pct((pi.medido + (lan ? 0 : e)) / pi.qtd) : ''}</td><td class="c">${st}</td></tr>`;
  }).join('');
  return `<h2>Contrato × medido × saldo — ${esc(a.titulo)}</h2><div class="bar">${selAba()}</div>
  <div class="cards"><div class="card"><div class="l">Valor das OS (qtd OS × preço)</div><div class="v">${PL.ok ? R$(tc) : '—'}</div></div><div class="card"><div class="l">Já medido no plane</div><div class="v">${PL.ok ? R$(tm) : '—'}</div></div><div class="card"><div class="l">Esta medição</div><div class="v">${R$(te)}</div></div></div>
  <div class="box muted">Atenção: em muitas OS a "quantidade" é a de referência (por apto/hall), não o total contratado — aí "medido > qtd da OS" é normal. Azul claro = itens desta medição.</div>
  <table class="t"><thead><tr><th>Nº</th><th>Serviço</th><th>Unid</th><th>Preço base</th><th>ID item OS</th><th>Preço OS</th><th>Qtd na OS</th><th>Medido no plane</th><th>Esta medição</th><th>OS − medido</th><th>medido ÷ OS</th><th>Situação</th></tr></thead><tbody>${rows}</tbody></table>`;
}

// ---------------- BASE
function vBase() {
  const q = semac(BUSCA);
  const lista = S.base.filter(b => (!FILTRO_ABA || b.aba === FILTRO_ABA) && (!q || semac(b.serv + ' ' + b.aba + ' ' + b.etapa).indexOf(q) >= 0));
  const rows = lista.slice(0, 400).map(b => {
    const pi = b.isoi ? PL.itens[b.isoi] : null;
    const st0 = b.doPlane ? '<span class="tag info">NOVO DO PLANE</span> ' : '';
    const st = st0 + (!b.isoi ? '<span class="tag bad">NÃO ESTÁ NA OS</span>' : !PL.ok ? '' : !pi ? '<span class="tag warn">não achado</span>' : Math.abs(pi.preco - (b.preco || 0)) > 0.00005 ? (equivalente(b, pi) ? `<span class="tag ok" title="mesmo valor: base ${R4(b.preco)} × ${Q(b.qref || 1)} = OS ${R4(pi.preco)} × ${Q(pi.qtd)}">OK (equivalente)</span>` : '<span class="tag warn">VALOR DIFERENTE</span>') : b.vinc === 'conferir' ? '<span class="tag warn">CONFERIR NOME</span>' : '<span class="tag ok">OK</span>');
    return `<tr data-bid="${b.id}"><td class="c">${b.n || ''}</td><td>${esc(b.aba)}</td><td class="c">${b.nAba || ''}</td><td style="min-width:300px"><input data-b="serv" value="${esc(b.serv)}"></td><td style="width:60px"><input data-b="un" value="${esc(b.un)}"></td>
     <td style="width:100px"><input class="num" data-b="preco" value="${b.preco == null ? '' : NF4.format(b.preco)}"></td><td style="width:80px"><input class="num" data-b="qref" value="${b.qref == null ? '' : Q(b.qref)}"></td>
     <td style="width:80px"><input class="num" data-b="isoi" value="${b.isoi || ''}"></td><td>${pi ? esc(pi.item) : ''}</td><td class="n">${pi ? R4(pi.preco) + '<br><span class="muted">× ' + Q(pi.qtd) + '</span>' : ''}</td><td class="c">${st}</td></tr>`;
  }).join('');
  const ult = (S.logBase || []).slice(-40).reverse();
  return `<h2>Base de preços</h2>${boxNovidades(false)}
  <div class="box muted">A base é atualizada sozinha toda vez que o MedPrime lê o plane: serviço novo em OS entra aqui já ligado ao item, e preço mudado no plane troca aqui (as medições de meses anteriores ficam com o preço da época). Itens novos vêm sem "Qtd ref." — preencha quando o serviço for por apto.
  ${ult.length ? `<details style="margin-top:4px"><summary class="link">histórico das últimas atualizações automáticas</summary>${ult.map(e => `<div>${br(e.em.slice(0, 10))} · ${e.tipo === 'novo' ? '➕ novo' : e.tipo === 'preco' ? '💲 preço ' + R4(e.de) + ' → ' + R4(e.para) : '🔗 ligado'} · ${esc(e.aba)}: ${esc(e.serv)}</div>`).join('')}</details>` : ''}</div>
  <div class="bar"><label>Buscar</label><input id="busca" value="${esc(BUSCA)}" placeholder="parte do nome do serviço…" style="width:280px">
   <label>Aba</label><select data-act="fabase"><option value="">todas</option>${S.abas.map(a => `<option ${a.nome === FILTRO_ABA ? 'selected' : ''}>${esc(a.nome)}</option>`).join('')}</select>
   <span style="flex:1"></span><span class="muted">${lista.length} itens${lista.length > 400 ? ' (mostrando 400)' : ''}</span><button class="btn" data-act="novoitem">+ Novo item${FILTRO_ABA ? ' em ' + esc(FILTRO_ABA) : ''}</button></div>
  <table class="t"><thead><tr><th>Nº</th><th>Aba</th><th>Nº na aba</th><th>Serviço</th><th>Unid</th><th>Preço</th><th>Qtd ref.</th><th>ID item OS</th><th>Serviço no plane</th><th>Preço OS</th><th>Conferência</th></tr></thead><tbody>${rows}</tbody></table>
  <p class="muted">Mudar o texto ou o preço de um serviço vale para todos os lançamentos dele (como na planilha). Medições antigas que vieram do ARQUIVO ficam com o preço da época.</p>`;
}

// ---------------- PLANE
function vPlane() {
  const a = S.abas.find(x => x.nome === ABA) || S.abas[0]; ABA = a.nome;
  if (!PL.ok) return `<h2>Plane</h2><div class="box">${PL.carregando ? 'Lendo o plane…' : 'O plane ainda não foi lido. ' + (PL.erro ? '(' + esc(PL.erro) + ')' : '')} <button class="btn" data-act="plane">Ler agora</button></div>`;
  const sups = Object.keys(S.sup).filter(k => S.sup[k] === ABA).map(Number);
  const oss = PL.os.filter(o => sups.indexOf(o.sup) >= 0); const meds = PL.med.filter(m => sups.indexOf(m.sup) >= 0).sort((x, y) => y.fim.localeCompare(x.fim));
  return `<h2>Plane — ${esc(a.titulo)}</h2><div class="bar">${selAba()}<span class="muted">fornecedor(es) no plane: ${sups.map(s => esc(PL.sups[s] || s)).join(', ') || '<b style="color:#C00000">nenhum ligado a esta aba (veja Backup e ajustes)</b>'}</span></div>
  <div class="sec" style="background:#1F3864">ORDENS DE SERVIÇO</div><table class="t"><thead><tr><th>OS</th><th>Descrição</th><th>Ativa</th><th>ID item</th><th>Item</th><th>Preço</th><th>Qtd</th><th>Medido</th></tr></thead><tbody>
  ${oss.map(o => Object.values(PL.itens).filter(i => i.so === o.so).map((i, k) => `<tr><td class="c">${k ? '' : o.so}</td><td>${k ? '' : esc(o.desc)}</td><td class="c">${k ? '' : o.ativo ? 'sim' : 'não'}</td><td class="c">${i.isoi}</td><td>${esc(i.item)}</td><td class="n">${R4(i.preco)}</td><td class="n">${Q(i.qtd)}</td><td class="n">${Q(i.medido)}</td></tr>`).join('')).join('')}</tbody></table>
  <div class="sec" style="background:#1F3864">MEDIÇÕES</div><table class="t"><thead><tr><th>ID</th><th>OS</th><th>Título</th><th>Período</th><th>Situação</th><th>Bruto</th><th>Líquido</th><th>Descontos</th><th>A pagar</th></tr></thead><tbody>
  ${meds.map(m => `<tr><td class="c">${m.id}</td><td class="c">${m.so}</td><td>${esc(m.tit)}</td><td class="c">${br(m.ini)} a ${br(m.fim)}</td><td class="c"><span class="tag ${stPt(m.st) === 'APROVADA' ? 'ok' : 'warn'}">${stPt(m.st)}</span></td><td class="n">${R$(m.bruto)}</td><td class="n">${R$(m.liq)}</td><td class="n">${R$(m.ded)}</td><td class="n"><b>${R$(m.liq - m.ded)}</b></td></tr>`).join('')}</tbody></table>`;
}

// ---------------- CONFIG / BACKUP
function vConfig() {
  const sups = Object.keys(Object.assign({}, PL.sups, S.sup)).sort((x, y) => String(PL.sups[x] || '').localeCompare(String(PL.sups[y] || '')));
  return `<h2>Backup e ajustes</h2>
  <div class="grid2"><div class="box"><b>Backup em arquivo</b><p class="muted">Os dados ficam guardados neste Chrome. Salve um arquivo de backup (recomendado toda medição) — serve para restaurar ou levar para outro computador.</p>
   <button class="btn g" data-act="bkp">💾 Salvar backup (.json)</button> <button class="btn w" data-act="rest">📂 Abrir backup ou atualização de dados…</button>
   ${S.mapa ? '' : '<p style="color:#C00000"><b>Falta o mapa do croqui e os logos: abra o arquivo MedPrime_dados_REV46.json (botão acima) — seus lançamentos continuam.</b></p>'}
   <p class="muted">Último backup: ${S.ultimoBackup ? new Date(S.ultimoBackup).toLocaleString('pt-BR') : 'nunca'} · origem dos dados: ${esc(S.origem || '')}</p></div>
  <div class="box"><b>Planilha Excel</b><p class="muted">Se quiser continuar usando o Excel em paralelo: baixa o CSV do plane para a macro ATUALIZAR DO PLANE, ou os lançamentos do período em CSV.</p>
   <button class="btn w" data-act="csvplane">⬇ CSV do plane (Excel)</button> <button class="btn w" data-act="csvlanc">⬇ Lançamentos do período (CSV)</button>
   <p class="muted" style="margin-top:10px"><b>Novo empreiteiro</b> (aba nova): <input id="novoEmp" placeholder="NOME DO EMPREITEIRO" style="padding:4px;width:200px"> <button class="btn s" data-act="novoemp">criar</button></p></div></div>
  <div class="box"><b>Fornecedor do plane → empreiteiro aqui</b> <span class="muted">(é assim que o plane sabe de quem é cada medição)</span>
  <table class="t" style="margin-top:6px"><thead><tr><th>ID</th><th>Fornecedor no plane</th><th>Empreiteiro (aba)</th></tr></thead><tbody>
  ${sups.map(k => `<tr><td class="c">${k}</td><td>${esc(PL.sups[k] || '')}</td><td><select data-sup="${k}"><option value="">—</option>${S.abas.map(a => `<option ${S.sup[k] === a.nome ? 'selected' : ''}>${esc(a.nome)}</option>`).join('')}</select></td></tr>`).join('')}</tbody></table></div>
  <div class="box"><b>Recomeçar</b><p class="muted">Apaga o que está guardado neste Chrome (depois é só abrir um backup ou o arquivo de dados). Faça backup antes.</p><button class="btn r" data-act="reset">Apagar dados deste Chrome</button></div>`;
}
function baixar(nome, conteudo, tipo) {
  const blob = new Blob([conteudo], { type: tipo || 'application/octet-stream' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = nome; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
const hoje = () => isoD(new Date()).replace(/-/g, '');

// ---------------- local picker
function abrirPicker(id) {
  const l = S.lanc.find(x => x.id === id); if (!l) return;
  let sel = { bloco: 1, ap: new Set(), hl: new Set(), area: null };
  const m = document.createElement('div'); m.className = 'modal';
  const desenha = () => {
    const b = sel.bloco; const b15 = b === 15;
    let grid = '<table class="pick"><tr><th></th><th colspan="4">LADO A</th>' + (b15 ? '' : '<th>HALL A</th><th>HALL B</th><th colspan="4">LADO B</th>') + '</tr>';
    for (let f = 4; f >= 1; f--) {
      grid += `<tr><th>${f === 1 ? 'térreo' : f + 'º'}</th>`;
      for (let u = 1; u <= 4; u++) grid += `<td data-ap="${f}0${u}" class="${sel.ap.has(f + '0' + u) ? 'on' : ''}">${f}0${u}</td>`;
      if (!b15) { grid += `<td data-hl="${f}A" class="h ${sel.hl.has(f + 'A') ? 'on' : ''}">${f}A</td><td data-hl="${f}B" class="h ${sel.hl.has(f + 'B') ? 'on' : ''}">${f}B</td>`; for (let u = 5; u <= 8; u++) grid += `<td data-ap="${f}0${u}" class="${sel.ap.has(f + '0' + u) ? 'on' : ''}">${f}0${u}</td>`; }
      grid += '</tr>';
    }
    grid += '</table>';
    const areas = Object.keys(mapaObj()).filter(k => k.startsWith('A|')).map(k => `<div data-area="${esc(mapaObj()[k].orig)}" class="${sel.area === mapaObj()[k].orig ? 'on' : ''}">${esc(mapaObj()[k].orig)}</div>`).join('');
    m.innerHTML = `<div class="mbox"><h2>Escolher local</h2><div class="muted">Local atual: <b>${esc(l.local || '—')}</b></div>
     <div style="margin:10px 0">Bloco: ${Array.from({ length: 15 }, (_, i) => `<button class="btn s ${sel.bloco === i + 1 && !sel.area ? '' : 'w'}" data-bl="${i + 1}">${String(i + 1).padStart(2, '0')}</button>`).join(' ')}</div>
     ${sel.area ? '' : grid + '<div style="display:flex;gap:6px"><button class="btn s w" data-all="1">marcar todos</button><button class="btn s w" data-all="0">limpar</button></div>'}
     <div class="sec" style="background:#548235">ÁREAS COMUNS</div><div class="areas" style="margin-top:6px">${areas}</div>
     <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px"><button class="btn w" data-pk="cancel">Cancelar</button><button class="btn" data-pk="add">Inserir e marcar outro bloco</button><button class="btn g" data-pk="ok">Inserir</button></div></div>`;
  };
  const textoSel = () => {
    if (sel.area) return sel.area;
    const b = sel.bloco, b15 = b === 15;
    const all = []; for (let f = 1; f <= 4; f++) for (let u = 1; u <= (b15 ? 4 : 8); u++) all.push(f + '0' + u);
    const ap = all.filter(a => sel.ap.has(a)).map(Number).sort((x, y) => x - y);
    const hA = [1, 2, 3, 4].filter(f => sel.hl.has(f + 'A')), hB = [1, 2, 3, 4].filter(f => sel.hl.has(f + 'B'));
    let hTxt = '';
    if (!b15 && hA.length + hB.length === 8) hTxt = 'HALL';
    else if (hA.length === 4 && !hB.length) hTxt = 'HALL A';
    else if (hB.length === 4 && !hA.length) hTxt = 'HALL B';
    else if (hA.length + hB.length) { const l2 = []; for (let f = 1; f <= 4; f++) { if (sel.hl.has(f + 'A')) l2.push(f + 'A'); if (sel.hl.has(f + 'B')) l2.push(f + 'B'); } hTxt = 'HALL ' + l2.join(', '); }
    let t = 'BLOCO ' + String(b).padStart(2, '0');
    if (!ap.length && !hTxt) return t;   // só o número do bloco clicado = local BLOCO nn (não escreve TODOS OS APTOS)
    if (ap.length === all.length) return t + ' (TODOS OS APTOS)' + (hTxt ? ' + ' + hTxt : '');
    const fx = []; let i = 0;
    while (i < ap.length) { let a = ap[i], z = a; while (i + 1 < ap.length && ap[i + 1] === z + 1 && Math.floor(ap[i + 1] / 100) === Math.floor(z / 100)) { z = ap[++i]; } fx.push(z > a ? a + ' AO ' + z : String(a)); i++; }
    if (fx.length) t += ' - ' + fx.join(', ');
    if (hTxt) t += (fx.length ? ', ' : ' - ') + hTxt;
    return t;
  };
  const chaveSeg = s => { s = semac(s); const bl = blocos(s); if (bl.length) return 'BLOCO ' + String(+bl[0]).padStart(2, '0'); const ar = Object.keys(mapaObj()).filter(k => k.startsWith('A|')).map(k => mapaObj()[k].orig).find(n => s.indexOf(semac(n)) === 0); return ar || ''; };
  const inserir = () => {
    const txt = textoSel(); const key = sel.area || ('BLOCO ' + String(sel.bloco).padStart(2, '0'));
    const segs = segmentos(l.local); let achou = false; const novo = [];
    segs.forEach(sg => { if (chaveSeg(sg) === key) { if (!achou) novo.push(txt); achou = true; } else novo.push(sg); });
    if (!achou) novo.push(txt);
    l.local = novo.join(' ; ');
    const q = qtdAptosDoLocal(l.local); if (q > 0) l.n = q;
    salvar();
  };
  m.addEventListener('click', e => {
    const t = e.target.closest('[data-ap],[data-hl],[data-bl],[data-area],[data-all],[data-pk]'); if (!t) return;
    if (t.dataset.ap) { sel.ap.has(t.dataset.ap) ? sel.ap.delete(t.dataset.ap) : sel.ap.add(t.dataset.ap); }
    else if (t.dataset.hl) { sel.hl.has(t.dataset.hl) ? sel.hl.delete(t.dataset.hl) : sel.hl.add(t.dataset.hl); }
    else if (t.dataset.bl) { sel = { bloco: +t.dataset.bl, ap: new Set(), hl: new Set(), area: null }; }
    else if (t.dataset.area) { sel.area = sel.area === t.dataset.area ? null : t.dataset.area; }
    else if (t.dataset.all) { sel.ap.clear(); sel.hl.clear(); if (t.dataset.all === '1') { for (let f = 1; f <= 4; f++) { for (let u = 1; u <= (sel.bloco === 15 ? 4 : 8); u++) sel.ap.add(f + '0' + u); if (sel.bloco !== 15) { sel.hl.add(f + 'A'); sel.hl.add(f + 'B'); } } } }
    else if (t.dataset.pk === 'cancel') { m.remove(); return; }
    else if (t.dataset.pk === 'add') { inserir(); sel = { bloco: sel.bloco, ap: new Set(), hl: new Set(), area: null }; render(); }
    else if (t.dataset.pk === 'ok') { inserir(); m.remove(); render(); return; }
    desenha();
  });
  desenha(); R.appendChild(m);
}

// ---------------- eventos
function abrirArquivo(o) {
  if (ehBackup(o)) {
    if (S && !confirm(`Restaurar o backup com ${o.lanc.length} lançamentos? O que está aqui agora será substituído.`)) return;
    S = o; invalida(); _mapa = null; aplicarAjustes(); salvar(); VIEW = 'resumo'; render(); if (!PL.ok) carregarPlane(); return;
  }
  if (ehDados(o)) {
    if (!S) { S = seedState(o); invalida(); _mapa = null; aplicarAjustes(); salvar(); VIEW = 'resumo'; render(); carregarPlane(); return; }
    if (!confirm('Juntar esta atualização de dados (' + o.versao + ')? Só entram itens e empreiteiros novos; seus lançamentos e preços editados ficam como estão.')) return;
    const r = mesclarDados(o); alert(`Pronto: ${r.nb} itens novos na base e ${r.na} empreiteiros novos.`); render(); return;
  }
  throw new Error('este arquivo não é um backup nem um arquivo de dados do MedPrime');
}
function novaLinha(tipo) {
  const per = S.dataMed; const ord = Math.max(0, ...S.lanc.map(l => l.ord || 0)) + 1;
  const l = { id: uid(), aba: ABA, tipo: tipo === 'P' ? 'P' : 'E', per, data: tipo === 'P' ? (($('#prevAte') || {}).value || per) : per, serv: tipo === 'D' ? DESC_LABELS[0] : '', local: '', n: null, qreal: null, obs: '', ord, fonte: 'medprime' };
  S.lanc.push(l); salvar(); render();
  const inp = $(`tr[data-id="${l.id}"] input[data-f="serv"]`); if (inp) inp.focus();
}
function onClick(e) {
  const t = e.target.closest('[data-view],[data-goto],[data-add],[data-del],[data-dup],[data-pick],[data-print],[data-act],[data-irper],[data-reat],[data-ocultar],[data-criaemp],[data-usarpreco],[data-fechar]');
  if (!t) return;
  const d = t.dataset;
  if (d.view) { VIEW = d.view; render(); return; }
  if (d.goto) { if (d.aba) ABA = d.aba; VIEW = d.goto; render(); return; }
  if (d.add) { novaLinha(d.add); return; }
  if (d.del) { const l = S.lanc.find(x => x.id === d.del); if (l && confirm('Apagar a linha "' + (l.serv || '') + '"?')) { S.lanc = S.lanc.filter(x => x.id !== d.del); salvar(); render(); } return; }
  if (d.dup) { const l = S.lanc.find(x => x.id === d.dup); if (l) { const c = Object.assign({}, l, { id: uid(), ord: (l.ord || 0) + 0.5, fonte: 'medprime' }); S.lanc.push(c); salvar(); render(); } return; }
  if (d.pick) { abrirPicker(d.pick); return; }
  if (d.fechar) { if (d.fechar === 'leit') LEIT_FECHADA = NOVIDADES && NOVIDADES.id; else if (d.fechar === 'aviso') AVISO = ''; else { S.avisoFechado = d.fechar; salvar(); } render(); return; }
  if (d.usarpreco || d.act === 'usartodos') {
    const alvo = d.usarpreco ? NOVIDADES.conferir.filter(e => String(e.id) === d.usarpreco) : NOVIDADES.conferir.slice();
    if (d.act === 'usartodos' && !confirm(`Trocar ${alvo.length} preço(s) da base pelo preço do plane? As medições de meses anteriores ficam com o preço antigo.`)) return;
    alvo.forEach(e => { const b = S.base.find(x => String(x.id) === String(e.id)); if (b) { aplicarPreco(b, e.para, null, NOVIDADES); if (b.vinc === 'conferir') b.vinc = 'confirmado'; } });
    NOVIDADES.conferir = NOVIDADES.conferir.filter(e => alvo.indexOf(e) < 0); salvar(); render(); return;
  }
  if (d.ocultar) {
    const isoi = Number(d.ocultar); const b = S.base.find(x => Number(x.isoi) === isoi && x.doPlane);
    if (b && S.lanc.some(l => l.aba === b.aba && l.serv === rotulo(b))) { alert('Esse serviço já tem lançamento; não dá para tirar da base.'); return; }
    if (b) S.base = S.base.filter(x => x !== b);
    S.ocultosPlane = S.ocultosPlane || []; S.ocultosPlane.push(isoi);
    if (NOVIDADES) NOVIDADES.novos = NOVIDADES.novos.filter(x => Number(x.isoi) !== isoi);
    invalida(); salvar(); render(); return;
  }
  if (d.criaemp) {
    const nm0 = (PL.sups[d.criaemp] || '').toUpperCase().replace(/\b(LTDA|ME|EIRELI|S\/?A)\b\.?/g, '').replace(/\s+/g, ' ').trim();
    const nm = (prompt('Nome do empreiteiro (aba) para ' + (PL.sups[d.criaemp] || d.criaemp) + ':', nm0) || '').trim().toUpperCase(); if (!nm) return;
    if (!S.abas.find(a => a.nome === nm)) S.abas.push({ nome: nm, titulo: PL.sups[d.criaemp] || nm, disc: '', ret: 0.05 });
    S.sup[String(d.criaemp)] = nm; salvar(); sincronizarBase(); render(); return;
  }
  if (d.reat) { const l = S.lanc.find(x => x.id === d.reat); if (l) { l.fora = false; salvar(); render(); } return; }
  if (d.print) { imprimir(d.print); return; }
  if (d.irper) { S.dataMed = d.irper; salvar(); render(); return; }
  if (d.act === 'plane') { carregarPlane(); return; }
  if (d.act === 'bkp') { baixar(`MedPrime_backup_${hoje()}.json`, JSON.stringify(S), 'application/json'); S.ultimoBackup = new Date().toISOString(); salvar(); render(); return; }
  if (d.act === 'rest') { $('#fileRest').click(); return; }
  if (d.act === 'reset') { if (confirm('Apagar tudo o que está guardado neste Chrome? (faça backup antes)')) { S = null; store.set(null); invalida(); _mapa = null; render(); } return; }
  if (d.act === 'csvplane') { exportarCsvPlane(); return; }
  if (d.act === 'csvlanc') {
    const per = S.dataMed; const L = ['Empreiteiro;Tipo;Data;Serviço;Local;Nº aptos;Qtd/apto real;Observação;Unid;Preço;Qtd/apto;Qtd total;Valor'];
    S.lanc.filter(l => l.per === per).forEach(l => { const c = calc(l); L.push([l.aba, l.tipo, br(l.data), l.serv, l.local, l.n, l.qreal, l.obs, c.un, c.preco, c.qapto, c.qt, Math.round(c.valor * 100) / 100].map(v => String(v == null ? '' : v).replace(/;/g, ',').replace(/\n/g, ' ').replace(/^(-?\d+)\.(\d+)$/, '$1,$2')).join(';')); });
    baixar(`MedPrime_lancamentos_${per}.csv`, '﻿' + L.join('\r\n'), 'text/csv;charset=utf-8'); return;
  }
  if (d.act === 'novoitem') {
    const aba = FILTRO_ABA || prompt('Em qual empreiteiro (nome da aba)?', ABA || ''); if (!aba || !S.abas.find(a => a.nome === aba)) { if (aba) alert('Empreiteiro não encontrado.'); return; }
    const serv = prompt('Descrição do serviço:'); if (!serv) return;
    const un = prompt('Unidade (M², M, UND, VB…):', 'M²') || '';
    const preco = num(prompt('Preço unitário (R$):', '0') || '0');
    const nAba = Math.max(0, ...S.base.filter(b => b.aba === aba).map(b => +b.nAba || 0)) + 1;
    const id = Math.max(0, ...S.base.map(b => +b.id || 0)) + 1;
    S.base.push({ id, n: Math.max(0, ...S.base.map(b => +b.n || 0)) + 1, disc: (S.abas.find(a => a.nome === aba) || {}).disc || '', emp: aba, etapa: '', serv, un, preco, qref: 1, sit: 'Ativo', aba, isoi: null, vinc: '', nAba });
    invalida(); salvar(); render(); return;
  }
  if (d.act === 'novoemp') {
    const nm = ($('#novoEmp').value || '').trim().toUpperCase(); if (!nm) return;
    if (S.abas.find(a => a.nome === nm)) { alert('Já existe.'); return; }
    S.abas.push({ nome: nm, titulo: nm, disc: '', ret: 0.05 }); salvar(); ABA = nm; render(); return;
  }
}
function onChange(e) {
  const t = e.target; const d = t.dataset;
  if (d.fvs) { S.fvs = S.fvs || {}; if (t.value === '') delete S.fvs[d.fvs]; else S.fvs[d.fvs] = [+t.value]; FVS_ABERTO = true; FVS_MSG = ''; salvar(); render(); return; }
  if (d.act === 'aba') { ABA = t.value; SVC = 'TODOS'; render(); return; }
  if (d.act === 'modo') { MODO = t.value; render(); return; }
  if (d.act === 'svc') { SVC = t.value; render(); return; }
  if (d.act === 'fabase') { FILTRO_ABA = t.value; render(); return; }
  if (d.sup) { if (t.value) S.sup[d.sup] = t.value; else delete S.sup[d.sup]; salvar(); return; }
  if (t.id === 'ret') { const a = S.abas.find(x => x.nome === ABA); const v = num(t.value); if (a && v != null) { a.ret = v / 100; salvar(); render(); } return; }
  if (t.id === 'prevAte') { linhas(ABA, S.dataMed, 'P').forEach(l => { l.data = t.value; }); salvar(); return; }
  const tr = t.closest('tr[data-id]');
  if (tr && d.f) {
    const l = S.lanc.find(x => x.id === tr.dataset.id); if (!l) return;
    if (d.f === 'n' || d.f === 'qreal') l[d.f] = num(t.value);
    else if (d.f === 'data') { l.data = t.value; if (l.tipo === 'E' && t.value) { const p = perDe(t.value); if (p !== l.per && !confirm('Essa data é da medição de ' + br(p) + '. Mover a linha para lá?')) { t.value = l.per; l.data = l.per; } else l.per = p; } }
    else l[d.f] = t.value;
    if (d.f === 'local') { const q = qtdAptosDoLocal(l.local); if (q > 0) l.n = q; }
    l.fonte = l.fonte === 'arquivo' ? 'arquivo' : l.fonte;
    salvar(); render(); return;
  }
  const trb = t.closest('tr[data-bid]');
  if (trb && d.b) {
    const b = S.base.find(x => String(x.id) === trb.dataset.bid); if (!b) return;
    if (['preco', 'qref', 'isoi'].indexOf(d.b) >= 0) b[d.b] = num(t.value);
    else if (d.b === 'serv') { const velho = rotulo(b); b.serv = t.value; const novo = rotulo(b); S.lanc.forEach(l => { if (l.aba === b.aba && l.serv === velho) l.serv = novo; }); }
    else b[d.b] = t.value;
    invalida(); salvar(); return;
  }
}
let _tb;
function onInput(e) { if (e.target.id === 'busca') { BUSCA = e.target.value; clearTimeout(_tb); _tb = setTimeout(() => { render(); const i = $('#busca'); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }, 250); } }

// ---------------- CSV para a planilha Excel (mesmo formato do exportador antigo)
async function exportarCsvPlane() {
  try {
    const limpa = v => (v == null) ? '' : String(v).replace(/[;\r\n\t]+/g, ' ').trim();
    const nm = v => (v == null || v === '') ? '' : String(Number(v)); const dia = v => v ? String(v).slice(0, 10) : '';
    const so = await apiGet('serviceOrder/list?limit=all&construction_id=' + (S.cid || 50)); const oss = so.items || [];
    const me = oss.length ? await apiGet('measurement/list?limit=all&service_order_ids=' + oss.map(o => o.service_order_id).join(',')) : { items: [] };
    const L = ['TIPO;A;B;C;D;E;F;G;H;I;J;K;L;M']; const sup = {};
    oss.forEach(o => { if (o.supplier) sup[o.supplier_id] = o.supplier; L.push(['OS', o.service_order_id, o.supplier_id, o.is_active ? 'SIM' : 'NÃO', limpa(o.description), limpa(o.status)].join(';'));
      (o.item_service_order || []).forEach(i => { const inp = i.input || {}; L.push(['IT', i.item_service_order_id, o.service_order_id, i.input_id, limpa(i.item || inp.item), limpa(i.description), '', nm(i.price), nm(i.quantity), i.is_rework ? 'SIM' : 'NÃO', limpa(inp.budget && inp.budget.service_level_3)].join(';')); }); });
    (me.items || []).forEach(m => { if (m.supplier) sup[m.supplier_id] = m.supplier; const ret = m.supplier && m.supplier.type_supplier ? nm(m.supplier.type_supplier.discounts) : '';
      const ap = [m.approved_by_engenheiro_user_id, m.approved_by_otimizacao_user_id, m.approved_by_supervisor_planejamento_user_id, m.approved_by_supervisor_obras_user_id].map(x => x ? '1' : '0').join('');
      L.push(['ME', m.measurement_id, m.service_order_id, m.supplier_id, dia(m.start), dia(m.end), limpa(m.title), limpa(m.status), m.is_last_measurement ? 'SIM' : 'NÃO', nm(m.inputs_total_value), nm(m.deductions_total_value), ret, ap, dia(m.updatedAt)].join(';'));
      (m.input_measurements || []).forEach(i => L.push(['MI', m.measurement_id, i.input_id, nm(i.quantity), nm(i.price), limpa(i.description || i.item), '', i.input && i.input.input ? limpa(i.input.input.unity) : ''].join(';')));
      (m.deduction_measurements || []).forEach(dd => L.push(['MD', m.measurement_id, limpa(dd.deduction && dd.deduction.title), nm(dd.quantity), nm(dd.price)].join(';'))); });
    Object.keys(sup).forEach(id => L.push(['SUP', id, limpa(sup[id].company), limpa(sup[id].type_supplier && sup[id].type_supplier.title)].join(';')));
    const dt = new Date(), p = n => String(n).padStart(2, '0');
    baixar(`PLANE_EXPORT_${dt.getFullYear()}${p(dt.getMonth() + 1)}${p(dt.getDate())}_${p(dt.getHours())}${p(dt.getMinutes())}.csv`, '﻿' + L.join('\r\n'), 'text/csv;charset=utf-8');
  } catch (er) { alert('Erro ao ler o plane: ' + er.message); }
}

// ---------------- botão flutuante
function fab() {
  if (document.getElementById('medprime-fab') || !document.body) return;
  const b = document.createElement('button'); b.id = 'medprime-fab'; b.textContent = '📐 MedPrime';
  b.style.cssText = 'position:fixed;right:18px;bottom:18px;z-index:2147482999;background:#1F3864;color:#fff;border:0;border-radius:24px;padding:11px 18px;font:700 13px Arial,sans-serif;cursor:pointer;box-shadow:0 3px 12px rgba(0,0,0,.35)';
  b.title = 'Abrir o MedPrime (medição Prime Clube)'; b.onclick = abrir;
  document.body.appendChild(b);
}
S = store.get();
if (!S || !S.v) S = null;
aplicarAjustes();
setInterval(fab, 1500); fab();
W.__MedPrime = { abrir, versao: VERSAO, estado: () => S, _t: { qtdAptosDoLocal, chavesDaLinha, calc, totais, perDe, iniDe } };
})();
