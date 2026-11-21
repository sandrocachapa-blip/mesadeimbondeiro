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
const PERFIS = { admin: 'Administração', gerente: 'Gerente', chefe: 'Chefe de sala', caixa: 'Caixa', empregado: 'Empregado de mesa', cozinha: 'Cozinha', bar: 'Bar' };
const PODE = { cfg: ['admin', 'gerente'], admin: ['admin'], pedir: ['admin', 'gerente', 'chefe', 'caixa', 'empregado'], pagar: ['admin', 'gerente', 'chefe', 'caixa'], aprovar: ['admin', 'gerente'], sala: ['admin', 'gerente', 'chefe'] };
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
const VIVAS = ['mesas', 'pedido', 'cozinha', 'bar', 'servir', 'entregas', 'empregado'];
async function sync() {
  if (!S.token || aSincronizar) return;
  aSincronizar = true;
  const antes = JSON.stringify(S.st), prA = prontosIds();
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
    if (S.token && antes !== 'null' && pode('pedir') && S.user.perfil !== 'caixa') { const nv = prontosIds().filter((id) => !prA.includes(id)); if (nv.length) { const [pp] = linhaDe(nv[0]); apito(); try { navigator.vibrate && navigator.vibrate([250, 120, 250]); } catch (e) {} toast('Pronto a servir: ' + (pp ? pp.mesa_nome : '') + (nv.length > 1 ? ' (+' + (nv.length - 1) + ')' : '')); } }
    if (S.token && JSON.stringify(S.st) !== antes && (antes === 'null' || (VIVAS.includes(rota().v) && !S.x.editar && document.activeElement.id !== 'busca' && !$('#modal').classList.contains('on')))) render();
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
const AUTO = ['embalagem', 'servico', 'entrega'];
const recalc = (p) => {
  const e = S.st.empresa || {}, base = p.linhas.filter((l) => !AUTO.includes(l.seccao) && l.estado !== 'anulado');
  const soma = base.reduce((t, l) => t + l.preco * l.qtd, 0), pratos = base.filter((l) => l.seccao === 'cozinha').reduce((t, l) => t + l.qtd, 0), fora = p.tipo === 'takeaway' || p.tipo === 'entrega';
  const auto = (suf, nome, sec, preco, n) => { const id = p.id + suf, x = p.linhas.find((l) => l.id === id); if (x && x.estado === 'anulado') return;
    if (n > 0 && preco > 0) { if (x) { x.qtd = n; x.preco = preco; x.nome = nome; } else p.linhas.push({ id, pedido_id: p.id, artigo_id: null, nome, preco, qtd: n, notas: '', seccao: sec, estado: 'entregue', criado_em: new Date().toISOString() }); } else if (x) p.linhas = p.linhas.filter((l) => l !== x); };
  auto('-emb', 'Embalagem take-away', 'embalagem', e.emb_preco || 0, fora ? (e.emb_modo === 'pedido' ? (base.length ? 1 : 0) : pratos) : 0);
  auto('-ent', 'Taxa de entrega' + (p.bairro ? ' · ' + p.bairro : ''), 'entrega', p.taxa_entrega || 0, p.tipo === 'entrega' && base.length ? 1 : 0);
  auto('-srv', 'Taxa de serviço (' + (e.taxa_servico || 0) + '%)', 'servico', Math.round(soma * (e.taxa_servico || 0) / 100), p.tipo === 'mesa' && base.length ? 1 : 0);
  p.total = Math.max(0, p.linhas.filter((l) => l.estado !== 'anulado').reduce((t, l) => t + l.preco * l.qtd, 0) - (p.desconto || 0)); };
const prontosIds = () => (S.st ? S.st.pedidos.flatMap((p) => p.linhas.filter((l) => l.estado === 'pronto' && !AUTO.includes(l.seccao)).map((l) => l.id)) : []);
const imgArt = (a) => a.imagem || ((S.st.familias.find((f) => f.id === a.familia_id) || {}).seccao === 'bar' ? '/img/_bebida.png' : '/img/_prato.png');
const pago = (p) => p.pagamentos.reduce((s, g) => s + g.valor, 0);
function aplicar(o) {
  const d = o.d, st = S.st;
  switch (o.tipo) {
    case 'pedido.abrir': {
      const m = d.mesa_id && st.mesas.find((x) => x.id === d.mesa_id);
      if (m && st.pedidos.some((p) => p.mesa_id === m.id)) throw new Error(m.nome + ' já tem uma conta aberta');
      const ent = !m && d.tipo === 'entrega';
      st.pedidos.push({ id: d.id, mesa_id: d.mesa_id || null, mesa_nome: m ? m.nome : ent ? 'Entrega · ' + d.cliente_nome : (d.tipo === 'takeaway' ? 'Take-away' : 'Balcão'), tipo: m ? 'mesa' : d.tipo, aberto_por_nome: S.user.nome, aberto_em: o.ts, cliente_nome: d.cliente_nome || '', cliente_tel: ent ? d.cliente_tel || '' : '', morada: ent ? d.morada || '' : '', bairro: ent ? d.bairro || '' : '', taxa_entrega: ent ? Number(d.taxa_entrega) || 0 : 0, estafeta: '', entrega_estado: ent ? 'preparar' : '', desconto: 0, total: 0, linhas: [], pagamentos: [] });
      break;
    }
    case 'pedido.cliente': { const p = P(d.pedido_id); if (p) { p.cliente_nome = d.cliente_nome || ''; p.cliente_nif = d.cliente_nif || ''; } break; }
    case 'entrega.estado': { const p = P(d.pedido_id); if (p) { p.entrega_estado = d.estado; if (d.estafeta != null) p.estafeta = d.estafeta; } break; }
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
    case 'pedido.transferir': { const p = P(d.pedido_id), m = st.mesas.find((x) => x.id === d.mesa_id); if (p && m) { if (st.pedidos.some((x) => x.mesa_id === m.id && x !== p)) throw new Error(m.nome + ' já tem uma conta aberta'); p.mesa_id = m.id; p.mesa_nome = m.nome; p.tipo = 'mesa'; recalc(p); } break; }
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
function modal(html, cls) { const m = $('#modal'); m.innerHTML = '<div class="cx ' + (cls || '') + '">' + html + '</div>'; m.classList.add('on'); const i = $('input:not([type=hidden]), select', m); if (i) setTimeout(() => i.focus(), 30); }
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
  if (p === 'cozinha') return [{ g: 'Operação', i: [['cozinha', 'Cozinha'], ['equipa', 'Ponto']] }];
  if (p === 'bar') return [{ g: 'Operação', i: [['bar', 'Bar'], ['equipa', 'Ponto']] }];
  const op = p === 'empregado' ? [['empregado', 'Empregado · pedidos'], ['mesas', 'Mesas'], ['servir', 'Prontos a servir'], ['cozinha', 'Cozinha'], ['bar', 'Bar'], ['entregas', 'Entregas'], ['reservas', 'Reservas']] : [['mesas', 'Mesas'], ['empregado', 'Empregado · pedidos'], ['servir', 'Prontos a servir'], ['cozinha', 'Cozinha'], ['bar', 'Bar'], ['entregas', 'Entregas'], ['reservas', 'Reservas']];
  if (pode('pagar')) op.push(['caixa', 'Caixa'], ['facturacao', 'Facturação']);
  op.push(['clientes', 'Clientes']);
  const g = [{ g: 'Operação', i: op }];
  if (pode('cfg')) g.push({ g: 'Stock e compras', i: [['dstock', 'Dashboard'], ['stock', 'Stock'], ['compras', 'Compras'], ['fornecedores', 'Fornecedores'], ['fichas', 'Fichas e custos']] });
  if (pode('aprovar')) g.push({ g: 'Pessoas e dinheiro', i: [['dpessoas', 'Dashboard'], ['equipa', 'Equipa e ponto'], ['salarios', 'Salários'], ['daf', 'Finanças (DAF)']] });
  else g[0].i.push(['equipa', 'Ponto']);
  if (pode('aprovar')) { const m = pode('admin') ? [['admin', 'Administração ao vivo']] : []; m.unshift(['dgestao', 'Dashboard de vendas']); m.push(['artigos', 'Carta e artigos'], ['painel', 'Painel e alertas'], ['relatorios', 'Relatórios']); if (pode('admin')) m.push(['grupo', 'Grupo']); m.push(['menu', 'Menu digital'], ['config', 'Configuração']); g.push({ g: 'Gestão', i: m }); }
  return g;
}
const VIEWS = {};
const TABI = {"empregado": "<svg viewBox=\"0 0 24 24\"><rect x=\"5\" y=\"3\" width=\"14\" height=\"18\" rx=\"2\"/><path d=\"M9 8h6M9 12h6M9 16h3\"/></svg>", "mesas": "<svg viewBox=\"0 0 24 24\"><rect x=\"4\" y=\"5\" width=\"16\" height=\"4\" rx=\"1.5\"/><path d=\"M7 9v10M17 9v10\"/></svg>", "servir": "<svg viewBox=\"0 0 24 24\"><path d=\"M3 18h18M5 18a7 7 0 0 1 14 0M12 8V6\"/></svg>", "entregas": "<svg viewBox=\"0 0 24 24\"><path d=\"M3 7h11v9H3zM14 10h4l3 3v3h-7z\"/><circle cx=\"7\" cy=\"18\" r=\"2\"/><circle cx=\"17\" cy=\"18\" r=\"2\"/></svg>", "mais": "<svg viewBox=\"0 0 24 24\"><path d=\"M4 7h16M4 12h16M4 17h16\"/></svg>"};
function sair(silencioso) { S.token = ''; S.user = null; ls.del('token'); ls.del('user'); if (!silencioso) { S.st = null; ls.del('state'); } render(); }

function render() {
  const app = $('#app');
  document.body.classList.toggle('tema-luxo', !!(S.st && S.st.empresa && S.st.empresa.tema === 'luxo') || (!S.st && ls.get('tema', '') === 'luxo'));
  if (S.st && S.st.empresa) ls.set('tema', S.st.empresa.tema || 'classico');
  if (!S.token || !S.user) { document.body.classList.remove('modo-app', 'emp-ped', 'com-tabs'); return (app.innerHTML = vLogin()); }
  if (!S.st) { app.innerHTML = '<div class="login"><div class="cx"><img src="/logo.png" alt=""><p>A carregar…</p><p class="mudo">Na primeira utilização é precisa ligação à internet.</p></div></div>'; return; }
  const gs = menus(), todos = gs.flatMap((g) => g.i), r = rota();
  const modoApp = S.user.perfil === 'empregado'; document.body.classList.toggle('modo-app', modoApp);
  if (modoApp && r.v === 'pedido' && r.id) { location.replace('#empregado/' + r.id); return; }
  if (!todos.some((m) => m[0] === r.v) && r.v !== 'pedido') { location.hash = todos[0][0]; return; }
  const on = r.v === 'pedido' ? 'mesas' : r.v, empPed = r.v === 'empregado' && !!(r.id && P(r.id));
  let corpo = '';
  try { corpo = VIEWS[r.v](r.id); } catch (e) { corpo = '<div class="aviso">Erro a mostrar este ecrã: ' + esc(e.message) + '</div>'; console.error(e); }
  const lado = $('.lado nav'), sc = lado ? lado.scrollTop : 0;
  app.innerHTML = `<aside class="lado"><a class="marca" href="#${todos[0][0]}"><img src="/icon-192.png" alt=""><span>Mesa de<br>Imbondeiro</span></a>
    ${S.st.locais.length > 1 ? `<select id="selLocal">${S.st.locais.map((l) => `<option value="${l.id}" ${l.id === S.local ? 'selected' : ''}>${esc(l.nome)}</option>`).join('')}</select>` : `<div class="loc">${esc(S.st.local.nome)}</div>`}
    <nav>${gs.map((g, k) => { const tem = g.i.some((m) => m[0] === on), ab = (S.x.grpAb || {})[k] != null ? S.x.grpAb[k] : (tem || gs.length === 1);
      return `<div class="grp ${ab ? 'ab' : ''} ${tem ? 'act' : ''}"><button class="gh" data-a="grp" data-g="${k}" data-ab="${ab ? 1 : 0}"><span>${g.g}</span><i>▾</i></button><div class="sub">${g.i.map((m) => `<a href="#${m[0]}" class="${m[0] === on ? 'on' : ''}">${m[1]}</a>`).join('')}</div></div>`; }).join('')}</nav></aside>
    <div class="vela" data-a="ham"></div>
    <div class="corpo"><header class="topo"><button class="ham" data-a="ham" aria-label="Menu">☰</button><b class="tit">${esc((todos.find((m) => m[0] === on) || ['', ''])[1])}</b><span class="esp"></span><span id="estado" class="pill"></span><button class="eu" data-a="eu">${esc(S.user.nome.split(' ')[0])} ▾</button></header><main>${corpo}</main></div>
    ${pode('pedir') && r.v !== 'pedido' && !empPed ? `<nav class="tabs-m">${[['empregado', 'Pedir'], ['servir', 'Prontos'], ['entregas', 'Entregas']].map((t) => `<a href="#${t[0]}" class="${on === t[0] ? 'on' : ''}">${TABI[t[0]]}<span>${t[1]}</span>${t[0] === 'servir' && prontosIds().length ? `<i>${prontosIds().length}</i>` : ''}</a>`).join('')}<button data-a="ham">${TABI.mais}<span>Mais</span></button></nav>` : ''}`;
  document.body.classList.toggle('com-tabs', pode('pedir') && r.v !== 'pedido' && !empPed); document.body.classList.toggle('emp-ped', empPed);
  if (sc) $('.lado nav').scrollTop = sc;
  pintarEstado();
}

/* ---------- Ecrãs ---------- */
function vLogin() {
  return `<div class="login foto"><form class="cx cartao" id="fLogin"><img src="/logo.png" alt="Mesa de Imbondeiro"><p class="mudo">Gestão de restaurantes e bares</p>
    <label style="text-align:left">Utilizador</label><input name="login" autocomplete="username" autocapitalize="none" required>
    <label style="text-align:left">Palavra-passe</label><input name="password" type="password" autocomplete="current-password" required>
    <button class="btn p" style="width:100%;margin-top:16px">Entrar</button></form></div>`;
}

const temQr = (p) => !!p && p.linhas.some((l) => l.estado === 'novo' && l.criado_por_nome === 'Cliente (QR)');
function posMesa(m, i) { const e = (S.x.pos || {})[m.id]; return e || { x: m.x != null ? m.x : 14 + (i % 4) * 24, y: m.y != null ? m.y : 20 + Math.floor(i / 4) * 34, forma: m.forma || 'quadrada' }; }
/* Cor da mesa pela espera: conta desde o envio mais antigo que a cozinha ou o bar ainda não deram como pronto. */
function corMesa(p) {
  if (!p) return { cls: '', min: null };
  const pend = p.linhas.filter((l) => l.estado === 'enviado' || l.estado === 'preparar');
  if (!pend.length) return { cls: 'verde', min: null };
  const min = mins(pend.reduce((a, l) => { const t = l.enviado_em || l.criado_em; return t < a ? t : a; }, pend[0].enviado_em || pend[0].criado_em));
  return { cls: min >= 30 ? 'vermelho' : min >= 10 ? 'amarelo' : 'verde', min };
}
/* Reserva de hoje ligada a uma mesa (ou a uma das mesas juntas a ela) */
function resMesa(m) { const ids = [m.id].concat(S.st.mesas.filter((x) => x.junta_a === m.id).map((x) => x.id)); return (S.st.reservas || []).filter((r) => ids.includes(r.mesa_id)).sort((a, b) => (a.hora < b.hora ? -1 : 1))[0] || null; }
const resTxt = (r) => (r ? `<small class="res-t">reservada ${esc(r.hora)} · ${esc(r.cliente_nome)}</small>` : '');
function mReserva(mesaId, r) {
  r = r || {}; const livres = mesasVis();
  form(r.id ? 'Reserva — ' + r.cliente_nome : 'Nova reserva', [{ k: 'cliente_nome', label: 'Nome do cliente', req: 1, value: r.cliente_nome }, { k: 'telefone', label: 'Telefone', value: r.telefone }, { k: 'dia', label: 'Dia', type: 'date', value: r.dia || hojeLuanda(), req: 1 }, { k: 'hora', label: 'Hora', type: 'time', value: r.hora || '20:00', req: 1 }, { k: 'pessoas', label: 'N.º de pessoas', type: 'number', value: r.pessoas || 2 },
    { k: 'mesa_id', label: 'Mesa', type: 'select', options: [['', 'A definir']].concat(livres.map((m) => [m.id, m.zona + ' — ' + m.nome + ' (' + lug(m) + ' lug.)'])), value: r.mesa_id || mesaId || '' }, { k: 'notas', label: 'Notas (aniversário, alergias, cadeira de bebé…)', value: r.notas }],
  async (v) => { await api('reg', { method: 'POST', body: { entidade: 'reservas', linha: Object.assign({ id: r.id, local_id: S.local, estado: r.id && r.estado !== 'pendente' ? r.estado : 'confirmada' }, v) } }); toast('Reserva guardada'); await sync(); render(); });
}
const esperaTxt = (c) => (c.min != null ? `<small class="esp-t">à espera há ${c.min} min</small>` : '');
const zoomP = () => ls.get('zoom', 0.78);
const filhas = (m) => S.st.mesas.filter((x) => x.junta_a === m.id);
const mesasVis = () => S.st.mesas.filter((m) => !m.junta_a || !S.st.mesas.some((x) => x.id === m.junta_a));
const lug = (m) => (m.lugares || 4) + filhas(m).reduce((s, x) => s + (x.lugares || 0), 0);
function mesa3d(m, i) {
  const p = S.st.pedidos.find((x) => x.mesa_id === m.id), cm = corMesa(p), ps = posMesa(m, i), fl = filhas(m), n = lug(m), f = fl.length ? 'rect' : ps.forma || 'quadrada';
  let w = n <= 2 ? 62 : n <= 4 ? 84 : n <= 6 ? 116 : n <= 8 ? 150 : n <= 12 ? 200 : 250, h = f === 'redonda' ? w : (n > 4 || f === 'rect' ? 76 : w);
  if (f === 'rect' && n <= 4) w = 110;
  const cima = Math.ceil(n / 2), baixo = n - cima, cad = (k, top) => Array.from({ length: k }, (_, j) => `<i class="cad" style="left:${((j + 1) / (k + 1)) * 100}%;${top ? 'top:-13px' : 'bottom:-13px'}"></i>`).join('');
  const rs = p ? null : resMesa(m);
  return `<div class="pm ${f} ${rs ? 'res' : ''} ${p ? 'oc ' + cm.cls : ''} ${temQr(p) ? 'qr' : ''} ${(S.x.sel || []).includes(m.id) ? 'sel' : ''}" data-a="mesa" data-id="${m.id}" style="left:${ps.x}%;top:${ps.y}%;width:${w}px;height:${h}px"><i class="sombra"></i>${cad(cima, 1)}${cad(baixo, 0)}<i class="pe"></i><i class="esp1"></i><i class="esp2"></i><i class="tampo"></i>${fl.map((_, k) => `<i class="junta" style="left:${((k + 1) / (fl.length + 1)) * 100}%"></i>`).join('')}<span class="tag"><b>${esc(m.nome)}</b>${p ? kz(p.total) : n + ' lug.'}${esperaTxt(cm)}${resTxt(rs)}${fl.length ? `<small>${fl.length + 1} mesas juntas</small>` : ''}${temQr(p) ? '<em>pedido do cliente</em>' : ''}</span></div>`;
}
function vMesas() {
  const st = S.st, vis = mesasVis(), zonas = [...new Set(vis.map((m) => m.zona))], nSel = (S.x.sel || []).length;
  if (!zonas.includes(S.x.zona)) S.x.zona = zonas[0];
  const modo = S.x.modoMesas || (window.innerWidth < 760 ? 'lista' : 'planta'), ed = !!S.x.editar && modo === 'planta';
  const cartao = (m) => { const p = st.pedidos.find((x) => x.mesa_id === m.id), cm = corMesa(p);
    return `<button class="mesa ${!p && resMesa(m) ? 'res' : ''} ${p ? 'oc ' + cm.cls : ''}" data-a="mesa" data-id="${m.id}"><b>${esc(m.nome)}</b><span class="mudo">${p ? esc(p.aberto_por_nome) + ' · ' + mins(p.aberto_em) + ' min' : lug(m) + ' lugares · livre'}${filhas(m).length ? ' · ' + (filhas(m).length + 1) + ' mesas juntas' : ''}</span>${esperaTxt(cm)}${p ? '' : resTxt(resMesa(m))}${temQr(p) ? '<span class="est novo">pedido do cliente</span>' : ''}${p ? `<span class="tot">${kz(p.total)}</span>` : ''}</button>`; };
  const soltas = st.pedidos.filter((p) => !p.mesa_id), ocup = st.pedidos.filter((p) => p.mesa_id).length;
  return `<div class="cab"><h1>${esc(st.local.nome)}</h1><span class="mudo">${ocup} de ${vis.length} mesas ocupadas</span><span class="esp"></span>
    <div class="seg"><button class="${modo === 'planta' ? 'on' : ''}" data-a="modoMesas" data-m="planta">Planta 3D</button><button class="${modo === 'lista' ? 'on' : ''}" data-a="modoMesas" data-m="lista">Lista</button></div>
    ${modo === 'planta' && pode('cfg') ? (ed ? '' : '<button class="btn p" data-a="editarPlanta">Editar mesas</button>') : ''}
    <button class="btn" data-a="reservar">Reservar mesa</button><button class="btn" data-a="nova" data-t="balcao">Conta de balcão</button><button class="btn" data-a="nova" data-t="takeaway">Take-away</button></div>
    ${(st.reservas || []).some((r) => r.estado === 'pendente') ? `<div class="aviso">Há ${st.reservas.filter((r) => r.estado === 'pendente').length} pedido(s) de reserva para hoje por confirmar. <a href="#reservas">Ver reservas</a></div>` : ''}
    ${!st.turno && pode('pagar') ? '<div class="aviso">A caixa está fechada. Pode registar pedidos, mas para receber pagamentos abra a caixa no menu <a href="#caixa">Caixa</a>.</div>' : ''}
    ${ed ? `<div class="aviso ferr"><div><b>Mover:</b> arraste cada mesa para o sítio. <b>Alterar ou apagar:</b> toque na mesa e escolha «Alterar mesa» ou «Apagar». <b>Juntar:</b> toque nas mesas a juntar (a primeira fica com o número activo) e escolha «Juntar». As outras deixam de aparecer e a conta passa a ser uma só.</div>
      <div class="fila" style="margin-top:10px"><button class="btn p" data-a="juntarMesas" ${nSel >= 2 ? '' : 'disabled'}>Juntar${nSel >= 2 ? ' ' + nSel + ' mesas' : ''}</button><button class="btn" data-a="separarMesas" ${nSel ? '' : 'disabled'}>Separar</button><button class="btn" data-a="novaMesa">Adicionar mesa</button><button class="btn" data-a="alterarMesa" ${nSel === 1 ? '' : 'disabled'}>Alterar mesa</button><button class="btn" data-a="formaMesas" ${nSel ? '' : 'disabled'}>Mudar forma</button><button class="btn perigo" data-a="apagarMesas" ${nSel ? '' : 'disabled'}>Apagar${nSel > 1 ? ' ' + nSel + ' mesas' : ''}</button><span class="esp"></span><button class="btn p" data-a="guardarPlanta">Guardar posições</button><button class="btn" data-a="editarPlanta">Fechar</button></div></div>` : ''}
    ${soltas.length ? `<h3 class="zona">Balcão, take-away e entregas</h3><div class="grelha">${soltas.map((p) => `<button class="mesa oc ${corMesa(p).cls}" data-a="abrir" data-id="${p.id}"><b>${esc(p.mesa_nome)}</b><span class="mudo">${esc(p.aberto_por_nome)} · ${hora(p.aberto_em)}</span>${esperaTxt(corMesa(p))}<span class="tot">${kz(p.total)}</span></button>`).join('')}</div>` : ''}
    <div class="legenda"><span><i class="l0"></i>Livre</span><span><i class="l4"></i>Reservada hoje</span><span><i class="l1"></i>Ocupada, pedido em dia</span><span><i class="l2"></i>À espera há 10 min ou mais</span><span><i class="l3"></i>À espera há 30 min ou mais</span><span class="mudo">A espera pára quando a cozinha ou o bar dão o pedido como pronto.</span></div>
    ${modo === 'planta' ? `<div class="chips" style="margin-top:12px">${zonas.map((z) => `<button class="chip ${z === S.x.zona ? 'on' : ''}" data-a="zona" data-id="${esc(z)}">${esc(z)}</button>`).join('')}</div>
      ${ed ? '' : `<div class="zoom"><span class="mudo">Distância da planta</span><button class="btn s" data-a="zoomPlanta" data-d="-1" title="Afastar">−</button><button class="btn s" data-a="zoomPlanta" data-d="1" title="Aproximar">+</button></div>`}
      <div class="planta-w"><div class="planta ${ed ? 'editar' : ''}" id="planta" style="--z:${zoomP()}">${vis.filter((m) => m.zona === S.x.zona).map(mesa3d).join('')}</div></div>`
    : zonas.map((z) => `<h3 class="zona">${esc(z)}</h3><div class="grelha">${vis.filter((m) => m.zona === z).map(cartao).join('')}</div>`).join('')}`;
}

const IC = (d) => `<svg class="ic" viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
const ICO = { volta: IC('<path d="M15 6l-6 6 6 6"/>'), desconto: IC('<path d="M19 5L5 19"/><circle cx="7.5" cy="7.5" r="2.5"/><circle cx="16.5" cy="16.5" r="2.5"/>'), obs: IC('<path d="M4 5h16v11H9l-5 4z"/>'),
  imp: IC('<path d="M7 9V4h10v5M7 17H5a1 1 0 0 1-1-1v-5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v5a1 1 0 0 1-1 1h-2M7 14h10v6H7z"/>'), moto: IC('<path d="M3 7h11v9H3zM14 10h4l3 3v3h-7z"/><circle cx="7" cy="18" r="2"/><circle cx="17" cy="18" r="2"/>'),
  enviar: IC('<path d="M4 12l16-8-6 16-3-6z"/>'), pagar: IC('<rect x="3" y="6" width="18" height="12" rx="2"/><path d="M3 10h18"/>'), user: IC('<circle cx="12" cy="8" r="3.5"/><path d="M5 20a7 7 0 0 1 14 0"/>'),
  cesto: IC('<path d="M4 6h2l2 10h9l2-7H7"/><circle cx="9.5" cy="19" r="1.3"/><circle cx="16.5" cy="19" r="1.3"/>'), troca: IC('<path d="M4 8h14l-3-3M20 16H6l3 3"/>'), mais: IC('<path d="M12 5v14M5 12h14"/>'),
  mesa: IC('<rect x="4" y="5" width="16" height="4" rx="1.5"/><path d="M7 9v10M17 9v10"/>'), sobe: IC('<path d="M12 19V5M6 11l6-6 6 6"/>'), desce: IC('<path d="M12 5v14M6 13l6 6 6-6"/>'), cofre: IC('<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M4 10h16"/>'), saldo: IC('<rect x="3" y="7" width="18" height="12" rx="2"/><path d="M16 13h2"/>') };
const tecla = (k) => `<kbd>${k}</kbd>`;
function linhasHtml(p) {
  const ls = p.linhas.filter((l) => !AUTO.includes(l.seccao));
  return ls.length ? ls.map((l) => `<div class="lin ${l.estado}">
      ${l.estado === 'novo' ? `<div class="qt"><button data-a="menos" data-id="${l.id}">−</button><b>${l.qtd}</b><button data-a="mais" data-id="${l.id}">+</button></div>` : `<b class="qx">${l.qtd} ×</b>`}
      <div class="n">${esc(l.nome)}<small><span class="est ${l.estado}">${ESTADOS[l.estado]}</span>${l.criado_por_nome === 'Cliente (QR)' && l.estado === 'novo' ? ' pedido pelo cliente' : ''}</small>${l.notas ? `<span class="obs-t">Obs.: ${esc(l.notas)}</span>` : ''}${l.estado === 'novo' ? `<button class="obs-b" data-a="nota" data-id="${l.id}">${l.notas ? 'Alterar obs.' : '+ Observação'}</button>` : ''}</div>
      <span class="v">${kz(l.preco * l.qtd)}</span>
      ${l.estado === 'novo' ? `<button class="tira" data-a="tirar" data-id="${l.id}" title="Tirar da conta">−</button>` : (l.estado !== 'anulado' && pode('sala') ? `<button class="tira" data-a="anularL" data-id="${l.id}" title="Anular linha">×</button>` : '<span class="tira0"></span>')}
    </div>`).join('') : '<p class="mudo vazio">Toque nos artigos para os juntar à conta.</p>';
}
function totaisHtml(p) {
  const base = p.linhas.filter((l) => !AUTO.includes(l.seccao) && l.estado !== 'anulado').reduce((s, l) => s + l.preco * l.qtd, 0), autos = p.linhas.filter((l) => AUTO.includes(l.seccao) && l.estado !== 'anulado'), pg = pago(p);
  return `<div class="tot-l"><span>Subtotal</span><span>${kz(base)}</span></div>
    ${autos.map((l) => `<div class="tot-l"><span>${esc(l.nome)}${l.qtd > 1 ? ' × ' + l.qtd : ''}${pode('sala') ? ` <button class="xz" data-a="anularL" data-id="${l.id}" title="Dispensar esta taxa">×</button>` : ''}</span><span>${kz(l.preco * l.qtd)}</span></div>`).join('')}
    ${p.desconto ? `<div class="tot-l"><span>Desconto</span><span>− ${kz(p.desconto)}</span></div>` : ''}
    <div class="tot-l g"><span>Total</span><span>${kz(p.total)}</span></div>
    ${pg ? `<div class="tot-l"><span>Recebido</span><span>${kz(pg)}</span></div><div class="tot-l"><b>Em falta</b><b>${kz(Math.max(0, p.total - pg))}</b></div>` : ''}`;
}
const chipsFam = (fams, temFav) => `${temFav ? `<button class="chip fav ${S.fam === 'fav' ? 'on' : ''}" data-a="fam" data-id="fav">★ Favoritos</button>` : ''}<button class="chip ${S.fam === 'todos' ? 'on' : ''}" data-a="fam" data-id="todos">Todos</button>${fams.map((f) => `<button class="chip ${f.id === S.fam ? 'on' : ''}" data-a="fam" data-id="${f.id}">${esc(f.nome)}</button>`).join('')}`;
function vPedido(id) {
  const st = S.st, p = P(id);
  if (!p) return `<div class="aviso">Esta conta já foi fechada.</div><a class="btn" href="#mesas">Voltar às mesas</a>`;
  const daCarta = st.familias.filter((f) => (f.carta === 'vinhos') === (S.x.carta === 'vinhos')), temFav = st.artigos.some((a) => a.favorito);
  if (!(S.fam === 'todos' || (S.fam === 'fav' && temFav) || daCarta.some((f) => f.id === S.fam))) S.fam = temFav && !S.fam ? 'fav' : (daCarta[0] || st.familias[0] || {}).id;
  const novos = p.linhas.filter((l) => l.estado === 'novo').length, itens = p.linhas.filter((l) => l.estado !== 'anulado' && !AUTO.includes(l.seccao)).reduce((s, l) => s + l.qtd, 0), nFora = st.artigos.filter((a) => a.fora).length;
  return `<div class="pedido pdv ${S.x.verConta ? 'vc' : ''}"><div class="carta pdv-e">
    <div class="pdv-b"><a class="btn az" href="#mesas">${ICO.volta}Voltar</a><input id="busca" type="search" placeholder="(F4) Procurar artigo…" value="${esc(S.x.busca || '')}" autocomplete="off"><button class="btn" data-a="disp">Indisponíveis${nFora ? ' (' + nFora + ')' : ''}</button><button class="btn" data-a="semImg" title="Mostrar ou esconder as imagens">${ls.get('semImg', false) ? 'Com imagens' : 'Só texto'}</button>${pode('cfg') ? '<button class="btn vdb" data-a="artNovo" title="Criar um artigo novo na carta">+ Artigo</button>' : ''}</div>
    <div class="seg" style="margin-bottom:8px"><button class="${S.x.carta !== 'vinhos' ? 'on' : ''}" data-a="carta" data-c="menu">Menu</button><button class="${S.x.carta === 'vinhos' ? 'on' : ''}" data-a="carta" data-c="vinhos">Vinhos e bebidas alcoólicas</button></div>
    <div class="chips">${chipsFam(daCarta, temFav)}</div>
    <div class="arts" id="arts">${artsHtml(p)}</div>
  </div>
  <div class="conta pdv-d">
    <header class="pdv-h">${ICO.mesa}<b>${esc(p.mesa_nome)}</b><span>${hora(p.aberto_em)}</span><span class="esp"></span>${pode('sala') ? `<button class="pdv-x" data-a="anularP" data-id="${p.id}">Anular conta</button>` : ''}</header>
    <div class="pdv-s"><button data-a="cliente" data-id="${p.id}">${ICO.user}<span>${p.cliente_nome ? esc(p.cliente_nome) + (p.cliente_nif ? ' · NIF ' + esc(p.cliente_nif) : '') : 'Cliente'}</span></button><div>${ICO.user}<span>${esc(p.aberto_por_nome)}</span></div></div>
    ${p.tipo === 'entrega' ? `<div class="pdv-ent"><b>Entrega</b> · ${esc([p.bairro, p.morada].filter(Boolean).join(' · ')) || 'sem morada'}${p.cliente_tel ? ' · <a href="tel:' + esc(p.cliente_tel) + '">' + esc(p.cliente_tel) + '</a>' : ''}${p.estafeta ? ' · estafeta: ' + esc(p.estafeta) : ''} · <a href="#entregas">quadro de entregas</a></div>` : ''}
    <div class="pdv-s"><button class="az" data-a="transferir" data-id="${p.id}">${ICO.troca}<span>Mudar de mesa</span>${tecla('F9')}</button><button class="vd" data-a="nova" data-t="balcao">${ICO.mais}<span>Conta de balcão</span>${tecla('F2')}</button></div>
    <div class="pdv-l">${linhasHtml(p)}</div>
    <div class="pdv-t">${totaisHtml(p)}</div>
    <div class="pdv-q">
      <button class="q1" data-a="desconto" data-id="${p.id}" ${pode('sala') ? '' : 'disabled'}>${ICO.desconto}<span>Desconto</span>${tecla('F7')}</button>
      <button class="q2" data-a="obsUlt" data-id="${p.id}">${ICO.obs}<span>Observação</span>${tecla('F3')}</button>
      <button class="q3" data-a="consulta" data-id="${p.id}">${ICO.imp}<span>Imprimir</span>${tecla('F8')}</button>
      <button class="q4" data-a="${p.tipo === 'entrega' ? 'irEntregas' : 'entNova'}">${ICO.moto}<span>Entrega</span></button>
    </div>
    <div class="pdv-f"><button class="az" data-a="enviar" data-id="${p.id}" ${novos ? '' : 'disabled'}>${ICO.enviar}<span>Enviar pedido${novos ? ' (' + novos + ')' : ''}</span>${tecla('F5')}</button>
      ${pode('pagar') ? `<button class="vd" data-a="receber" data-id="${p.id}" ${p.linhas.length ? '' : 'disabled'}>${ICO.pagar}<span>Pagamento</span>${tecla('F6')}</button>` : ''}</div>
  </div></div>
  <div class="barra-m"><button class="btn" data-a="verConta">${S.x.verConta ? '← Carta' : 'Conta · ' + itens + ' · ' + kz(p.total)}</button><button class="btn p" data-a="enviar" data-id="${p.id}" ${novos ? '' : 'disabled'}>Enviar${novos ? ' (' + novos + ')' : ''}</button></div>`;
}
function artsHtml(p) {
  const emp = rota().v === 'empregado', b = (S.x.busca || '').trim().toLowerCase(), qt = (id) => p.linhas.filter((l) => l.artigo_id === id && l.estado === 'novo').reduce((s, l) => s + l.qtd, 0);
  const naCarta = (a) => { const f = S.st.familias.find((x) => x.id === a.familia_id); return emp || !f || (f.carta === 'vinhos') === (S.x.carta === 'vinhos'); };
  const arts = S.st.artigos.filter((a) => (b ? a.nome.toLowerCase().includes(b) : S.fam === 'fav' ? a.favorito : S.fam === 'todos' ? naCarta(a) : a.familia_id === S.fam)), img = !ls.get('semImg', false);
  if (emp) return arts.map((a) => { const n = qt(a.id); return `<div class="ea ${n ? 'tem' : ''} ${a.fora ? 'fora' : ''}" data-a="add" data-id="${a.id}" role="button" tabindex="0">${n ? `<em class="ea-n">${n}</em>` : ''}<img src="${esc(imgArt(a))}" alt="" loading="lazy"><div class="ea-t"><b>${esc(a.nome)}</b><span>${a.fora ? 'indisponível' : kz(a.preco)}</span></div>${n ? `<div class="ea-q"><button data-a="empMenos" data-id="${a.id}" aria-label="Menos um">−</button><i>+</i></div>` : (a.fora ? '' : '<i class="ea-p">+</i>')}</div>`; }).join('') || '<p class="mudo">Sem artigos.</p>';
  return arts.map((a) => { const n = qt(a.id); return `<button class="art ${img ? 'ci' : ''} ${n ? 'tem' : ''} ${a.fora ? 'fora' : ''}" data-a="add" data-id="${a.id}">${n ? `<i>${n}</i>` : ''}${img ? `<img src="${esc(imgArt(a))}" alt="" loading="lazy">` : ''}<b>${esc(a.nome)}</b><span>${a.fora ? 'indisponível' : kz(a.preco)}</span></button>`; }).join('') || '<p class="mudo">Sem artigos.</p>';
}

/* ---------- Empregado: registo de pedidos no telemóvel ou no tablet ---------- */
function empCasa() {
  const st = S.st, vis = mesasVis(), eu = S.user.nome, zonas = [...new Set(vis.map((m) => m.zona))], z = zonas.includes(S.x.empZona) ? S.x.empZona : '';
  const minhas = st.pedidos.filter((p) => p.aberto_por_nome === eu), nPr = prontosIds().length, soltas = st.pedidos.filter((p) => !p.mesa_id), livres = vis.filter((m) => !st.pedidos.some((p) => p.mesa_id === m.id)).length;
  const prM = [...new Set(st.pedidos.filter((p) => p.linhas.some((l) => l.estado === 'pronto' && !AUTO.includes(l.seccao))).map((p) => p.mesa_nome))];
  const cartao = (m) => { const p = st.pedidos.find((x) => x.mesa_id === m.id), cm = corMesa(p), r = !p && resMesa(m);
    return `<button class="mesa em ${r ? 'res' : ''} ${p ? 'oc ' + cm.cls : ''}" data-a="empMesa" data-id="${m.id}"><b>${esc(m.nome)}</b><span class="mudo">${p ? esc((p.aberto_por_nome || '').split(' ')[0]) + ' · ' + mins(p.aberto_em) + ' min' : r ? 'reservada ' + esc(r.hora) : lug(m) + ' lugares'}</span>${cm.min != null ? `<small class="esp-t">espera ${cm.min} min</small>` : ''}${temQr(p) ? '<span class="est novo">pedido do cliente</span>' : ''}${p ? `<span class="tot">${kz(p.total)}</span>` : '<span class="tot livre">Abrir</span>'}</button>`; };
  return `<div class="emp"><div class="emp-ola"><div><small>Empregado</small><b>${esc(eu)}</b></div><span class="mudo">${esc(st.local.nome)}</span></div>
    <div class="emp-k"><div><b>${minhas.length}</b><span>As minhas contas</span></div><a href="#servir" class="${nPr ? 'pr' : ''}"><b>${nPr}</b><span>Prontos a servir</span></a><div><b>${livres}</b><span>Mesas livres</span></div></div>
    ${nPr ? `<a class="emp-pr" href="#servir"><b>${nPr} artigo(s) pronto(s) a servir</b><span>${prM.map(esc).join(', ')} →</span></a>` : ''}
    <div class="fila emp-n"><button class="btn" data-a="empNova" data-t="takeaway">+ Take-away</button><button class="btn" data-a="empNova" data-t="balcao">+ Balcão</button><button class="btn" data-a="entNova">+ Entrega</button></div>
    ${soltas.length ? `<h3 class="zona">Contas sem mesa</h3><div class="grelha emg">${soltas.map((p) => `<button class="mesa em oc ${corMesa(p).cls}" data-a="empAbrir" data-id="${p.id}"><b>${esc(p.mesa_nome)}</b><span class="mudo">${esc((p.aberto_por_nome || '').split(' ')[0])} · ${hora(p.aberto_em)}</span><span class="tot">${kz(p.total)}</span></button>`).join('')}</div>` : ''}
    <h3 class="zona">Escolha a mesa</h3>
    <div class="chips"><button class="chip ${z ? '' : 'on'}" data-a="empZona" data-id="">Todas</button>${zonas.map((x) => `<button class="chip ${x === z ? 'on' : ''}" data-a="empZona" data-id="${esc(x)}">${esc(x)}</button>`).join('')}</div>
    <div class="grelha emg">${vis.filter((m) => !z || m.zona === z).map(cartao).join('')}</div></div>`;
}
function vEmp(id) {
  const st = S.st, p = id && P(id);
  if (!p) return empCasa();
  const temFav = st.artigos.some((a) => a.favorito);
  if (!(S.fam === 'todos' || (S.fam === 'fav' && temFav) || st.familias.some((f) => f.id === S.fam))) S.fam = temFav ? 'fav' : 'todos';
  const novos = p.linhas.filter((l) => l.estado === 'novo').length, itens = p.linhas.filter((l) => l.estado !== 'anulado' && !AUTO.includes(l.seccao)).reduce((s, l) => s + l.qtd, 0);
  return `<div class="ep ${S.x.verConta ? 'vc' : ''}">
    <header class="ep-h"><button data-a="empVoltar" aria-label="Voltar às mesas">${ICO.volta}</button><div><b>${esc(p.mesa_nome)}</b><small>${itens} artigo(s) · ${kz(p.total)}</small></div><button class="ep-cb" data-a="verConta" aria-label="Ver pedido">${ICO.cesto}${novos ? `<i>${novos}</i>` : ''}</button></header>
    <div class="ep-c"><div class="ep-e"><input id="busca" type="search" placeholder="Procurar artigo…" value="${esc(S.x.busca || '')}" autocomplete="off">
      <div class="chips">${chipsFam(st.familias, temFav)}</div><div class="ep-arts" id="arts">${artsHtml(p)}</div></div>
    <aside class="ep-conta"><h3>Pedido · ${esc(p.mesa_nome)}</h3><div class="pdv-l">${linhasHtml(p)}</div><div class="pdv-t">${totaisHtml(p)}</div>
      <div class="fila" style="margin-top:12px"><button class="btn s" data-a="consulta" data-id="${p.id}">Consulta de mesa</button><button class="btn s" data-a="transferir" data-id="${p.id}">Mudar de mesa</button>${pode('pagar') ? `<button class="btn s" data-a="receber" data-id="${p.id}" ${p.linhas.length ? '' : 'disabled'}>Receber</button>` : ''}</div></aside></div>
    <footer class="ep-f"><button class="btn" data-a="verConta">${S.x.verConta ? '← Artigos' : 'Ver pedido · ' + itens + ' · ' + kz(p.total)}</button><button class="btn p" data-a="enviar" data-id="${p.id}" ${novos ? '' : 'disabled'}>${ICO.enviar}Enviar${novos ? ' (' + novos + ')' : ''}</button></footer></div>`;
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

/* Observações ao pedido: opções mais usadas (configuráveis em Configuração → Empresa) e texto livre */
const OBS_PADRAO = { cozinha: ['Bem passado', 'Médio', 'Mal passado', 'Sem batata', 'Só arroz', 'Com arroz e batata', 'Sem sal', 'Pouco sal', 'Sem jindungo', 'Com jindungo à parte', 'Sem cebola', 'Sem alho', 'Sem molho', 'Molho à parte', 'Sem ovo', 'Sem glúten', 'Alergia: avisar o chefe', 'Para dividir', 'Para levar', 'Servir depois das entradas'], bar: ['Sem gelo', 'Com gelo', 'Com limão', 'Sem açúcar', 'Natural', 'Bem fresca', 'Copo à parte', 'Com palhinha', 'Para levar'] };
function obsOpcoes(sec) { const e = S.st.empresa, t = (sec === 'bar' ? e.obs_bar : e.obs_cozinha) || ''; const l = t.split(',').map((x) => x.trim()).filter(Boolean); return l.length ? l : OBS_PADRAO[sec === 'bar' ? 'bar' : 'cozinha']; }
function mObs() {
  const o = S.x.obs, [, l] = linhaDe(o.id); if (!l) return fechar();
  modal(`<h2>Obs. — ${esc(l.nome)}</h2><p class="mudo" style="margin:4px 0 10px">Toque nas alterações pedidas pelo cliente. Seguem com o pedido para ${l.seccao === 'bar' ? 'o bar' : 'a cozinha'}.</p>
    <div class="obs-op">${obsOpcoes(l.seccao).map((v) => `<button class="${o.sel.includes(v) ? 'on' : ''}" data-a="obsTroca" data-v="${esc(v)}">${esc(v)}</button>`).join('')}</div>
    <label>Outra observação</label><input id="obsLivre" value="${esc(o.livre || '')}" placeholder="Escreva aqui o que não estiver na lista" autocomplete="off">
    <div class="fila" style="margin-top:16px"><button class="btn s" data-a="obsLimpa">Limpar</button><span class="esp"></span><button class="btn" data-a="fechar">Cancelar</button><button class="btn p" data-a="obsOk">Guardar obs.</button></div>`, 'larga');
}
/* Retirar produtos do menu temporariamente (por local): somem do menu digital e ficam bloqueados nos pedidos */
function mDisp() {
  const st = S.st, sec = S.x.dispSec, fams = st.familias.filter((f) => !sec || f.seccao === sec), n = st.artigos.filter((a) => a.fora).length;
  modal(`<h2>Produtos indisponíveis</h2><p class="mudo" style="margin:4px 0 10px">Toque num produto para o retirar do menu de ${esc(st.local.nome)}. Deixa de aparecer no menu digital e não pode ser pedido, até alguém o repor. Não apaga o produto nem mexe no preço.</p>
    ${fams.map((f) => { const as = st.artigos.filter((a) => a.familia_id === f.id); return as.length ? `<h3 style="margin:12px 0 6px">${esc(f.nome)}</h3><div class="disp">${as.map((a) => `<button class="${a.fora ? 'fora' : ''}" data-a="dispTroca" data-id="${a.id}"><span>${esc(a.nome)}</span><b>${a.fora ? 'retirado' : 'no menu'}</b></button>`).join('')}</div>` : ''; }).join('')}
    <div class="fila" style="margin-top:16px">${n ? `<button class="btn" data-a="dispTodos">Repor todos (${n})</button>` : ''}<span class="esp"></span><button class="btn p" data-a="fechar">Concluído</button></div>`, 'larga');
}
function apito() { try { const C = window.AudioContext || window.webkitAudioContext, c = apito.c || (apito.c = new C()); [0, 0.22].forEach((t) => { const o = c.createOscillator(), g = c.createGain(); o.frequency.value = 880; o.connect(g); g.connect(c.destination); g.gain.setValueAtTime(0.25, c.currentTime + t); g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + t + 0.18); o.start(c.currentTime + t); o.stop(c.currentTime + t + 0.2); }); } catch (e) {} }
/* Empregado de mesa: o que já saiu da cozinha ou do bar e está à espera de ir para a mesa */
function vServir() {
  const de = (ests) => S.st.pedidos.map((p) => ({ p, ls: p.linhas.filter((l) => ests.includes(l.estado) && !AUTO.includes(l.seccao)) })).filter((t) => t.ls.length);
  const pr = de(['pronto']), fila = de(['enviado', 'preparar']);
  return `<div class="cab"><h1>Prontos a servir</h1><span class="mudo">${pr.reduce((s, t) => s + t.ls.length, 0)} artigo(s) à espera de ir para a mesa</span></div>
    ${pr.length ? `<div class="servir">${pr.map(({ p, ls }) => `<div class="cartao sv"><header><b>${esc(p.mesa_nome)}</b><span class="mudo">${esc((p.aberto_por_nome || '').split(' ')[0])}</span></header>
      ${ls.map((l) => { const a = S.st.artigos.find((x) => x.id === l.artigo_id); return `<div class="sv-l">${a ? `<img src="${esc(imgArt(a))}" alt="" loading="lazy">` : ''}<div><b>${l.qtd}× ${esc(l.nome)}</b><small>${l.seccao === 'bar' ? 'Levantar no bar' : 'Levantar na cozinha'}${l.notas ? ' · ' + esc(l.notas) : ''}</small></div><button class="btn s" data-a="kds" data-id="${l.id}" data-e="pronto">Entregue</button></div>`; }).join('')}
      <div class="fila" style="margin-top:10px"><a class="btn s" href="#pedido/${p.id}">Abrir conta</a><span class="esp"></span><button class="btn p" data-a="servirTodos" data-p="${p.id}">Entreguei tudo</button></div></div>`).join('')}</div>`
    : '<div class="cartao">Nada à espera. Quando a cozinha ou o bar validarem uma saída, aparece aqui e o telemóvel toca.</div>'}
    <h3 class="zona">Ainda em preparação</h3>${fila.length ? `<div class="cartao">${fila.map(({ p, ls }) => `<div class="tot-l"><span><b>${esc(p.mesa_nome)}</b> · ${ls.map((l) => l.qtd + '× ' + esc(l.nome)).join(', ')}</span><span class="mudo">${mins(ls[0].enviado_em || ls[0].criado_em)} min</span></div>`).join('')}</div>` : '<p class="mudo">Sem pedidos em preparação.</p>'}`;
}
function reduzFoto(file) {
  return new Promise((ok, erro) => { const im = new Image(); im.onload = () => { const W = 800, H = 600, c = document.createElement('canvas'); c.width = W; c.height = H;
    const e = Math.max(W / im.width, H / im.height), w = im.width * e, h = im.height * e; c.getContext('2d').drawImage(im, (W - w) / 2, (H - h) / 2, w, h); URL.revokeObjectURL(im.src); ok(c.toDataURL('image/jpeg', 0.8)); };
    im.onerror = () => erro(new Error('Não foi possível ler a fotografia')); im.src = URL.createObjectURL(file); });
}
function vKds(sec) {
  const de = (ests) => S.st.pedidos.map((p) => ({ p, ls: p.linhas.filter((l) => l.seccao === sec && ests.includes(l.estado)) })).filter((t) => t.ls.length)
    .sort((a, b) => new Date(a.ls[0].enviado_em || a.ls[0].criado_em) - new Date(b.ls[0].enviado_em || b.ls[0].criado_em));
  const fila = de(['enviado', 'preparar']), prontos = de(['pronto']);
  // apito quando entra um pedido novo
  const ids = fila.flatMap((t) => t.ls.filter((l) => l.estado === 'enviado').map((l) => l.id)), vistos = (S.x.kdsV = S.x.kdsV || {})[sec];
  if (vistos && ids.some((id) => !vistos.includes(id))) apito();
  S.x.kdsV[sec] = ids;
  const linha = (x) => `<button class="${x.estado}" data-a="kds" data-id="${x.id}" data-e="${x.estado}"><b>${x.qtd}×</b><span style="flex:1">${esc(x.nome)}${x.notas ? `<br><small><i>${esc(x.notas)}</i></small>` : ''}${x.criado_por_nome === 'Cliente (QR)' ? '<br><small>pedido pelo cliente</small>' : ''}</span><span class="est ${x.estado}">${ESTADOS[x.estado]}</span></button>`;
  const tic = ({ p, ls }) => { const m = mins(ls[0].enviado_em || ls[0].criado_em), novos = ls.some((x) => x.estado === 'enviado');
    return `<div class="tic ${m >= 30 ? 'tarde pisca' : m >= 10 ? 'aviso' : ''}"><header><span>${esc(p.mesa_nome)}</span><span>${m} min · ${esc((p.aberto_por_nome || '').split(' ')[0])}</span></header>${ls.map(linha).join('')}
      <div class="tic-b">${novos ? `<button class="btn" data-a="kdsTodos" data-p="${p.id}" data-s="${sec}" data-de="enviado" data-para="preparar">Aceitar pedido</button>` : ''}<button class="btn p" data-a="kdsTodos" data-p="${p.id}" data-s="${sec}" data-de="enviado,preparar" data-para="pronto">Validar saída</button></div></div>`; };
  return `<div class="cab"><h1>${sec === 'bar' ? 'Bar' : 'Cozinha'}</h1><span class="mudo">${fila.length} pedido(s) em fila · ${fila.reduce((s, t) => s + t.ls.reduce((a, l) => a + l.qtd, 0), 0)} artigo(s)</span><span class="esp"></span><button class="btn" data-a="disp" data-s="${sec}">Produtos indisponíveis${S.st.artigos.some((a) => a.fora) ? ' (' + S.st.artigos.filter((a) => a.fora).length + ')' : ''}</button><button class="btn" data-a="kdsFull">${document.body.classList.contains('kds-full') ? 'Sair do ecrã inteiro' : 'Ecrã inteiro'}</button></div>
    <div class="kds-2"><div><h3 class="zona" style="margin-top:0">Por preparar</h3>${fila.length ? `<div class="kds">${fila.map(tic).join('')}</div>` : '<div class="cartao">Sem pedidos em espera.</div>'}</div>
    <div class="kds-p"><h3 class="zona" style="margin-top:0">Saída validada · a aguardar entrega</h3>${prontos.length ? prontos.map(({ p, ls }) => `<div class="tic pr"><header><span>${esc(p.mesa_nome)}</span><span>pronto</span></header>${ls.map((x) => `<button class="pronto" data-a="kds" data-id="${x.id}" data-e="pronto"><b>${x.qtd}×</b><span style="flex:1">${esc(x.nome)}</span></button>`).join('')}<div class="tic-b"><button class="btn" data-a="kdsTodos" data-p="${p.id}" data-s="${sec}" data-de="pronto" data-para="entregue">Entregue na mesa</button></div></div>`).join('') : '<p class="mudo">Nada a aguardar entrega.</p>'}</div></div>`;
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
  const rec = d.porMeio.reduce((s, m) => s + m.valor, 0);
  return `<div class="cab"><h1>Controlo de caixa</h1><span class="esp"></span></div>
    ${d.abertas ? `<div class="aviso">Há ${d.abertas} conta(s) ainda aberta(s) neste local.</div>` : ''}
    <div class="cxr"><div class="cartao cxr-c"><header><h2>Resumo da caixa</h2><span class="cxr-on">● Caixa aberta</span></header><p class="mudo">Aberta em ${dataHora(t.aberto_em)} por ${esc(t.utilizador_nome)}</p>
      <div class="cxr-l"><div><i class="c1">${ICO.cofre}</i><span>Valor de abertura</span><b>${kz(t.fundo)}</b></div><div><i class="c2">${ICO.sobe}</i><span>Entradas<small>recebido ${kz(rec)}${ent ? ' + reforços ' + kz(ent) : ''}</small></span><b>${kz(rec + ent)}</b></div>
        <div><i class="c3">${ICO.desce}</i><span>Saídas<small>sangrias</small></span><b>${kz(sai)}</b></div><div><i class="c4">${ICO.saldo}</i><span>Saldo da caixa<small>numerário esperado na gaveta: ${kz(esp.numerario)}</small></span><b>${kz(t.fundo + rec + ent - sai)}</b></div></div>
      <div class="cxr-b"><button class="vd" data-a="mov" data-t="reforco">+ Adicionar entrada</button><button class="am" data-a="mov" data-t="sangria">− Adicionar saída</button><button class="vm" data-a="fecharCaixa">Fechar caixa</button></div></div></div>
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
  const qr = (u, n, sub) => `<div class="cartao qr"><h2>${esc(n)}</h2>${sub ? `<p class="mudo">${sub}</p>` : ''}<p><img src="/api/qr?t=${encodeURIComponent(u)}" alt="Código QR" loading="lazy"></p><div class="fila" style="justify-content:center"><a class="btn s" href="${esc(u)}" target="_blank" rel="noopener">Abrir</a><button class="btn s p" data-a="impQr" data-u="${esc(u)}" data-n="${esc(n)}">Imprimir QR</button></div></div>`;
  const base = location.origin + '/menu?l=' + encodeURIComponent(S.st.local.slug);
  return `<div class="cab"><h1>Menu digital</h1><span class="esp"></span><a class="btn" href="/menu?l=${encodeURIComponent(S.st.local.slug)}&imprimir=1" target="_blank" rel="noopener">Versão para imprimir</a><button class="btn p" data-a="disp">Retirar produtos temporariamente${S.st.artigos.some((a) => a.fora) ? ' (' + S.st.artigos.filter((a) => a.fora).length + ' fora)' : ''}</button></div><div class="aviso">O QR do local mostra só a carta. O QR de cada mesa deixa o cliente pedir: o pedido entra na conta dessa mesa como «pedido do cliente» e só segue para a cozinha depois de o empregado o confirmar com «Enviar pedido».</div>
    <h3 class="zona">Carta de ${esc(S.st.local.nome)}</h3><div class="fases">${qr(base, S.st.local.nome, 'Menu · só consulta')}${qr(base + '#vinhos', 'Carta de vinhos e bar', 'Vinhos e bebidas alcoólicas · só consulta')}</div>
    <h3 class="zona">Reservas online</h3><div class="fases">${qr(base + '#reservar', 'Reservar em ' + S.st.local.nome, 'O cliente pede a reserva; fica «por confirmar» em Reservas')}</div>
    <h3 class="zona">Pedido na mesa</h3><div class="fases">${S.st.mesas.map((m) => qr(base + '&m=' + m.id, m.nome, esc(m.zona))).join('')}</div>`;
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
  if (tab === 'artigos') corpo = T(['', 'Artigo', 'Família', 'Preço base', 'Preço em ' + esc(S.st.local.nome), 'Activo', 'No menu digital'], d.artigos.map((a) => [a.id, `<img class="mini" src="${esc(a.imagem || '/img/_prato.png')}" alt="" loading="lazy">`, esc(a.nome) + (a.favorito ? ' <span class="est ok">★ favorito</span>' : ''), esc(fam(a.familia_id)), kz(a.preco), pl(a.id) != null ? kz(pl(a.id)) : '<span class="mudo">igual ao base</span>', sn(a.activo), sn(a.no_menu)]));
  if (tab === 'familias') corpo = T(['Família', 'Carta', 'Preparada em', 'Ordem', 'Activa'], d.familias.map((f) => [f.id, esc(f.nome), f.carta === 'vinhos' ? 'Vinhos e bebidas alcoólicas' : 'Menu', f.seccao === 'bar' ? 'Bar' : 'Cozinha', f.ordem, sn(f.activo)]));
  if (tab === 'mesas') corpo = T(['Mesa', 'Zona', 'Local', 'Lugares', 'Activa'], d.mesas.map((m) => [m.id, esc(m.nome), esc(m.zona), esc(loc(m.local_id)), m.lugares, sn(m.activo)]));
  if (tab === 'locais') corpo = T(['Local', 'Tipo', 'Morada', 'Endereço do menu', 'Activo'], d.locais.map((l) => [l.id, esc(l.nome), esc(l.tipo), esc(l.morada), '/menu?l=' + esc(l.slug), sn(l.activo)]));
  if (tab === 'utilizadores') corpo = (d.utilizadores.some((u) => u.id.startsWith('demo-u-') && u.activo) ? '<div class="aviso">Há utilizadores de teste com a palavra-passe <b>123</b>. Antes de usar a app com clientes, mude-lhes a palavra-passe ou desactive-os (saem também ao apagar os dados fictícios).</div>' : '') + T(['Nome', 'Utilizador', 'Perfil', 'Local', 'Activo'], d.utilizadores.map((u) => [u.id, esc(u.nome) + (u.id.startsWith('demo-u-') ? ' <span class="est pendente">teste</span>' : ''), esc(u.login), PERFIS[u.perfil] || u.perfil, esc(loc(u.local_id)), sn(u.activo)]));
  if (tab === 'empresa') { const e = d.empresa; corpo = `<table><tr><td>Nome</td><td>${esc(e.nome)}</td></tr><tr><td>NIF</td><td>${esc(e.nif) || '—'}</td></tr><tr><td>Regime de IVA</td><td>${esc(e.regime_iva)}</td></tr><tr><td>Taxa de IVA incluída nos preços</td><td>${e.taxa_iva}%</td></tr><tr><td>Software de facturação certificado</td><td>${esc(e.factura_software) || 'por definir'}</td></tr><tr><td>Embalagem de take-away</td><td>${e.emb_preco > 0 ? kz(e.emb_preco) + (e.emb_modo === 'pedido' ? ' por pedido' : ' por prato') : 'não é cobrada'}</td></tr><tr><td>Taxa de serviço nas mesas</td><td>${e.taxa_servico > 0 ? e.taxa_servico + '% sobre o consumo' : 'não é cobrada'}</td></tr><tr><td>Aspecto</td><td>${e.tema === 'luxo' ? 'Luxo — preto e dourado' : 'Clássico — terracota e creme'}</td></tr></table>
    <div class="aviso" style="margin:16px 0 0"><b>Dados fictícios de demonstração.</b> Preenchem todos os menus com vendas, stock, compras, equipa, salários, finanças, reservas e um segundo local de exemplo. Podem ser apagados de uma vez, sem tocar nos dados reais.<div class="fila" style="margin-top:10px"><button class="btn" data-a="demo" data-ac="carregar">Carregar dados fictícios</button><button class="btn perigo" data-a="demo" data-ac="apagar">Apagar dados fictícios</button></div></div>`; }
  return `<div class="cab"><h1>Configuração</h1><span class="esp"></span><button class="btn p" data-a="cfgEdit" data-id="">${tab === 'empresa' ? 'Editar dados da empresa' : 'Novo registo'}</button></div>
    <div class="tabs">${tabs.map((t) => `<button class="chip ${t[0] === tab ? 'on' : ''}" data-a="cfgTab" data-id="${t[0]}">${t[1]}</button>`).join('')}</div><div class="cartao" style="overflow:auto">${corpo}</div>`;
}
function cfgForm(id, tabF, pre) {
  const d = S.x.cfg.d, tab = tabF || S.x.cfgTab, r = tab === 'empresa' ? d.empresa : (d[tab].find((x) => x.id === id) || Object.assign({}, pre)), novo = !r.id;
  const optLoc = d.locais.map((l) => [l.id, l.nome]);
  const campos = {
    artigos: [{ k: 'nome', label: 'Nome', req: 1 }, { k: 'familia_id', label: 'Família', type: 'select', options: d.familias.map((f) => [f.id, f.nome]) }, { k: 'descricao', label: 'Descrição (aparece no menu digital)' }, { k: 'preco', label: 'Preço base (Kz)', type: 'number', req: 1 },
      { k: 'preco_local', label: 'Preço só em ' + S.st.local.nome + ' (vazio = igual ao base)', type: 'number', value: (d.precos.find((p) => p.artigo_id === r.id && p.local_id === S.local) || {}).preco }, { k: 'no_menu', label: 'Mostrar no menu digital', type: 'check', value: novo ? true : r.no_menu }, { k: 'favorito', label: 'Favorito — aparece primeiro no ponto de venda', type: 'check', value: !!r.favorito }, { k: 'activo', label: 'Activo', type: 'check', value: novo ? true : r.activo }],
    familias: [{ k: 'nome', label: 'Nome', req: 1 }, { k: 'carta', label: 'Aparece em', type: 'select', options: [['menu', 'Menu (comida e bebidas sem álcool)'], ['vinhos', 'Carta de vinhos e bebidas alcoólicas']] }, { k: 'seccao', label: 'Preparada em', type: 'select', options: [['cozinha', 'Cozinha'], ['bar', 'Bar']] }, { k: 'ordem', label: 'Ordem na carta', type: 'number' }, { k: 'activo', label: 'Activa', type: 'check', value: novo ? true : r.activo }],
    mesas: [{ k: 'nome', label: 'Nome', req: 1 }, { k: 'zona', label: 'Zona', value: r.zona || 'Sala' }, { k: 'local_id', label: 'Local', type: 'select', options: optLoc, value: r.local_id || S.local }, { k: 'lugares', label: 'Lugares', type: 'number', value: r.lugares || 4 }, { k: 'ordem', label: 'Ordem', type: 'number' }, { k: 'activo', label: 'Activa', type: 'check', value: novo ? true : r.activo }],
    locais: [{ k: 'nome', label: 'Nome', req: 1 }, { k: 'tipo', label: 'Tipo', type: 'select', options: [['restaurante', 'Restaurante'], ['bar', 'Bar'], ['esplanada', 'Esplanada'], ['takeaway', 'Take-away']] }, { k: 'morada', label: 'Morada' }, { k: 'slug', label: 'Endereço do menu (sem espaços)', ph: 'ex.: ilha-de-luanda' }, { k: 'imagem', label: 'Imagem de capa do menu digital', type: 'select', options: [['', 'Sem imagem'], ['/foto/esplanada.jpg', 'Esplanada'], ['/foto/terraco-sobre-o-mar.jpg', 'Terraço sobre o mar'], ['/foto/sala-da-trattoria.jpg', 'Sala interior'], ['/foto/balcao-da-grelha.jpg', 'Balcão da grelha'], ['/foto/patio-do-cafe.jpg', 'Pátio do café'], ['/foto/rooftop-ao-anoitecer.jpg', 'Rooftop ao anoitecer']] }, { k: 'activo', label: 'Activo', type: 'check', value: novo ? true : r.activo }],
    utilizadores: [{ k: 'nome', label: 'Nome', req: 1 }, { k: 'login', label: 'Nome de utilizador', req: 1 }, { k: 'perfil', label: 'Perfil', type: 'select', options: Object.entries(PERFIS) }, { k: 'local_id', label: 'Local', type: 'select', options: [['', 'Todos os locais']].concat(optLoc) }, { k: 'password', label: novo ? 'Palavra-passe (mín. 6 caracteres)' : 'Nova palavra-passe (vazio = manter)', type: 'password' }, { k: 'activo', label: 'Activo', type: 'check', value: novo ? true : r.activo }],
    empresa: [{ k: 'nome', label: 'Nome', req: 1 }, { k: 'nif', label: 'NIF' }, { k: 'regime_iva', label: 'Regime de IVA', type: 'select', options: [['geral', 'Geral'], ['simplificado', 'Simplificado'], ['exclusao', 'Exclusão']] }, { k: 'taxa_iva', label: 'Taxa de IVA incluída nos preços (%) — confirme com o contabilista', type: 'number' }, { k: 'factura_software', label: 'Software de facturação certificado a ligar', ph: 'ex.: Primavera' }, { k: 'inss_taxa', label: 'Segurança Social a cargo do trabalhador (%) — confirme com o contabilista', type: 'number' }, { k: 'emb_preco', label: 'Preço da embalagem de take-away (Kz) — 0 para não cobrar', type: 'number' }, { k: 'emb_modo', label: 'Cobrar a embalagem', type: 'select', options: [['prato', 'Por cada prato da cozinha'], ['pedido', 'Uma vez por pedido']] }, { k: 'taxa_servico', label: 'Taxa de serviço nas contas de mesa (%) — 0 para não cobrar', type: 'number' }, { k: 'obs_cozinha', label: 'Observações rápidas da cozinha, separadas por vírgulas (vazio = lista padrão)', ph: 'Bem passado, Sem batata, Só arroz…' }, { k: 'obs_bar', label: 'Observações rápidas do bar, separadas por vírgulas (vazio = lista padrão)', ph: 'Sem gelo, Com limão…' }, { k: 'tema', label: 'Aspecto da app e do menu digital', type: 'select', options: [['classico', 'Clássico — terracota e creme'], ['luxo', 'Luxo — preto e dourado, para restaurantes de alto nível']] }],
  }[tab].map((c) => (c.value === undefined ? Object.assign(c, { value: r[c.k] }) : c));
  form((novo && tab !== 'empresa' ? 'Novo registo' : 'Editar') + ' — ' + CFG_TABS.find((t) => t[0] === tab)[1], campos, async (v) => {
    const pl = v.preco_local; delete v.preco_local;
    const res = await api('cfg', { method: 'POST', body: { entidade: tab, linha: Object.assign({ id: r.id }, v) } });
    if (tab === 'artigos') { await api('cfg', { method: 'POST', body: { entidade: 'preco_local', linha: { artigo_id: res.id, local_id: S.local, preco: pl } } });
      const fl = $('#fotoF') && $('#fotoF').files[0];
      if (fl) await api('foto', { method: 'POST', body: { artigo_id: res.id, dados: await reduzFoto(fl) } });
      else if ($('#fotoR') && $('#fotoR').checked) await api('foto', { method: 'POST', body: { artigo_id: res.id, remover: true } }); }
    toast('Guardado'); delete S.x.cfg; sync(); render();
  }, tab === 'artigos' ? `<label>Fotografia do prato ou da bebida (opcional)</label><div class="foto-f"><img src="${esc(r.imagem || '/img/_prato.png')}" alt=""><div><input type="file" id="fotoF" accept="image/*">${String(r.imagem || '').startsWith('/api/foto') ? '<label><input type="checkbox" id="fotoR" style="width:auto"> Remover a fotografia e voltar à ilustração</label>' : ''}<small class="mudo">Sem fotografia, é usada a ilustração da casa. A fotografia é reduzida antes de ser enviada.</small></div></div>` : tab === 'mesas' && r.id ? `<div style="margin-top:14px"><button type="button" class="btn perigo" data-a="apagarMesaCfg" data-id="${r.id}">Apagar esta mesa</button></div>` : '');
}

/* ---------- Acções ---------- */
const ACOES = {
  fechar: () => { fechar(); },
  recarregar: () => { ['caixa', 'fact', 'rel', 'cfg'].forEach((k) => delete S.x[k]); render(); },
  eu: () => modal(`<h2>${esc(S.user.nome)}</h2><p class="mudo">${PERFIS[S.user.perfil]} · utilizador «${esc(S.user.login)}»</p><div class="fila" style="margin-top:14px"><button class="btn" data-a="mudarPass">Alterar palavra-passe</button><span class="esp"></span><button class="btn" data-a="fechar">Fechar</button><button class="btn perigo" data-a="sair">Sair</button></div>`),
  sair: () => { if (S.queue.length && !confirm('Há ' + S.queue.length + ' operação(ões) por sincronizar. Se sair agora perdem-se. Sair mesmo assim?')) return; S.queue = []; ls.del('queue'); fechar(); sair(); },
  mudarPass: () => form('Alterar palavra-passe', [{ k: 'actual', label: 'Palavra-passe actual', type: 'password', req: 1 }, { k: 'nova', label: 'Nova palavra-passe (mín. 6 caracteres)', type: 'password', req: 1 }], async (v) => { await api('password', { method: 'POST', body: v }); toast('Palavra-passe alterada'); }),
  mesa: (el) => { if (S.x.editar) return; S.x.verConta = false; S.x.busca = ''; const p = S.st.pedidos.find((x) => x.mesa_id === el.dataset.id); if (p) return ir('pedido/' + p.id); if (!pode('pedir')) return;
    const mm = S.st.mesas.find((x) => x.id === el.dataset.id), rs = mm && !el.dataset.direto ? resMesa(mm) : null;
    if (rs) return modal(`<h2>${esc(mm.nome)} — reservada</h2><div class="aviso" style="margin-top:10px"><b>${esc(rs.hora)} · ${esc(rs.cliente_nome)}</b><br>${rs.pessoas} pessoa(s)${rs.telefone ? ' · ' + esc(rs.telefone) : ''}${rs.notas ? '<br>' + esc(rs.notas) : ''}${rs.estado === 'pendente' ? '<br><span class="est pendente">pedido online por confirmar</span>' : ''}</div>
      <div class="fila" style="margin-top:14px"><button class="btn p" data-a="sentar" data-id="${rs.id}" data-m="${mm.id}">Chegaram: abrir conta</button><button class="btn" data-a="reservar" data-r="${rs.id}">Alterar reserva</button><button class="btn perigo" data-a="resEstado" data-id="${rs.id}" data-e="cancelada">Cancelar reserva</button></div>
      <div class="fila" style="margin-top:10px"><button class="btn s" data-a="mesa" data-id="${mm.id}" data-direto="1">Abrir conta para outro cliente</button><span class="esp"></span><button class="btn s" data-a="fechar">Fechar</button></div>`);
    fechar(); const id = uuid(); if (op('pedido.abrir', { id, local_id: S.local, mesa_id: el.dataset.id })) ir('pedido/' + id); },
  nova: (el) => { const id = uuid(); if (op('pedido.abrir', { id, local_id: S.local, tipo: el.dataset.t })) ir('pedido/' + id); },
  abrir: (el) => ir('pedido/' + el.dataset.id),
  reservar: (el) => { const r = el.dataset.r ? (S.st.reservas || []).find((x) => x.id === el.dataset.r) : null; mReserva(el.dataset.id || '', r); },
  resEstado: async (el) => { const r = (S.st.reservas || []).find((x) => x.id === el.dataset.id); if (!r) return; if (el.dataset.e === 'cancelada' && !confirm('Cancelar a reserva de ' + r.cliente_nome + '?')) return;
    try { await api('reg', { method: 'POST', body: { entidade: 'reservas', linha: Object.assign({}, r, { estado: el.dataset.e }) } }); fechar(); toast('Reserva actualizada'); await sync(); render(); } catch (e) { toast(e.message, 'erro'); } },
  sentar: async (el) => { const r = (S.st.reservas || []).find((x) => x.id === el.dataset.id); if (!r) return; const id = uuid();
    if (!op('pedido.abrir', { id, local_id: S.local, mesa_id: el.dataset.m, cliente_nome: r.cliente_nome })) return;
    S.st.reservas = S.st.reservas.filter((x) => x !== r); guardar(); fechar(); ir('pedido/' + id);
    api('reg', { method: 'POST', body: { entidade: 'reservas', linha: Object.assign({}, r, { estado: 'sentada' }) } }).catch(() => toast('Sem rede: marque a reserva como sentada em Reservas', 'erro')); },
  carta: (el) => { S.x.carta = el.dataset.c; S.x.busca = ''; S.fam = ''; render(); },
  fam: (el) => { S.fam = el.dataset.id; S.x.busca = ''; render(); },
  ham: () => document.body.classList.toggle('menu-on'),
  semImg: () => { ls.set('semImg', !ls.get('semImg', false)); render(); },
  servirTodos: (el) => { const p = P(el.dataset.p); if (!p) return; p.linhas.filter((l) => l.estado === 'pronto' && !AUTO.includes(l.seccao)).forEach((l) => op('linha.estado', { id: l.id, estado: 'entregue' })); toast('Entregue: ' + p.mesa_nome); render(); },
  grp: (el) => { (S.x.grpAb = S.x.grpAb || {})[el.dataset.g] = el.dataset.ab !== '1'; render(); },
  demo: async (el) => { const ap = el.dataset.ac === 'apagar'; if (!confirm(ap ? 'Apagar todos os dados fictícios? Os dados reais que tenha introduzido ficam.' : 'Carregar dados fictícios em todos os menus?')) return;
    try { el.disabled = true; await api('demo', { method: 'POST', body: { acao: el.dataset.ac } }); toast(ap ? 'Dados fictícios apagados' : 'Dados fictícios carregados'); S.x = {}; S.st = null; guardar(); render(); sync(); } catch (e) { toast(e.message, 'erro'); el.disabled = false; } },
  juntarMesas: async () => { const sel = S.x.sel || []; if (sel.length < 2) return toast('Toque em duas ou mais mesas para as juntar', 'erro');
    try { await api('mesas-juntar', { method: 'POST', body: { principal: sel[0], outras: sel.slice(1) } }); S.x.sel = []; toast('Mesas juntas: fica activa só a ' + S.st.mesas.find((m) => m.id === sel[0]).nome); await sync(); await sync(); render(); } catch (e) { toast(e.message, 'erro'); } },
  separarMesas: async () => { const sel = (S.x.sel || []).filter((id) => S.st.mesas.some((m) => m.junta_a === id)); if (!sel.length) return toast('Toque numa mesa junta para a separar', 'erro');
    try { for (const id of sel) await api('mesas-separar', { method: 'POST', body: { principal: id } }); S.x.sel = []; toast('Mesas separadas'); await sync(); await sync(); render(); } catch (e) { toast(e.message, 'erro'); } },
  zoomPlanta: (el) => { const z = Math.min(1.05, Math.max(0.45, Math.round((zoomP() + Number(el.dataset.d) * 0.1) * 100) / 100)); ls.set('zoom', z); render(); },
  novaMesa: () => { const nomes = S.st.mesas.map((m) => m.nome); let n = S.st.mesas.length + 1; while (nomes.includes('Mesa ' + n)) n++;
    form('Adicionar mesa', [{ k: 'nome', label: 'Nome ou número', value: 'Mesa ' + n, req: 1 }, { k: 'lugares', label: 'Lugares', type: 'number', value: 4 }, { k: 'zona', label: 'Zona (escreva um nome novo para criar outra zona)', value: S.x.zona || 'Sala', req: 1 }, { k: 'forma', label: 'Forma', type: 'select', options: [['quadrada', 'Quadrada'], ['redonda', 'Redonda'], ['rect', 'Rectangular']] }],
    async (v) => { if (nomes.includes(v.nome)) throw new Error('Já existe uma mesa com esse nome');
      const r = await api('cfg', { method: 'POST', body: { entidade: 'mesas', linha: { local_id: S.local, zona: v.zona, nome: v.nome, lugares: Math.max(1, Number(v.lugares) || 4), ordem: S.st.mesas.length + 1, activo: true } } });
      await api('planta', { method: 'POST', body: { mesas: [{ id: r.id, x: 50, y: 50, forma: v.forma }] } });
      S.x.zona = v.zona; toast(v.nome + ' adicionada: arraste-a para o sítio'); await sync(); await sync(); render(); }); },
  formaMesas: () => { (S.x.sel || []).forEach((id) => { const m = S.st.mesas.find((x) => x.id === id), i = mesasVis().filter((x) => x.zona === m.zona).indexOf(m), ps = Object.assign({}, posMesa(m, i)); ps.forma = { quadrada: 'redonda', redonda: 'rect', rect: 'quadrada' }[ps.forma || 'quadrada']; (S.x.pos = S.x.pos || {})[id] = ps; }); render(); },
  verConta: () => { S.x.verConta = !S.x.verConta; render(); window.scrollTo(0, 0); },
  modoMesas: (el) => { S.x.modoMesas = el.dataset.m; S.x.editar = false; render(); },
  zona: (el) => { S.x.zona = el.dataset.id; render(); },
  alterarMesa: () => { const m = S.st.mesas.find((x) => x.id === (S.x.sel || [])[0]); if (!m) return toast('Toque na mesa que quer alterar', 'erro');
    const ps = posMesa(m, mesasVis().filter((x) => x.zona === m.zona).indexOf(m));
    form('Alterar ' + m.nome, [{ k: 'nome', label: 'Nome ou número', value: m.nome, req: 1 }, { k: 'lugares', label: 'Lugares', type: 'number', value: m.lugares }, { k: 'zona', label: 'Zona (escreva um nome novo para criar outra zona)', value: m.zona, req: 1 }, { k: 'forma', label: 'Forma', type: 'select', value: ps.forma || 'quadrada', options: [['quadrada', 'Quadrada'], ['redonda', 'Redonda'], ['rect', 'Rectangular']] }],
      async (v) => { await api('mesa-editar', { method: 'POST', body: { id: m.id, nome: v.nome, zona: v.zona, lugares: v.lugares, forma: v.forma } }); if (S.x.pos) delete S.x.pos[m.id]; S.x.zona = v.zona; S.x.sel = []; delete S.x.cfg; toast('Mesa alterada'); await sync(); render(); }); },
  apagarMesas: () => { const ms = (S.x.sel || []).map((id) => S.st.mesas.find((x) => x.id === id)).filter(Boolean); if (!ms.length) return toast('Toque nas mesas que quer apagar', 'erro');
    modal(`<h2>Apagar ${ms.length > 1 ? ms.length + ' mesas' : esc(ms[0].nome)}?</h2><p>${ms.length > 1 ? esc(ms.map((m) => m.nome).join(', ')) + '. ' : ''}A mesa sai da planta e deixa de aceitar contas e reservas. As vendas antigas ficam no histórico. Não dá para desfazer.</p><div class="fila" style="margin-top:16px"><span class="esp"></span><button class="btn" data-a="fechar">Cancelar</button><button class="btn perigo" data-a="apagarMesasSim">Apagar</button></div>`); },
  apagarMesaCfg: (el) => { S.x.sel = [el.dataset.id]; ACOES.apagarMesas(); },
  apagarMesasSim: async () => { try { const r = await api('mesas-apagar', { method: 'POST', body: { ids: S.x.sel || [] } }); fechar(); S.x.sel = []; delete S.x.cfg; toast(r.n + ' mesa(s) apagada(s)'); await sync(); render(); } catch (e) { fechar(); toast(e.message, 'erro'); } },
  editarPlanta: () => { S.x.editar = !S.x.editar; S.x.pos = {}; S.x.sel = []; S.x.modoMesas = 'planta'; render(); },
  guardarPlanta: async () => { const ms = mesasVis().map((m) => Object.assign({ id: m.id }, posMesa(m, mesasVis().filter((y) => y.zona === m.zona).indexOf(m))));
    try { await api('planta', { method: 'POST', body: { mesas: ms } }); ms.forEach((x) => { const m = S.st.mesas.find((y) => y.id === x.id); m.x = x.x; m.y = x.y; m.forma = x.forma; }); S.x.pos = {}; guardar(); toast('Posições guardadas'); render(); } catch (e) { toast(e.message, 'erro'); } },
  add: (el) => { const p = P(rota().id); if (!p) return; const ar = S.st.artigos.find((x) => x.id === el.dataset.id); if (ar && ar.fora) return toast(ar.nome + ' está temporariamente indisponível', 'erro'); const l = p.linhas.find((x) => x.artigo_id === el.dataset.id && x.estado === 'novo' && !x.notas); if (l) op('linha.qtd', { id: l.id, qtd: l.qtd + 1 }); else op('linha.add', { id: uuid(), pedido_id: p.id, artigo_id: el.dataset.id, qtd: 1 }); render(); },
  mais: (el) => { const [, l] = linhaDe(el.dataset.id); if (l) { op('linha.qtd', { id: l.id, qtd: l.qtd + 1 }); render(); } },
  menos: (el) => { const [, l] = linhaDe(el.dataset.id); if (l) { op('linha.qtd', { id: l.id, qtd: l.qtd - 1 }); render(); } },
  nota: (el) => { const [, l] = linhaDe(el.dataset.id); if (!l) return; const ops = obsOpcoes(l.seccao), partes = (l.notas || '').split(',').map((x) => x.trim()).filter(Boolean);
    S.x.obs = { id: l.id, sel: partes.filter((x) => ops.includes(x)), livre: partes.filter((x) => !ops.includes(x)).join(', ') }; mObs(); },
  obsTroca: (el) => { const o = S.x.obs, v = el.dataset.v, k = o.sel.indexOf(v); o.livre = $('#obsLivre').value; if (k >= 0) o.sel.splice(k, 1); else o.sel.push(v); mObs(); },
  obsOk: () => { const o = S.x.obs, [, l] = linhaDe(o.id); if (l) op('linha.qtd', { id: l.id, qtd: l.qtd, notas: o.sel.concat($('#obsLivre').value.trim() ? [$('#obsLivre').value.trim()] : []).join(', ') }); fechar(); render(); },
  obsLimpa: () => { S.x.obs.sel = []; S.x.obs.livre = ''; mObs(); },
  anularL: (el) => form('Anular linha', [{ k: 'motivo', label: 'Motivo', req: 1 }], (v) => { op('linha.anular', { id: el.dataset.id, motivo: v.motivo }); render(); }),
  enviar: (el) => { const pe = P(el.dataset.id); if (op('pedido.enviar', { pedido_id: el.dataset.id })) { toast('Pedido enviado' + (pe ? ': ' + pe.mesa_nome : '')); S.x.verConta = false; if (rota().v === 'empregado') ir('empregado'); else render(); } },
  tirar: (el) => { op('linha.qtd', { id: el.dataset.id, qtd: 0 }); render(); },
  cliente: (el) => { const p = P(el.dataset.id); if (!p) return; form('Cliente da conta', [{ k: 'cliente_nome', label: 'Nome do cliente', value: p.cliente_nome }, { k: 'cliente_nif', label: 'NIF (para a factura)', value: p.cliente_nif }], (v) => { op('pedido.cliente', { pedido_id: p.id, cliente_nome: v.cliente_nome, cliente_nif: v.cliente_nif }); render(); }); },
  obsUlt: (el) => { const p = P(el.dataset.id), l = p && p.linhas.filter((x) => x.estado === 'novo' && !AUTO.includes(x.seccao)).pop(); if (!l) return toast('Junte primeiro um artigo: a observação fica no último artigo por enviar', 'erro'); ACOES.nota({ dataset: { id: l.id } }); },
  irEntregas: () => ir('entregas'),
  empMesa: (el) => { S.x.verConta = false; S.x.busca = ''; const p = S.st.pedidos.find((x) => x.mesa_id === el.dataset.id); if (p) return ir('empregado/' + p.id); const m = S.st.mesas.find((x) => x.id === el.dataset.id), r = m && resMesa(m);
    const abre = () => { fechar(); const id = uuid(); if (op('pedido.abrir', { id, local_id: S.local, mesa_id: el.dataset.id })) ir('empregado/' + id); };
    if (!r) return abre(); S.x.empAbre = abre; modal(`<h2>${esc(m.nome)} — reservada</h2><div class="aviso" style="margin-top:10px"><b>${esc(r.hora)} · ${esc(r.cliente_nome)}</b> · ${r.pessoas} pessoa(s)</div><div class="fila" style="margin-top:14px"><button class="btn p" data-a="empAbre">Abrir conta nesta mesa</button><span class="esp"></span><button class="btn" data-a="fechar">Cancelar</button></div>`); },
  empAbre: () => { const f = S.x.empAbre; delete S.x.empAbre; if (f) f(); },
  empAbrir: (el) => { S.x.verConta = false; S.x.busca = ''; ir('empregado/' + el.dataset.id); },
  empNova: (el) => { S.x.verConta = false; S.x.busca = ''; const id = uuid(); if (op('pedido.abrir', { id, local_id: S.local, tipo: el.dataset.t })) ir('empregado/' + id); },
  empVoltar: () => { S.x.verConta = false; S.x.busca = ''; ir('empregado'); },
  empZona: (el) => { S.x.empZona = el.dataset.id; render(); },
  empMenos: (el) => { const p = P(rota().id); if (!p) return; const ls = p.linhas.filter((x) => x.artigo_id === el.dataset.id && x.estado === 'novo'), l = ls.filter((x) => !x.notas).pop() || ls.pop(); if (l) { op('linha.qtd', { id: l.id, qtd: l.qtd - 1 }); render(); } },
  desconto: (el) => { const p = P(el.dataset.id); form('Desconto na conta', [{ k: 'valor', label: 'Valor do desconto (Kz)', type: 'number', value: p.desconto || '' }], (v) => { op('pedido.desconto', { pedido_id: p.id, valor: Math.max(0, Number(v.valor) || 0) }); render(); }); },
  transferir: (el) => { const livres = S.st.mesas.filter((m) => !S.st.pedidos.some((p) => p.mesa_id === m.id)); if (!livres.length) return toast('Não há mesas livres', 'erro'); form('Mudar de mesa', [{ k: 'mesa_id', label: 'Nova mesa', type: 'select', options: livres.map((m) => [m.id, m.zona + ' — ' + m.nome]) }], (v) => { op('pedido.transferir', { pedido_id: el.dataset.id, mesa_id: v.mesa_id }); render(); }); },
  anularP: (el) => form('Anular conta', [{ k: 'motivo', label: 'Motivo', req: 1 }], (v) => { if (P(el.dataset.id).pagamentos.length) { toast('Remova os pagamentos antes de anular a conta', 'erro'); return false; } op('pedido.anular', { pedido_id: el.dataset.id, motivo: v.motivo }); ir('mesas'); }),
  consulta: (el) => consulta(P(el.dataset.id)),
  receber: (el) => { const pr = P(el.dataset.id) || {}; S.x.rec = { nome: pr.cliente_nome || '', nif: pr.cliente_nif || '' }; mReceber(el.dataset.id); },
  pagar: (el) => { const p = P(el.dataset.id), falta = Math.max(0, p.total - pago(p)), v = Number($('#recValor').value) || 0; if (v <= 0) return toast('Indique o valor recebido', 'erro');
    S.x.rec.nome = $('#recNome').value; S.x.rec.nif = $('#recNif').value; S.x.rec.troco = el.dataset.m === 'numerario' && v > falta ? v - falta : 0;
    if (op('pagamento.add', { id: uuid(), pedido_id: p.id, meio: el.dataset.m, valor: Math.min(v, falta) })) mReceber(p.id); render(); },
  rmPag: (el) => { S.x.rec.troco = 0; op('pagamento.remover', { id: el.dataset.id }); mReceber(el.dataset.p); render(); },
  fecharConta: (el) => { if (op('pedido.fechar', { pedido_id: el.dataset.id, cliente_nome: $('#recNome').value.trim(), cliente_nif: $('#recNif').value.trim() })) { fechar(); toast('Conta fechada'); delete S.x.fact; delete S.x.caixa; ir('mesas'); } },
  disp: (el) => { S.x.dispSec = (el && el.dataset.s) || ''; mDisp(); },
  dispTroca: async (el) => { const a = S.st.artigos.find((x) => x.id === el.dataset.id); if (!a) return; const fora = !a.fora;
    try { await api('disponibilidade', { method: 'POST', body: { local: S.local, artigo_id: a.id, fora } }); a.fora = fora; guardar(); mDisp(); render(); } catch (e) { toast(e.offline ? 'Precisa de internet para alterar a disponibilidade' : e.message, 'erro'); } },
  dispTodos: async () => { try { await api('disponibilidade', { method: 'POST', body: { local: S.local, todos: true } }); S.st.artigos.forEach((a) => { a.fora = false; }); guardar(); mDisp(); render(); toast('Todos os produtos voltaram ao menu'); } catch (e) { toast(e.message, 'erro'); } },
  kdsTodos: (el) => { const p = P(el.dataset.p); if (!p) return; const de = el.dataset.de.split(','); p.linhas.filter((l) => l.seccao === el.dataset.s && de.includes(l.estado)).forEach((l) => op('linha.estado', { id: l.id, estado: el.dataset.para })); if (el.dataset.para === 'pronto') toast('Saída validada: ' + p.mesa_nome); render(); },
  kdsFull: () => { const on = document.body.classList.toggle('kds-full'); try { if (on) document.documentElement.requestFullscreen(); else if (document.fullscreenElement) document.exitFullscreen(); } catch (e) {} apito(); render(); },
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
document.addEventListener('change', (e) => { if (e.target.id === 'fotoF' && e.target.files[0]) { const im = e.target.closest('.foto-f').querySelector('img'); if (im) im.src = URL.createObjectURL(e.target.files[0]); }
  if (e.target.id === 'selLocal') { if (S.queue.length) { toast('Aguarde a sincronização antes de mudar de local', 'erro'); e.target.value = S.local; return; } S.local = e.target.value; S.x = {}; S.st = null; guardar(); render(); sync(); } });
window.addEventListener('hashchange', () => { if (!['cozinha', 'bar'].includes(rota().v)) document.body.classList.remove('kds-full'); fechar(); document.body.classList.remove('menu-on'); Object.keys(S.x).forEach((k) => { if (S.x[k] && typeof S.x[k] === 'object' && 'pronto' in S.x[k]) delete S.x[k]; }); render(); });
document.addEventListener('input', (e) => { if (e.target.id === 'buscaArt') { S.x.artB = e.target.value; const g = $('#artG'); if (g) g.innerHTML = artGrelha(); return; }
  if (e.target.id === 'busca') { S.x.busca = e.target.value; const p = P(rota().id); if (p) $('#arts').innerHTML = artsHtml(p); } });
/* Arrastar mesas na planta (modo de edição) */
let arr = null;
document.addEventListener('pointerdown', (e) => { const el = e.target.closest('.planta.editar .pm'); if (!el) return; e.preventDefault(); arr = { el, id: el.dataset.id, x0: e.clientX, y0: e.clientY, mexeu: false }; });
document.addEventListener('pointermove', (e) => { if (!arr) return; if (Math.abs(e.clientX - arr.x0) + Math.abs(e.clientY - arr.y0) > 5) arr.mexeu = true; if (!arr.mexeu) return;
  const r = $('#planta').getBoundingClientRect(); arr.x = Math.min(96, Math.max(4, ((e.clientX - r.left) / r.width) * 100)); arr.y = Math.min(94, Math.max(6, ((e.clientY - r.top) / r.height) * 100)); arr.el.style.left = arr.x + '%'; arr.el.style.top = arr.y + '%'; });
document.addEventListener('pointerup', () => { if (!arr) return; const i = mesasVis().filter((m) => m.zona === S.x.zona).findIndex((m) => m.id === arr.id), m = S.st.mesas.find((x) => x.id === arr.id), ps = Object.assign({}, posMesa(m, i));
  if (arr.mexeu) { ps.x = Math.round(arr.x * 10) / 10; ps.y = Math.round(arr.y * 10) / 10; (S.x.pos = S.x.pos || {})[arr.id] = ps; }
  else { const sel = (S.x.sel = S.x.sel || []), k = sel.indexOf(arr.id); if (k >= 0) sel.splice(k, 1); else sel.push(arr.id); }
  arr = null; render(); });
window.addEventListener('online', () => { sync(); });
window.addEventListener('offline', () => { S.online = false; pintarEstado(); });
setInterval(() => { if (!document.hidden) sync(); }, 6000);
setInterval(() => { if (S.token && S.st && ['cozinha', 'bar', 'mesas'].includes(rota().v) && !S.x.editar && !$('#modal').classList.contains('on')) render(); }, 30000);
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('/sw.js').catch(() => {});
Object.assign(VIEWS, { mesas: vMesas, pedido: vPedido, cozinha: () => vKds('cozinha'), bar: () => vKds('bar'), caixa: vCaixa, facturacao: vFact, relatorios: vRel, menu: vMenu, config: vCfg, servir: vServir, empregado: vEmp });
const ATALHOS = { F2: '[data-a=nova][data-t=balcao]', F3: '[data-a=obsUlt]', F5: '.pdv-f [data-a=enviar]', F6: '[data-a=receber]', F7: '.pdv-q [data-a=desconto]', F8: '.pdv-q [data-a=consulta]', F9: '.pdv-s [data-a=transferir]' };
document.addEventListener('keydown', (e) => { if (!S.token || rota().v !== 'pedido' || e.ctrlKey || e.altKey || e.metaKey) return; if (e.key === 'Escape' && $('#modal').classList.contains('on')) return fechar(); if ($('#modal').classList.contains('on')) return;
  if (e.key === 'F4') { e.preventDefault(); const b = $('#busca'); if (b) { b.focus(); b.select(); } return; }
  const el = ATALHOS[e.key] && $('.pdv ' + ATALHOS[e.key]); if (ATALHOS[e.key]) e.preventDefault(); if (el && !el.disabled) el.click(); });
function boot() { render(); sync(); }
