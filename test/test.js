'use strict';
const assert = require('assert');
const { PGlite } = require('@electric-sql/pglite');
const { handle } = require('../lib/core');
global.__t1 = (async () => {
  const pg = new PGlite();
  const db = { q: async (t, p) => (await pg.query(t, p)).rows, tx: (fn) => pg.transaction((tx) => fn(async (t, p) => (await tx.query(t, p)).rows)) };
  const env = { AUTH_SECRET: 's', ADMIN_PASSWORD: 'segredo1' };
  let token = '';
  const call = async (method, path, body, query) => handle(db, env, { method, path: '/api/' + path, body, query: query || {}, token });
  const ops = async (...list) => (await call('POST', 'ops', { ops: list.map((o, i) => ({ id: o.id || 'op-' + Math.random(), ts: new Date().toISOString(), ...o })) })).json.resultados;

  assert.equal((await call('GET', 'state')).status, 401);
  assert.equal((await call('POST', 'login', { login: 'admin', password: 'x' })).status, 401);
  const lg = await call('POST', 'login', { login: 'Admin', password: 'segredo1' });
  assert.equal(lg.status, 200); token = lg.json.token;
  let st = (await call('GET', 'state')).json;
  assert.equal(st.mesas.length, 10); assert.ok(st.artigos.length > 10);
  const L = st.local.id, mesa = st.mesas[0], art = st.artigos.find((a) => a.nome === 'Mufete'), beb = st.artigos.find((a) => a.nome === 'Café');

  // pedido completo
  let r = await ops({ tipo: 'pedido.abrir', d: { id: 'p1', local_id: L, mesa_id: mesa.id } },
    { tipo: 'linha.add', d: { id: 'l1', pedido_id: 'p1', artigo_id: art.id, qtd: 2 } },
    { tipo: 'linha.add', d: { id: 'l2', pedido_id: 'p1', artigo_id: beb.id, qtd: 1 } },
    { tipo: 'linha.qtd', d: { id: 'l2', qtd: 3 } },
    { tipo: 'pedido.enviar', d: { pedido_id: 'p1' } });
  assert.ok(r.every((x) => x.ok), JSON.stringify(r));
  st = (await call('GET', 'state', null, { local: L })).json;
  assert.equal(st.pedidos[0].total, 2 * 14500 + 3 * 1000);
  assert.equal(st.pedidos[0].linhas.filter((l) => l.estado === 'enviado').length, 2);
  assert.equal(st.pedidos[0].linhas.find((l) => l.id === 'l2').seccao, 'bar');

  // mesa ocupada, linha enviada não se altera, idempotência
  r = await ops({ tipo: 'pedido.abrir', d: { id: 'p2', local_id: L, mesa_id: mesa.id } }); assert.equal(r[0].ok, false);
  r = await ops({ tipo: 'linha.qtd', d: { id: 'l1', qtd: 5 } }); assert.equal(r[0].ok, false);
  r = await ops({ id: 'fixo', tipo: 'linha.add', d: { id: 'l3', pedido_id: 'p1', artigo_id: beb.id, qtd: 1 } }); assert.ok(r[0].ok);
  r = await ops({ id: 'fixo', tipo: 'linha.add', d: { id: 'l3', pedido_id: 'p1', artigo_id: beb.id, qtd: 1 } }); assert.ok(r[0].ok && r[0].dup);

  // cozinha, anulação, desconto
  r = await ops({ tipo: 'linha.estado', d: { id: 'l1', estado: 'pronto' } }, { tipo: 'linha.anular', d: { id: 'l3', motivo: 'engano' } }, { tipo: 'pedido.desconto', d: { pedido_id: 'p1', valor: 2000 } });
  assert.ok(r.every((x) => x.ok), JSON.stringify(r));
  st = (await call('GET', 'state', null, { local: L })).json;
  assert.equal(st.pedidos[0].total, 30000);

  // pagamento exige caixa aberta; fecho exige total pago
  r = await ops({ tipo: 'pagamento.add', d: { id: 'g1', pedido_id: 'p1', meio: 'numerario', valor: 10000 } }); assert.equal(r[0].ok, false);
  r = await ops({ tipo: 'turno.abrir', d: { id: 't1', local_id: L, fundo: 5000 } }, { tipo: 'pagamento.add', d: { id: 'g1b', pedido_id: 'p1', meio: 'numerario', valor: 10000 } }, { tipo: 'pedido.fechar', d: { pedido_id: 'p1' } });
  assert.deepEqual(r.map((x) => x.ok), [true, true, false]);
  r = await ops({ tipo: 'pagamento.add', d: { id: 'g2', pedido_id: 'p1', meio: 'tpa', valor: 20000 } }, { tipo: 'caixa.mov', d: { id: 'm1', turno_id: 't1', tipo: 'sangria', valor: 3000, motivo: 'depósito' } }, { tipo: 'pedido.fechar', d: { pedido_id: 'p1', cliente_nif: '5000000000' } });
  assert.ok(r.every((x) => x.ok), JSON.stringify(r));
  st = (await call('GET', 'state', null, { local: L })).json;
  assert.equal(st.pedidos.length, 0);

  const tn = (await call('GET', 'turno', null, { local: L })).json;
  assert.equal(tn.porMeio.find((m) => m.meio === 'numerario').valor, 10000); assert.equal(tn.movs.length, 1);
  const hoje = new Date(Date.now() + 3600e3).toISOString().slice(0, 10);
  const rel = (await call('GET', 'relatorio', null, { local: L, de: hoje, ate: hoje })).json;
  assert.equal(rel.resumo.vendas, 30000); assert.equal(rel.resumo.contas, 1); assert.equal(rel.anulacoes.n, 1);
  assert.equal(rel.porArtigo[0].nome, 'Mufete');
  const fac = (await call('GET', 'facturacao', null, { local: L })).json;
  assert.equal(fac.docs[0].doc_num, 1); assert.equal(fac.docs[0].sync_estado, 'pendente'); assert.equal(fac.docs[0].linhas.length, 2);
  assert.equal((await call('POST', 'facturacao', { ids: ['p1'], estado: 'enviado', ref: 'FT 1' })).status, 200);
  r = await ops({ tipo: 'turno.fechar', d: { id: 't1', contado: { numerario: 12000 } } }); assert.ok(r[0].ok);

  // configuração, perfis, menu público
  const cfg = (await call('GET', 'cfg')).json;
  assert.equal((await call('POST', 'cfg', { entidade: 'artigos', linha: { familia_id: cfg.familias[0].id, nome: 'Novo prato', preco: 9000 } })).status, 200);
  assert.equal((await call('POST', 'cfg', { entidade: 'preco_local', linha: { artigo_id: art.id, local_id: L, preco: 16000 } })).status, 200);
  assert.equal((await call('POST', 'cfg', { entidade: 'utilizadores', linha: { nome: 'Ana', login: 'ana', perfil: 'empregado', password: 'abc123' } })).status, 200);
  assert.equal((await call('POST', 'cfg', { entidade: 'utilizadores', linha: { nome: 'Ana2', login: 'ana', perfil: 'empregado', password: 'abc123' } })).status, 409);
  const menu = (await call('GET', 'menu', null, { l: 'principal' })).json;
  assert.equal(menu.familias.flatMap((f) => f.artigos).find((a) => a.nome === 'Mufete').preco, 16000);
  assert.ok((await call('GET', 'qr', null, { t: 'https://x.y/menu' })).svg.includes('<svg'));
  token = (await call('POST', 'login', { login: 'ana', password: 'abc123' })).json.token;
  assert.equal((await call('GET', 'cfg')).status, 403);
  r = await ops({ tipo: 'pedido.abrir', d: { id: 'p3', local_id: L, tipo: 'takeaway' } }, { tipo: 'pedido.desconto', d: { pedido_id: 'p3', valor: 1 } }, { tipo: 'turno.abrir', d: { id: 't2', local_id: L } });
  assert.deepEqual(r.map((x) => x.ok), [true, false, false]);
  assert.equal((await call('POST', 'password', { actual: 'abc123', nova: 'nova456' })).status, 200);
  console.log('OK — todos os testes passaram');
})().catch((e) => { console.error(e); process.exit(1); });

// ---- Fases 2 a 4 ----
(async () => {
  const { PGlite } = require('@electric-sql/pglite');
  await global.__t1;
  const core = require('../lib/core'); core._reset();
  const pg = new PGlite();
  const db = { q: async (t, p) => (await pg.query(t, p)).rows, tx: (fn) => pg.transaction((tx) => fn(async (t, p) => (await tx.query(t, p)).rows)) };
  const env = { AUTH_SECRET: 's', ADMIN_PASSWORD: 'segredo1' };
  let token = '';
  const call = async (method, path, body, query) => { const r = await core.handle(db, env, { method, path: '/api/' + path, body, query: query || {}, token }); if (r.status !== 200) throw new Error(path + ' -> ' + r.status + ' ' + JSON.stringify(r.json)); return r.json; };
  const falha = async (...a) => { try { await call(...a); } catch (e) { return true; } return false; };
  const ops = async (...list) => (await call('POST', 'ops', { ops: list.map((o) => ({ id: 'op-' + Math.random(), ts: new Date().toISOString(), ...o })) })).resultados;
  token = (await call('POST', 'login', { login: 'admin', password: 'segredo1' })).token;
  let st = await call('GET', 'state'); const L = st.local.id, mufete = st.artigos.find((a) => a.nome === 'Mufete');
  const mes = new Date(Date.now() + 3600e3).toISOString().slice(0, 7), hoje = new Date(Date.now() + 3600e3).toISOString().slice(0, 10);

  // ingredientes, fornecedor, ficha, compra, recepção, custo médio
  const peixe = (await call('POST', 'reg', { entidade: 'ingredientes', linha: { nome: 'Peixe carapau', unidade: 'kg', stock_min: 5 } })).id;
  const forn = (await call('POST', 'reg', { entidade: 'fornecedores', linha: { nome: 'Peixaria Ilha', prazo_dias: 15 } })).id;
  await call('POST', 'fichas', { artigo_id: mufete.id, linhas: [{ ingrediente_id: peixe, qtd: 0.4 }] });
  const cid = (await call('POST', 'compras', { acao: 'criar', local: L, fornecedor_id: forn, linhas: [{ ingrediente_id: peixe, qtd: 10, preco: 3000 }] })).id;
  assert.ok(await falha('POST', 'compras', { acao: 'pagar', id: cid, valor: 100 }));
  await call('POST', 'compras', { acao: 'receber', id: cid, num_factura: 'FT 9' });
  let sk = await call('GET', 'stock', null, { local: L });
  assert.equal(sk.itens[0].qtd, 10); assert.equal(sk.itens[0].custo, 3000);
  assert.equal((await call('GET', 'custos')).artigos.find((a) => a.nome === 'Mufete').custo, 1200);

  // venda baixa stock; quebra; contagem
  await ops({ tipo: 'turno.abrir', d: { id: 't1', local_id: L } }, { tipo: 'pedido.abrir', d: { id: 'p1', local_id: L, mesa_id: st.mesas[0].id } }, { tipo: 'linha.add', d: { id: 'l1', pedido_id: 'p1', artigo_id: mufete.id, qtd: 5 } }, { tipo: 'pagamento.add', d: { id: 'g1', pedido_id: 'p1', meio: 'tpa', valor: 72500 } }, { tipo: 'pedido.fechar', d: { pedido_id: 'p1' } });
  sk = await call('GET', 'stock', null, { local: L }); assert.equal(sk.itens[0].qtd, 8);
  await call('POST', 'stock', { tipo: 'quebra', local: L, ingrediente_id: peixe, qtd: 1, motivo: 'estragado' });
  await call('POST', 'stock', { tipo: 'contagem', local: L, ingrediente_id: peixe, qtd: 4 });
  sk = await call('GET', 'stock', null, { local: L }); assert.equal(sk.itens[0].qtd, 4);
  assert.equal((await call('GET', 'compras', null, { local: L })).sugestao.length, 1);

  // tesouraria, pagamento da compra, despesas, RH, salários, DAF
  const banco = (await call('POST', 'reg', { entidade: 'contas_banc', linha: { nome: 'BAI', saldo_inicial: 100000 } })).id;
  await call('POST', 'compras', { acao: 'pagar', id: cid, valor: 30000, conta_id: banco });
  await call('POST', 'reg', { entidade: 'despesas', linha: { local_id: L, categoria: 'Renda', descricao: 'Novembro', valor: 20000, dia: hoje, pago: false } });
  const f1 = (await call('POST', 'reg', { entidade: 'funcionarios', linha: { nome: 'João', funcao: 'Cozinheiro', local_id: L, salario_base: 150000, subsidios: 30000 } })).id;
  await call('POST', 'reg', { entidade: 'ausencias', linha: { funcionario_id: f1, tipo: 'falta', de: mes + '-03', ate: mes + '-04' } });
  await call('POST', 'ponto', { funcionario_id: f1, acao: 'entrada', local: L }); assert.ok(await falha('POST', 'ponto', { funcionario_id: f1, acao: 'entrada' })); await call('POST', 'ponto', { funcionario_id: f1, acao: 'saida' });
  assert.equal((await call('GET', 'ponto', null, { local: L })).rows.length, 1);
  await call('POST', 'salarios', { acao: 'processar', mes });
  let sal = (await call('GET', 'salarios', null, { mes })).linhas[0];
  assert.equal(sal.faltas, 10000); assert.equal(sal.inss, 5100); assert.equal(sal.liquido, 164900);
  await call('POST', 'salarios', { acao: 'editar', id: sal.id, irt: 4900, extras: 0, descontos: 0 });
  await call('POST', 'salarios', { acao: 'pagar', mes, conta_id: banco });
  const d = await call('GET', 'daf', null, { local: L, mes });
  assert.equal(d.vendas, 72500); assert.equal(d.cmv, 6000); assert.equal(d.pessoal, 170000); assert.equal(d.despesas, 20000);
  assert.equal(d.bancos[0].saldo, 100000 - 30000 - 160000); assert.equal(d.pagarDespesas.length, 1); assert.equal(d.pagarCompras.length, 0);

  // reservas, alertas, consolidado, planta, pedido por QR
  await call('POST', 'reg', { entidade: 'reservas', linha: { local_id: L, cliente_nome: 'Família Santos', dia: hoje, hora: '20:00', pessoas: 6 } });
  const al = await call('GET', 'alertas', null, { local: L });
  assert.equal(al.stock.length, 1); assert.equal(al.reservas.length, 1); assert.equal(al.hoje.vendas, 72500);
  assert.equal((await call('GET', 'consolidado', null, { de: hoje, ate: hoje })).locais[0].vendas, 72500);
  await call('POST', 'planta', { mesas: [{ id: st.mesas[1].id, x: 40, y: 55, forma: 'redonda' }] });
  const tk = token; token = '';
  const menu = await call('GET', 'menu', null, { l: 'principal', m: st.mesas[1].id }); assert.equal(menu.mesa.nome, 'Mesa 2');
  await call('POST', 'pedido-publico', { l: 'principal', mesa: st.mesas[1].id, itens: [{ artigo_id: mufete.id, qtd: 2 }] });
  assert.ok(await falha('POST', 'pedido-publico', { l: 'principal', mesa: 'x', itens: [{ artigo_id: mufete.id, qtd: 2 }] }));
  token = tk; st = await call('GET', 'state');
  assert.equal(st.mesas[1].forma, 'redonda'); assert.equal(st.pedidos[0].linhas[0].criado_por_nome, 'Cliente (QR)'); assert.equal(st.pedidos[0].total, 29000);
  assert.equal((await call('GET', 'alertas', null, { local: L })).qr, 1);
  console.log('OK — fases 2 a 4');
})().catch((e) => { console.error(e); process.exit(1); });

// ---- Juntar mesas e dados fictícios ----
(async () => {
  await global.__t1; await new Promise((r) => setTimeout(r, 2500));
  const { PGlite } = require('@electric-sql/pglite');
  const core = require('../lib/core'); core._reset();
  const pg = new PGlite();
  const db = { q: async (t, p) => (await pg.query(t, p)).rows, tx: (fn) => pg.transaction((tx) => fn(async (t, p) => (await tx.query(t, p)).rows)) };
  const env = { AUTH_SECRET: 's', ADMIN_PASSWORD: 'segredo1', DEMO_AUTO: '1' };
  let token = '';
  const call = async (method, path, body, query) => { const r = await core.handle(db, env, { method, path: '/api/' + path, body, query: query || {}, token }); if (r.status !== 200) throw new Error(path + ' -> ' + r.status + ' ' + JSON.stringify(r.json)); return r.json; };
  const ops = async (...list) => (await call('POST', 'ops', { ops: list.map((o) => ({ id: 'op-' + Math.random(), ts: new Date().toISOString(), ...o })) })).resultados;
  token = (await call('POST', 'login', { login: 'admin', password: 'segredo1' })).token;
  let st = await call('GET', 'state'); const L = st.local.id;
  const hoje = new Date(Date.now() + 3600e3).toISOString().slice(0, 10), mes = hoje.slice(0, 7);
  // dados fictícios carregados sozinhos
  assert.equal(st.locais.length, 2); assert.equal(st.pedidos.length, 5); assert.equal(st.pedidos.filter((p) => p.tipo === "entrega").length, 2);
  const rel = await call('GET', 'relatorio', null, { local: L, de: '2020-01-01', ate: hoje }); assert.ok(rel.resumo.contas > 150 && rel.porMeio.length === 4);
  const sk = await call('GET', 'stock', null, { local: L }); assert.equal(sk.itens.length, 22); assert.ok(sk.itens.every((i) => i.qtd > 0), JSON.stringify(sk.itens.filter((i) => i.qtd <= 0)));
  const d = await call('GET', 'daf', null, { local: L, mes }); assert.ok(d.vendas > 0 && d.cmv > 0 && d.pessoal > 0 && d.despesas > 0 && d.bancos.length === 2 && d.pagarCompras.length > 0);
  const al = await call('GET', 'alertas', null, { local: L }); assert.ok(al.stock.length >= 2 && al.reservas.length === 3);
  assert.equal((await call('GET', 'consolidado', null, { de: '2020-01-01', ate: hoje })).locais.filter((l) => l.vendas > 0).length, 2);
  assert.ok((await call('GET', 'custos')).artigos.filter((a) => a.n).length >= 15);
  assert.equal((await call('GET', 'salarios', null, { mes })).linhas.length, 8);
  assert.ok((await call('GET', 'facturacao', null, { local: L })).docs.length > 100);
  assert.ok((await call('GET', 'turno', null, { local: L })).ultimos.length === 10);
  // juntar: duas mesas com conta + uma livre → uma só conta na principal
  const cm = st.pedidos.filter((p) => p.mesa_id), oc = cm.map((p) => p.mesa_id), livre = st.mesas.find((m) => !oc.includes(m.id));
  const tot = cm[0].total + cm[1].total;
  await call('POST', 'mesas-juntar', { principal: oc[0], outras: [oc[1], livre.id] });
  st = await call('GET', 'state');
  assert.equal(st.pedidos.filter((p) => p.mesa_id).length, 2); assert.equal(st.pedidos.find((p) => p.mesa_id === oc[0]).total, tot);
  assert.equal(st.mesas.filter((m) => m.junta_a === oc[0]).length, 2);
  const r = await ops({ tipo: 'pedido.abrir', d: { id: 'px', local_id: L, mesa_id: livre.id } }); assert.equal(r[0].ok, false); // a mesa junta responde pela principal, que está ocupada
  await call('POST', 'mesas-separar', { principal: oc[0] });
  st = await call('GET', 'state'); assert.equal(st.mesas.filter((m) => m.junta_a).length, 0);
  await call('POST', 'demo', { acao: 'apagar' });
  st = await call('GET', 'state'); assert.equal(st.locais.length, 1); assert.equal(st.pedidos.length, 0);
  assert.equal((await call('GET', 'stock', null, { local: L })).itens.length, 0);
  await call('POST', 'demo', { acao: 'carregar' }); assert.equal((await call('GET', 'state')).locais.length, 2);
  console.log('OK — juntar mesas e dados fictícios');
})().catch((e) => { console.error(e); process.exit(1); });
// ---- Administração ao vivo ----
(async () => {
  await global.__t1; await new Promise((r) => setTimeout(r, 9000));
  const { PGlite } = require('@electric-sql/pglite');
  const core = require('../lib/core'); core._reset();
  const pg = new PGlite();
  const db = { q: async (t, p) => (await pg.query(t, p)).rows, tx: (fn) => pg.transaction((tx) => fn(async (t, p) => (await tx.query(t, p)).rows)) };
  const env = { AUTH_SECRET: 's', ADMIN_PASSWORD: 'segredo1', DEMO_AUTO: '1' };
  let token = '';
  const call = async (method, path, body, query) => { const r = await core.handle(db, env, { method, path: '/api/' + path, body, query: query || {}, token }); if (r.status !== 200) throw new Error(path + ' -> ' + r.status + ' ' + JSON.stringify(r.json)); return r.json; };
  token = (await call('POST', 'login', { login: 'admin', password: 'segredo1' })).token;
  const a = await call('GET', 'admin');
  assert.equal(a.locais.length, 2); const r = a.locais[0];
  assert.ok(r.mes.vendas > 0 && r.mes.cmv > 0 && r.mes.pessoal > 0 && r.mes.despesas > 0);
  assert.equal(r.agora.contas, 5); assert.equal(r.agora.mesas, 10); assert.ok(r.agora.cozinha.linhas + r.agora.bar.linhas > 0);
  assert.ok(a.dinheiro.bancos > 0 && a.dinheiro.fornecedores > 0 && a.dinheiro.n_despesas === 1 && a.dinheiro.n_salarios === 8);
  assert.ok(r.pendentes.facturas > 0 && r.pendentes.stock_baixo >= 2 && r.pendentes.reservas === 3);
  assert.ok(a.eventos.length > 5 && a.difs.length > 0);
  const d = await call('GET', 'daf', null, { local: r.id, mes: a.mes }); assert.equal(Math.round(d.vendas), Math.round(r.mes.vendas)); assert.equal(Math.round(d.cmv), Math.round(r.mes.cmv));
  console.log('OK — administração ao vivo');
})().catch((e) => { console.error(e); process.exit(1); });
// ---- Reservas: pedido público e mesas reservadas ----
(async () => {
  await global.__t1; await new Promise((r) => setTimeout(r, 14000));
  const { PGlite } = require('@electric-sql/pglite');
  const core = require('../lib/core'); core._reset();
  const pg = new PGlite();
  const db = { q: async (t, p) => (await pg.query(t, p)).rows, tx: (fn) => pg.transaction((tx) => fn(async (t, p) => (await tx.query(t, p)).rows)) };
  const env = { AUTH_SECRET: 's', ADMIN_PASSWORD: 'segredo1' };
  let token = '';
  const raw = (method, path, body, query) => core.handle(db, env, { method, path: '/api/' + path, body, query: query || {}, token });
  const hoje = new Date(Date.now() + 3600e3).toISOString().slice(0, 10);
  const ok = { l: 'principal', nome: 'Rosa Miguel', telefone: '+244 923 111 222', dia: hoje, hora: '20:30', pessoas: 4, notas: 'Aniversário' };
  assert.equal((await raw('POST', 'reserva-publica', ok)).status, 200);
  assert.equal((await raw('POST', 'reserva-publica', { ...ok, telefone: '12' })).status, 400);
  assert.equal((await raw('POST', 'reserva-publica', { ...ok, dia: '2020-01-01' })).status, 400);
  assert.equal((await raw('POST', 'reserva-publica', { ...ok, pessoas: 0 })).status, 400);
  assert.equal((await raw('POST', 'reserva-publica', { ...ok, l: 'nao-existe' })).status, 404);
  token = (await raw('POST', 'login', { login: 'admin', password: 'segredo1' })).json.token;
  let st = (await raw('GET', 'state')).json;
  assert.equal(st.reservas.length, 1); assert.equal(st.reservas[0].estado, 'pendente'); assert.equal(st.reservas[0].pessoas, 4);
  const r = st.reservas[0];
  assert.equal((await raw('POST', 'reg', { entidade: 'reservas', linha: { ...r, estado: 'confirmada', mesa_id: st.mesas[0].id } })).status, 200);
  st = (await raw('GET', 'state')).json; assert.equal(st.reservas[0].mesa_id, st.mesas[0].id); assert.equal(st.reservas[0].cliente_nome, 'Rosa Miguel');
  assert.equal((await raw('GET', 'admin')).json.dinheiro.reservas_pendentes, 0);
  assert.equal((await raw('POST', 'reg', { entidade: 'reservas', linha: { ...st.reservas[0], estado: 'sentada' } })).status, 200);
  assert.equal((await raw('GET', 'state')).json.reservas.length, 0);
  console.log('OK — reservas');
})().catch((e) => { console.error(e); process.exit(1); });
// ---- Pedido do cliente com registo e acompanhamento ----
(async () => {
  await global.__t1; await new Promise((r) => setTimeout(r, 17000));
  const { PGlite } = require('@electric-sql/pglite');
  const core = require('../lib/core'); core._reset();
  const pg = new PGlite();
  const db = { q: async (t, p) => (await pg.query(t, p)).rows, tx: (fn) => pg.transaction((tx) => fn(async (t, p) => (await tx.query(t, p)).rows)) };
  const env = { AUTH_SECRET: 's', ADMIN_PASSWORD: 'segredo1' };
  let token = '';
  const raw = (method, path, body, query) => core.handle(db, env, { method, path: '/api/' + path, body, query: query || {}, token });
  token = (await raw('POST', 'login', { login: 'admin', password: 'segredo1' })).json.token;
  let st = (await raw('GET', 'state')).json; const mesa = st.mesas[0].id, a = st.artigos.find((x) => x.nome === 'Mufete').id; token = '';
  const r1 = (await raw('POST', 'pedido-publico', { l: 'principal', mesa, itens: [{ artigo_id: a, qtd: 1 }], cliente: { nome: 'Rui', telefone: '923 555 777' } })).json;
  assert.ok(/^[0-9a-f-]{36}$/.test(r1.seguir));
  const r2 = (await raw('POST', 'pedido-publico', { l: 'principal', mesa, itens: [{ artigo_id: a, qtd: 2 }], cliente: { nome: 'Rui', telefone: '923 555 777' }, seguir: r1.seguir })).json;
  assert.equal(r2.seguir, r1.seguir);
  assert.equal((await raw('POST', 'pedido-publico', { l: 'principal', mesa, itens: [{ artigo_id: a, qtd: 1 }] })).json.seguir, null);
  let e = (await raw('GET', 'pedido-estado', null, { t: r1.seguir })).json; assert.equal(e.linhas.length, 2); assert.ok(e.linhas.every((x) => x.estado === 'novo'));
  assert.equal((await raw('GET', 'pedido-estado', null, { t: 'x' })).status, 400);
  assert.equal((await raw('GET', 'pedido-estado', null, { t: '00000000-0000-0000-0000-000000000000' })).json.linhas.length, 0);
  token = (await raw('POST', 'login', { login: 'admin', password: 'segredo1' })).json.token;
  st = (await raw('GET', 'state')).json; const p = st.pedidos[0];
  const ops = (l) => raw('POST', 'ops', { ops: l.map((o) => ({ id: 'o' + Math.random(), ts: new Date().toISOString(), ...o })) });
  await ops([{ tipo: 'pedido.enviar', d: { pedido_id: p.id } }, { tipo: 'linha.estado', d: { id: e.linhas[0].id, estado: 'pronto' } }]);
  e = (await raw('GET', 'pedido-estado', null, { t: r1.seguir })).json; assert.deepEqual(e.linhas.map((x) => x.estado).sort(), ['enviado', 'pronto']);
  assert.equal((await raw('GET', 'reg', null, { e: 'clientes' })).json.filter((c) => c.telefone === '923 555 777').length, 1);
  console.log('OK — pedido do cliente com registo');
})().catch((e) => { console.error(e); process.exit(1); });
// ---- Stock sai ao validar a saída; histórico com conta e factura ----
(async () => {
  await global.__t1; await new Promise((r) => setTimeout(r, 20000));
  const { PGlite } = require('@electric-sql/pglite');
  const core = require('../lib/core'); core._reset();
  const pg = new PGlite();
  const db = { q: async (t, p) => (await pg.query(t, p)).rows, tx: (fn) => pg.transaction((tx) => fn(async (t, p) => (await tx.query(t, p)).rows)) };
  const env = { AUTH_SECRET: 's', ADMIN_PASSWORD: 'segredo1' };
  let token = '';
  const call = async (method, path, body, query) => { const r = await core.handle(db, env, { method, path: '/api/' + path, body, query: query || {}, token }); if (r.status !== 200) throw new Error(path + ' -> ' + r.status + ' ' + JSON.stringify(r.json)); return r.json; };
  const ops = async (...l) => { const r = (await call('POST', 'ops', { ops: l.map((o) => ({ id: 'o' + Math.random(), ts: new Date().toISOString(), ...o })) })).resultados; assert.ok(r.every((x) => x.ok), JSON.stringify(r)); };
  token = (await call('POST', 'login', { login: 'admin', password: 'segredo1' })).token;
  const st = await call('GET', 'state'), L = st.local.id, muf = st.artigos.find((a) => a.nome === 'Mufete'), cer = st.artigos.find((a) => a.nome === 'Cerveja nacional');
  const peixe = (await call('POST', 'reg', { entidade: 'ingredientes', linha: { nome: 'Peixe', unidade: 'kg', custo_medio: 3000 } })).id, gar = (await call('POST', 'reg', { entidade: 'ingredientes', linha: { nome: 'Cerveja', unidade: 'un', custo_medio: 600 } })).id;
  await call('POST', 'fichas', { artigo_id: muf.id, linhas: [{ ingrediente_id: peixe, qtd: 0.5 }] }); await call('POST', 'fichas', { artigo_id: cer.id, linhas: [{ ingrediente_id: gar, qtd: 1 }] });
  await call('POST', 'stock', { tipo: 'entrada', local: L, ingrediente_id: peixe, qtd: 10 }); await call('POST', 'stock', { tipo: 'entrada', local: L, ingrediente_id: gar, qtd: 48 });
  const qt = async (id) => (await call('GET', 'stock', null, { local: L })).itens.find((i) => i.id === id).qtd;
  await ops({ tipo: 'turno.abrir', d: { id: 't', local_id: L } }, { tipo: 'pedido.abrir', d: { id: 'p', local_id: L, mesa_id: st.mesas[0].id } }, { tipo: 'linha.add', d: { id: 'a', pedido_id: 'p', artigo_id: muf.id, qtd: 2 } }, { tipo: 'linha.add', d: { id: 'b', pedido_id: 'p', artigo_id: cer.id, qtd: 3 } }, { tipo: 'pedido.enviar', d: { pedido_id: 'p' } });
  assert.equal(await qt(peixe), 10);
  await ops({ tipo: 'linha.estado', d: { id: 'a', estado: 'preparar' } }); assert.equal(await qt(peixe), 10);        // aceitar não mexe no stock
  await ops({ tipo: 'linha.estado', d: { id: 'a', estado: 'pronto' } }); assert.equal(await qt(peixe), 9);           // validar a saída baixa
  await ops({ tipo: 'linha.estado', d: { id: 'a', estado: 'entregue' } }); assert.equal(await qt(peixe), 9);         // não baixa duas vezes
  assert.equal(await qt(gar), 48);                                                                                    // a cerveja ainda não foi validada
  await ops({ tipo: 'pagamento.add', d: { id: 'g', pedido_id: 'p', meio: 'tpa', valor: 33500 } }, { tipo: 'pedido.fechar', d: { pedido_id: 'p' } });
  assert.equal(await qt(peixe), 9); assert.equal(await qt(gar), 45);                                                  // o que faltava sai ao fechar
  await call('POST', 'facturacao', { ids: ['p'], estado: 'enviado', ref: 'FT 2026/55' });
  const h = await call('GET', 'stock-saidas', null, { local: L });
  assert.equal(h.linhas.length, 2); assert.ok(h.linhas.every((x) => x.sync_ref === 'FT 2026/55' && x.doc_num === 1 && x.mesa_nome === 'Mesa 1'));
  assert.equal(h.linhas.find((x) => x.ingrediente === 'Peixe').motivo, '2× Mufete'); assert.equal(h.resumo.find((x) => x.ingrediente === 'Cerveja').qtd, 3);
  assert.equal((await call('GET', 'stock-saidas', null, { local: L, ingrediente: gar })).linhas.length, 1);
  console.log('OK — stock sai ao validar e fica com histórico');
})().catch((e) => { console.error(e); process.exit(1); });
// ---- Produtos temporariamente indisponíveis ----
(async () => {
  await global.__t1; await new Promise((r) => setTimeout(r, 23000));
  const { PGlite } = require('@electric-sql/pglite');
  const core = require('../lib/core'); core._reset();
  const pg = new PGlite();
  const db = { q: async (t, p) => (await pg.query(t, p)).rows, tx: (fn) => pg.transaction((tx) => fn(async (t, p) => (await tx.query(t, p)).rows)) };
  const env = { AUTH_SECRET: 's', ADMIN_PASSWORD: 'segredo1' };
  let token = '';
  const raw = (method, path, body, query) => core.handle(db, env, { method, path: '/api/' + path, body, query: query || {}, token });
  token = (await raw('POST', 'login', { login: 'admin', password: 'segredo1' })).json.token;
  let st = (await raw('GET', 'state')).json; const L = st.local.id, a = st.artigos.find((x) => x.nome === 'Mufete'), b = st.artigos.find((x) => x.nome === 'Café'), mesa = st.mesas[0].id;
  const noMenu = async () => (await raw('GET', 'menu', null, { l: 'principal' })).json.familias.flatMap((f) => f.artigos).some((x) => x.nome === 'Mufete');
  const ops = async (l) => (await raw('POST', 'ops', { ops: l.map((o) => ({ id: 'o' + Math.random(), ts: new Date().toISOString(), ...o })) })).json.resultados;
  assert.ok(await noMenu());
  assert.equal((await raw('POST', 'disponibilidade', { local: L, artigo_id: a.id, fora: true })).status, 200);
  st = (await raw('GET', 'state')).json; assert.equal(st.artigos.find((x) => x.id === a.id).fora, true); assert.equal(st.artigos.find((x) => x.id === b.id).fora, false);
  assert.equal(await noMenu(), false);
  let r = await ops([{ tipo: 'pedido.abrir', d: { id: 'p', local_id: L, mesa_id: mesa } }, { tipo: 'linha.add', d: { id: 'x', pedido_id: 'p', artigo_id: a.id, qtd: 1 } }, { tipo: 'linha.add', d: { id: 'y', pedido_id: 'p', artigo_id: b.id, qtd: 1 } }]);
  assert.deepEqual(r.map((x) => x.ok), [true, false, true]);
  const tk = token; token = '';
  await raw('POST', 'pedido-publico', { l: 'principal', mesa, itens: [{ artigo_id: a.id, qtd: 1 }, { artigo_id: b.id, qtd: 1 }] });
  token = tk; st = (await raw('GET', 'state')).json; assert.equal(st.pedidos[0].linhas.filter((l) => l.nome === 'Mufete').length, 0); assert.equal(st.pedidos[0].linhas.length, 2);
  assert.equal((await raw('POST', 'disponibilidade', { local: L, artigo_id: a.id, fora: false })).status, 200); assert.ok(await noMenu());
  await raw('POST', 'disponibilidade', { local: L, artigo_id: b.id, fora: true }); await raw('POST', 'disponibilidade', { local: L, todos: true });
  assert.equal((await raw('GET', 'disponibilidade', null, { local: L })).json.fora.length, 0);
  console.log('OK — produtos indisponíveis');
})().catch((e) => { console.error(e); process.exit(1); });
// ---- Embalagem de take-away automática ----
(async () => {
  await global.__t1; await new Promise((r) => setTimeout(r, 26000));
  const { PGlite } = require('@electric-sql/pglite');
  const core = require('../lib/core'); core._reset();
  const pg = new PGlite();
  const db = { q: async (t, p) => (await pg.query(t, p)).rows, tx: (fn) => pg.transaction((tx) => fn(async (t, p) => (await tx.query(t, p)).rows)) };
  const env = { AUTH_SECRET: 's', ADMIN_PASSWORD: 'segredo1' };
  let token = '';
  const call = async (method, path, body, query) => { const r = await core.handle(db, env, { method, path: '/api/' + path, body, query: query || {}, token }); if (r.status !== 200) throw new Error(path + ' -> ' + r.status + ' ' + JSON.stringify(r.json)); return r.json; };
  const ops = async (...l) => { const r = (await call('POST', 'ops', { ops: l.map((o) => ({ id: 'o' + Math.random(), ts: new Date().toISOString(), ...o })) })).resultados; assert.ok(r.every((x) => x.ok), JSON.stringify(r)); };
  token = (await call('POST', 'login', { login: 'admin', password: 'segredo1' })).token;
  let st = await call('GET', 'state'); const L = st.local.id, muf = st.artigos.find((a) => a.nome === 'Mufete').id, cafe = st.artigos.find((a) => a.nome === 'Café').id;
  assert.equal(st.empresa.emb_preco, 300); assert.equal(st.empresa.emb_modo, 'prato');
  const ped = async (id) => (await call('GET', 'state')).pedidos.find((p) => p.id === id);
  await ops({ tipo: 'pedido.abrir', d: { id: 'tk', local_id: L, tipo: 'takeaway' } }, { tipo: 'linha.add', d: { id: 'a', pedido_id: 'tk', artigo_id: cafe, qtd: 2 } });
  assert.equal((await ped('tk')).total, 2000);                                                       // só bebidas: sem embalagem
  await ops({ tipo: 'linha.add', d: { id: 'b', pedido_id: 'tk', artigo_id: muf, qtd: 2 } });
  let p = await ped('tk'), e = p.linhas.find((l) => l.nome === 'Embalagem take-away'); assert.equal(e.qtd, 2); assert.equal(p.total, 2000 + 29000 + 600);
  await ops({ tipo: 'linha.qtd', d: { id: 'b', qtd: 3 } }); p = await ped('tk'); assert.equal(p.linhas.find((l) => l.id === 'tk-emb').qtd, 3); assert.equal(p.total, 2000 + 43500 + 900);
  await ops({ tipo: 'pedido.enviar', d: { pedido_id: 'tk' } }); assert.equal((await ped('tk')).linhas.find((l) => l.id === 'tk-emb').estado, 'entregue'); // não vai para a cozinha
  await ops({ tipo: 'pedido.abrir', d: { id: 'bl', local_id: L, tipo: 'balcao' } }, { tipo: 'linha.add', d: { id: 'c', pedido_id: 'bl', artigo_id: muf, qtd: 1 } });
  assert.equal((await ped('bl')).total, 14500);                                                       // balcão: sem embalagem
  await call('POST', 'cfg', { entidade: 'empresa', linha: { ...st.empresa, emb_preco: 500, emb_modo: 'pedido' } });
  await ops({ tipo: 'linha.add', d: { id: 'd', pedido_id: 'tk', artigo_id: cafe, qtd: 1 } }); p = await ped('tk'); e = p.linhas.find((l) => l.id === 'tk-emb'); assert.equal(e.qtd, 1); assert.equal(e.preco, 500);
  await ops({ tipo: 'linha.anular', d: { id: 'tk-emb', motivo: 'cliente trouxe caixa' } }, { tipo: 'linha.add', d: { id: 'f', pedido_id: 'tk', artigo_id: cafe, qtd: 1 } });
  p = await ped('tk'); assert.equal(p.linhas.find((l) => l.id === 'tk-emb').estado, 'anulado'); assert.equal(p.total, 4000 + 43500);                      // dispensada pelo gerente: não volta
  await ops({ tipo: 'pedido.abrir', d: { id: 't2', local_id: L, tipo: 'takeaway' } }, { tipo: 'linha.add', d: { id: 'g', pedido_id: 't2', artigo_id: muf, qtd: 1 } }, { tipo: 'pedido.transferir', d: { pedido_id: 't2', mesa_id: st.mesas[0].id } });
  assert.equal((await ped('t2')).total, 14500);                                                       // passou para mesa: embalagem sai
  console.log('OK — embalagem de take-away');
})().catch((e) => { console.error(e); process.exit(1); });
// ---- v11: imagens, fotografia, favoritos, taxa de serviço, entregas ----
(async () => {
  await global.__t1; await new Promise((r) => setTimeout(r, 29000));
  const { PGlite } = require('@electric-sql/pglite');
  const core = require('../lib/core'); core._reset();
  const pg = new PGlite();
  const db = { q: async (t, p) => (await pg.query(t, p)).rows, tx: (fn) => pg.transaction((tx) => fn(async (t, p) => (await tx.query(t, p)).rows)) };
  const env = { AUTH_SECRET: 's', ADMIN_PASSWORD: 'segredo1' };
  let token = '';
  const raw = (method, path, body, query) => core.handle(db, env, { method, path: '/api/' + path, body, query: query || {}, token });
  const call = async (method, path, body, query) => { const r = await raw(method, path, body, query); if (r.status !== 200) throw new Error(path + ' -> ' + r.status + ' ' + JSON.stringify(r.json)); return r.json; };
  const ops = async (...l) => (await call('POST', 'ops', { ops: l.map((o) => ({ id: 'o' + Math.random(), ts: new Date().toISOString(), ...o })) })).resultados;
  token = (await call('POST', 'login', { login: 'admin', password: 'segredo1' })).token;
  let st = await call('GET', 'state'); const L = st.local.id, muf = st.artigos.find((a) => a.nome === 'Mufete'), cafe = st.artigos.find((a) => a.nome === 'Café');
  const fs = require('fs');
  for (const a of st.artigos) { assert.ok(/^\/(img|foto)\//.test(a.imagem), a.nome + ' sem imagem'); assert.ok(fs.existsSync(__dirname + '/../public' + a.imagem), a.imagem); }
  assert.equal(muf.imagem, '/foto/peixe-grelhado-com-banana-pao.jpg'); assert.equal(muf.favorito, false);
  assert.equal(st.artigos.length, 73); assert.equal(st.artigos.filter((x) => x.imagem.startsWith('/foto/')).length, 42); assert.equal(st.artigos.find((x) => x.nome === 'Tiramisù').imagem, '/foto/tiramisu.jpg'); assert.equal(st.artigos.find((x) => x.nome === 'Mojito').imagem, '/img/mojito.png');
  assert.equal((await call('GET', 'menu', null, { l: 'principal' })).capa, '/foto/esplanada.jpg');
  // artigo novo sem ilustração fica vazio (a app usa a genérica); favorito guarda-se
  const cfg = await call('GET', 'cfg'); const am = cfg.artigos.find((a) => a.id === muf.id);
  await call('POST', 'cfg', { entidade: 'artigos', linha: { ...am, favorito: true } });
  const novo = await call('POST', 'cfg', { entidade: 'artigos', linha: { nome: 'Prato do dia', familia_id: am.familia_id, preco: 9000 } });
  st = await call('GET', 'state'); assert.equal(st.artigos.find((a) => a.id === muf.id).favorito, true); assert.equal(st.artigos.find((a) => a.id === novo.id).imagem, '');
  // fotografia: só o gestor carrega, qualquer pessoa vê; remover volta à ilustração
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
  assert.equal((await raw('POST', 'foto', { artigo_id: muf.id, dados: 'data:text/html;base64,AAAA' })).status, 400);
  const f = await call('POST', 'foto', { artigo_id: muf.id, dados: png }); assert.ok(f.imagem.startsWith('/api/foto?a=' + muf.id));
  const tk = token; token = '';
  const g = await raw('GET', 'foto', null, { a: muf.id }); assert.equal(g.status, 200); assert.equal(g.mime, 'image/png'); assert.ok(g.bin.length > 50);
  assert.equal((await raw('POST', 'foto', { artigo_id: muf.id, dados: png })).status, 401);
  const menu = await call('GET', 'menu', null, { l: 'principal' }); assert.equal(menu.familias.flatMap((x) => x.artigos).find((a) => a.id === muf.id).imagem, f.imagem);
  token = tk; await call('POST', 'foto', { artigo_id: muf.id, remover: true });
  st = await call('GET', 'state'); assert.equal(st.artigos.find((a) => a.id === muf.id).imagem, '/foto/peixe-grelhado-com-banana-pao.jpg'); assert.equal((await raw('GET', 'foto', null, { a: muf.id })).status, 404);
  // taxa de serviço: só nas mesas, sobre o consumo, e pode ser dispensada
  const ped = async (id) => (await call('GET', 'state')).pedidos.find((p) => p.id === id);
  await call('POST', 'cfg', { entidade: 'empresa', linha: { ...st.empresa, taxa_servico: 10 } });
  let r = await ops({ tipo: 'pedido.abrir', d: { id: 'm1', local_id: L, mesa_id: st.mesas[0].id } }, { tipo: 'linha.add', d: { id: 'a', pedido_id: 'm1', artigo_id: muf.id, qtd: 2 } }); assert.ok(r.every((x) => x.ok), JSON.stringify(r));
  let p = await ped('m1'); assert.equal(p.linhas.find((l) => l.id === 'm1-srv').preco, 2900); assert.equal(p.total, 31900);
  await ops({ tipo: 'linha.add', d: { id: 'b', pedido_id: 'm1', artigo_id: cafe.id, qtd: 1 } }); p = await ped('m1'); assert.equal(p.total, 30000 + 3000);
  token = ''; await call('POST', 'pedido-publico', { l: 'principal', mesa: st.mesas[0].id, itens: [{ artigo_id: cafe.id, qtd: 1 }] }); token = tk;
  p = await ped('m1'); assert.equal(p.total, 31000 + 3100);                                           // o pedido por QR também actualiza a taxa
  await ops({ tipo: 'pedido.abrir', d: { id: 'b1', local_id: L, tipo: 'balcao' } }, { tipo: 'linha.add', d: { id: 'c', pedido_id: 'b1', artigo_id: muf.id, qtd: 1 } }); assert.equal((await ped('b1')).total, 14500);
  await ops({ tipo: 'linha.anular', d: { id: 'm1-srv', motivo: 'oferta da casa' } }, { tipo: 'linha.add', d: { id: 'd', pedido_id: 'm1', artigo_id: cafe.id, qtd: 1 } }); assert.equal((await ped('m1')).total, 32000);
  // entregas: nome obrigatório, taxa do bairro e embalagem entram sozinhas, estados
  await call('POST', 'reg', { entidade: 'bairros', linha: { nome: 'Maianga', taxa: 1500 } });
  st = await call('GET', 'state'); assert.deepEqual(st.bairros.map((b) => [b.nome, b.taxa]), [['Maianga', 1500]]);
  r = await ops({ tipo: 'pedido.abrir', d: { id: 'e0', local_id: L, tipo: 'entrega' } }); assert.equal(r[0].ok, false);
  r = await ops({ tipo: 'pedido.abrir', d: { id: 'e1', local_id: L, tipo: 'entrega', cliente_nome: 'Marta', cliente_tel: '923000111', bairro: 'Maianga', morada: 'Rua 1', taxa_entrega: 1500 } }, { tipo: 'linha.add', d: { id: 'e', pedido_id: 'e1', artigo_id: muf.id, qtd: 2 } }); assert.ok(r.every((x) => x.ok), JSON.stringify(r));
  p = await ped('e1'); assert.equal(p.tipo, 'entrega'); assert.equal(p.mesa_nome, 'Entrega · Marta'); assert.equal(p.entrega_estado, 'preparar');
  assert.equal(p.linhas.find((l) => l.id === 'e1-ent').nome, 'Taxa de entrega · Maianga'); assert.equal(p.linhas.find((l) => l.id === 'e1-emb').qtd, 2); assert.ok(!p.linhas.find((l) => l.id === 'e1-srv'));
  assert.equal(p.total, 29000 + 1500 + 600);
  r = await ops({ tipo: 'entrega.estado', d: { pedido_id: 'e1', estado: 'caminho', estafeta: 'João' } }, { tipo: 'entrega.estado', d: { pedido_id: 'e1', estado: 'voou' } }); assert.deepEqual(r.map((x) => x.ok), [true, false]);
  p = await ped('e1'); assert.equal(p.entrega_estado, 'caminho'); assert.equal(p.estafeta, 'João');
  await ops({ tipo: 'pedido.enviar', d: { pedido_id: 'e1' } }); p = await ped('e1'); assert.equal(p.linhas.filter((l) => l.estado === 'enviado').length, 1);          // só o prato vai para a cozinha
  r = await ops({ tipo: 'pedido.cliente', d: { pedido_id: 'm1', cliente_nome: 'Empresa X, Lda', cliente_nif: '5417000099' } }); assert.ok(r[0].ok); p = await ped('m1'); assert.equal(p.cliente_nome, 'Empresa X, Lda'); assert.equal(p.cliente_nif, '5417000099');
  // gerir artigos: apagar só sem vendas, famílias vazias, preços em lote
  assert.equal((await raw('POST', 'cfg', { entidade: 'artigos', apagar: muf.id })).status, 409);
  let cg = await call('GET', 'cfg'); assert.equal(cg.artigos.find((a) => a.id === muf.id).vendido, true); assert.equal(cg.artigos.find((a) => a.id === novo.id).vendido, false);
  await call('POST', 'cfg', { entidade: 'artigos', apagar: novo.id }); cg = await call('GET', 'cfg'); assert.ok(!cg.artigos.find((a) => a.id === novo.id));
  const fam = await call('POST', 'cfg', { entidade: 'familias', linha: { nome: 'Sazonais', seccao: 'cozinha', carta: 'menu', ordem: 9 } });
  const tmp = await call('POST', 'cfg', { entidade: 'artigos', linha: { nome: 'Sopa do dia', familia_id: fam.id, preco: 2130 } });
  assert.equal((await raw('POST', 'cfg', { entidade: 'familias', apagar: fam.id })).status, 409);
  const lote = await call('POST', 'cfg', { entidade: 'precos_lote', linha: { familia_id: fam.id, pct: 10, arredondar: 50 } }); assert.equal(lote.n, 1);
  cg = await call('GET', 'cfg'); assert.equal(cg.artigos.find((a) => a.id === tmp.id).preco, 2350); assert.equal(cg.artigos.find((a) => a.id === cafe.id).preco, 1000);
  await call('POST', 'cfg', { entidade: 'artigos', apagar: tmp.id }); await call('POST', 'cfg', { entidade: 'familias', apagar: fam.id });
  token = ''; assert.equal((await raw('POST', 'cfg', { entidade: 'artigos', apagar: cafe.id })).status, 401); token = tk;
  // dados fictícios trazem bairros e entregas
  await call('POST', 'demo', { acao: 'carregar' }); st = await call('GET', 'state'); assert.ok(st.bairros.length >= 6); assert.equal(st.pedidos.filter((x) => x.id.startsWith('demo-en-')).length, 2);
  // dashboards dos menus de gestão
  const dg = await call('GET', 'dash', null, { t: 'gestao', local: L, dias: 30 }); assert.equal(dg.vendasDia.length, 30); assert.equal(dg.horas.length, 24); assert.ok(dg.k.vendas > 0 && dg.top.length > 0 && dg.familias.length > 0 && dg.meios.length > 0);
  assert.ok(Math.abs(dg.vendasDia.reduce((a, b) => a + b, 0) - dg.k.vendas) < 1); assert.ok(Math.abs(dg.horas.reduce((a, b) => a + b, 0) - dg.k.vendas) < 1); assert.ok(Math.abs(dg.meios.reduce((a, b) => a + b.v, 0) - dg.k.vendas) < dg.k.vendas * 0.05);
  const dt = await call('GET', 'dash', null, { t: 'gestao', local: 'todos', dias: 7 }); assert.equal(dt.vendasDia.length, 7); assert.ok(dt.locais.length >= 2);
  const ds = await call('GET', 'dash', null, { t: 'stock', local: L, dias: 30 }); assert.ok(ds.valor > 0 && ds.itens > 0 && ds.topValor.length > 0 && ds.entradas.length === 30); assert.ok(ds.compras.v > 0); assert.ok(Array.isArray(ds.abaixo));
  const dp = await call('GET', 'dash', null, { t: 'pessoas', local: L, dias: 30 }); assert.equal(dp.meses.length, 6); assert.ok(dp.nFun > 0 && dp.massa > 0 && dp.receitas[5] > 0 && dp.bancos.length > 0);
  assert.equal((await raw('GET', 'dash', null, { t: 'xpto', local: L })).status, 400);
  await call('POST', 'demo', { acao: 'apagar' }); st = await call('GET', 'state'); assert.equal(st.bairros.length, 1);
  console.log('OK — imagens, fotografia, taxa de serviço e entregas');
})().catch((e) => { console.error(e); process.exit(1); });
