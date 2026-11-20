'use strict';
/* Mesa de Imbondeiro — aplicação (fases 0 e 1). Funciona sem rede: as operações ficam em fila e sincronizam sozinhas. */
const $ = (s, el) => (el || document).querySelector(s);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const kz = (n) => new Intl.NumberFormat('pt-PT', { maximumFractionDigits: 0 }).format(Math.round(n || 0)).replace(/\s/g, ' ') + ' Kz';
const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : 'x' + Date.now().toString(36) + Math.random().toString(36).slice(2));
const ls = { get: (k, d) => { try { const v = localStorage.getItem('mdi.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } }, set: (k, v) => { try { localStorage.setItem('mdi.' + k, JSON.stringify(v)); } catch (e) {} }, del: (k) => { try { localStorage.removeItem('mdi.' + k); } catch (e) {} } };
const hora = (t) => new Date(t).toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' });
const dataHora = (t) => new Date(t).toLocaleString('pt-PT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const mins = (t) => Math.max(0, Math.round((Date.now() - new Date(t).getTime()) / 60000));
const hojeLuanda = () => new Date(Date.now() + 3600e3).toISOString().slice(0, 10);

const MEIOS = [['numerario', 'Numerário'], ['tpa', 'TPA Multicaixa'], ['express', 'Multicaixa Express'], ['transferencia', 'Transferência']];
const meioNome = (m) => (MEIOS.find((x) => x[0] === m) || [m, m])[1];
const PERFIS = { admin: 'Administração', gerente: 'Gerente', caixa: 'Caixa', empregado: 'Empregado de mesa', cozinha: 'Cozinha', bar: 'Bar' };
const PODE = { cfg: ['admin', 'gerente'], admin: ['admin'], pedir: ['admin', 'gerente', 'caixa', 'empregado'], pagar: ['admin', 'gerente', 'caixa'], aprovar: ['admin', 'gerente'] };
const ESTADOS = { novo: 'por enviar', enviado: 'enviado', preparar: 'a preparar', pronto: 'pronto', entregue: 'entregue', anulado: 'anulado' };

const S = { token: ls.get('token', ''), user: ls.get('user', null), local: ls.get('local', ''), st: ls.get('state', null), queue: ls.get('queue', []), online: navigator.onLine, fam: '', x: {} };
const pode = (k) => !!S.user && PODE[k].includes(S.user.perfil);
const guardar = () => { ls.set('state', S.st); ls.set('queue', S.queue); ls.set('local', S.local); };

function toast(msg, tipo) {
  const d = document.createElement('div'); d.textContent = msg; if (tipo) d.className = tipo;
  $('#toast').appendChild(d); setTimeout(() => d.remove(), tipo === 'erro' ? 5000 : 2500);
}

async function api(path, o) {
  o = o || {};
  const qs = o.query ? '?' + new URLSearchParams(o.query) : '';
  let r;
  try {
    r = await fetch('/api/' + path + qs, { method: o.method || 'GET', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + S.token }, body: o.body ? JSON.stringify(o.body) : undefined });
  } catch (e) { const er = new Error('Sem ligação ao servidor'); er.offline = true; throw er; }
  let j = {}; try { j = await r.json(); } catch (e) {}
  if (r.status === 401 && path !== 'login') { sair(true); const er = new Error(j.erro || 'Sessão expirada'); er.auth = true; throw er; }
  if (r.status >= 502) { const er = new Error('Servidor indisponível'); er.offline = true; throw er; }
  if (!r.ok) throw new Error(j.erro || 'Erro ' + r.status);
  return j;
}

/* ---------- Sincronização ---------- */
let aSincronizar = false;
const VIVAS = ['mesas', 'pedido', 'cozinha', 'bar'];
async function sync() {
  if (!S.token || aSincronizar) return;
  aSincronizar = true;
  const antes = JSON.stringify(S.st);
  try {
    while (S.queue.length) {
      const lote = S.queue.slice(0, 40);
      const r = await api('ops', { method: 'POST', body: { ops: lote } });
      const ids = new Set(lote.map((o) => o.id));
      S.queue = S.queue.filter((o) => !ids.has(o.id)); guardar();
      r.resultados.filter((x) => !x.ok).forEach((x) => toast(x.erro, 'erro'));
    }
    const st = await api('state', { query: S.local ? { local: S.local } : {} });
    S.st = st; S.local = st.local.id;
    S.queue.forEach((o) => { try { aplicar(o); } catch (e) {} });
    guardar(); S.online = true;
  } catch (e) {
    if (e.offline) S.online = false; else if (!e.auth) toast(e.message, 'erro');
  } finally {
    aSincronizar = false;
    pintarEstado();
    if (S.token && JSON.stringify(S.st) !== antes && (antes === 'null' || (VIVAS.includes(rota().v) && !$('#modal').classList.contains('on')))) render();
  }
}
function pintarEstado() {
  const p = $('#estado'); if (!p) return;
  const n = S.queue.length;
  p.className = 'pill' + (S.online ? '' : ' off');
  p.textContent = S.online ? (n ? 'A sincronizar ' + n : 'Online') : 'Offline' + (n ? ' · ' + n + ' por enviar' : '');
}

/* ---------- Operações (aplicadas já no dispositivo, enviadas quando há rede) ---------- */
const P = (id) => S.st.pedidos.find((p) => p.id === id);
const linhaDe = (id) => { for (const p of S.st.pedidos) { const l = p.linhas.find((x) => x.id === id); if (l) return [p, l]; } return [null, null]; };
const recalc = (p) => { p.total = Math.max(0, p.linhas.filter((l) => l.estado !== 'anulado').reduce((s, l) => s + l.preco * l.qtd, 0) - (p.desconto || 0)); };
const pago = (p) => p.pagamentos.reduce((s, g) => s + g.valor, 0);
function aplicar(o) {
  const d = o.d, st = S.st;
  switch (o.tipo) {
    case 'pedido.abrir': {
      const m = d.mesa_id && st.mesas.find((x) => x.id === d.mesa_id);
      if (m && st.pedidos.some((p) => p.mesa_id === m.id)) throw new Error(m.nome + ' já tem uma conta aberta');
      st.pedidos.push({ id: d.id, mesa_id: d.mesa_id || null, mesa_nome: m ? m.nome : (d.tipo === 'takeaway' ? 'Take-away' : 'Balcão'), tipo: m ? 'mesa' : d.tipo, aberto_por_nome: S.user.nome, aberto_em: o.ts, cliente_nome: '', desconto: 0, total: 0, linhas: [], pagamentos: [] });
      break;
    }
    case 'linha.add': {
      const p = P(d.pedido_id), a = st.artigos.find((x) => x.id === d.artigo_id); if (!p || !a) throw new Error('Artigo ou conta em falta');
      const f = st.familias.find((x) => x.id === a.familia_id);
      p.linhas.push({ id: d.id, pedido_id: p.id, artigo_id: a.id, nome: a.nome, preco: a.preco, qtd: d.qtd || 1, notas: d.notas || '', seccao: f ? f.seccao : 'cozinha', estado: 'novo', criado_em: o.ts }); recalc(p); break;
    }
    case 'linha.qtd': { const [p, l] = linhaDe(d.id); if (!l) break; if (d.qtd <= 0) p.linhas = p.linhas.filter((x) => x !== l); else { l.qtd = d.qtd; if (d.notas != null) l.notas = d.notas; } recalc(p); break; }
    case 'linha.anular': { const [p, l] = linhaDe(d.id); if (l) { l.estado = 'anulado'; recalc(p); } break; }
    case 'pedido.enviar': { const p = P(d.pedido_id); if (p) p.linhas.forEach((l) => { if (l.estado === 'novo') { l.estado = 'enviado'; l.enviado_em = o.ts; } }); break; }
    case 'linha.estado': { const [, l] = linhaDe(d.id); if (l) l.estado = d.estado; break; }
    case 'pedido.desconto': { const p = P(d.pedido_id); if (p) { p.desconto = d.valor; recalc(p); } break; }
    case 'pedido.transferir': { const p = P(d.pedido_id), m = st.mesas.find((x) => x.id === d.mesa_id); if (p && m) { if (st.pedidos.some((x) => x.mesa_id === m.id && x !== p)) throw new Error(m.nome + ' já tem uma conta aberta'); p.mesa_id = m.id; p.mesa_nome = m.nome; p.tipo = 'mesa'; } break; }
    case 'pagamento.add': { const p = P(d.pedido_id); if (!st.turno) throw new Error('Abra a caixa antes de receber pagamentos'); if (p) p.pagamentos.push({ id: d.id, pedido_id: p.id, meio: d.meio, valor: d.valor }); break; }
    case 'pagamento.remover': { st.pedidos.forEach((p) => { p.pagamentos = p.pagamentos.filter((g) => g.id !== d.id); }); break; }
    case 'pedido.fechar': { const p = P(d.pedido_id); if (p) { if (pago(p) + 0.005 < p.total) throw new Error('Falta receber ' + kz(p.total - pago(p))); st.pedidos = st.pedidos.filter((x) => x !== p); } break; }
    case 'pedido.anular': { st.pedidos = st.pedidos.filter((x) => x.id !== d.pedido_id); break; }
    case 'turno.abrir': { st.turno = { id: d.id, utilizador_nome: S.user.nome, aberto_em: o.ts, fundo: d.fundo || 0 }; break; }
    case 'turno.fechar': { st.turno = null; break; }
  }
}
function op(tipo, d) {
  const o = { id: uuid(), tipo, d, ts: new Date().toISOString() };
  try { aplicar(o); } catch (e) { toast(e.message, 'erro'); return false; }
  S.queue.push(o); guardar(); pintarEstado(); sync();
  return true;
}

/* ---------- Modal e formulários ---------- */
function modal(html) { const m = $('#modal'); m.innerHTML = '<div class="cx">' + html + '</div>'; m.classList.add('on'); const i = $('input:not([type=hidden]), select', m); if (i) setTimeout(() => i.focus(), 30); }
function fechar() { $('#modal').classList.remove('on'); $('#modal').innerHTML = ''; }
function form(titulo, campos, ok, extra) {
  modal(`<h2>${esc(titulo)}</h2><form id="f">${campos.map((c) => {
    const v = c.value == null ? '' : c.value;
    if (c.type === 'select') return `<label>${esc(c.label)}</label><select name="${c.k}">${c.options.map((o) => `<option value="${esc(o[0])}" ${String(o[0]) === String(v) ? 'selected' : ''}>${esc(o[1])}</option>`).join('')}</select>`;
    if (c.type === 'check') return `<label><input type="checkbox" name="${c.k}" ${v ? 'checked' : ''} style="width:auto"> ${esc(c.label)}</label>`;
    return `<label>${esc(c.label)}</label><input name="${c.k}" type="${c.type || 'text'}" value="${esc(v)}" ${c.type === 'number' ? 'step="any" inputmode="decimal"' : ''} ${c.req ? 'required' : ''} ${c.ph ? `placeholder="${esc(c.ph)}"` : ''} autocomplete="off">`;
  }).join('')}${extra || ''}<div class="fila" style="margin-top:18px"><span class="esp"></span><button type="button" class="btn" data-a="fechar">Cancelar</button><button class="btn p">Confirmar</button></div></form>`);
  $('#f').onsubmit = async (e) => {
    e.preventDefault();
    const v = {}; campos.forEach((c) => { const el = e.target.elements[c.k]; v[c.k] = c.type === 'check' ? el.checked : (c.type === 'number' ? (el.value === '' ? '' : Number(el.value)) : el.value.trim()); });
    try { const r = await ok(v); if (r !== false) fechar(); } catch (er) { toast(er.message, 'erro'); }
  };
}

/* ---------- Navegação ---------- */
const rota = () => { const [v, id] = location.hash.replace(/^#\/?/, '').split('/'); return { v: v || '', id }; };
const ir = (h) => { if (location.hash === '#' + h) render(); else location.hash = h; };
function menus() {
  const p = S.user.perfil;
  if (p === 'cozinha') return [['cozinha', 'Cozinha']];
  if (p === 'bar') return [['bar', 'Bar']];
  const m = [['mesas', 'Mesas'], ['cozinha', 'Cozinha'], ['bar', 'Bar']];
  if (pode('pagar')) m.push(['caixa', 'Caixa'], ['facturacao', 'Facturação']);
  if (pode('aprovar')) m.push(['relatorios', 'Relatórios']);
  if (pode('cfg')) m.push(['menu', 'Menu digital'], ['config', 'Configuração'], ['fases', 'Próximas fases']);
  return m;
}
function sair(silencioso) { S.token = ''; S.user = null; ls.del('token'); ls.del('user'); if (!silencioso) { S.st = null; ls.del('state'); } render(); }

function render() {
  const app = $('#app');
  if (!S.token || !S.user) return (app.innerHTML = vLogin());
  if (!S.st) { app.innerHTML = '<div class="login"><div class="cx"><img src="/logo.png" alt=""><p>A carregar…</p><p class="mudo">Na primeira utilização é precisa ligação à internet.</p></div></div>'; return; }
  const ms = menus(), r = rota();
  if (!ms.some((m) => m[0] === r.v) && r.v !== 'pedido') { location.hash = ms[0][0]; return; }
  const on = r.v === 'pedido' ? 'mesas' : r.v;
  let corpo = '';
  try { corpo = ({ mesas: vMesas, pedido: vPedido, cozinha: () => vKds('cozinha'), bar: () => vKds('bar'), caixa: vCaixa, facturacao: vFact, relatorios: vRel, menu: vMenu, config: vCfg, fases: vFases })[r.v](r.id); } catch (e) { corpo = '<div class="aviso">Erro a mostrar este ecrã: ' + esc(e.message) + '</div>'; console.error(e); }
  app.innerHTML = `<div class="topo"><a class="marca" href="#mesas" style="text-decoration:none"><img src="/icon-192.png" alt="">Mesa de Imbondeiro</a>
    ${S.st.locais.length > 1 ? `<select id="selLocal">${S.st.locais.map((l) => `<option value="${l.id}" ${l.id === S.local ? 'selected' : ''}>${esc(l.nome)}</option>`).join('')}</select>` : ''}
    <nav>${ms.map((m) => `<a href="#${m[0]}" class="${m[0] === on ? 'on' : ''}">${m[1]}</a>`).join('')}</nav>
    <span id="estado" class="pill"></span><button class="eu" data-a="eu">${esc(S.user.nome.split(' ')[0])} ▾</button></div><main>${corpo}</main>`;
  pintarEstado();
}

/* ---------- Ecrãs ---------- */
function vLogin() {
  return `<div class="login"><form class="cx cartao" id="fLogin"><img src="/logo.png" alt="Mesa de Imbondeiro"><p class="mudo">Gestão de restaurantes e bares</p>
    <label style="text-align:left">Utilizador</label><input name="login" autocomplete="username" autocapitalize="none" required>
    <label style="text-align:left">Palavra-passe</label><input name="password" type="password" autocomplete="current-password" required>
    <button class="btn p" style="width:100%;margin-top:16px">Entrar</button></form></div>`;
}

function vMesas() {
  const st = S.st, zonas = [...new Set(st.mesas.map((m) => m.zona))];
  const cartao = (m) => { const p = st.pedidos.find((x) => x.mesa_id === m.id);
    return `<button class="mesa ${p ? 'oc' : ''}" data-a="mesa" data-id="${m.id}"><b>${esc(m.nome)}</b><span class="mudo">${p ? esc(p.aberto_por_nome) + ' · ' + mins(p.aberto_em) + ' min' : m.lugares + ' lugares · livre'}</span>${p ? `<span class="tot">${kz(p.total)}</span>` : ''}</button>`; };
  const soltas = st.pedidos.filter((p) => !p.mesa_id);
  return `<div class="cab"><h1>${esc(st.local.nome)}</h1><span class="esp"></span>
    <button class="btn" data-a="nova" data-t="balcao">Nova conta de balcão</button><button class="btn" data-a="nova" data-t="takeaway">Novo take-away</button></div>
    ${!st.turno && pode('pagar') ? '<div class="aviso">A caixa está fechada. Pode registar pedidos, mas para receber pagamentos abra a caixa no menu <a href="#caixa">Caixa</a>.</div>' : ''}
    ${soltas.length ? `<h3 class="zona">Balcão e take-away</h3><div class="grelha">${soltas.map((p) => `<button class="mesa oc" data-a="abrir" data-id="${p.id}"><b>${esc(p.mesa_nome)}</b><span class="mudo">${esc(p.aberto_por_nome)} · ${hora(p.aberto_em)}</span><span class="tot">${kz(p.total)}</span></button>`).join('')}</div>` : ''}
    ${zonas.map((z) => `<h3 class="zona">${esc(z)}</h3><div class="grelha">${st.mesas.filter((m) => m.zona === z).map(cartao).join('')}</div>`).join('')}`;
}

function vPedido(id) {
  const st = S.st, p = P(id);
  if (!p) return `<div class="aviso">Esta conta já foi fechada.</div><a class="btn" href="#mesas">Voltar às mesas</a>`;
  if (!S.fam || !st.familias.some((f) => f.id === S.fam)) S.fam = (st.familias[0] || {}).id;
  const novos = p.linhas.filter((l) => l.estado === 'novo').length, pg = pago(p), bruto = p.total + (p.desconto || 0);
  return `<div class="cab"><a class="btn s" href="#mesas">← Mesas</a><h1>${esc(p.mesa_nome)}</h1><span class="mudo">aberta por ${esc(p.aberto_por_nome)} às ${hora(p.aberto_em)}</span></div>
  <div class="pedido"><div>
    <div class="chips">${st.familias.map((f) => `<button class="chip ${f.id === S.fam ? 'on' : ''}" data-a="fam" data-id="${f.id}">${esc(f.nome)}</button>`).join('')}</div>
    <div class="arts">${st.artigos.filter((a) => a.familia_id === S.fam).map((a) => `<button class="art" data-a="add" data-id="${a.id}"><b>${esc(a.nome)}</b><span>${kz(a.preco)}</span></button>`).join('') || '<p class="mudo">Sem artigos nesta família.</p>'}</div>
  </div>
  <div class="cartao conta">
    ${p.linhas.length ? p.linhas.map((l) => `<div class="lin ${l.estado}">
      ${l.estado === 'novo' ? `<div class="qt"><button data-a="menos" data-id="${l.id}">−</button><b>${l.qtd}</b><button data-a="mais" data-id="${l.id}">+</button></div>` : `<b>${l.qtd}×</b>`}
      <div class="n">${esc(l.nome)}<small>${l.notas ? esc(l.notas) + ' · ' : ''}<span class="est ${l.estado}">${ESTADOS[l.estado]}</span></small></div>
      <span class="v">${kz(l.preco * l.qtd)}</span>
      ${l.estado === 'novo' ? `<button class="btn s" data-a="nota" data-id="${l.id}" title="Nota para a cozinha">✎</button>` : (l.estado !== 'anulado' && pode('aprovar') ? `<button class="btn s perigo" data-a="anularL" data-id="${l.id}">Anular</button>` : '')}
    </div>`).join('') : '<p class="mudo">Toque nos artigos para os juntar à conta.</p>'}
    <div style="margin-top:10px">
      ${p.desconto ? `<div class="tot-l"><span>Subtotal</span><span>${kz(bruto)}</span></div><div class="tot-l"><span>Desconto</span><span>− ${kz(p.desconto)}</span></div>` : ''}
      <div class="tot-l g"><span>Total</span><span>${kz(p.total)}</span></div>
      ${pg ? `<div class="tot-l"><span>Recebido</span><span>${kz(pg)}</span></div><div class="tot-l"><b>Em falta</b><b>${kz(Math.max(0, p.total - pg))}</b></div>` : ''}
    </div>
    <div class="fila" style="margin-top:12px">
      <button class="btn p" style="flex:1" data-a="enviar" data-id="${p.id}" ${novos ? '' : 'disabled'}>Enviar pedido${novos ? ' (' + novos + ')' : ''}</button>
      ${pode('pagar') ? `<button class="btn p" style="flex:1" data-a="receber" data-id="${p.id}" ${p.linhas.length ? '' : 'disabled'}>Receber</button>` : ''}
    </div>
    <div class="fila" style="margin-top:8px">
      <button class="btn s" data-a="consulta" data-id="${p.id}">Consulta de mesa</button>
      <button class="btn s" data-a="transferir" data-id="${p.id}">Mudar de mesa</button>
      ${pode('aprovar') ? `<button class="btn s" data-a="desconto" data-id="${p.id}">Desconto</button><button class="btn s perigo" data-a="anularP" data-id="${p.id}">Anular conta</button>` : ''}
    </div>
  </div></div>`;
}

function mReceber(id) {
  const p = P(id); if (!p) return fechar();
  const falta = Math.max(0, p.total - pago(p)), x = S.x.rec || (S.x.rec = {});
  if (!S.st.turno) return modal(`<h2>Caixa fechada</h2><p>Para receber pagamentos é preciso abrir a caixa.</p><div class="fila"><span class="esp"></span><button class="btn" data-a="fechar">Fechar</button><a class="btn p" href="#caixa" data-a="fechar">Ir para a Caixa</a></div>`);
  modal(`<h2>Receber — ${esc(p.mesa_nome)}</h2>
    <div class="tot-l g"><span>${falta > 0 ? 'Em falta' : 'Conta paga'}</span><span>${kz(falta)}</span></div>
    ${p.pagamentos.map((g) => `<div class="lin"><div class="n">${meioNome(g.meio)}</div><span>${kz(g.valor)}</span><button class="btn s" data-a="rmPag" data-id="${g.id}" data-p="${p.id}">✕</button></div>`).join('')}
    ${x.troco ? `<div class="aviso" style="margin-top:10px">Troco a devolver: <b>${kz(x.troco)}</b></div>` : ''}
    ${falta > 0 ? `<label>Valor recebido (Kz)</label><input id="recValor" type="number" inputmode="decimal" value="${Math.round(falta)}">
      <div class="meios">${MEIOS.map((m) => `<button class="btn" data-a="pagar" data-m="${m[0]}" data-id="${p.id}">${m[1]}</button>`).join('')}</div>` : ''}
    <label>Nome do cliente (opcional)</label><input id="recNome" value="${esc(x.nome || '')}" autocomplete="off">
    <label>NIF do cliente (opcional)</label><input id="recNif" value="${esc(x.nif || '')}" inputmode="numeric" autocomplete="off">
    <div class="fila" style="margin-top:16px"><span class="esp"></span><button class="btn" data-a="fechar">Voltar</button><button class="btn p" data-a="fecharConta" data-id="${p.id}" ${falta > 0 ? 'disabled' : ''}>Fechar conta</button></div>`);
}

function consulta(p) {
  const e = S.st.empresa;
  $('#print').className = '';
  $('#print').innerHTML = `<h2>${esc(e.nome)}</h2><div class="c">${esc(S.st.local.nome)}${e.nif ? '<br>NIF ' + esc(e.nif) : ''}</div><hr>
    <div><b>CONSULTA DE MESA</b><br>${esc(p.mesa_nome)} · ${dataHora(new Date())}<br>Atendido por ${esc(p.aberto_por_nome)}</div><hr>
    <table>${p.linhas.filter((l) => l.estado !== 'anulado').map((l) => `<tr><td>${l.qtd}×</td><td>${esc(l.nome)}</td><td style="text-align:right">${kz(l.preco * l.qtd)}</td></tr>`).join('')}</table><hr>
    ${p.desconto ? `<div>Desconto: − ${kz(p.desconto)}</div>` : ''}<div><b>TOTAL: ${kz(p.total)}</b></div><hr>
    <div class="c">Este documento não serve de factura.<br>A factura é emitida pelo software de facturação certificado.</div>`;
  window.print();
}

function vKds(sec) {
  const act = ['enviado', 'preparar', 'pronto'];
  const tics = S.st.pedidos.map((p) => ({ p, ls: p.linhas.filter((l) => l.seccao === sec && act.includes(l.estado)) })).filter((t) => t.ls.length)
    .sort((a, b) => new Date(a.ls[0].enviado_em || a.ls[0].criado_em) - new Date(b.ls[0].enviado_em || b.ls[0].criado_em));
  return `<div class="cab"><h1>${sec === 'bar' ? 'Bar' : 'Cozinha'}</h1><span class="mudo">Toque numa linha para avançar: enviado → a preparar → pronto → entregue</span></div>
    ${tics.length ? `<div class="kds">${tics.map(({ p, ls: l }) => { const m = mins(l[0].enviado_em || l[0].criado_em);
      return `<div class="tic ${m >= 15 ? 'tarde' : ''}"><header><span>${esc(p.mesa_nome)}</span><span>${m} min</span></header>${l.map((x) => `<button class="${x.estado}" data-a="kds" data-id="${x.id}" data-e="${x.estado}"><b>${x.qtd}×</b><span style="flex:1">${esc(x.nome)}${x.notas ? `<br><small><i>${esc(x.notas)}</i></small>` : ''}</span><span class="est ${x.estado}">${ESTADOS[x.estado]}</span></button>`).join('')}</div>`; }).join('')}</div>`
      : '<div class="cartao">Sem pedidos em espera.</div>'}`;
}

/* Ecrãs que precisam do servidor: carregam e voltam a desenhar */
function carregar(chave, fn) {
  const c = S.x[chave];
  if (c && c.pronto) return c;
  if (!c) { S.x[chave] = { pronto: false }; fn().then((d) => { S.x[chave] = { pronto: true, d }; render(); }).catch((e) => { S.x[chave] = { pronto: true, erro: e.message }; render(); }); }
  return null;
}
const recarregar = (chave) => { delete S.x[chave]; render(); };
const espera = (c) => (c === null ? '<div class="cartao">A carregar…</div>' : c.erro ? `<div class="aviso">${esc(c.erro)}. Este ecrã precisa de ligação à internet. <button class="btn s" data-a="recarregar">Tentar de novo</button></div>` : '');

function vCaixa() {
  const c = carregar('caixa', () => api('turno', { query: { local: S.local } }));
  if (!c || c.erro) return '<div class="cab"><h1>Caixa</h1></div>' + espera(c);
  const d = c.d, t = d.turno;
  const ult = d.ultimos.length ? `<h2 style="margin:20px 0 8px">Últimos fechos</h2><div class="cartao"><table><tr><th>Aberta</th><th>Fechada</th><th>Por</th><th class="dir">Numerário esperado</th><th class="dir">Contado</th><th class="dir">Diferença</th></tr>${d.ultimos.map((u) => { const k = u.contado || {}, e = (k.esperado || {}).numerario || 0, n = k.numerario || 0;
    return `<tr><td>${dataHora(u.aberto_em)}</td><td>${dataHora(u.fechado_em)}</td><td>${esc(u.utilizador_nome)}</td><td class="dir">${kz(e)}</td><td class="dir">${kz(n)}</td><td class="dir"><b>${kz(n - e)}</b></td></tr>`; }).join('')}</table></div>` : '';
  if (!t) return `<div class="cab"><h1>Caixa</h1></div><div class="cartao"><p>A caixa deste local está fechada.</p><button class="btn p" data-a="abrirCaixa">Abrir caixa</button></div>${ult}`;
  const v = (m) => (d.porMeio.find((x) => x.meio === m) || { valor: 0 }).valor;
  const ent = d.movs.filter((m) => m.tipo === 'reforco').reduce((s, m) => s + m.valor, 0), sai = d.movs.filter((m) => m.tipo === 'sangria').reduce((s, m) => s + m.valor, 0);
  const esp = { numerario: t.fundo + v('numerario') + ent - sai, tpa: v('tpa'), express: v('express'), transferencia: v('transferencia') };
  S.x.esperado = esp; S.x.turnoId = t.id;
  return `<div class="cab"><h1>Caixa</h1><span class="mudo">aberta por ${esc(t.utilizador_nome)} em ${dataHora(t.aberto_em)}</span><span class="esp"></span>
    <button class="btn" data-a="mov" data-t="reforco">Reforço</button><button class="btn" data-a="mov" data-t="sangria">Sangria</button><button class="btn p" data-a="fecharCaixa">Fechar caixa</button></div>
    ${d.abertas ? `<div class="aviso">Há ${d.abertas} conta(s) ainda aberta(s) neste local.</div>` : ''}
    <div class="kpis"><div class="cartao kpi">Total recebido<b>${kz(d.porMeio.reduce((s, m) => s + m.valor, 0))}</b></div><div class="cartao kpi">Numerário esperado na gaveta<b>${kz(esp.numerario)}</b></div><div class="cartao kpi">Fundo de caixa<b>${kz(t.fundo)}</b></div></div>
    <div class="duas"><div class="cartao"><h3>Recebido por meio de pagamento</h3><table>${MEIOS.map((m) => `<tr><td>${m[1]}</td><td class="dir">${kz(v(m[0]))}</td></tr>`).join('')}</table></div>
    <div class="cartao"><h3>Reforços e sangrias</h3>${d.movs.length ? `<table>${d.movs.map((m) => `<tr><td>${hora(m.criado_em)}</td><td>${m.tipo === 'sangria' ? 'Sangria' : 'Reforço'}${m.motivo ? ' — ' + esc(m.motivo) : ''}</td><td class="dir">${m.tipo === 'sangria' ? '− ' : '+ '}${kz(m.valor)}</td></tr>`).join('')}</table>` : '<p class="mudo">Sem movimentos.</p>'}</div></div>${ult}`;
}

function vFact() {
  const c = carregar('fact', () => api('facturacao', { query: { local: S.local } }));
  const sw = S.st.empresa.factura_software;
  const cab = `<div class="cab"><h1>Facturação</h1><span class="esp"></span>${c && c.d ? `<button class="btn" data-a="csv">Exportar pendentes (CSV)</button>${pode('aprovar') ? '<button class="btn p" data-a="marcar">Marcar seleccionadas como enviadas</button>' : ''}` : ''}</div>
    <div class="aviso">As contas fechadas ficam aqui em fila para o software de facturação certificado pela AGT${sw ? ' (<b>' + esc(sw) + '</b>)' : ''}. ${sw ? '' : 'O software ainda não está definido em Configuração → Empresa. '}Enquanto a ligação automática não estiver activa, exporte as pendentes e marque-as como enviadas depois de emitir a factura no software oficial.</div>`;
  if (!c || c.erro) return cab + espera(c);
  const docs = c.d.docs;
  return cab + `<div class="cartao">${docs.length ? `<table><tr><th></th><th>Conta n.º</th><th>Fechada</th><th>Mesa</th><th>Cliente</th><th class="dir">Total</th><th>Estado</th><th>Ref. da factura</th></tr>
    ${docs.map((d) => `<tr><td>${d.sync_estado !== 'enviado' ? `<input type="checkbox" class="selDoc" value="${d.id}" style="width:auto">` : ''}</td><td>${d.doc_num}</td><td>${dataHora(d.fechado_em)}</td><td>${esc(d.mesa_nome)}</td><td>${esc(d.cliente_nome || 'Consumidor final')}${d.cliente_nif ? '<br><small>NIF ' + esc(d.cliente_nif) + '</small>' : ''}</td><td class="dir">${kz(d.total)}</td><td><span class="est ${d.sync_estado === 'enviado' ? 'ok' : d.sync_estado}">${d.sync_estado === 'enviado' ? 'enviada' : d.sync_estado}</span></td><td>${esc(d.sync_ref)}</td></tr>`).join('')}</table>` : '<p class="mudo">Ainda não há contas fechadas.</p>'}</div>`;
}

function vRel() {
  const f = S.x.relF || (S.x.relF = { de: hojeLuanda(), ate: hojeLuanda() });
  const c = carregar('rel', () => api('relatorio', { query: { local: S.local, de: f.de, ate: f.ate } }));
  const cab = `<div class="cab"><h1>Relatórios</h1><span class="esp"></span><input type="date" id="relDe" value="${f.de}" style="width:auto"><span>a</span><input type="date" id="relAte" value="${f.ate}" style="width:auto"><button class="btn p" data-a="relVer">Ver</button></div>`;
  if (!c || c.erro) return cab + espera(c);
  const d = c.d, r = d.resumo, mx = Math.max(1, ...d.porHora.map((h) => h.valor));
  const tab = (tit, cols, rows) => `<div class="cartao"><h3>${tit}</h3>${rows.length ? `<table><tr>${cols.map((x, i) => `<th class="${i ? 'dir' : ''}">${x}</th>`).join('')}</tr>${rows.map((x) => `<tr>${x.map((y, i) => `<td class="${i ? 'dir' : ''}">${y}</td>`).join('')}</tr>`).join('')}</table>` : '<p class="mudo">Sem dados no período.</p>'}</div>`;
  return cab + `<div class="kpis"><div class="cartao kpi">Vendas<b>${kz(r.vendas)}</b></div><div class="cartao kpi">Contas fechadas<b>${r.contas}</b></div><div class="cartao kpi">Valor médio por conta<b>${kz(r.contas ? r.vendas / r.contas : 0)}</b></div><div class="cartao kpi">Descontos<b>${kz(r.descontos)}</b></div><div class="cartao kpi">Linhas anuladas<b>${d.anulacoes.n} · ${kz(d.anulacoes.valor)}</b></div></div>
    <div class="cartao" style="margin-bottom:14px"><h3>Vendas por hora</h3>${d.porHora.length ? `<div class="barras" style="margin-bottom:22px">${d.porHora.map((h) => `<div style="height:${Math.round(h.valor / mx * 100)}%" title="${kz(h.valor)} · ${h.contas} contas"><span>${h.hora}h</span></div>`).join('')}</div>` : '<p class="mudo">Sem vendas no período.</p>'}</div>
    <div class="duas">${tab('Artigos mais vendidos', ['Artigo', 'Qtd.', 'Valor'], d.porArtigo.map((a) => [esc(a.nome), a.qtd, kz(a.valor)]))}
    <div style="display:grid;gap:14px">${tab('Por meio de pagamento', ['Meio', 'Valor'], d.porMeio.map((m) => [meioNome(m.meio), kz(m.valor)]))}${tab('Por empregado', ['Nome', 'Contas', 'Valor'], d.porEmpregado.map((e) => [esc(e.nome), e.contas, kz(e.valor)]))}${d.porDia.length > 1 ? tab('Por dia', ['Dia', 'Contas', 'Valor'], d.porDia.map((e) => [e.dia, e.contas, kz(e.valor)])) : ''}</div></div>`;
}

function vMenu() {
  return `<div class="cab"><h1>Menu digital</h1></div><div class="aviso">Cada local tem a sua carta pública, com os preços desse local. Imprima o código QR e coloque-o nas mesas; a carta actualiza-se sozinha quando muda artigos ou preços.</div>
    <div class="fases">${S.st.locais.map((l) => { const u = location.origin + '/menu?l=' + encodeURIComponent(l.slug);
      return `<div class="cartao qr"><h2>${esc(l.nome)}</h2><p><img src="/api/qr?t=${encodeURIComponent(u)}" alt="Código QR"></p><p class="mudo" style="word-break:break-all">${esc(u)}</p><div class="fila" style="justify-content:center"><a class="btn" href="${esc(u)}" target="_blank" rel="noopener">Abrir menu</a><button class="btn p" data-a="impQr" data-u="${esc(u)}" data-n="${esc(l.nome)}">Imprimir QR</button></div></div>`; }).join('')}</div>`;
}

const CFG_TABS = [['artigos', 'Artigos e preços'], ['familias', 'Famílias'], ['mesas', 'Mesas'], ['locais', 'Locais'], ['utilizadores', 'Utilizadores'], ['empresa', 'Empresa']];
function vCfg() {
  const c = carregar('cfg', () => api('cfg'));
  if (!c || c.erro) return '<div class="cab"><h1>Configuração</h1></div>' + espera(c);
  const d = c.d, tabs = CFG_TABS.filter((t) => pode('admin') || !['locais', 'utilizadores', 'empresa'].includes(t[0]));
  const tab = S.x.cfgTab && tabs.some((t) => t[0] === S.x.cfgTab) ? S.x.cfgTab : (S.x.cfgTab = 'artigos');
  const sn = (b) => (b ? 'Sim' : 'Não'), fam = (id) => (d.familias.find((f) => f.id === id) || {}).nome || '—', loc = (id) => (d.locais.find((l) => l.id === id) || {}).nome || 'Todos';
  const pl = (aid) => (d.precos.find((p) => p.artigo_id === aid && p.local_id === S.local) || {}).preco;
  let corpo = '';
  const T = (cols, rows) => `<table><tr>${cols.map((x) => `<th>${x}</th>`).join('')}</tr>${rows.map((r) => `<tr class="clic" data-a="cfgEdit" data-id="${r[0]}">${r.slice(1).map((x) => `<td>${x}</td>`).join('')}</tr>`).join('')}</table>`;
  if (tab === 'artigos') corpo = T(['Artigo', 'Família', 'Preço base', 'Preço em ' + esc(S.st.local.nome), 'Activo', 'No menu digital'], d.artigos.map((a) => [a.id, esc(a.nome), esc(fam(a.familia_id)), kz(a.preco), pl(a.id) != null ? kz(pl(a.id)) : '<span class="mudo">igual ao base</span>', sn(a.activo), sn(a.no_menu)]));
  if (tab === 'familias') corpo = T(['Família', 'Preparada em', 'Ordem', 'Activa'], d.familias.map((f) => [f.id, esc(f.nome), f.seccao === 'bar' ? 'Bar' : 'Cozinha', f.ordem, sn(f.activo)]));
  if (tab === 'mesas') corpo = T(['Mesa', 'Zona', 'Local', 'Lugares', 'Activa'], d.mesas.map((m) => [m.id, esc(m.nome), esc(m.zona), esc(loc(m.local_id)), m.lugares, sn(m.activo)]));
  if (tab === 'locais') corpo = T(['Local', 'Tipo', 'Morada', 'Endereço do menu', 'Activo'], d.locais.map((l) => [l.id, esc(l.nome), esc(l.tipo), esc(l.morada), '/menu?l=' + esc(l.slug), sn(l.activo)]));
  if (tab === 'utilizadores') corpo = T(['Nome', 'Utilizador', 'Perfil', 'Local', 'Activo'], d.utilizadores.map((u) => [u.id, esc(u.nome), esc(u.login), PERFIS[u.perfil] || u.perfil, esc(loc(u.local_id)), sn(u.activo)]));
  if (tab === 'empresa') { const e = d.empresa; corpo = `<table><tr><td>Nome</td><td>${esc(e.nome)}</td></tr><tr><td>NIF</td><td>${esc(e.nif) || '—'}</td></tr><tr><td>Regime de IVA</td><td>${esc(e.regime_iva)}</td></tr><tr><td>Taxa de IVA incluída nos preços</td><td>${e.taxa_iva}%</td></tr><tr><td>Software de facturação certificado</td><td>${esc(e.factura_software) || 'por definir'}</td></tr></table>`; }
  return `<div class="cab"><h1>Configuração</h1><span class="esp"></span><button class="btn p" data-a="cfgEdit" data-id="">${tab === 'empresa' ? 'Editar dados da empresa' : 'Novo registo'}</button></div>
    <div class="tabs">${tabs.map((t) => `<button class="chip ${t[0] === tab ? 'on' : ''}" data-a="cfgTab" data-id="${t[0]}">${t[1]}</button>`).join('')}</div><div class="cartao" style="overflow:auto">${corpo}</div>`;
}
function cfgForm(id) {
  const d = S.x.cfg.d, tab = S.x.cfgTab, r = tab === 'empresa' ? d.empresa : (d[tab].find((x) => x.id === id) || {}), novo = !r.id;
  const optLoc = d.locais.map((l) => [l.id, l.nome]);
  const campos = {
    artigos: [{ k: 'nome', label: 'Nome', req: 1 }, { k: 'familia_id', label: 'Família', type: 'select', options: d.familias.map((f) => [f.id, f.nome]) }, { k: 'descricao', label: 'Descrição (aparece no menu digital)' }, { k: 'preco', label: 'Preço base (Kz)', type: 'number', req: 1 },
      { k: 'preco_local', label: 'Preço só em ' + S.st.local.nome + ' (vazio = igual ao base)', type: 'number', value: (d.precos.find((p) => p.artigo_id === r.id && p.local_id === S.local) || {}).preco }, { k: 'no_menu', label: 'Mostrar no menu digital', type: 'check', value: novo ? true : r.no_menu }, { k: 'activo', label: 'Activo', type: 'check', value: novo ? true : r.activo }],
    familias: [{ k: 'nome', label: 'Nome', req: 1 }, { k: 'seccao', label: 'Preparada em', type: 'select', options: [['cozinha', 'Cozinha'], ['bar', 'Bar']] }, { k: 'ordem', label: 'Ordem na carta', type: 'number' }, { k: 'activo', label: 'Activa', type: 'check', value: novo ? true : r.activo }],
    mesas: [{ k: 'nome', label: 'Nome', req: 1 }, { k: 'zona', label: 'Zona', value: r.zona || 'Sala' }, { k: 'local_id', label: 'Local', type: 'select', options: optLoc, value: r.local_id || S.local }, { k: 'lugares', label: 'Lugares', type: 'number', value: r.lugares || 4 }, { k: 'ordem', label: 'Ordem', type: 'number' }, { k: 'activo', label: 'Activa', type: 'check', value: novo ? true : r.activo }],
    locais: [{ k: 'nome', label: 'Nome', req: 1 }, { k: 'tipo', label: 'Tipo', type: 'select', options: [['restaurante', 'Restaurante'], ['bar', 'Bar'], ['esplanada', 'Esplanada'], ['takeaway', 'Take-away']] }, { k: 'morada', label: 'Morada' }, { k: 'slug', label: 'Endereço do menu (sem espaços)', ph: 'ex.: ilha-de-luanda' }, { k: 'activo', label: 'Activo', type: 'check', value: novo ? true : r.activo }],
    utilizadores: [{ k: 'nome', label: 'Nome', req: 1 }, { k: 'login', label: 'Nome de utilizador', req: 1 }, { k: 'perfil', label: 'Perfil', type: 'select', options: Object.entries(PERFIS) }, { k: 'local_id', label: 'Local', type: 'select', options: [['', 'Todos os locais']].concat(optLoc) }, { k: 'password', label: novo ? 'Palavra-passe (mín. 6 caracteres)' : 'Nova palavra-passe (vazio = manter)', type: 'password' }, { k: 'activo', label: 'Activo', type: 'check', value: novo ? true : r.activo }],
    empresa: [{ k: 'nome', label: 'Nome', req: 1 }, { k: 'nif', label: 'NIF' }, { k: 'regime_iva', label: 'Regime de IVA', type: 'select', options: [['geral', 'Geral'], ['simplificado', 'Simplificado'], ['exclusao', 'Exclusão']] }, { k: 'taxa_iva', label: 'Taxa de IVA incluída nos preços (%) — confirme com o contabilista', type: 'number' }, { k: 'factura_software', label: 'Software de facturação certificado a ligar', ph: 'ex.: Primavera' }],
  }[tab].map((c) => (c.value === undefined ? Object.assign(c, { value: r[c.k] }) : c));
  form((novo && tab !== 'empresa' ? 'Novo registo' : 'Editar') + ' — ' + CFG_TABS.find((t) => t[0] === tab)[1], campos, async (v) => {
    const pl = v.preco_local; delete v.preco_local;
    const res = await api('cfg', { method: 'POST', body: { entidade: tab, linha: Object.assign({ id: r.id }, v) } });
    if (tab === 'artigos') await api('cfg', { method: 'POST', body: { entidade: 'preco_local', linha: { artigo_id: res.id, local_id: S.local, preco: pl } } });
    toast('Guardado'); delete S.x.cfg; sync(); render();
  });
}

function vFases() {
  const f = [['Fase 2 · Controlar custos', 'Fichas técnicas e custo por prato', 'Receitas com rendimento; a margem de cada prato fica à vista quando o custo de um ingrediente muda.'], ['Fase 2 · Controlar custos', 'Stock', 'Baixa automática por venda, contagens, quebras, validades e transferências entre locais.'], ['Fase 2 · Controlar custos', 'Compras e fornecedores', 'Requisições, encomendas, recepção, conferência de facturas e conta-corrente de cada fornecedor.'],
    ['Fase 3 · Pessoas e dinheiro', 'Recursos humanos', 'Escalas, ponto, férias e faltas, gorjetas e processamento salarial sincronizado com o software oficial.'], ['Fase 3 · Pessoas e dinheiro', 'DAF', 'Contas a pagar e a receber, bancos, despesas, centros de custo por local e exportação para a contabilidade.'],
    ['Fase 4 · Crescer', 'Reservas e clientes', 'Reservas, lista de espera, eventos, fidelização e conta-corrente de clientes empresa.'], ['Fase 4 · Crescer', 'Pedido pelo cliente por QR', 'O cliente pede na mesa a partir do menu digital; o pedido cai directamente na cozinha.'], ['Fase 4 · Crescer', 'Alertas e consolidado do grupo', 'Anulações e descontos fora do normal, rupturas e um painel único com todos os locais.']];
  return `<div class="cab"><h1>Próximas fases</h1></div><div class="aviso">Esta versão cobre as fases 0 e 1 do mapa do projecto: configuração, menus e preços, vendas, cozinha e bar, caixa, fila de facturação e menu digital. O que se segue ainda não está construído.</div>
    <div class="fases">${f.map((x) => `<div class="cartao"><span class="est">${x[0]}</span><h2 style="margin:8px 0 4px">${x[1]}</h2><p class="mudo" style="margin:0">${x[2]}</p></div>`).join('')}</div>`;
}

/* ---------- Acções ---------- */
const ACOES = {
  fechar: () => { fechar(); },
  recarregar: () => { ['caixa', 'fact', 'rel', 'cfg'].forEach((k) => delete S.x[k]); render(); },
  eu: () => modal(`<h2>${esc(S.user.nome)}</h2><p class="mudo">${PERFIS[S.user.perfil]} · utilizador «${esc(S.user.login)}»</p><div class="fila" style="margin-top:14px"><button class="btn" data-a="mudarPass">Alterar palavra-passe</button><span class="esp"></span><button class="btn" data-a="fechar">Fechar</button><button class="btn perigo" data-a="sair">Sair</button></div>`),
  sair: () => { if (S.queue.length && !confirm('Há ' + S.queue.length + ' operação(ões) por sincronizar. Se sair agora perdem-se. Sair mesmo assim?')) return; S.queue = []; ls.del('queue'); fechar(); sair(); },
  mudarPass: () => form('Alterar palavra-passe', [{ k: 'actual', label: 'Palavra-passe actual', type: 'password', req: 1 }, { k: 'nova', label: 'Nova palavra-passe (mín. 6 caracteres)', type: 'password', req: 1 }], async (v) => { await api('password', { method: 'POST', body: v }); toast('Palavra-passe alterada'); }),
  mesa: (el) => { const p = S.st.pedidos.find((x) => x.mesa_id === el.dataset.id); if (p) return ir('pedido/' + p.id); if (!pode('pedir')) return; const id = uuid(); if (op('pedido.abrir', { id, local_id: S.local, mesa_id: el.dataset.id })) ir('pedido/' + id); },
  nova: (el) => { const id = uuid(); if (op('pedido.abrir', { id, local_id: S.local, tipo: el.dataset.t })) ir('pedido/' + id); },
  abrir: (el) => ir('pedido/' + el.dataset.id),
  fam: (el) => { S.fam = el.dataset.id; render(); },
  add: (el) => { const p = P(rota().id); if (!p) return; const l = p.linhas.find((x) => x.artigo_id === el.dataset.id && x.estado === 'novo' && !x.notas); if (l) op('linha.qtd', { id: l.id, qtd: l.qtd + 1 }); else op('linha.add', { id: uuid(), pedido_id: p.id, artigo_id: el.dataset.id, qtd: 1 }); render(); },
  mais: (el) => { const [, l] = linhaDe(el.dataset.id); if (l) { op('linha.qtd', { id: l.id, qtd: l.qtd + 1 }); render(); } },
  menos: (el) => { const [, l] = linhaDe(el.dataset.id); if (l) { op('linha.qtd', { id: l.id, qtd: l.qtd - 1 }); render(); } },
  nota: (el) => { const [, l] = linhaDe(el.dataset.id); if (l) form('Nota para ' + l.nome, [{ k: 'notas', label: 'Nota (ex.: sem jindungo, mal passado)', value: l.notas }], (v) => { op('linha.qtd', { id: l.id, qtd: l.qtd, notas: v.notas }); render(); }); },
  anularL: (el) => form('Anular linha', [{ k: 'motivo', label: 'Motivo', req: 1 }], (v) => { op('linha.anular', { id: el.dataset.id, motivo: v.motivo }); render(); }),
  enviar: (el) => { if (op('pedido.enviar', { pedido_id: el.dataset.id })) { toast('Pedido enviado'); render(); } },
  desconto: (el) => { const p = P(el.dataset.id); form('Desconto na conta', [{ k: 'valor', label: 'Valor do desconto (Kz)', type: 'number', value: p.desconto || '' }], (v) => { op('pedido.desconto', { pedido_id: p.id, valor: Math.max(0, Number(v.valor) || 0) }); render(); }); },
  transferir: (el) => { const livres = S.st.mesas.filter((m) => !S.st.pedidos.some((p) => p.mesa_id === m.id)); if (!livres.length) return toast('Não há mesas livres', 'erro'); form('Mudar de mesa', [{ k: 'mesa_id', label: 'Nova mesa', type: 'select', options: livres.map((m) => [m.id, m.zona + ' — ' + m.nome]) }], (v) => { op('pedido.transferir', { pedido_id: el.dataset.id, mesa_id: v.mesa_id }); render(); }); },
  anularP: (el) => form('Anular conta', [{ k: 'motivo', label: 'Motivo', req: 1 }], (v) => { if (P(el.dataset.id).pagamentos.length) { toast('Remova os pagamentos antes de anular a conta', 'erro'); return false; } op('pedido.anular', { pedido_id: el.dataset.id, motivo: v.motivo }); ir('mesas'); }),
  consulta: (el) => consulta(P(el.dataset.id)),
  receber: (el) => { S.x.rec = {}; mReceber(el.dataset.id); },
  pagar: (el) => { const p = P(el.dataset.id), falta = Math.max(0, p.total - pago(p)), v = Number($('#recValor').value) || 0; if (v <= 0) return toast('Indique o valor recebido', 'erro');
    S.x.rec.nome = $('#recNome').value; S.x.rec.nif = $('#recNif').value; S.x.rec.troco = el.dataset.m === 'numerario' && v > falta ? v - falta : 0;
    if (op('pagamento.add', { id: uuid(), pedido_id: p.id, meio: el.dataset.m, valor: Math.min(v, falta) })) mReceber(p.id); render(); },
  rmPag: (el) => { S.x.rec.troco = 0; op('pagamento.remover', { id: el.dataset.id }); mReceber(el.dataset.p); render(); },
  fecharConta: (el) => { if (op('pedido.fechar', { pedido_id: el.dataset.id, cliente_nome: $('#recNome').value.trim(), cliente_nif: $('#recNif').value.trim() })) { fechar(); toast('Conta fechada'); delete S.x.fact; delete S.x.caixa; ir('mesas'); } },
  kds: (el) => { const seg = { enviado: 'preparar', preparar: 'pronto', pronto: 'entregue' }[el.dataset.e]; if (seg) { op('linha.estado', { id: el.dataset.id, estado: seg }); render(); } },
  abrirCaixa: () => form('Abrir caixa', [{ k: 'fundo', label: 'Fundo de caixa em numerário (Kz)', type: 'number', value: 0 }], (v) => { op('turno.abrir', { id: uuid(), local_id: S.local, fundo: Number(v.fundo) || 0 }); setTimeout(() => recarregar('caixa'), 900); }),
  mov: (el) => form(el.dataset.t === 'sangria' ? 'Sangria (retirar numerário)' : 'Reforço (juntar numerário)', [{ k: 'valor', label: 'Valor (Kz)', type: 'number', req: 1 }, { k: 'motivo', label: 'Motivo' }], (v) => { op('caixa.mov', { id: uuid(), turno_id: S.x.turnoId, tipo: el.dataset.t, valor: Number(v.valor) || 0, motivo: v.motivo }); setTimeout(() => recarregar('caixa'), 900); }),
  fecharCaixa: () => { const e = S.x.esperado; form('Fechar caixa', MEIOS.map((m) => ({ k: m[0], label: m[1] + ' — contado (esperado ' + kz(e[m[0]]) + ')', type: 'number', value: m[0] === 'numerario' ? '' : Math.round(e[m[0]]), req: m[0] === 'numerario' })).concat([{ k: 'obs', label: 'Observações' }]), (v) => {
    const contado = { esperado: e }; MEIOS.forEach((m) => { contado[m[0]] = Number(v[m[0]]) || 0; });
    op('turno.fechar', { id: S.x.turnoId, contado, obs: v.obs }); toast('Caixa fechada. Diferença em numerário: ' + kz(contado.numerario - e.numerario)); setTimeout(() => recarregar('caixa'), 900); }); },
  relVer: () => { S.x.relF = { de: $('#relDe').value, ate: $('#relAte').value }; recarregar('rel'); },
  csv: () => { const docs = S.x.fact.d.docs.filter((d) => d.sync_estado !== 'enviado'); if (!docs.length) return toast('Não há contas pendentes');
    const q = (s) => '"' + String(s == null ? '' : s).replace(/"/g, '""') + '"', linhas = [['conta', 'data', 'local', 'mesa', 'cliente', 'nif', 'artigo', 'quantidade', 'preco_unitario', 'total_linha', 'desconto_conta', 'total_conta', 'pagamentos'].join(';')];
    docs.forEach((d) => d.linhas.forEach((l) => linhas.push([d.doc_num, q(new Date(d.fechado_em).toISOString()), q(S.st.local.nome), q(d.mesa_nome), q(d.cliente_nome), q(d.cliente_nif), q(l.nome), l.qtd, l.preco, l.qtd * l.preco, d.desconto, d.total, q(d.pagamentos.map((g) => meioNome(g.meio) + ' ' + g.valor).join(' + '))].join(';'))));
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + linhas.join('\r\n')], { type: 'text/csv;charset=utf-8' })); a.download = 'contas-por-facturar-' + hojeLuanda() + '.csv'; a.click(); },
  marcar: () => { const ids = [...document.querySelectorAll('.selDoc:checked')].map((x) => x.value); if (!ids.length) return toast('Seleccione as contas', 'erro');
    form('Marcar ' + ids.length + ' conta(s) como enviada(s)', [{ k: 'ref', label: 'Referência da factura no software oficial (opcional)', ph: 'ex.: FT 2026/123' }], async (v) => { await api('facturacao', { method: 'POST', body: { local: S.local, ids, estado: 'enviado', ref: v.ref } }); recarregar('fact'); }); },
  impQr: (el) => { const pr = $('#print'); pr.className = 'qrp'; pr.innerHTML = `<img src="/logo.png" style="width:70mm"><h2>${esc(el.dataset.n)}</h2><p>Aponte a câmara para ver o menu</p><img id="qrImp" src="/api/qr?t=${encodeURIComponent(el.dataset.u)}">`; const im = $('#qrImp'); if (im.complete) window.print(); else im.onload = () => window.print(); },
  cfgTab: (el) => { S.x.cfgTab = el.dataset.id; render(); },
  cfgEdit: (el) => cfgForm(el.dataset.id),
};

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-a]'); if (!el) return;
  if (el.tagName === 'A' && el.dataset.a === 'fechar') { fechar(); return; }
  if (el.type !== 'checkbox') e.preventDefault();
  const f = ACOES[el.dataset.a]; if (f) f(el);
});
document.addEventListener('submit', async (e) => {
  if (e.target.id !== 'fLogin') return;
  e.preventDefault();
  try {
    const r = await api('login', { method: 'POST', body: { login: e.target.login.value, password: e.target.password.value } });
    S.token = r.token; S.user = r.user; ls.set('token', r.token); ls.set('user', r.user);
    if (S.st && r.user.local_id && S.local !== r.user.local_id) { S.st = null; S.local = r.user.local_id; }
    render(); sync();
  } catch (er) { toast(er.message, 'erro'); }
});
document.addEventListener('change', (e) => { if (e.target.id === 'selLocal') { if (S.queue.length) { toast('Aguarde a sincronização antes de mudar de local', 'erro'); e.target.value = S.local; return; } S.local = e.target.value; S.x = {}; S.st = null; guardar(); render(); sync(); } });
window.addEventListener('hashchange', () => { fechar(); const v = rota().v; ({ caixa: 'caixa', facturacao: 'fact', relatorios: 'rel', config: 'cfg' })[v] && delete S.x[({ caixa: 'caixa', facturacao: 'fact', relatorios: 'rel', config: 'cfg' })[v]]; render(); });
window.addEventListener('online', () => { sync(); });
window.addEventListener('offline', () => { S.online = false; pintarEstado(); });
setInterval(() => { if (!document.hidden) sync(); }, 6000);
setInterval(() => { if (S.token && S.st && ['cozinha', 'bar', 'mesas'].includes(rota().v) && !$('#modal').classList.contains('on')) render(); }, 30000);
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('/sw.js').catch(() => {});
render(); sync();
