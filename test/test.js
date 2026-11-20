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
  assert.equal(st.locais.length, 2); assert.equal(st.pedidos.length, 3);
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
  const oc = st.pedidos.map((p) => p.mesa_id), livre = st.mesas.find((m) => !oc.includes(m.id));
  const tot = st.pedidos[0].total + st.pedidos[1].total;
  await call('POST', 'mesas-juntar', { principal: oc[0], outras: [oc[1], livre.id] });
  st = await call('GET', 'state');
  assert.equal(st.pedidos.length, 2); assert.equal(st.pedidos.find((p) => p.mesa_id === oc[0]).total, tot);
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
  assert.equal(r.agora.contas, 3); assert.equal(r.agora.mesas, 10); assert.ok(r.agora.cozinha.linhas + r.agora.bar.linhas > 0);
  assert.ok(a.dinheiro.bancos > 0 && a.dinheiro.fornecedores > 0 && a.dinheiro.n_despesas === 1 && a.dinheiro.n_salarios === 8);
  assert.ok(r.pendentes.facturas > 0 && r.pendentes.stock_baixo >= 2 && r.pendentes.reservas === 3);
  assert.ok(a.eventos.length > 5 && a.difs.length > 0);
  const d = await call('GET', 'daf', null, { local: r.id, mes: a.mes }); assert.equal(Math.round(d.vendas), Math.round(r.mes.vendas)); assert.equal(Math.round(d.cmv), Math.round(r.mes.cmv));
  console.log('OK — administração ao vivo');
})().catch((e) => { console.error(e); process.exit(1); });
