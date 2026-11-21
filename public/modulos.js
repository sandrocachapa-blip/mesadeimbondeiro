'use strict';
/* Mesa de Imbondeiro — fases 2 a 4: stock, compras, fornecedores, fichas, equipa, salários, finanças, clientes, reservas, painel, grupo. */
const mesAtual = () => hojeLuanda().slice(0, 7);
const num = (n, d) => new Intl.NumberFormat('pt-PT', { maximumFractionDigits: d == null ? 2 : d }).format(n || 0).replace(/\s/g, ' ');
const refrescar = (...ks) => { ks.forEach((k) => delete S.x[k]); render(); };
const nomeDe = (lst, id) => ((lst || []).find((x) => x.id === id) || {}).nome || '—';
const sn = (b) => (b ? 'Sim' : 'Não');
function baixarCsv(nome, linhas) {
  const q = (s) => (typeof s === 'number' ? String(s).replace('.', ',') : '"' + String(s == null ? '' : s).replace(/"/g, '""') + '"');
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + linhas.map((l) => l.map(q).join(';')).join('\r\n')], { type: 'text/csv;charset=utf-8' })); a.download = nome; a.click();
}

function tela(tit, loads, desenha, botoes) {
  const d = {}; let pend = false, erro = '';
  for (const k in loads) { const c = carregar(k, loads[k]); if (!c) pend = true; else if (c.erro) erro = c.erro; else d[k] = c.d; }
  const cab = `<div class="cab"><h1>${tit}</h1><span class="esp"></span>${!pend && !erro ? (typeof botoes === 'function' ? botoes(d) : botoes || '') : ''}</div>`;
  if (erro) return cab + espera({ erro }); if (pend) return cab + espera(null);
  return cab + desenha(d);
}
function abas(chave, lst) {
  const on = lst.some((t) => t[0] === S.x[chave]) ? S.x[chave] : (S.x[chave] = lst[0][0]);
  return `<div class="tabs">${lst.map((t) => `<button class="chip ${t[0] === on ? 'on' : ''}" data-a="aba" data-k="${chave}" data-id="${t[0]}">${t[1]}</button>`).join('')}</div>` + lst.find((t) => t[0] === on)[2]();
}
ACOES.aba = (el) => { S.x[el.dataset.k] = el.dataset.id; render(); };

/* Lista genérica com formulário */
const LISTAS = {};
function tabela(o, rows, b) {
  return `<div class="cartao" style="overflow:auto">${rows.length ? `<table><tr>${o.cols.map((c) => `<th>${c[0]}</th>`).join('')}</tr>${rows.map((r) => `<tr class="clic" data-a="regEdit" data-e="${o.e}" data-id="${r.id}">${o.cols.map((c) => `<td>${c[1](r, b)}</td>`).join('')}</tr>`).join('')}</table>` : '<p class="mudo">Ainda sem registos.</p>'}</div>`;
}
function lista(o, semCab) {
  LISTAS[o.e] = o;
  const loads = { base: () => api('base'), ['reg_' + o.e]: () => api('reg', { query: { e: o.e, local: S.local } }) };
  const corpo = (d) => { o._rows = d['reg_' + o.e]; o._b = d.base; return (o.antes ? o.antes(o._rows, d.base) : '') + tabela(o, o._rows, d.base); };
  const bt = `<button class="btn p" data-a="regEdit" data-e="${o.e}" data-id="">${o.novo || 'Novo registo'}</button>`;
  if (!semCab) return tela(o.tit, loads, corpo, bt);
  const d = {}; for (const k in loads) { const c = carregar(k, loads[k]); if (!c || c.erro) return espera(c); d[k] = c.d; }
  return `<div class="fila" style="margin-bottom:10px"><span class="esp"></span>${bt}</div>` + corpo(d);
}
ACOES.regEdit = (el) => {
  const o = LISTAS[el.dataset.e], r = (o._rows || []).find((x) => x.id === el.dataset.id) || {};
  const campos = o.campos(r, o._b).map((c) => (c.value === undefined ? Object.assign(c, { value: r[c.k] }) : c));
  form((r.id ? 'Editar' : 'Novo') + ' — ' + o.tit, campos, async (v) => {
    await api('reg', { method: 'POST', body: { entidade: o.e, linha: Object.assign({ id: r.id }, o.fixo ? o.fixo() : {}, v) } });
    toast('Guardado'); refrescar('reg_' + o.e, 'base');
  }, r.id && o.del ? `<div style="margin-top:14px"><button type="button" class="btn s perigo" data-a="regDel" data-e="${o.e}" data-id="${r.id}">Apagar este registo</button></div>` : '');
};
ACOES.regDel = async (el) => { if (!confirm('Apagar este registo?')) return; try { await api('reg', { method: 'POST', body: { entidade: el.dataset.e, apagar: el.dataset.id } }); fechar(); refrescar('reg_' + el.dataset.e); } catch (e) { toast(e.message, 'erro'); } };
const optF = (b, vazio) => (vazio ? [['', vazio]] : []).concat(b.funcionarios.map((f) => [f.id, f.nome]));
const cActivo = (r) => ({ k: 'activo', label: 'Activo', type: 'check', value: r.id ? r.activo : true });

/* ---------- Fase 4: reservas e clientes ---------- */
VIEWS.reservas = () => lista({ e: 'reservas', tit: 'Reservas', novo: 'Nova reserva', del: 1, fixo: () => ({ local_id: S.local }),
  antes: (rows) => { const h = rows.filter((r) => r.dia === hojeLuanda() && r.estado !== 'cancelada'); return `<div class="kpis"><div class="cartao kpi">Reservas para hoje<b>${h.length}</b></div><div class="cartao kpi">Pessoas esperadas hoje<b>${h.reduce((s, r) => s + (r.pessoas || 0), 0)}</b></div><div class="cartao kpi">Pedidos online por confirmar<b>${rows.filter((r) => r.estado === 'pendente' && r.dia >= hojeLuanda()).length}</b></div></div>`; },
  cols: [['Dia', (r) => esc(r.dia)], ['Hora', (r) => esc(r.hora)], ['Cliente', (r) => esc(r.cliente_nome) + (r.telefone ? '<br><small>' + esc(r.telefone) + '</small>' : '')], ['Pessoas', (r) => r.pessoas], ['Mesa', (r, b) => esc(nomeDe(b.mesas, r.mesa_id))], ['Estado', (r) => `<span class="est ${r.estado === 'cancelada' || r.estado === 'faltou' ? 'erro' : r.estado === 'sentada' || r.estado === 'confirmada' ? 'ok' : 'pendente'}">${r.estado === 'pendente' ? 'por confirmar' : esc(r.estado)}</span>`], ['Notas', (r) => esc(r.notas)]],
  campos: (r, b) => [{ k: 'cliente_nome', label: 'Nome do cliente', req: 1 }, { k: 'telefone', label: 'Telefone' }, { k: 'dia', label: 'Dia', type: 'date', value: r.dia || hojeLuanda(), req: 1 }, { k: 'hora', label: 'Hora', type: 'time', value: r.hora || '20:00' }, { k: 'pessoas', label: 'N.º de pessoas', type: 'number', value: r.pessoas || 2 },
    { k: 'mesa_id', label: 'Mesa', type: 'select', options: [['', 'A definir']].concat(b.mesas.filter((m) => m.local_id === S.local).map((m) => [m.id, m.nome])) }, { k: 'estado', label: 'Estado', type: 'select', options: [['pendente', 'Por confirmar (pedido online)'], ['confirmada', 'Confirmada'], ['sentada', 'Sentada'], ['cancelada', 'Cancelada'], ['faltou', 'Não compareceu']], value: r.estado || 'confirmada' }, { k: 'notas', label: 'Notas (aniversário, alergias, cadeira de bebé…)' }] });
VIEWS.clientes = () => lista({ e: 'clientes', tit: 'Clientes', novo: 'Novo cliente',
  cols: [['Nome', (r) => esc(r.nome)], ['NIF', (r) => esc(r.nif)], ['Telefone', (r) => esc(r.telefone)], ['E-mail', (r) => esc(r.email)], ['Notas', (r) => esc(r.notas)], ['Activo', (r) => sn(r.activo)]],
  campos: (r) => [{ k: 'nome', label: 'Nome', req: 1 }, { k: 'nif', label: 'NIF' }, { k: 'telefone', label: 'Telefone' }, { k: 'email', label: 'E-mail' }, { k: 'notas', label: 'Notas (preferências, empresa, condições)' }, cActivo(r)] });

/* ---------- Fase 2: fornecedores, stock, compras, fichas ---------- */
VIEWS.fornecedores = () => lista({ e: 'fornecedores', tit: 'Fornecedores', novo: 'Novo fornecedor',
  cols: [['Nome', (r) => esc(r.nome)], ['NIF', (r) => esc(r.nif)], ['Contacto', (r) => esc(r.contacto)], ['E-mail', (r) => esc(r.email)], ['Prazo de pagamento', (r) => r.prazo_dias + ' dias'], ['Activo', (r) => sn(r.activo)]],
  campos: (r) => [{ k: 'nome', label: 'Nome', req: 1 }, { k: 'nif', label: 'NIF' }, { k: 'contacto', label: 'Telefone ou pessoa de contacto' }, { k: 'email', label: 'E-mail' }, { k: 'prazo_dias', label: 'Prazo de pagamento (dias)', type: 'number', value: r.id ? r.prazo_dias : 30 }, cActivo(r)] });
const L_ING = { e: 'ingredientes', tit: 'Ingredientes', novo: 'Novo ingrediente',
  cols: [['Ingrediente', (r) => esc(r.nome)], ['Unidade', (r) => esc(r.unidade)], ['Custo médio', (r) => kz(r.custo_medio)], ['Stock mínimo', (r) => num(r.stock_min)], ['Activo', (r) => sn(r.activo)]],
  campos: (r) => [{ k: 'nome', label: 'Nome', req: 1 }, { k: 'unidade', label: 'Unidade', type: 'select', options: [['kg', 'kg'], ['g', 'g'], ['L', 'L'], ['ml', 'ml'], ['un', 'unidade'], ['cx', 'caixa'], ['gf', 'garrafa']], value: r.unidade || 'kg' }, { k: 'custo_medio', label: 'Custo por unidade (Kz) — actualiza-se sozinho a cada compra recebida', type: 'number' }, { k: 'stock_min', label: 'Stock mínimo (gera alerta e sugestão de compra)', type: 'number' }, cActivo(r)] };
const TIPOS_MOV = { entrada: 'Entrada', quebra: 'Quebra', consumo: 'Consumo interno', contagem: 'Contagem', transferencia: 'Transferência', venda: 'Venda' };
VIEWS.stock = () => `<div class="cab"><h1>Stock</h1></div>` + abas('abaStock', [['exist', 'Existências', () => {
  const c = carregar('stock', () => api('stock', { query: { local: S.local } })); if (!c || c.erro) return espera(c);
  const it = c.d.itens, baixo = it.filter((i) => i.min > 0 && i.qtd < i.min).length;
  return `<div class="kpis"><div class="cartao kpi">Valor do stock<b>${kz(it.reduce((s, i) => s + Math.max(0, i.qtd) * i.custo, 0))}</b></div><div class="cartao kpi">Ingredientes<b>${it.length}</b></div><div class="cartao kpi">Abaixo do mínimo<b>${baixo}</b></div></div>
    <div class="cartao" style="overflow:auto">${it.length ? `<table><tr><th>Ingrediente</th><th class="dir">Em stock</th><th class="dir">Mínimo</th><th class="dir">Valor</th><th></th><th></th></tr>${it.map((i) => `<tr><td>${esc(i.nome)}</td><td class="dir"><b>${num(i.qtd)}</b> ${esc(i.unidade)}</td><td class="dir">${i.min ? num(i.min) : '—'}</td><td class="dir">${kz(Math.max(0, i.qtd) * i.custo)}</td><td>${i.min > 0 && i.qtd < i.min ? '<span class="est erro">repor</span>' : ''}</td><td class="dir"><button class="btn s" data-a="stockMov" data-id="${i.id}">Movimento</button></td></tr>`).join('')}</table>` : '<p class="mudo">Crie os ingredientes no separador «Ingredientes» e dê entrada pelas Compras.</p>'}</div>`; }],
  ['ing', 'Ingredientes', () => lista(L_ING, true)],
  ['saidas', 'Saídas por venda', () => { const f = S.x.saiF || (S.x.saiF = { de: new Date(Date.now() + 3600e3 - 7 * 864e5).toISOString().slice(0, 10), ate: hojeLuanda(), ingrediente: '' });
    const c = carregar('saidas', () => api('stock-saidas', { query: Object.assign({ local: S.local }, f) })), k = carregar('stock', () => api('stock', { query: { local: S.local } }));
    const filtros = `<div class="fila" style="margin-bottom:12px"><input type="date" id="saiDe" value="${f.de}" style="width:auto"><span>a</span><input type="date" id="saiAte" value="${f.ate}" style="width:auto"><select id="saiIng" style="width:auto"><option value="">Todos os ingredientes e bebidas</option>${k && k.d ? k.d.itens.map((i) => `<option value="${i.id}" ${i.id === f.ingrediente ? 'selected' : ''}>${esc(i.nome)}</option>`).join('') : ''}</select><button class="btn p" data-a="saiVer">Ver</button><span class="esp"></span><button class="btn" data-a="saiCsv">Exportar CSV</button></div>`;
    if (!c || c.erro) return filtros + espera(c);
    const d = c.d, fact = (x) => (x.sync_ref ? `<b>${esc(x.sync_ref)}</b>` : x.doc_num ? `Conta n.º ${x.doc_num} <span class="est pendente">por facturar</span>` : x.conta === 'aberto' ? '<span class="est">conta ainda aberta</span>' : '—');
    return filtros + `<div class="aviso">O stock sai sozinho quando a cozinha ou o bar validam a saída do pedido. O que não passar por validação sai ao fechar a conta. Cada saída fica ligada à conta e, depois de emitida, à factura.</div>
      <div class="kpis"><div class="cartao kpi">Custo do que saiu<b>${kz(d.resumo.reduce((s2, r) => s2 + r.valor, 0))}</b></div><div class="cartao kpi">Ingredientes e bebidas com saídas<b>${d.resumo.length}</b></div><div class="cartao kpi">Movimentos no período<b>${d.linhas.length}${d.linhas.length >= 800 ? '+' : ''}</b></div></div>
      <div style="display:grid;gap:14px"><div class="cartao" style="overflow:auto"><h3>Total por ingrediente ou bebida</h3>${d.resumo.length ? `<table><tr><th>Item</th><th class="dir">Saiu</th><th class="dir">Custo</th><th class="dir">Contas</th></tr>${d.resumo.map((r) => `<tr><td>${esc(r.ingrediente)}</td><td class="dir">${num(r.qtd)} ${esc(r.unidade)}</td><td class="dir">${kz(r.valor)}</td><td class="dir">${r.contas}</td></tr>`).join('')}</table>` : '<p class="mudo">Sem saídas no período.</p>'}</div>
      <div class="cartao" style="overflow:auto"><h3>Histórico: o que saiu, quando e em que factura</h3>${d.linhas.length ? `<table><tr><th>Quando</th><th>Item</th><th class="dir">Saiu</th><th>Vendido como</th><th>Mesa</th><th>Factura</th></tr>${d.linhas.slice(0, 300).map((x) => `<tr><td style="white-space:nowrap">${dataHora(x.criado_em)}</td><td>${esc(x.ingrediente)}</td><td class="dir">${num(x.qtd)} ${esc(x.unidade)}</td><td>${esc(x.motivo)}</td><td>${esc(x.mesa_nome || '')}</td><td>${fact(x)}</td></tr>`).join('')}</table>${d.linhas.length > 300 ? `<p class="mudo">A mostrar as 300 saídas mais recentes de ${d.linhas.length}. O CSV traz todas.</p>` : ''}` : '<p class="mudo">Sem saídas no período.</p>'}</div></div>`; }],
  ['mov', 'Movimentos', () => { const c = carregar('stock', () => api('stock', { query: { local: S.local } })); if (!c || c.erro) return espera(c);
    return `<div class="cartao" style="overflow:auto">${c.d.movs.length ? `<table><tr><th>Quando</th><th>Tipo</th><th>Ingrediente</th><th class="dir">Quantidade</th><th>Motivo</th><th>Por</th></tr>${c.d.movs.map((m) => `<tr><td>${dataHora(m.criado_em)}</td><td>${TIPOS_MOV[m.tipo] || m.tipo}</td><td>${esc(m.nome)}</td><td class="dir">${m.qtd > 0 ? '+' : ''}${num(m.qtd)} ${esc(m.unidade)}</td><td>${esc(m.motivo)}</td><td>${esc(m.utilizador_nome)}</td></tr>`).join('')}</table>` : '<p class="mudo">Sem movimentos manuais. As saídas por venda estão no separador «Saídas por venda».</p>'}</div>`; }]]);
ACOES.saiVer = () => { S.x.saiF = { de: $('#saiDe').value, ate: $('#saiAte').value, ingrediente: $('#saiIng').value }; refrescar('saidas'); };
ACOES.saiCsv = () => { const d = S.x.saidas && S.x.saidas.d; if (!d || !d.linhas.length) return toast('Sem saídas para exportar');
  baixarCsv('saidas-de-stock-' + d.de + '-a-' + d.ate + '.csv', [['quando', 'item', 'quantidade', 'unidade', 'custo', 'vendido_como', 'mesa', 'conta_numero', 'factura', 'validado_por']].concat(d.linhas.map((x) => [new Date(x.criado_em).toISOString(), x.ingrediente, x.qtd, x.unidade, Math.round(x.valor), x.motivo, x.mesa_nome || '', x.doc_num || '', x.sync_ref || '', x.utilizador_nome]))); };
ACOES.stockMov = (el) => { const i = S.x.stock.d.itens.find((x) => x.id === el.dataset.id);
  form('Movimento — ' + i.nome, [{ k: 'tipo', label: 'Tipo', type: 'select', options: [['contagem', 'Contagem (indique a quantidade contada)'], ['quebra', 'Quebra ou desperdício'], ['consumo', 'Consumo interno ou oferta'], ['entrada', 'Entrada sem compra'], ['transferencia', 'Transferência para outro local']] }, { k: 'qtd', label: 'Quantidade (' + i.unidade + ') — em stock: ' + num(i.qtd), type: 'number', req: 1 }, { k: 'motivo', label: 'Motivo' },
    { k: 'destino', label: 'Local de destino (só para transferências)', type: 'select', options: [['', '—']].concat(S.st.locais.filter((l) => l.id !== S.local).map((l) => [l.id, l.nome])) }],
  async (v) => { await api('stock', { method: 'POST', body: Object.assign({ local: S.local, ingrediente_id: i.id }, v) }); toast('Movimento registado'); refrescar('stock'); }); };

/* Editor de linhas (encomendas e fichas técnicas) */
function mLinhas(o) { S.x.ml = o; if (!o.linhas.length) o.linhas.push({}); desenhaML(); }
function desenhaML() {
  const o = S.x.ml, ing = o.base.ingredientes;
  modal(`<h2>${esc(o.tit)}</h2>${o.topo || ''}${ing.length ? '' : '<div class="aviso">Ainda não há ingredientes. Crie-os em Stock → Ingredientes.</div>'}
    ${o.linhas.map((l, i) => `<div class="fila ml" style="margin-top:8px;flex-wrap:nowrap"><select data-ml="ingrediente_id" data-i="${i}" style="flex:3;min-width:0"><option value="">Ingrediente…</option>${ing.map((g) => `<option value="${g.id}" ${g.id === l.ingrediente_id ? 'selected' : ''}>${esc(g.nome)} (${esc(g.unidade)})</option>`).join('')}</select>
      <input data-ml="qtd" data-i="${i}" type="number" step="any" inputmode="decimal" placeholder="Qtd." value="${l.qtd == null ? '' : l.qtd}" style="flex:1;min-width:64px">${o.preco ? `<input data-ml="preco" data-i="${i}" type="number" step="any" inputmode="decimal" placeholder="Preço un." value="${l.preco == null ? '' : l.preco}" style="flex:1.3;min-width:80px">` : ''}<button class="btn s" data-a="mlRm" data-i="${i}">✕</button></div>`).join('')}
    <div class="fila" style="margin-top:10px"><button class="btn s" data-a="mlAdd">+ Juntar linha</button><span class="esp"></span><b id="mlTot"></b></div>
    <div class="fila" style="margin-top:18px"><span class="esp"></span><button class="btn" data-a="fechar">Cancelar</button><button class="btn p" data-a="mlOk">Guardar</button></div>`, 'larga');
  totML();
  const t = $('[data-mt]'); if (t) t.value = o[t.dataset.mt] || '';
}
function totML() { const o = S.x.ml, el = $('#mlTot'); if (!el) return; const ing = o.base.ingredientes;
  const t = o.linhas.reduce((s, l) => s + (Number(l.qtd) || 0) * (o.preco ? Number(l.preco) || 0 : ((ing.find((g) => g.id === l.ingrediente_id) || {}).custo || 0)), 0);
  el.textContent = (o.preco ? 'Total: ' : 'Custo do prato: ') + kz(t) + (o.venda ? ' · margem ' + (o.venda > 0 ? Math.round((1 - t / o.venda) * 100) : 0) + '%' : ''); }
document.addEventListener('change', (e) => { const k = e.target.dataset.ml; if (!k) return; const o = S.x.ml, l = o.linhas[e.target.dataset.i]; l[k] = e.target.value;
  if (k === 'ingrediente_id' && o.preco && !l.preco) { l.preco = (o.base.ingredientes.find((g) => g.id === l.ingrediente_id) || {}).custo || ''; desenhaML(); } else totML(); });
document.addEventListener('change', (e) => { const k = e.target.dataset.mt; if (k) S.x.ml[k] = e.target.value; });
ACOES.mlAdd = () => { S.x.ml.linhas.push({}); desenhaML(); };
ACOES.mlRm = (el) => { S.x.ml.linhas.splice(el.dataset.i, 1); if (!S.x.ml.linhas.length) S.x.ml.linhas.push({}); desenhaML(); };
ACOES.mlOk = async () => { try { await S.x.ml.ok(S.x.ml); fechar(); } catch (e) { toast(e.message, 'erro'); } };

const EST_C = { encomendada: ['pendente', 'encomendada'], recebida: ['ok', 'recebida'], anulada: ['erro', 'anulada'] };
VIEWS.compras = () => tela('Compras', { base: () => api('base'), compras: () => api('compras', { query: { local: S.local } }) }, (d) => {
  const cs = d.compras.compras, sg = d.compras.sugestao, divida = cs.filter((c) => c.estado === 'recebida').reduce((s, c) => s + c.total - c.pago, 0);
  return `${sg.length ? `<div class="aviso">${sg.length} ingrediente(s) abaixo do mínimo: ${sg.slice(0, 6).map((i) => esc(i.nome)).join(', ')}${sg.length > 6 ? '…' : ''}. <button class="btn s" data-a="encNova" data-s="1">Criar encomenda com a sugestão</button></div>` : ''}
    <div class="kpis"><div class="cartao kpi">Encomendas por receber<b>${cs.filter((c) => c.estado === 'encomendada').length}</b></div><div class="cartao kpi">Por pagar a fornecedores<b>${kz(divida)}</b></div></div>
    <div class="cartao" style="overflow:auto">${cs.length ? `<table><tr><th>Data</th><th>Fornecedor</th><th>Factura</th><th>Estado</th><th class="dir">Total</th><th class="dir">Por pagar</th><th>Vencimento</th></tr>${cs.map((c) => `<tr class="clic" data-a="compraVer" data-id="${c.id}"><td>${esc(c.dia)}</td><td>${esc(c.fornecedor || '—')}</td><td>${esc(c.num_factura)}</td><td><span class="est ${EST_C[c.estado][0]}">${EST_C[c.estado][1]}</span></td><td class="dir">${kz(c.total)}</td><td class="dir">${c.estado === 'recebida' ? kz(c.total - c.pago) : '—'}</td><td>${esc(c.vencimento)}</td></tr>`).join('')}</table>` : '<p class="mudo">Ainda sem compras.</p>'}</div>`;
}, '<button class="btn p" data-a="encNova">Nova encomenda</button>');
ACOES.encNova = (el) => { const b = S.x.base.d, sg = el.dataset.s ? S.x.compras.d.sugestao : [];
  mLinhas({ tit: 'Nova encomenda', base: b, preco: 1, fornecedor_id: '', linhas: sg.map((i) => ({ ingrediente_id: i.id, qtd: Math.max(1, Math.ceil(i.min * 2 - i.qtd)), preco: i.custo || '' })),
    topo: `<label>Fornecedor</label><select data-mt="fornecedor_id"><option value="">Sem fornecedor</option>${b.fornecedores.map((f) => `<option value="${f.id}">${esc(f.nome)}</option>`).join('')}</select>`,
    ok: async (o) => { await api('compras', { method: 'POST', body: { acao: 'criar', local: S.local, fornecedor_id: o.fornecedor_id, linhas: o.linhas } }); toast('Encomenda criada'); refrescar('compras'); } }); };
ACOES.compraVer = (el) => { const c = S.x.compras.d.compras.find((x) => x.id === el.dataset.id);
  modal(`<h2>Compra — ${esc(c.fornecedor || 'sem fornecedor')}</h2><p class="mudo">${esc(c.dia)} · <span class="est ${EST_C[c.estado][0]}">${EST_C[c.estado][1]}</span>${c.num_factura ? ' · factura ' + esc(c.num_factura) : ''}</p>
    <table>${c.linhas.map((l) => `<tr><td>${esc(l.nome)}</td><td class="dir">${num(l.qtd)} ${esc(l.unidade)}</td><td class="dir">${kz(l.preco)}</td><td class="dir">${kz(l.qtd * l.preco)}</td></tr>`).join('')}</table>
    <div class="tot-l g"><span>Total</span><span>${kz(c.total)}</span></div>${c.estado === 'recebida' ? `<div class="tot-l"><span>Pago</span><span>${kz(c.pago)}</span></div>` : ''}
    <div class="fila" style="margin-top:16px">${c.estado === 'encomendada' ? `<button class="btn perigo" data-a="compraAcao" data-ac="anular" data-id="${c.id}">Anular</button>` : ''}<span class="esp"></span><button class="btn" data-a="fechar">Fechar</button>
    ${c.estado === 'encomendada' ? `<button class="btn p" data-a="compraAcao" data-ac="receber" data-id="${c.id}">Receber mercadoria</button>` : ''}${c.estado === 'recebida' && c.total > c.pago && pode('aprovar') ? `<button class="btn p" data-a="compraAcao" data-ac="pagar" data-id="${c.id}">Registar pagamento</button>` : ''}</div>`, 'larga'); };
ACOES.compraAcao = (el) => { const c = S.x.compras.d.compras.find((x) => x.id === el.dataset.id), ac = el.dataset.ac, b = S.x.base.d;
  const faz = async (extra) => { await api('compras', { method: 'POST', body: Object.assign({ acao: ac, id: c.id }, extra) }); toast('Feito'); refrescar('compras', 'stock'); };
  if (ac === 'anular') { if (confirm('Anular esta encomenda?')) faz({}).then(fechar).catch((e) => toast(e.message, 'erro')); return; }
  if (ac === 'receber') return form('Receber mercadoria', [{ k: 'num_factura', label: 'N.º da factura do fornecedor' }, { k: 'dia', label: 'Data da factura', type: 'date', value: hojeLuanda() }], faz, '<p class="mudo">Ao confirmar, o stock entra e o custo médio de cada ingrediente é actualizado.</p>');
  form('Registar pagamento', [{ k: 'valor', label: 'Valor pago (Kz)', type: 'number', value: Math.round(c.total - c.pago), req: 1 }, { k: 'conta_id', label: 'Sai de', type: 'select', options: [['', 'Não registar em conta bancária']].concat(b.contas.map((x) => [x.id, x.nome])) }], faz); };

VIEWS.fichas = () => tela('Fichas técnicas e custos', { base: () => api('base'), custos: () => api('custos') }, (d) => {
  const a = d.custos.artigos, com = a.filter((x) => x.n);
  return `<div class="aviso">A ficha técnica diz que ingredientes e quantidades leva cada artigo. Com ela, cada venda baixa o stock sozinha e a margem fica à vista. Toque num artigo para editar a ficha.</div>
    <div class="kpis"><div class="cartao kpi">Artigos com ficha<b>${com.length} de ${a.length}</b></div><div class="cartao kpi">Custo médio sobre o preço<b>${com.length ? Math.round(com.reduce((s, x) => s + (x.preco ? x.custo / x.preco : 0), 0) / com.length * 100) : 0}%</b></div></div>
    <div class="cartao" style="overflow:auto"><table><tr><th>Artigo</th><th class="dir">Preço</th><th class="dir">Custo</th><th class="dir">Margem</th><th class="dir">Custo / preço</th><th></th></tr>${a.map((x) => { const pc = x.preco ? x.custo / x.preco * 100 : 0;
      return `<tr class="clic" data-a="fichaEdit" data-id="${x.id}"><td>${esc(x.nome)}</td><td class="dir">${kz(x.preco)}</td><td class="dir">${x.n ? kz(x.custo) : '—'}</td><td class="dir">${x.n ? kz(x.preco - x.custo) : '—'}</td><td class="dir">${x.n ? Math.round(pc) + '%' : ''}</td><td>${!x.n ? '<span class="est">sem ficha</span>' : pc > 40 ? '<span class="est erro">custo alto</span>' : '<span class="est ok">ok</span>'}</td></tr>`; }).join('')}</table></div>`; });
ACOES.fichaEdit = async (el) => { const a = S.x.custos.d.artigos.find((x) => x.id === el.dataset.id);
  try { const f = await api('fichas', { query: { artigo: a.id } });
    mLinhas({ tit: 'Ficha técnica — ' + a.nome, base: S.x.base.d, venda: a.preco, linhas: f.linhas, topo: '<p class="mudo">Quantidade de cada ingrediente para uma dose.</p>',
      ok: async (o) => { await api('fichas', { method: 'POST', body: { artigo_id: a.id, linhas: o.linhas } }); toast('Ficha guardada'); refrescar('custos'); } }); } catch (e) { toast(e.message, 'erro'); } };

/* ---------- Fase 3: equipa, ponto, salários, finanças ---------- */
const L_FUNC = { e: 'funcionarios', tit: 'Funcionários', novo: 'Novo funcionário',
  cols: [['Nome', (r) => esc(r.nome)], ['Função', (r) => esc(r.funcao)], ['Local', (r, b) => esc(r.local_id ? nomeDe(b.locais, r.local_id) : 'Todos')], ['Salário-base', (r) => kz(r.salario_base)], ['Subsídios', (r) => kz(r.subsidios)], ['Admissão', (r) => esc(r.data_admissao)], ['Activo', (r) => sn(r.activo)]],
  campos: (r, b) => [{ k: 'nome', label: 'Nome', req: 1 }, { k: 'funcao', label: 'Função' }, { k: 'local_id', label: 'Local', type: 'select', options: [['', 'Todos os locais']].concat(b.locais.map((l) => [l.id, l.nome])), value: r.id ? r.local_id || '' : S.local }, { k: 'salario_base', label: 'Salário-base mensal (Kz)', type: 'number' }, { k: 'subsidios', label: 'Subsídios mensais (Kz)', type: 'number' }, { k: 'data_admissao', label: 'Data de admissão', type: 'date' }, { k: 'contacto', label: 'Contacto' }, cActivo(r)] };
const L_ESC = { e: 'escalas', tit: 'Escalas', novo: 'Novo turno', del: 1, fixo: () => ({ local_id: S.local }),
  cols: [['Dia', (r) => esc(r.dia)], ['Funcionário', (r, b) => esc(nomeDe(b.funcionarios, r.funcionario_id))], ['Entrada', (r) => esc(r.inicio)], ['Saída', (r) => esc(r.fim)]],
  campos: (r, b) => [{ k: 'funcionario_id', label: 'Funcionário', type: 'select', options: optF(b) }, { k: 'dia', label: 'Dia', type: 'date', value: r.dia || hojeLuanda(), req: 1 }, { k: 'inicio', label: 'Entrada', type: 'time', value: r.inicio || '10:00' }, { k: 'fim', label: 'Saída', type: 'time', value: r.fim || '18:00' }] };
const TIPO_AUS = { falta: 'Falta', ferias: 'Férias', baixa: 'Baixa médica', folga: 'Folga' };
const L_AUS = { e: 'ausencias', tit: 'Férias e faltas', novo: 'Novo registo', del: 1,
  cols: [['Funcionário', (r, b) => esc(nomeDe(b.funcionarios, r.funcionario_id))], ['Tipo', (r) => TIPO_AUS[r.tipo] || esc(r.tipo)], ['De', (r) => esc(r.de)], ['Até', (r) => esc(r.ate)], ['Observações', (r) => esc(r.obs)]],
  campos: (r, b) => [{ k: 'funcionario_id', label: 'Funcionário', type: 'select', options: optF(b) }, { k: 'tipo', label: 'Tipo (só as faltas descontam no salário)', type: 'select', options: Object.entries(TIPO_AUS), value: r.tipo || 'falta' }, { k: 'de', label: 'De', type: 'date', value: r.de || hojeLuanda(), req: 1 }, { k: 'ate', label: 'Até', type: 'date', value: r.ate || r.de || hojeLuanda(), req: 1 }, { k: 'obs', label: 'Observações' }] };
function vPonto() {
  const c = carregar('ponto', () => api('ponto', { query: { local: S.local } })), b = carregar('base', () => api('base'));
  if (!c || c.erro) return espera(c); if (!b || b.erro) return espera(b);
  const fs = b.d.funcionarios.filter((f) => !f.local_id || f.local_id === S.local), ab = c.d.abertos;
  return `<div class="grelha" style="margin-bottom:14px">${fs.map((f) => { const d = ab.includes(f.id); return `<button class="mesa ${d ? 'oc' : ''}" data-a="picar" data-id="${f.id}" data-ac="${d ? 'saida' : 'entrada'}"><b>${esc(f.nome)}</b><span class="mudo">${d ? 'ao serviço' : 'fora'}</span><span class="tot">${d ? 'Marcar saída' : 'Marcar entrada'}</span></button>`; }).join('') || '<p class="mudo">Sem funcionários neste local. A gerência cria-os em Equipa → Funcionários.</p>'}</div>
    <div class="cartao" style="overflow:auto"><h3>Registos de hoje</h3>${c.d.rows.length ? `<table><tr><th>Funcionário</th><th>Entrada</th><th>Saída</th><th class="dir">Horas</th></tr>${c.d.rows.map((r) => `<tr><td>${esc(r.nome)}</td><td>${hora(r.entrada)}</td><td>${r.saida ? hora(r.saida) : '<span class="est pendente">ao serviço</span>'}</td><td class="dir">${num(r.horas)}</td></tr>`).join('')}</table>` : '<p class="mudo">Sem registos hoje.</p>'}</div>`;
}
ACOES.picar = async (el) => { try { await api('ponto', { method: 'POST', body: { funcionario_id: el.dataset.id, acao: el.dataset.ac, local: S.local } }); toast(el.dataset.ac === 'entrada' ? 'Entrada registada' : 'Saída registada'); refrescar('ponto'); } catch (e) { toast(e.message, 'erro'); } };
VIEWS.equipa = () => `<div class="cab"><h1>${pode('aprovar') ? 'Equipa e ponto' : 'Ponto'}</h1></div>` + (pode('aprovar') ? abas('abaEq', [['ponto', 'Ponto', vPonto], ['func', 'Funcionários', () => lista(L_FUNC, true)], ['esc', 'Escalas', () => lista(L_ESC, true)], ['aus', 'Férias e faltas', () => lista(L_AUS, true)]]) : vPonto());

VIEWS.salarios = () => { const mes = S.x.salMes || (S.x.salMes = mesAtual());
  return tela('Salários', { base: () => api('base'), sal: () => api('salarios', { query: { mes } }) }, (d) => { const ls = d.sal.linhas, pagos = ls.length && ls.every((l) => l.estado === 'pago');
    return `<div class="aviso">A Segurança Social é calculada pela taxa definida em Configuração → Empresa (${S.st.empresa.inss_taxa}%). O IRT não é calculado aqui: introduza-o em cada recibo ou deixe o software oficial (Primavera) apurá-lo depois de exportar. Confirme sempre os valores com o contabilista.</div>
      <div class="kpis"><div class="cartao kpi">Total ilíquido<b>${kz(ls.reduce((s, l) => s + l.base + l.subsidios + l.extras - l.faltas, 0))}</b></div><div class="cartao kpi">Total líquido a pagar<b>${kz(ls.reduce((s, l) => s + l.liquido, 0))}</b></div><div class="cartao kpi">Estado<b>${!ls.length ? 'por processar' : pagos ? 'pago' : 'processado'}</b></div></div>
      <div class="cartao" style="overflow:auto">${ls.length ? `<table><tr><th>Funcionário</th><th class="dir">Base</th><th class="dir">Subsídios</th><th class="dir">Extras</th><th class="dir">Faltas</th><th class="dir">Seg. Social</th><th class="dir">IRT</th><th class="dir">Outros desc.</th><th class="dir">Líquido</th><th>Software oficial</th></tr>${ls.map((l) => `<tr class="clic" data-a="salEdit" data-id="${l.id}"><td>${esc(l.nome)}</td><td class="dir">${kz(l.base)}</td><td class="dir">${kz(l.subsidios)}</td><td class="dir">${kz(l.extras)}</td><td class="dir">− ${kz(l.faltas)}</td><td class="dir">− ${kz(l.inss)}</td><td class="dir">− ${kz(l.irt)}</td><td class="dir">− ${kz(l.descontos)}</td><td class="dir"><b>${kz(l.liquido)}</b></td><td><span class="est ${l.sync_estado === 'enviado' ? 'ok' : 'pendente'}">${l.sync_estado === 'enviado' ? 'enviado' : 'por enviar'}</span></td></tr>`).join('')}</table>` : '<p class="mudo">Ainda não processou este mês. Toque em «Processar mês».</p>'}</div>`; },
  (d) => `<input type="month" id="salMes" value="${mes}" style="width:auto"><button class="btn p" data-a="salAcao" data-ac="processar">Processar mês</button>${d.sal.linhas.length ? '<button class="btn" data-a="salCsv">Exportar para o software oficial (CSV)</button><button class="btn" data-a="salAcao" data-ac="sync">Marcar como enviado</button><button class="btn" data-a="salPagar">Registar pagamento</button>' : ''}`); };
document.addEventListener('change', (e) => { if (e.target.id === 'salMes') { S.x.salMes = e.target.value; refrescar('sal'); } if (e.target.id === 'dafMes') { S.x.dafMes = e.target.value; refrescar('daf'); } });
ACOES.salAcao = async (el) => { try { await api('salarios', { method: 'POST', body: { acao: el.dataset.ac, mes: S.x.salMes } }); toast('Feito'); refrescar('sal'); } catch (e) { toast(e.message, 'erro'); } };
ACOES.salEdit = (el) => { const l = S.x.sal.d.linhas.find((x) => x.id === el.dataset.id); if (l.estado === 'pago') return toast('Salário já pago');
  form('Recibo — ' + l.nome, [{ k: 'extras', label: 'Horas extra e prémios (Kz)', type: 'number', value: l.extras }, { k: 'irt', label: 'IRT (Kz)', type: 'number', value: l.irt }, { k: 'descontos', label: 'Outros descontos — adiantamentos, etc. (Kz)', type: 'number', value: l.descontos }], async (v) => { await api('salarios', { method: 'POST', body: Object.assign({ acao: 'editar', id: l.id }, v) }); refrescar('sal'); }); };
ACOES.salPagar = () => form('Registar pagamento de salários — ' + S.x.salMes, [{ k: 'conta_id', label: 'Sai de', type: 'select', options: [['', 'Não registar em conta bancária']].concat(S.x.base.d.contas.map((x) => [x.id, x.nome])) }], async (v) => { await api('salarios', { method: 'POST', body: { acao: 'pagar', mes: S.x.salMes, conta_id: v.conta_id } }); toast('Salários pagos'); refrescar('sal'); });
ACOES.salCsv = () => baixarCsv('salarios-' + S.x.salMes + '.csv', [['mes', 'funcionario', 'base', 'subsidios', 'extras', 'faltas', 'seguranca_social', 'irt', 'outros_descontos', 'liquido']].concat(S.x.sal.d.linhas.map((l) => [l.mes, l.nome, l.base, l.subsidios, l.extras, l.faltas, l.inss, l.irt, l.descontos, l.liquido])));

const CATS = ['Renda', 'Energia e água', 'Gás', 'Internet e telefone', 'Manutenção', 'Limpeza', 'Marketing', 'Impostos e taxas', 'Transportes', 'Outras'];
const L_DESP = { e: 'despesas', tit: 'Despesas', novo: 'Nova despesa', del: 1, fixo: () => ({ local_id: S.local }),
  cols: [['Dia', (r) => esc(r.dia)], ['Categoria', (r) => esc(r.categoria)], ['Descrição', (r) => esc(r.descricao)], ['Fornecedor', (r, b) => esc(r.fornecedor_id ? nomeDe(b.fornecedores, r.fornecedor_id) : '')], ['Valor', (r) => kz(r.valor)], ['Paga', (r) => (r.pago ? '<span class="est ok">paga</span>' : '<span class="est erro">por pagar</span>')]],
  campos: (r, b) => [{ k: 'categoria', label: 'Categoria', type: 'select', options: CATS.map((c) => [c, c]), value: r.categoria || 'Outras' }, { k: 'descricao', label: 'Descrição' }, { k: 'valor', label: 'Valor (Kz)', type: 'number', req: 1 }, { k: 'dia', label: 'Data', type: 'date', value: r.dia || hojeLuanda(), req: 1 }, { k: 'fornecedor_id', label: 'Fornecedor', type: 'select', options: [['', '—']].concat(b.fornecedores.map((f) => [f.id, f.nome])) }, { k: 'pago', label: 'Já está paga', type: 'check', value: r.id ? r.pago : true }, { k: 'meio', label: 'Meio de pagamento' }] };
const L_BANC = { e: 'contas_banc', tit: 'Contas bancárias e caixas', novo: 'Nova conta',
  cols: [['Conta', (r) => esc(r.nome)], ['Saldo inicial', (r) => kz(r.saldo_inicial)], ['Activa', (r) => sn(r.activo)]],
  campos: (r) => [{ k: 'nome', label: 'Nome (ex.: BAI conta à ordem, Cofre)', req: 1 }, { k: 'saldo_inicial', label: 'Saldo inicial (Kz)', type: 'number' }, cActivo(r)] };
const dafDados = () => carregar('daf', () => api('daf', { query: { local: S.local, mes: S.x.dafMes || (S.x.dafMes = mesAtual()) } }));
VIEWS.daf = () => `<div class="cab"><h1>Finanças (DAF)</h1><span class="esp"></span><input type="month" id="dafMes" value="${S.x.dafMes || mesAtual()}" style="width:auto"></div>` + abas('abaDaf', [
  ['res', 'Resultado do mês', () => { const c = dafDados(); if (!c || c.erro) return espera(c); const d = c.d, pc = (v) => (d.vendas ? Math.round(v / d.vendas * 100) + '%' : '—');
    const l = (n, v, cls) => `<tr class="${cls || ''}"><td>${n}</td><td class="dir">${kz(v)}</td><td class="dir">${pc(v)}</td></tr>`;
    return `<div class="kpis"><div class="cartao kpi">Vendas<b>${kz(d.vendas)}</b></div><div class="cartao kpi">Custo da mercadoria<b>${pc(d.cmv)}</b></div><div class="cartao kpi">Pessoal<b>${pc(d.pessoal)}</b></div><div class="cartao kpi">Resultado<b>${kz(d.resultado)}</b></div></div>
      <div class="duas"><div class="cartao"><h3>${esc(S.st.local.nome)} — ${esc(d.mes)}</h3><table><tr><th></th><th class="dir">Valor</th><th class="dir">% das vendas</th></tr>${l('Vendas (' + d.contas + ' contas)', d.vendas)}${l('− Custo da mercadoria vendida', d.cmv)}${l('− Quebras e perdas de stock', d.perdas)}${l('− Pessoal (salários processados)', d.pessoal)}${l('− Outras despesas', d.despesas)}<tr><td><b>= Resultado</b></td><td class="dir"><b>${kz(d.resultado)}</b></td><td class="dir"><b>${pc(d.resultado)}</b></td></tr></table>
        <p class="mudo">O custo da mercadoria só conta os artigos com ficha técnica. O pessoal só aparece depois de processar os salários do mês.</p><button class="btn s" data-a="dafCsv">Exportar para a contabilidade (CSV)</button></div>
      <div class="cartao"><h3>Despesas por categoria</h3>${d.porCategoria.length ? `<table>${d.porCategoria.map((x) => `<tr><td>${esc(x.categoria)}</td><td class="dir">${kz(x.valor)}</td></tr>`).join('')}</table>` : '<p class="mudo">Sem despesas no mês.</p>'}</div></div>`; }],
  ['pagar', 'Contas a pagar', () => { const c = dafDados(); if (!c || c.erro) return espera(c); const d = c.d, tot = d.pagarCompras.reduce((s, x) => s + x.falta, 0) + d.pagarDespesas.reduce((s, x) => s + x.valor, 0);
    return `<div class="kpis"><div class="cartao kpi">Total por pagar<b>${kz(tot)}</b></div><div class="cartao kpi">Facturas vencidas<b>${d.pagarCompras.filter((x) => x.vencimento && x.vencimento < d.hoje).length}</b></div></div>
      <div class="duas"><div class="cartao"><h3>Fornecedores</h3>${d.pagarCompras.length ? `<table><tr><th>Fornecedor</th><th>Factura</th><th>Vence</th><th class="dir">Em dívida</th></tr>${d.pagarCompras.map((x) => `<tr><td>${esc(x.fornecedor || '—')}</td><td>${esc(x.num_factura)}</td><td>${esc(x.vencimento)} ${x.vencimento && x.vencimento < d.hoje ? '<span class="est erro">vencida</span>' : ''}</td><td class="dir">${kz(x.falta)}</td></tr>`).join('')}</table><p class="mudo">Os pagamentos registam-se em Compras, abrindo a compra.</p>` : '<p class="mudo">Nada em dívida a fornecedores.</p>'}</div>
      <div class="cartao"><h3>Despesas por pagar</h3>${d.pagarDespesas.length ? `<table>${d.pagarDespesas.map((x) => `<tr><td>${esc(x.dia)}</td><td>${esc(x.categoria)} — ${esc(x.descricao)}</td><td class="dir">${kz(x.valor)}</td></tr>`).join('')}</table>` : '<p class="mudo">Sem despesas por pagar.</p>'}</div></div>`; }],
  ['tes', 'Tesouraria', () => { const c = dafDados(); if (!c || c.erro) return espera(c); const d = c.d;
    return `<div class="fila" style="margin-bottom:10px"><span class="esp"></span><button class="btn p" data-a="tesNovo">Novo movimento</button></div><div class="kpis">${d.bancos.map((x) => `<div class="cartao kpi">${esc(x.nome)}<b>${kz(x.saldo)}</b></div>`).join('') || '<div class="cartao">Crie as contas no separador «Contas bancárias».</div>'}</div>
      <div class="cartao" style="overflow:auto"><h3>Últimos movimentos</h3>${d.movs.length ? `<table>${d.movs.map((m) => `<tr><td>${esc(m.dia)}</td><td>${esc(m.conta)}</td><td>${esc(m.descricao)}</td><td class="dir">${m.valor > 0 ? '+ ' : '− '}${kz(Math.abs(m.valor))}</td></tr>`).join('')}</table>` : '<p class="mudo">Sem movimentos.</p>'}</div>`; }],
  ['desp', 'Despesas', () => lista(L_DESP, true)], ['banc', 'Contas bancárias', () => lista(L_BANC, true)]]);
ACOES.tesNovo = () => { const bs = S.x.daf.d.bancos; if (!bs.length) return toast('Crie primeiro uma conta bancária', 'erro');
  form('Novo movimento de tesouraria', [{ k: 'conta_id', label: 'Conta', type: 'select', options: bs.map((x) => [x.id, x.nome]) }, { k: 'tipo', label: 'Tipo', type: 'select', options: [['1', 'Entrada (depósito de vendas, TPA, etc.)'], ['-1', 'Saída']] }, { k: 'valor', label: 'Valor (Kz)', type: 'number', req: 1 }, { k: 'descricao', label: 'Descrição' }, { k: 'dia', label: 'Data', type: 'date', value: hojeLuanda() }],
    async (v) => { await api('tes', { method: 'POST', body: { conta_id: v.conta_id, valor: Math.abs(Number(v.valor) || 0) * Number(v.tipo), descricao: v.descricao, dia: v.dia } }); refrescar('daf'); }); };
ACOES.dafCsv = () => { const d = S.x.daf.d; baixarCsv('resultado-' + d.mes + '.csv', [['mes', 'local', 'rubrica', 'valor'], [d.mes, S.st.local.nome, 'Vendas', d.vendas], [d.mes, S.st.local.nome, 'Custo da mercadoria vendida', d.cmv], [d.mes, S.st.local.nome, 'Quebras e perdas', d.perdas], [d.mes, S.st.local.nome, 'Pessoal', d.pessoal]].concat(d.porCategoria.map((x) => [d.mes, S.st.local.nome, 'Despesa: ' + x.categoria, x.valor]), [[d.mes, S.st.local.nome, 'Resultado', d.resultado]])); };

/* ---------- Fase 4: painel de alertas e consolidado do grupo ---------- */
VIEWS.painel = () => tela('Painel e alertas', { al: () => api('alertas', { query: { local: S.local } }) }, (d) => { const a = d.al, k = (a.fecho && a.fecho.contado) || {}, dif = (k.numerario || 0) - ((k.esperado || {}).numerario || 0);
  const cx = (tit, n, corpo, cls) => `<div class="cartao alerta ${n ? cls || 'mau' : 'bom'}"><h3>${tit}</h3>${n ? corpo : '<p class="mudo">Tudo em ordem.</p>'}</div>`;
  return `<div class="kpis"><div class="cartao kpi">Vendas de hoje<b>${kz(a.hoje.vendas)}</b></div><div class="cartao kpi">Contas fechadas hoje<b>${a.hoje.contas}</b></div><div class="cartao kpi">Contas abertas agora<b>${a.abertas.n} · ${kz(a.abertas.valor)}</b></div><div class="cartao kpi">Descontos de hoje<b>${kz(a.hoje.descontos)}</b></div></div>
    <div class="fases">
    ${cx('Pedidos de clientes por confirmar', a.qr, `<p><b>${a.qr}</b> linha(s) pedidas por QR à espera do empregado. <a href="#mesas">Ver mesas</a></p>`, 'aviso2')}
    ${cx('Stock abaixo do mínimo', a.stock.length, `<table>${a.stock.map((s) => `<tr><td>${esc(s.nome)}</td><td class="dir">${num(s.qtd)} / ${num(s.min)} ${esc(s.unidade)}</td></tr>`).join('')}</table><a href="#compras">Encomendar</a>`)}
    ${cx('Linhas anuladas hoje', a.anulacoes.n, `<p><b>${a.anulacoes.n}</b> linha(s), no valor de <b>${kz(a.anulacoes.valor)}</b>.</p>`, 'aviso2')}
    ${cx('Facturas de fornecedores vencidas', a.vencidas.length, `<table>${a.vencidas.map((v) => `<tr><td>${esc(v.fornecedor || '—')}</td><td>${esc(v.vencimento)}</td><td class="dir">${kz(v.falta)}</td></tr>`).join('')}</table>`)}
    ${cx('Pratos com custo acima de 40% do preço', a.margem.length, `<table>${a.margem.map((m) => `<tr><td>${esc(m.nome)}</td><td class="dir">${Math.round(m.custo / m.preco * 100)}%</td></tr>`).join('')}</table><a href="#fichas">Rever fichas</a>`, 'aviso2')}
    ${cx('Último fecho de caixa', a.fecho && Math.abs(dif) >= 1, a.fecho ? `<p>Diferença em numerário de <b>${kz(dif)}</b>, fechada por ${esc(a.fecho.utilizador_nome)} em ${dataHora(a.fecho.fechado_em)}.</p>` : '')}
    <div class="cartao alerta"><h3>Reservas de hoje</h3>${a.reservas.length ? `<table>${a.reservas.map((r) => `<tr><td>${esc(r.hora)}</td><td>${esc(r.cliente_nome)}</td><td class="dir">${r.pessoas} pessoas</td></tr>`).join('')}</table>` : '<p class="mudo">Sem reservas para hoje.</p>'}</div></div>`; });
VIEWS.grupo = () => { const f = S.x.grpF || (S.x.grpF = { de: hojeLuanda().slice(0, 8) + '01', ate: hojeLuanda() });
  return tela('Grupo — todos os locais', { grp: () => api('consolidado', { query: f }) }, (d) => { const ls = d.grp.locais, tv = ls.reduce((s, l) => s + l.vendas, 0), tc = ls.reduce((s, l) => s + l.contas, 0), mx = Math.max(1, ...ls.map((l) => l.vendas));
    return `<div class="kpis"><div class="cartao kpi">Vendas do grupo<b>${kz(tv)}</b></div><div class="cartao kpi">Contas<b>${tc}</b></div><div class="cartao kpi">Valor médio por conta<b>${kz(tc ? tv / tc : 0)}</b></div><div class="cartao kpi">Locais activos<b>${ls.length}</b></div></div>
      <div class="cartao" style="overflow:auto"><table><tr><th>Local</th><th>Tipo</th><th class="dir">Vendas</th><th style="width:22%"></th><th class="dir">Contas</th><th class="dir">Média</th><th class="dir">Custo mercadoria</th><th class="dir">Abertas agora</th></tr>${ls.map((l) => `<tr><td><b>${esc(l.nome)}</b></td><td>${esc(l.tipo)}</td><td class="dir">${kz(l.vendas)}</td><td><div class="barra-h"><i style="width:${Math.round(l.vendas / mx * 100)}%"></i></div></td><td class="dir">${l.contas}</td><td class="dir">${kz(l.contas ? l.vendas / l.contas : 0)}</td><td class="dir">${l.vendas ? Math.round(l.cmv / l.vendas * 100) + '%' : '—'}</td><td class="dir">${l.abertas}</td></tr>`).join('')}</table></div>`; },
  `<input type="date" id="grpDe" value="${f.de}" style="width:auto"><span>a</span><input type="date" id="grpAte" value="${f.ate}" style="width:auto"><button class="btn p" data-a="grpVer">Ver</button>`); };
ACOES.grpVer = () => { S.x.grpF = { de: $('#grpDe').value, ate: $('#grpAte').value }; refrescar('grp'); };

/* ---------- Administração ao vivo: o que cada local está a fazer e os custos do mês ---------- */
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
function vAdmin() {
  const c = carregar('adm', () => api('admin'));
  if (!c || c.erro) return '<div class="cab"><h1>Administração ao vivo</h1></div>' + espera(c);
  const d = c.d, ls = d.locais, soma = (f) => ls.reduce((s, l) => s + f(l), 0);
  const vh = soma((l) => l.hoje.vendas), vsp = soma((l) => l.hoje.semana_passada), vm = soma((l) => l.mes.vendas);
  const cmv = soma((l) => l.mes.cmv), perdas = soma((l) => l.mes.perdas), pes = soma((l) => l.mes.pessoal) + d.geral.pessoal, desp = soma((l) => l.mes.despesas) + d.geral.despesas, custos = cmv + perdas + pes + desp, res = vm - custos;
  const varia = vsp ? Math.round((vh / vsp - 1) * 100) : null;
  const seg = (n, v, cls) => (v > 0 && vm > 0 ? `<i class="${cls}" style="width:${Math.max(1.5, (v / Math.max(vm, custos)) * 100)}%" title="${n}: ${kz(v)}"></i>` : '');
  const leg = (n, v, cls) => `<span><i class="${cls}"></i>${n} <b>${kz(v)}</b> · ${pct(v, vm)}%</span>`;
  const cartao = (l) => { const a = l.agora, mx = Math.max(1, ...l.horas.map((x) => x.v)), custoM = l.mes.cmv + l.mes.perdas + l.mes.pessoal + l.mes.despesas;
    const est = a.vermelhas ? 'vermelho' : a.amarelas ? 'amarelo' : a.contas ? 'verde' : '';
    const sec = (n, x) => `<div class="adm-s ${x.espera >= 30 ? 'vermelho' : x.espera >= 10 ? 'amarelo' : ''}"><small>${n}</small><b>${x.linhas ? x.linhas + ' em preparação' : 'sem pedidos'}</b>${x.linhas ? `<span>espera máx. ${x.espera} min</span>` : ''}</div>`;
    return `<div class="cartao adm-l ${est}"><div class="fila"><h2>${esc(l.nome)}</h2><span class="esp"></span><span class="est ${l.caixa ? 'ok' : ''}">${l.caixa ? 'caixa aberta' : 'caixa fechada'}</span></div>
      <div class="adm-big"><b>${kz(l.hoje.vendas)}</b><span>hoje · ${l.hoje.contas} contas · média ${kz(l.hoje.contas ? l.hoje.vendas / l.hoje.contas : 0)}</span></div>
      <div class="barras adm-h">${l.horas.length ? l.horas.map((x) => `<div style="height:${Math.round((x.v / mx) * 100)}%" title="${x.hora}h: ${kz(x.v)}"><span>${x.hora}h</span></div>`).join('') : '<p class="mudo" style="align-self:center">Ainda sem vendas hoje.</p>'}</div>
      <div class="adm-g"><div class="adm-s"><small>Mesas</small><b>${a.mesas_ocupadas} de ${a.mesas} ocupadas</b><div class="barra-h"><i style="width:${pct(a.mesas_ocupadas, a.mesas)}%"></i></div></div>
        <div class="adm-s"><small>Contas abertas</small><b>${a.contas} · ${kz(a.valor)}</b>${a.amarelas || a.vermelhas ? `<span>${a.vermelhas ? a.vermelhas + ' mesa(s) a vermelho' : ''}${a.vermelhas && a.amarelas ? ' · ' : ''}${a.amarelas ? a.amarelas + ' a amarelo' : ''}</span>` : ''}</div>
        ${sec('Cozinha', a.cozinha)}${sec('Bar', a.bar)}
        <div class="adm-s"><small>Equipa ao serviço</small><b>${a.ao_servico} pessoa(s)</b></div>
        <div class="adm-s"><small>Hoje</small><b>mercadoria ${pct(l.hoje.cmv, l.hoje.vendas)}%</b><span>descontos ${kz(l.hoje.descontos)} · ${l.hoje.anulacoes} anulação(ões)</span></div></div>
      <div class="adm-p"><span>${l.pendentes.reservas} reserva(s) hoje · ${l.pendentes.reservas_pessoas} pessoas</span><span class="${l.pendentes.stock_baixo ? 'al' : ''}">${l.pendentes.stock_baixo} ingrediente(s) abaixo do mínimo</span><span class="${l.pendentes.facturas ? 'al' : ''}">${l.pendentes.facturas} conta(s) por facturar</span></div>
      <table class="adm-m"><tr><th>Mês</th><th class="dir">Vendas</th><th class="dir">Custos</th><th class="dir">Resultado</th></tr><tr><td>${esc(d.mes)}</td><td class="dir">${kz(l.mes.vendas)}</td><td class="dir">${kz(custoM)}</td><td class="dir"><b>${kz(l.mes.resultado)}</b> · ${pct(l.mes.resultado, l.mes.vendas)}%</td></tr></table></div>`; };
  const ICO = { conta: 'ok', anulacao: 'erro', caixa: 'pendente' };
  return `<div class="cab"><h1>Administração ao vivo</h1><span class="vivo"><i></i>actualizado às ${new Date(d.agora).toLocaleTimeString('pt-PT')} · renova a cada 15 segundos</span></div>
    <div class="kpis"><div class="cartao kpi">Vendas de hoje (grupo)<b>${kz(vh)}</b>${varia == null ? '' : `<small class="${varia >= 0 ? 'sobe' : 'desce'}">${varia >= 0 ? '▲ +' : '▼ '}${varia}% face à mesma hora da semana passada</small>`}</div>
      <div class="cartao kpi">Contas abertas agora<b>${soma((l) => l.agora.contas)} · ${kz(soma((l) => l.agora.valor))}</b><small>${soma((l) => l.agora.mesas_ocupadas)} de ${soma((l) => l.agora.mesas)} mesas ocupadas</small></div>
      <div class="cartao kpi">Vendas do mês<b>${kz(vm)}</b><small>${soma((l) => l.mes.contas)} contas</small></div>
      <div class="cartao kpi">Custos do mês<b>${kz(custos)}</b><small>${pct(custos, vm)}% das vendas</small></div>
      <div class="cartao kpi">Resultado do mês<b class="${res < 0 ? 'neg' : ''}">${kz(res)}</b><small>margem ${pct(res, vm)}%</small></div></div>
    <div class="cartao" style="margin-bottom:14px"><h3>Para onde vai cada kwanza vendido este mês</h3><div class="pilha">${seg('Mercadoria', cmv, 'c1')}${seg('Quebras e perdas', perdas, 'c2')}${seg('Pessoal', pes, 'c3')}${seg('Outras despesas', desp, 'c4')}${seg('Resultado', Math.max(0, res), 'c5')}</div>
      <div class="pilha-l">${leg('Mercadoria', cmv, 'c1')}${leg('Quebras e perdas', perdas, 'c2')}${leg('Pessoal', pes, 'c3')}${leg('Outras despesas', desp, 'c4')}${leg('Resultado', res, 'c5')}</div>
      <p class="mudo" style="margin:8px 0 0">A mercadoria conta os artigos com ficha técnica; o pessoal conta os salários já processados no mês.</p></div>
    ${atencao(d)}
    <div class="adm-ls">${ls.map(cartao).join('')}</div>
    <div class="duas" style="margin-top:14px"><div class="cartao"><h3>A acontecer agora</h3>${d.eventos.length ? `<table>${d.eventos.map((e) => `<tr><td style="white-space:nowrap">${dataHora(e.t)}</td><td><span class="est ${ICO[e.tipo]}">${esc(e.l)}</span></td><td>${esc(e.txt)}</td><td class="dir">${e.valor != null ? kz(e.valor) : ''}</td></tr>`).join('')}</table>` : '<p class="mudo">Sem actividade.</p>'}</div>
    <div class="cartao"><h3>Mais vendidos hoje (grupo)</h3>${d.topo.length ? `<table>${d.topo.map((t) => `<tr><td>${esc(t.nome)}</td><td class="dir">${t.qtd}</td><td class="dir">${kz(t.valor)}</td></tr>`).join('')}</table>` : '<p class="mudo">Ainda sem vendas hoje.</p>'}</div></div>`;
}
function atencao(d) {
  const m = d.dinheiro, ls = d.locais, it = [], soma = (f) => ls.reduce((s, l) => s + f(l), 0);
  const add = (cls, tit, txt, href, rot) => it.push(`<div class="at ${cls}"><b>${tit}</b><span>${txt}</span>${href ? `<a href="#${href}">${rot}</a>` : ''}</div>`);
  const verm = ls.filter((l) => l.agora.vermelhas), am = ls.filter((l) => l.agora.amarelas && !l.agora.vermelhas);
  if (verm.length) add('mau', 'Mesas à espera há mais de 30 minutos', verm.map((l) => esc(l.nome) + ': ' + l.agora.vermelhas).join(' · '), 'mesas', 'Ver mesas');
  if (am.length) add('med', 'Mesas à espera há mais de 10 minutos', am.map((l) => esc(l.nome) + ': ' + l.agora.amarelas).join(' · '), 'mesas', 'Ver mesas');
  const fech = ls.filter((l) => !l.caixa && l.agora.contas); if (fech.length) add('med', 'Contas abertas com a caixa fechada', fech.map((l) => esc(l.nome)).join(' · '), 'caixa', 'Abrir caixa');
  if (m.n_vencidas) add('mau', 'Facturas de fornecedores vencidas', `${m.n_vencidas} factura(s), ${kz(m.vencido)} em atraso`, 'daf', 'Ver contas a pagar');
  const sb = soma((l) => l.pendentes.stock_baixo); if (sb) add('med', 'Stock abaixo do mínimo', ls.filter((l) => l.pendentes.stock_baixo).map((l) => esc(l.nome) + ': ' + l.pendentes.stock_baixo).join(' · '), 'compras', 'Encomendar');
  const fc = soma((l) => l.pendentes.facturas); if (fc) add('med', 'Contas por passar ao software de facturação', `${fc} conta(s), ${kz(soma((l) => l.pendentes.facturas_valor))}`, 'facturacao', 'Ver fila');
  if (m.reservas_pendentes) add('med', 'Reservas pedidas online por confirmar', `${m.reservas_pendentes} pedido(s) à espera de resposta`, 'reservas', 'Ver reservas');
  if (m.n_salarios) add('med', 'Salários processados por pagar', `${m.n_salarios} recibo(s), ${kz(m.salarios)}`, 'salarios', 'Ver salários');
  d.difs.slice(0, 2).forEach((f) => add(f.dif < 0 ? 'mau' : 'med', 'Diferença no fecho de caixa', `${esc(f.l)}: ${f.dif > 0 ? '+' : '−'} ${kz(Math.abs(f.dif))} em ${dataHora(f.t)}, fechada por ${esc(f.por)}`, 'caixa', 'Ver fechos'));
  const an = soma((l) => l.hoje.anulacoes); if (an) add('med', 'Linhas anuladas hoje', `${an} linha(s), ${kz(soma((l) => l.hoje.anulado))}`, 'relatorios', 'Ver relatório');
  return `<div class="duas" style="margin-bottom:14px"><div class="cartao"><h3>A precisar de atenção</h3>${it.length ? it.join('') : '<p class="mudo">Nada a assinalar neste momento.</p>'}</div>
    <div class="cartao"><h3>Dinheiro</h3><table><tr><td>Saldo em bancos e cofres (${m.contas} conta(s))</td><td class="dir"><b>${kz(m.bancos)}</b></td></tr><tr><td>Por pagar a fornecedores</td><td class="dir">− ${kz(m.fornecedores)}</td></tr><tr><td>Despesas por pagar (${m.n_despesas})</td><td class="dir">− ${kz(m.despesas)}</td></tr><tr><td>Salários por pagar</td><td class="dir">− ${kz(m.salarios)}</td></tr><tr><td><b>Disponível depois de pagar tudo</b></td><td class="dir"><b>${kz(m.bancos - m.fornecedores - m.despesas - m.salarios)}</b></td></tr></table>
      <p class="mudo" style="margin:8px 0 0">O saldo é o das contas registadas em Finanças → Tesouraria; só é fiável se os depósitos e pagamentos forem lá lançados.</p>
      <div class="fila" style="margin-top:10px"><a class="btn s" href="#daf">Finanças</a><a class="btn s" href="#grupo">Comparar locais</a><a class="btn s" href="#relatorios">Relatórios</a><a class="btn s" href="#painel">Alertas do local</a></div></div></div>`;
}
VIEWS.admin = vAdmin;
setInterval(() => { if (!S.token || rota().v !== 'admin' || document.hidden || $('#modal').classList.contains('on')) return;
  api('admin').then((d) => { S.x.adm = { pronto: true, d }; if (rota().v === 'admin') { const y = window.scrollY; render(); window.scrollTo(0, y); } }).catch(() => {}); }, 15000);

/* ---------- Entregas ao domicílio ---------- */
const L_BAI = { e: 'bairros', tit: 'Bairros e taxas de entrega', novo: 'Novo bairro',
  cols: [['Bairro', (r) => esc(r.nome)], ['Taxa de entrega', (r) => kz(r.taxa)], ['Activo', (r) => sn(r.activo)]],
  campos: (r) => [{ k: 'nome', label: 'Bairro', req: 1 }, { k: 'taxa', label: 'Taxa de entrega (Kz)', type: 'number' }, cActivo(r)] };
const ENT_COL = [['preparar', 'Em preparação'], ['caminho', 'A caminho'], ['entregue', 'Entregue · por receber']];
function waLink(p) {
  let n = String(p.cliente_tel || '').replace(/\D/g, ''); if (n.length === 9) n = '244' + n; if (n.length < 9) return '';
  const t = { preparar: 'já está a ser preparado', caminho: 'saiu para entrega' + (p.estafeta ? ' com ' + p.estafeta : ''), entregue: 'foi entregue. Obrigado pela preferência' }[p.entrega_estado || 'preparar'];
  return 'https://wa.me/' + n + '?text=' + encodeURIComponent('Olá ' + p.cliente_nome + ', o seu pedido de ' + S.st.empresa.nome + ' ' + t + '. Total: ' + kz(p.total) + '.');
}
function quadroEntregas() {
  const ps = S.st.pedidos.filter((p) => p.tipo === 'entrega');
  const cartao = (p) => { const ls = p.linhas.filter((l) => !AUTO.includes(l.seccao) && l.estado !== 'anulado'), ok = ls.filter((l) => ['pronto', 'entregue'].includes(l.estado)).length, e = p.entrega_estado || 'preparar', wa = waLink(p), falta = Math.max(0, p.total - pago(p));
    return `<div class="cartao ent"><header><b>${esc(p.cliente_nome)}</b><span class="mudo">${mins(p.aberto_em)} min</span></header>
      <p>${esc([p.bairro, p.morada].filter(Boolean).join(' · ')) || '<span class="mudo">sem morada</span>'}${p.cliente_tel ? `<br><a href="tel:${esc(p.cliente_tel)}">${esc(p.cliente_tel)}</a>` : ''}</p>
      <p class="mudo">${ls.length ? ls.map((l) => l.qtd + '× ' + esc(l.nome)).join(', ') : 'Ainda sem artigos'}</p>
      <div class="tot-l"><span>${ls.length ? `<span class="est ${ok === ls.length ? 'ok' : 'pendente'}">${ok} de ${ls.length} prontos</span>` : ''}${p.estafeta ? ' ' + esc(p.estafeta) : ''}</span><b>${falta ? kz(p.total) : 'Pago'}</b></div>
      <div class="fila" style="margin-top:10px"><a class="btn s" href="#pedido/${p.id}">Abrir conta</a>${wa ? `<a class="btn s" href="${esc(wa)}" target="_blank" rel="noopener">WhatsApp</a>` : ''}<span class="esp"></span>
      ${e === 'preparar' ? `<button class="btn p s" data-a="entSair" data-id="${p.id}">Saiu para entrega</button>` : e === 'caminho' ? `<button class="btn p s" data-a="entEstado" data-id="${p.id}" data-e="entregue">Entregue ao cliente</button>` : `<a class="btn p s" href="#pedido/${p.id}">${falta ? 'Receber' : 'Fechar conta'}</a>`}</div></div>`; };
  return `<div class="kpis"><div class="cartao kpi">Entregas em curso<b>${ps.length}</b></div><div class="cartao kpi">Na rua<b>${ps.filter((p) => p.entrega_estado === 'caminho').length}</b></div><div class="cartao kpi">Valor por receber<b>${kz(ps.reduce((s, p) => s + Math.max(0, p.total - pago(p)), 0))}</b></div></div>
    <div class="ent-q">${ENT_COL.map(([k, n]) => { const l = ps.filter((p) => (p.entrega_estado || 'preparar') === k); return `<div><h3 class="zona" style="margin-top:0">${n} · ${l.length}</h3>${l.map(cartao).join('') || '<p class="mudo">Nada aqui.</p>'}</div>`; }).join('')}</div>`;
}
VIEWS.entregas = () => `<div class="cab"><h1>Entregas</h1><span class="esp"></span><button class="btn p" data-a="entNova">Nova entrega</button></div>` + (pode('cfg') ? abas('abaEnt', [['quadro', 'Entregas em curso', quadroEntregas], ['bairros', 'Bairros e taxas', () => lista(L_BAI, true)]]) : quadroEntregas());
ACOES.entNova = () => { const bs = S.st.bairros || [];
  form('Nova entrega ao domicílio', [{ k: 'cliente_nome', label: 'Nome do cliente', req: 1 }, { k: 'cliente_tel', label: 'Telefone', type: 'tel' }, { k: 'bairro', label: 'Bairro', type: 'select', value: bs[0] ? bs[0].nome : '', options: bs.map((b) => [b.nome, b.nome + ' · ' + kz(b.taxa)]).concat([['', 'Outro bairro (indicar a taxa em baixo)']]) }, { k: 'morada', label: 'Morada e referências' }, { k: 'taxa', label: 'Taxa de entrega (Kz) — vazio usa a do bairro', type: 'number' }], (v) => {
    const b = bs.find((x) => x.nome === v.bairro), id = uuid();
    if (!op('pedido.abrir', { id, local_id: S.local, tipo: 'entrega', cliente_nome: v.cliente_nome, cliente_tel: v.cliente_tel, bairro: v.bairro, morada: v.morada, taxa_entrega: v.taxa === '' ? (b ? b.taxa : 0) : v.taxa })) return false;
    S.x.verConta = false; S.x.busca = ''; ir('pedido/' + id);
  }, '<p class="mudo" style="margin-top:10px">A taxa de entrega e a embalagem entram sozinhas na conta. Os bairros e as taxas definem-se no separador «Bairros e taxas».</p>'); };
ACOES.entSair = (el) => { const p = P(el.dataset.id); if (!p) return; form('Saiu para entrega — ' + p.cliente_nome, [{ k: 'estafeta', label: 'Estafeta', value: p.estafeta || ls.get('estafeta', '') }], (v) => { ls.set('estafeta', v.estafeta); op('entrega.estado', { pedido_id: p.id, estado: 'caminho', estafeta: v.estafeta }); render(); }); };
ACOES.entEstado = (el) => { op('entrega.estado', { pedido_id: el.dataset.id, estado: el.dataset.e }); render(); };
