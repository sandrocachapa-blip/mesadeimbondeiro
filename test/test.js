'use strict';
const assert = require('assert');
const { PGlite } = require('@electric-sql/pglite');
const { handle } = require('../lib/core');
(async () => {
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
