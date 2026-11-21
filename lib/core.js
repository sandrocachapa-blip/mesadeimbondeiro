'use strict';
// Mesa de Imbondeiro — lógica do servidor (independente do driver da base de dados).
// db = { q(text, params) -> rows, tx(fn(q)) }
const crypto = require('crypto');

const uid = () => crypto.randomUUID();
class Err extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const E = (s, m) => new Err(s, m);

const PODE = {
  cfg: ['admin', 'gerente'],
  admin: ['admin'],
  pedir: ['admin', 'gerente', 'caixa', 'empregado'],
  pagar: ['admin', 'gerente', 'caixa'],
  aprovar: ['admin', 'gerente'],
};
const pode = (u, k) => PODE[k].includes(u.perfil);
const exige = (u, k) => { if (!pode(u, k)) throw E(403, 'Sem permissão para esta operação'); };

const SCHEMA = [
  `create table if not exists empresas (id text primary key, nome text not null, nif text default '', regime_iva text default 'geral', taxa_iva numeric default 14, factura_software text default '', criado_em timestamptz default now())`,
  `create table if not exists locais (id text primary key, empresa_id text not null, nome text not null, tipo text default 'restaurante', morada text default '', slug text unique not null, activo boolean default true, seq_doc int default 0)`,
  `create table if not exists utilizadores (id text primary key, empresa_id text not null, nome text not null, login text unique not null, pass_hash text not null, perfil text not null, local_id text, activo boolean default true)`,
  `create table if not exists mesas (id text primary key, local_id text not null, zona text default 'Sala', nome text not null, lugares int default 4, ordem int default 0, activo boolean default true)`,
  `create table if not exists familias (id text primary key, empresa_id text not null, nome text not null, seccao text default 'cozinha', ordem int default 0, activo boolean default true)`,
  `create table if not exists artigos (id text primary key, empresa_id text not null, familia_id text not null, nome text not null, descricao text default '', preco numeric default 0, activo boolean default true, no_menu boolean default true)`,
  `create table if not exists precos_local (artigo_id text not null, local_id text not null, preco numeric not null, primary key (artigo_id, local_id))`,
  `create table if not exists turnos (id text primary key, local_id text not null, utilizador_id text, utilizador_nome text, aberto_em timestamptz default now(), fundo numeric default 0, fechado_em timestamptz, contado jsonb, obs text default '')`,
  `create table if not exists pedidos (id text primary key, local_id text not null, mesa_id text, mesa_nome text default '', tipo text default 'mesa', estado text default 'aberto', aberto_por text, aberto_por_nome text default '', aberto_em timestamptz default now(), fechado_em timestamptz, cliente_nome text default '', cliente_nif text default '', desconto numeric default 0, total numeric default 0, turno_id text, doc_num int, sync_estado text, sync_ref text default '', anulado_motivo text default '')`,
  `create table if not exists linhas (id text primary key, pedido_id text not null, artigo_id text, nome text not null, preco numeric not null, qtd int not null, notas text default '', seccao text default 'cozinha', estado text default 'novo', criado_em timestamptz default now(), enviado_em timestamptz, pronto_em timestamptz, anulado_motivo text default '', criado_por_nome text default '')`,
  `create table if not exists pagamentos (id text primary key, pedido_id text not null, turno_id text, meio text not null, valor numeric not null, criado_em timestamptz default now(), utilizador_nome text default '')`,
  `create table if not exists mov_caixa (id text primary key, turno_id text not null, tipo text not null, valor numeric not null, motivo text default '', criado_em timestamptz default now(), utilizador_nome text default '')`,
  `create table if not exists ops_log (id text primary key, tipo text, utilizador_id text, aplicado_em timestamptz default now(), erro text)`,
  `create index if not exists linhas_pedido on linhas (pedido_id)`,
  `create index if not exists pedidos_local_estado on pedidos (local_id, estado)`,
  `create index if not exists pagamentos_pedido on pagamentos (pedido_id)`,
];

function hashPass(p) {
  const salt = crypto.randomBytes(8).toString('hex');
  return salt + ':' + crypto.scryptSync(String(p), salt, 32).toString('hex');
}
function checkPass(p, h) {
  const [salt, hex] = String(h).split(':');
  if (!salt || !hex) return false;
  const a = crypto.scryptSync(String(p), salt, 32), b = Buffer.from(hex, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function sign(env, payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return body + '.' + crypto.createHmac('sha256', env.AUTH_SECRET).update(body).digest('base64url');
}
function verify(env, token) {
  const [body, mac] = String(token || '').split('.');
  if (!body || !mac) throw E(401, 'Sessão em falta');
  const good = crypto.createHmac('sha256', env.AUTH_SECRET).update(body).digest('base64url');
  if (mac.length !== good.length || !crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(good))) throw E(401, 'Sessão inválida');
  const u = JSON.parse(Buffer.from(body, 'base64url').toString());
  if (u.exp < Date.now()) throw E(401, 'Sessão expirada');
  return u;
}

const mod = require('./mod')({ E, exige, uid, acessoLocal: (u, lid) => acessoLocal(u, lid), recalc: (q, pid) => recalc(q, pid) });
const demo = require('./demo');
const VERSAO = '12';

// Carta de vinhos e bebidas alcoólicas de exemplo (nomes genéricos e preços ilustrativos), criada uma só vez.
async function cartaVinhos(db) {
  const r = await db.q("select v from meta where k='vinhos'");
  if (r.length) return;
  const CARTA = [
    ['Vinhos tintos', [['Tinto da casa (garrafa)', 'Alentejo · 75 cl', 9500], ['Tinto da casa (jarro)', '50 cl', 6500], ['Tinto da casa (copo)', '15 cl', 3000], ['Douro tinto reserva (garrafa)', 'Douro · 75 cl', 18500], ['Dão tinto (garrafa)', 'Dão · 75 cl', 14500], ['Pinotage sul-africano (garrafa)', 'África do Sul · 75 cl', 16500]]],
    ['Vinhos brancos e rosés', [['Branco da casa (garrafa)', 'Alentejo · 75 cl', 9000], ['Branco da casa (copo)', '15 cl', 3000], ['Vinho verde (garrafa)', 'Minho · 75 cl', 11500], ['Alvarinho (garrafa)', 'Monção e Melgaço · 75 cl', 19500], ['Rosé (garrafa)', '75 cl', 12500]]],
    ['Espumantes', [['Espumante bruto (garrafa)', '75 cl', 16000], ['Espumante (copo)', '12 cl', 4500], ['Champanhe (garrafa)', '75 cl', 85000]]],
    ['Cervejas', [['Cerveja de pressão (fino)', '25 cl', 1200], ['Cerveja importada', '33 cl', 2500], ['Cerveja preta', '33 cl', 1800]]],
    ['Destilados e licores', [['Whisky novo (dose)', '5 cl', 3500], ['Whisky 12 anos (dose)', '5 cl', 6500], ['Rum (dose)', '5 cl', 3000], ['Vodka (dose)', '5 cl', 3000], ['Aguardente velha (dose)', '5 cl', 4500], ['Licor (dose)', '5 cl', 2500]]],
    ['Cocktails', [['Caipirinha', 'Cachaça, lima e açúcar', 4500], ['Mojito', 'Rum, hortelã e lima', 5000], ['Margarita', 'Tequila, triple sec e lima', 5500], ['Sangria tinta (jarro)', '1 L', 12000]]],
  ];
  await db.tx(async (q) => {
    await q(`update familias set carta='vinhos' where nome='Bar'`);
    let o = 10;
    for (const [fam, arts] of CARTA) {
      const fid = uid();
      await q(`insert into familias (id, empresa_id, nome, seccao, carta, ordem) values ($1, 'emp1', $2, 'bar', 'vinhos', $3)`, [fid, fam, o++]);
      for (const [nm, d, p] of arts) await q(`insert into artigos (id, empresa_id, familia_id, nome, descricao, preco) values ($1, 'emp1', $2, $3, $4, $5)`, [uid(), fid, nm, d, p]);
    }
    await q("insert into meta (k, v) values ('vinhos', 'criada') on conflict (k) do nothing");
  });
}

// Pratos e bebidas das fotografias carregadas: entram uma vez na carta, com preços de exemplo para acertar.
async function cartaFotos(db) {
  const r = await db.q("select v from meta where k='carta48'");
  if (r.length) return;
  const C = [
    ['Entradas', 'cozinha', 'menu', [['Croquetes de peixe', '4 unidades, com molho de coentros', 4500], ['Salada de caranguejo', 'Com abacate e tomate', 7500], ['Burrata com tomate', 'Manjericão e azeite', 8500], ['Focaccia de alecrim', 'Com azeite e azeitonas', 3500], ['Batatas com paprica', 'Em gomos, no forno', 3000], ['Asas de frango', 'Grelhadas, com molho da casa', 5500], ['Espetadas de frango', '3 unidades', 5000], ['Salada de manga', 'Folhas verdes, pepino e manga', 5500]]],
    ['Pratos', 'cozinha', 'menu', [['Camarão grelhado', 'Com manteiga de alho e limão', 22000], ['Polvo com batata', 'Grelhado, com batata a murro', 19500], ['Arroz de marisco', 'Camarão, mexilhão e lulas', 18500], ['Pizza Margherita', 'Tomate, mozzarella e manjericão', 9500], ['Tagliatelle com cogumelos', 'Molho de natas e parmesão', 11500], ['Hambúrguer clássico', 'Queijo cheddar, alface e pickles', 9000], ['Costeletas de porco', 'Lacadas na grelha', 13500]]],
    ['Sobremesas', 'cozinha', 'menu', [['Tarte de lima', '', 3500], ['Tiramisù', '', 4000], ['Brownie com gelado', 'Gelado de baunilha', 4000], ['Bolo de cenoura', 'Com cobertura de queijo creme', 3000]]],
    ['Pequeno-almoço e lanches', 'cozinha', 'menu', [['Tosta de abacate', 'Com ovo escalfado', 6500], ['Panquecas de banana', 'Com mel e nozes', 5500], ['Croissant de manteiga', '', 2000]]],
    ['Bebidas', 'bar', 'menu', [['Limonada de gengibre', '', 2000], ['Sumo de ananás', 'Natural', 2500], ['Batido de chocolate', '', 3500], ['Cappuccino', '', 1800], ['Chá frio de hibisco', '', 2000], ['Mocktail de pepino', 'Sem álcool', 3500]]],
    ['Cocktails', 'bar', 'vinhos', [['Cocktail de maracujá', '', 5500], ['Daiquiri', 'Rum, lima e açúcar', 5000], ['Spritz de laranja', '', 5500]]],
  ];
  await db.tx(async (q) => {
    for (const [fam, sec, carta, arts] of C) {
      let [f] = await q('select id from familias where nome=$1 order by ordem limit 1', [fam]);
      if (!f) { f = { id: uid() }; await q(`insert into familias (id, empresa_id, nome, seccao, carta, ordem) values ($1, 'emp1', $2, $3, $4, 3)`, [f.id, fam, sec, carta]); }
      for (const [nm, d, p] of arts) await q(`insert into artigos (id, empresa_id, familia_id, nome, descricao, preco) select $1, 'emp1', $2, $3, $4, $5 where not exists (select 1 from artigos where nome=$3)`, [uid(), f.id, nm, d, p]);
    }
    await q(`update locais set imagem = case when id like 'demo-%' then '/foto/rooftop-ao-anoitecer.jpg' else '/foto/esplanada.jpg' end where imagem is null`);
    await q("insert into meta (k, v) values ('carta48', 'criada') on conflict (k) do nothing");
  });
}
async function autoDemo(db, env) {
  if (env.DEMO_AUTO !== '1') return;
  const r = await db.q("select v from meta where k='demo'");
  if (!r.length) await demo.carregar(db).catch((e) => console.error('demo', e));
}

let pronto = null;
async function ensure(db, env) {
  if (pronto) return pronto;
  pronto = (async () => {
    let actual = '';
    try { const r = await db.q("select v from meta where k='schema'"); actual = r[0] ? r[0].v : ''; } catch (e) {}
    if (actual !== VERSAO) {
      for (const s of SCHEMA.concat(mod.SCHEMA2)) await db.q(s);
      await db.q("insert into meta (k, v) values ('schema', $1) on conflict (k) do update set v=excluded.v", [VERSAO]);
    }
    const [{ n }] = await db.q('select count(*)::int as n from empresas');
    if (n > 0) { await cartaVinhos(db); await cartaFotos(db); await imagens(db); return autoDemo(db, env); }
    await db.tx(async (q) => {
      await q(`insert into empresas (id, nome) values ('emp1', 'Mesa de Imbondeiro')`);
      await q(`insert into locais (id, empresa_id, nome, tipo, slug) values ('loc1', 'emp1', 'Restaurante Principal', 'restaurante', 'principal')`);
      await q(`insert into utilizadores (id, empresa_id, nome, login, pass_hash, perfil) values ($1, 'emp1', 'Administrador', 'admin', $2, 'admin')`, [uid(), hashPass(env.ADMIN_PASSWORD || 'imbondeiro')]);
      const mesas = [['Sala', 'Mesa 1', 4], ['Sala', 'Mesa 2', 4], ['Sala', 'Mesa 3', 2], ['Sala', 'Mesa 4', 6], ['Sala', 'Mesa 5', 4], ['Sala', 'Mesa 6', 8], ['Esplanada', 'Esplanada 1', 4], ['Esplanada', 'Esplanada 2', 4], ['Bar', 'Balcão 1', 2], ['Bar', 'Balcão 2', 2]];
      let i = 0;
      for (const [z, nm, l] of mesas) await q(`insert into mesas (id, local_id, zona, nome, lugares, ordem) values ($1, 'loc1', $2, $3, $4, $5)`, [uid(), z, nm, l, i++]);
      // Carta de exemplo: nomes e preços ilustrativos, para substituir pela carta real.
      const carta = [
        ['Entradas', 'cozinha', [['Kitaba', 'Pasta de ginguba torrada com jindungo', 2500], ['Chamuças de carne', '4 unidades', 3500]]],
        ['Pratos', 'cozinha', [['Mufete', 'Peixe grelhado, feijão de óleo de palma, banana e mandioca', 14500], ['Moamba de galinha', 'Com funge de bombó', 12000], ['Calulu de peixe', 'Peixe seco e fresco, quiabos e jimboa', 13000], ['Bife à casa', 'Com batata frita e ovo', 15500]]],
        ['Sobremesas', 'cozinha', [['Cocada amarela', '', 3000], ['Mousse de múcua', 'Fruto do imbondeiro', 3500]]],
        ['Bebidas', 'bar', [['Água 0,5 L', '', 800], ['Refrigerante', '', 1200], ['Sumo natural de múcua', '', 2500], ['Café', '', 1000]]],
        ['Bar', 'bar', [['Cerveja nacional', '', 1500], ['Gin tónico', '', 5500], ['Vinho da casa (copo)', '', 3500]]],
      ];
      let o = 0;
      for (const [fam, sec, arts] of carta) {
        const fid = uid();
        await q(`insert into familias (id, empresa_id, nome, seccao, ordem) values ($1, 'emp1', $2, $3, $4)`, [fid, fam, sec, o++]);
        for (const [nm, d, p] of arts) await q(`insert into artigos (id, empresa_id, familia_id, nome, descricao, preco) values ($1, 'emp1', $2, $3, $4, $5)`, [uid(), fid, nm, d, p]);
      }
    });
    await cartaVinhos(db);
    await cartaFotos(db);
    await imagens(db);
    await autoDemo(db, env);
  })().catch((e) => { pronto = null; throw e; });
  return pronto;
}

const tsOk = (t) => { const d = new Date(t); return (isNaN(d) || d.getTime() > Date.now() + 60000) ? new Date().toISOString() : d.toISOString(); };
const acessoLocal = (u, lid) => { if (u.local_id && u.local_id !== lid) throw E(403, 'Sem acesso a este local'); };

async function pedidoAberto(q, u, id) {
  const [p] = await q('select id, local_id, estado, total::float8 as total, desconto::float8 as desconto from pedidos where id=$1', [id]);
  if (!p) throw E(404, 'Conta não encontrada');
  acessoLocal(u, p.local_id);
  if (p.estado !== 'aberto') throw E(409, 'A conta já está fechada');
  return p;
}
// Total da conta. Nos take-away junta sozinho a linha da embalagem (preço e regra em Configuração → Empresa).
async function recalc(q, pid) {
  const [p] = await q('select tipo, estado, coalesce(taxa_entrega, 0)::float8 as taxa_entrega, coalesce(bairro, $$$$) as bairro from pedidos where id=$1', [pid]);
  if (p && p.estado === 'aberto') {
    const eid = pid + '-emb', tid = pid + '-ent', sid = pid + '-srv';
    const [e] = await q('select coalesce(emb_preco, 0)::float8 as preco, coalesce(emb_modo, $$prato$$) as modo, coalesce(taxa_servico, 0)::float8 as srv from empresas limit 1');
    const auto = async (id, nome, sec, preco, n) => {
      if (n > 0 && preco > 0) await q(`insert into linhas (id, pedido_id, nome, preco, qtd, seccao, estado, criado_por_nome) values ($1, $2, $3, $4, $5, $6, 'entregue', 'Automático')
        on conflict (id) do update set qtd = excluded.qtd, preco = excluded.preco, nome = excluded.nome where linhas.estado <> 'anulado'`, [id, pid, nome, preco, n, sec]);
      else await q(`delete from linhas where id=$1 and estado<>'anulado'`, [id]);
    };
    const [c] = await q(`select coalesce(sum(case when seccao='cozinha' then qtd else 0 end), 0)::int as pratos, count(*)::int as linhas, coalesce(sum(preco*qtd), 0)::float8 as soma from linhas where pedido_id=$1 and estado<>'anulado' and id not in ($2, $3, $4)`, [pid, eid, tid, sid]);
    const fora = p.tipo === 'takeaway' || p.tipo === 'entrega';
    await auto(eid, 'Embalagem take-away', 'embalagem', (e && e.preco) || 0, fora ? (e.modo === 'pedido' ? (c.linhas ? 1 : 0) : c.pratos) : 0);
    await auto(tid, 'Taxa de entrega' + (p.bairro ? ' · ' + p.bairro : ''), 'entrega', p.taxa_entrega, p.tipo === 'entrega' && c.linhas ? 1 : 0);
    await auto(sid, 'Taxa de serviço (' + ((e && e.srv) || 0) + '%)', 'servico', Math.round(c.soma * ((e && e.srv) || 0) / 100), p.tipo === 'mesa' && c.linhas ? 1 : 0);
  }
  return q(`update pedidos set total = greatest(0, coalesce((select sum(preco*qtd) from linhas where pedido_id=$1 and estado<>'anulado'),0) - desconto) where id=$1`, [pid]);
}
// Imagem de cada artigo: ilustração da casa pelo nome; a fotografia carregada em Configuração tem prioridade.
const BANCO = require('./imagens.json'), IMGS = new Set(BANCO.img), FOTOS = new Set(BANCO.foto), CAPAS = BANCO.capa.map((c) => '/foto/' + c + '.jpg');
const FOTO_DE = { 'moamba-de-galinha': 'muamba-de-galinha-com-funge', mufete: 'peixe-grelhado-com-banana-pao', 'cocada-amarela': 'cocada', 'sumo-natural-de-mucua': 'sumo-de-mucua', kitaba: 'ginguba-torrada', cafe: 'espresso', caipirinha: 'caipirinha-de-lima', 'cerveja-de-pressao-fino': 'cerveja-a-pressao', 'branco-da-casa-copo': 'vinho-branco' };
const slugImg = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const imgDe = (nome) => { const s = slugImg(nome), f = FOTO_DE[s] || s; return FOTOS.has(f) ? '/foto/' + f + '.jpg' : IMGS.has(s) ? '/img/' + s + '.png' : ''; };
// As fotografias da casa têm prioridade sobre as ilustrações; a fotografia carregada à mão (em /api/foto) nunca é trocada.
async function imagens(db) {
  const rows = await db.q(`select id, nome, imagem from artigos where imagem is null or imagem = '' or imagem like '/img/%'`);
  for (const a of rows) { const v = imgDe(a.nome); if (v !== a.imagem) await db.q('update artigos set imagem=$2 where id=$1', [a.id, v]); }
}
async function fotoGet(db, id) {
  const [f] = await db.q('select mime, dados from fotos where artigo_id=$1', [id]);
  if (!f) throw E(404, 'Sem fotografia');
  return { status: 200, bin: Buffer.from(f.dados, 'base64'), mime: f.mime };
}
async function fotoPost(db, b) {
  const [a] = await db.q('select id from artigos where id=$1', [b.artigo_id]);
  if (!a) throw E(404, 'Artigo não encontrado');
  if (b.remover) { await db.q('delete from fotos where artigo_id=$1', [a.id]); await db.q('update artigos set imagem=null where id=$1', [a.id]); await imagens(db); return { ok: true }; }
  const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(b.dados || ''));
  if (!m) throw E(400, 'Fotografia inválida: use JPG, PNG ou WebP');
  if (m[2].length > 700000) throw E(413, 'Fotografia demasiado grande');
  await db.q('insert into fotos (artigo_id, mime, dados) values ($1,$2,$3) on conflict (artigo_id) do update set mime=excluded.mime, dados=excluded.dados', [a.id, m[1], m[2]]);
  const imagem = '/api/foto?a=' + a.id + '&v=' + Date.now().toString(36);
  await db.q('update artigos set imagem=$2 where id=$1', [a.id, imagem]);
  return { ok: true, imagem };
}
async function turnoAberto(q, lid) {
  const [t] = await q('select id from turnos where local_id=$1 and fechado_em is null', [lid]);
  return t || null;
}
async function mesaLivre(q, mesa_id, excepto) {
  let [m] = await q('select id, nome, local_id, junta_a from mesas where id=$1', [mesa_id]);
  if (!m) throw E(404, 'Mesa não encontrada');
  if (m.junta_a) { const [pr] = await q('select id, nome, local_id from mesas where id=$1', [m.junta_a]); if (pr) m = pr; }
  const oc = await q(`select id from pedidos where mesa_id=$1 and estado='aberto' and id<>$2`, [m.id, excepto || '']);
  if (oc.length) throw E(409, m.nome + ' já tem uma conta aberta');
  return m;
}

async function applyOp(q, u, op) {
  const d = op.d || {}, t = tsOk(op.ts);
  switch (op.tipo) {
    case 'pedido.abrir': {
      exige(u, 'pedir'); acessoLocal(u, d.local_id);
      const tp = d.mesa_id ? 'mesa' : (['takeaway', 'entrega'].includes(d.tipo) ? d.tipo : 'balcao'), ent = tp === 'entrega';
      if (ent && !String(d.cliente_nome || '').trim()) throw E(400, 'Indique o nome do cliente da entrega');
      let mesaNome = ent ? 'Entrega · ' + String(d.cliente_nome).trim().slice(0, 40) : tp === 'takeaway' ? 'Take-away' : 'Balcão';
      if (d.mesa_id) { const m = await mesaLivre(q, d.mesa_id); mesaNome = m.nome; d.mesa_id = m.id; }
      await q(`insert into pedidos (id, local_id, mesa_id, mesa_nome, tipo, aberto_por, aberto_por_nome, aberto_em, cliente_nome, cliente_tel, morada, bairro, taxa_entrega, entrega_estado) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
        [d.id, d.local_id, d.mesa_id || null, mesaNome, tp, u.id, u.nome, t, String(d.cliente_nome || '').slice(0, 80), ent ? String(d.cliente_tel || '').slice(0, 30) : '', ent ? String(d.morada || '').slice(0, 200) : '', ent ? String(d.bairro || '').slice(0, 60) : '', ent ? Math.max(0, Number(d.taxa_entrega) || 0) : 0, ent ? 'preparar' : '']);
      return;
    }
    case 'pedido.cliente': {
      exige(u, 'pedir');
      const p = await pedidoAberto(q, u, d.pedido_id);
      await q('update pedidos set cliente_nome=$2, cliente_nif=$3 where id=$1', [p.id, String(d.cliente_nome || '').slice(0, 80), String(d.cliente_nif || '').slice(0, 20)]);
      return;
    }
    case 'entrega.estado': {
      exige(u, 'pedir');
      const p = await pedidoAberto(q, u, d.pedido_id);
      if (!['preparar', 'caminho', 'entregue'].includes(d.estado)) throw E(400, 'Estado inválido');
      await q('update pedidos set entrega_estado=$2, estafeta=coalesce($3, estafeta) where id=$1', [p.id, d.estado, d.estafeta == null ? null : String(d.estafeta).slice(0, 60)]);
      return;
    }
    case 'linha.add': {
      exige(u, 'pedir');
      const p = await pedidoAberto(q, u, d.pedido_id);
      const [a] = await q(`select a.nome, coalesce(pl.preco, a.preco)::float8 as preco, f.seccao from artigos a join familias f on f.id=a.familia_id left join precos_local pl on pl.artigo_id=a.id and pl.local_id=$2 where a.id=$1`, [d.artigo_id, p.local_id]);
      if (!a) throw E(404, 'Artigo não encontrado');
      if ((await q('select 1 from indisponiveis where artigo_id=$1 and local_id=$2', [d.artigo_id, p.local_id])).length) throw E(409, a.nome + ' está temporariamente indisponível');
      await q(`insert into linhas (id, pedido_id, artigo_id, nome, preco, qtd, notas, seccao, criado_em, criado_por_nome) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [d.id, p.id, d.artigo_id, a.nome, a.preco, Math.max(1, parseInt(d.qtd) || 1), d.notas || '', a.seccao, t, u.nome]);
      return recalc(q, p.id);
    }
    case 'linha.qtd': {
      exige(u, 'pedir');
      const [l] = await q('select id, pedido_id, estado from linhas where id=$1', [d.id]);
      if (!l) return;
      await pedidoAberto(q, u, l.pedido_id);
      if (l.estado !== 'novo') throw E(409, 'Linha já enviada: só pode ser anulada');
      const n = parseInt(d.qtd) || 0;
      if (n <= 0) await q('delete from linhas where id=$1', [l.id]);
      else await q('update linhas set qtd=$2, notas=coalesce($3, notas) where id=$1', [l.id, n, d.notas == null ? null : d.notas]);
      return recalc(q, l.pedido_id);
    }
    case 'linha.anular': {
      exige(u, 'aprovar');
      const [l] = await q('select id, pedido_id from linhas where id=$1', [d.id]);
      if (!l) throw E(404, 'Linha não encontrada');
      await pedidoAberto(q, u, l.pedido_id);
      await q(`update linhas set estado='anulado', anulado_motivo=$2 where id=$1`, [l.id, (d.motivo || '') + ' — ' + u.nome]);
      return recalc(q, l.pedido_id);
    }
    case 'pedido.enviar': {
      exige(u, 'pedir');
      const p = await pedidoAberto(q, u, d.pedido_id);
      return q(`update linhas set estado='enviado', enviado_em=$2 where pedido_id=$1 and estado='novo'`, [p.id, t]);
    }
    case 'linha.estado': {
      if (!['preparar', 'pronto', 'entregue'].includes(d.estado)) throw E(400, 'Estado inválido');
      await q(`update linhas set estado=$2, pronto_em = case when $2='pronto' then $3::timestamptz else pronto_em end where id=$1 and estado in ('enviado','preparar','pronto')`, [d.id, d.estado, t]);
      if (d.estado !== 'preparar') await mod.aoValidar(q, d.id, t, u.nome); // a saída validada baixa o stock
      return;
    }
    case 'pedido.desconto': {
      exige(u, 'aprovar');
      const p = await pedidoAberto(q, u, d.pedido_id);
      await q('update pedidos set desconto=$2 where id=$1', [p.id, Math.max(0, Number(d.valor) || 0)]);
      return recalc(q, p.id);
    }
    case 'pedido.transferir': {
      exige(u, 'pedir');
      const p = await pedidoAberto(q, u, d.pedido_id);
      const m = await mesaLivre(q, d.mesa_id, p.id);
      await q(`update pedidos set mesa_id=$2, mesa_nome=$3, tipo='mesa' where id=$1`, [p.id, m.id, m.nome]);
      return recalc(q, p.id);
    }
    case 'pagamento.add': {
      exige(u, 'pagar');
      const p = await pedidoAberto(q, u, d.pedido_id);
      const tn = await turnoAberto(q, p.local_id);
      if (!tn) throw E(409, 'Abra a caixa antes de receber pagamentos');
      const v = Number(d.valor) || 0;
      if (v <= 0) throw E(400, 'Valor inválido');
      return q(`insert into pagamentos (id, pedido_id, turno_id, meio, valor, criado_em, utilizador_nome) values ($1,$2,$3,$4,$5,$6,$7)`, [d.id, p.id, tn.id, d.meio, v, t, u.nome]);
    }
    case 'pagamento.remover': {
      exige(u, 'pagar');
      const [pg] = await q('select id, pedido_id from pagamentos where id=$1', [d.id]);
      if (!pg) return;
      await pedidoAberto(q, u, pg.pedido_id);
      return q('delete from pagamentos where id=$1', [pg.id]);
    }
    case 'pedido.fechar': {
      exige(u, 'pagar');
      const p = await pedidoAberto(q, u, d.pedido_id);
      await q(`update linhas set estado='enviado', enviado_em=$2 where pedido_id=$1 and estado='novo'`, [p.id, t]);
      await recalc(q, p.id);
      const [{ total }] = await q('select total::float8 as total from pedidos where id=$1', [p.id]);
      const [{ pago }] = await q('select coalesce(sum(valor),0)::float8 as pago from pagamentos where pedido_id=$1', [p.id]);
      if (pago + 0.005 < total) throw E(409, 'Falta receber ' + (total - pago).toFixed(2) + ' Kz');
      const tn = await turnoAberto(q, p.local_id);
      const [{ seq_doc }] = await q('update locais set seq_doc=seq_doc+1 where id=$1 returning seq_doc', [p.local_id]);
      await q(`update pedidos set estado='fechado', fechado_em=$2, doc_num=$3, turno_id=$4, sync_estado='pendente', cliente_nome=$5, cliente_nif=$6 where id=$1`,
        [p.id, t, seq_doc, tn ? tn.id : null, d.cliente_nome || '', d.cliente_nif || '']);
      return mod.aoFechar(q, p.id, p.local_id, t, u.nome);
    }
    case 'pedido.anular': {
      exige(u, 'aprovar');
      const p = await pedidoAberto(q, u, d.pedido_id);
      const pg = await q('select id from pagamentos where pedido_id=$1', [p.id]);
      if (pg.length) throw E(409, 'Remova os pagamentos antes de anular a conta');
      return q(`update pedidos set estado='anulado', fechado_em=$2, anulado_motivo=$3 where id=$1`, [p.id, t, (d.motivo || '') + ' — ' + u.nome]);
    }
    case 'turno.abrir': {
      exige(u, 'pagar'); acessoLocal(u, d.local_id);
      if (await turnoAberto(q, d.local_id)) throw E(409, 'Já existe uma caixa aberta neste local');
      return q('insert into turnos (id, local_id, utilizador_id, utilizador_nome, aberto_em, fundo) values ($1,$2,$3,$4,$5,$6)', [d.id, d.local_id, u.id, u.nome, t, Number(d.fundo) || 0]);
    }
    case 'turno.fechar': {
      exige(u, 'pagar');
      const [tn] = await q('select id, local_id from turnos where id=$1 and fechado_em is null', [d.id]);
      if (!tn) throw E(409, 'Caixa já fechada');
      acessoLocal(u, tn.local_id);
      return q('update turnos set fechado_em=$2, contado=$3::jsonb, obs=$4 where id=$1', [tn.id, t, JSON.stringify(d.contado || {}), d.obs || '']);
    }
    case 'caixa.mov': {
      exige(u, 'pagar');
      const [tn] = await q('select id from turnos where id=$1 and fechado_em is null', [d.turno_id]);
      if (!tn) throw E(409, 'Caixa fechada');
      if (!['sangria', 'reforco'].includes(d.tipo)) throw E(400, 'Tipo inválido');
      return q('insert into mov_caixa (id, turno_id, tipo, valor, motivo, criado_em, utilizador_nome) values ($1,$2,$3,$4,$5,$6,$7)', [d.id, tn.id, d.tipo, Math.abs(Number(d.valor) || 0), d.motivo || '', t, u.nome]);
    }
    default: throw E(400, 'Operação desconhecida: ' + op.tipo);
  }
}

async function runOps(db, u, ops) {
  const out = [];
  for (const op of ops || []) {
    if (!op || !op.id) continue;
    try {
      const r = await db.tx(async (q) => {
        const ins = await q('insert into ops_log (id, tipo, utilizador_id) values ($1,$2,$3) on conflict (id) do nothing returning id', [op.id, op.tipo, u.id]);
        if (!ins.length) return 'dup';
        await applyOp(q, u, op);
        return 'ok';
      });
      out.push({ id: op.id, ok: true, dup: r === 'dup' });
    } catch (e) {
      if (!e.status) console.error('op', op.tipo, e);
      await db.q('insert into ops_log (id, tipo, utilizador_id, erro) values ($1,$2,$3,$4) on conflict (id) do nothing', [op.id, op.tipo, u.id, e.message]).catch(() => {});
      out.push({ id: op.id, ok: false, erro: e.status ? e.message : 'Erro interno ao aplicar a operação' });
    }
  }
  return out;
}

async function estado(db, u, lid) {
  const locais = await db.q(`select id, nome, tipo, slug from locais where activo and ($1::text is null or id=$1) order by (id like 'demo-%'), nome`, [u.local_id || null]);
  if (!locais.length) throw E(404, 'Sem locais disponíveis');
  const local = locais.find((l) => l.id === lid) || locais[0];
  const [empresa] = await db.q('select nome, nif, regime_iva, taxa_iva::float8 as taxa_iva, factura_software, coalesce(inss_taxa,3)::float8 as inss_taxa, coalesce(tema, $$classico$$) as tema, coalesce(obs_cozinha, $$$$) as obs_cozinha, coalesce(obs_bar, $$$$) as obs_bar, coalesce(emb_preco, 0)::float8 as emb_preco, coalesce(emb_modo, $$prato$$) as emb_modo, coalesce(taxa_servico, 0)::float8 as taxa_servico from empresas limit 1');
  const [mesas, familias, artigos, pedidos, linhas, pagamentos, turno] = await Promise.all([
    db.q('select id, zona, nome, lugares, x::float8 as x, y::float8 as y, forma, junta_a from mesas where local_id=$1 and activo order by ordem, nome', [local.id]),
    db.q(`select id, nome, seccao, coalesce(carta, 'menu') as carta from familias where activo order by ordem, nome`),
    db.q(`select a.id, a.familia_id, a.nome, a.descricao, coalesce(a.imagem, '') as imagem, coalesce(a.favorito, false) as favorito, coalesce(pl.preco, a.preco)::float8 as preco, exists (select 1 from indisponiveis x where x.artigo_id=a.id and x.local_id=$1) as fora from artigos a left join precos_local pl on pl.artigo_id=a.id and pl.local_id=$1 where a.activo order by a.nome`, [local.id]),
    db.q(`select id, mesa_id, mesa_nome, tipo, aberto_por_nome, aberto_em, cliente_nome, coalesce(cliente_nif, '') as cliente_nif, coalesce(cliente_tel, '') as cliente_tel, coalesce(morada, '') as morada, coalesce(bairro, '') as bairro, coalesce(taxa_entrega, 0)::float8 as taxa_entrega, coalesce(estafeta, '') as estafeta, coalesce(entrega_estado, '') as entrega_estado, desconto::float8 as desconto, total::float8 as total from pedidos where local_id=$1 and estado='aberto' order by aberto_em`, [local.id]),
    db.q(`select l.id, l.pedido_id, l.artigo_id, l.nome, l.preco::float8 as preco, l.qtd, l.notas, l.seccao, l.estado, l.enviado_em, l.criado_em, l.criado_por_nome from linhas l join pedidos p on p.id=l.pedido_id where p.local_id=$1 and p.estado='aberto' order by l.criado_em`, [local.id]),
    db.q(`select g.id, g.pedido_id, g.meio, g.valor::float8 as valor from pagamentos g join pedidos p on p.id=g.pedido_id where p.local_id=$1 and p.estado='aberto' order by g.criado_em`, [local.id]),
    db.q('select id, utilizador_nome, aberto_em, fundo::float8 as fundo from turnos where local_id=$1 and fechado_em is null', [local.id]),
  ]);
  for (const p of pedidos) { p.linhas = linhas.filter((l) => l.pedido_id === p.id); p.pagamentos = pagamentos.filter((g) => g.pedido_id === p.id); }
  const reservas = await db.q(`select id, local_id, cliente_nome, telefone, dia, hora, pessoas::int as pessoas, mesa_id, estado, notas from reservas where local_id=$1 and dia=$2 and estado in ('confirmada','pendente') order by hora`, [local.id, new Date(Date.now() + 3600e3).toISOString().slice(0, 10)]).catch(() => []);
  const bairros = await db.q('select id, nome, taxa::float8 as taxa from bairros where activo order by nome').catch(() => []);
  return { empresa, locais, local, mesas, familias, artigos, pedidos, reservas, bairros, turno: turno[0] || null, agora: new Date().toISOString() };
}

async function turnoResumo(db, u, lid) {
  const [tn] = await db.q('select id, local_id, utilizador_nome, aberto_em, fundo::float8 as fundo from turnos where local_id=$1 and fechado_em is null', [lid]);
  const ultimos = await db.q(`select id, utilizador_nome, aberto_em, fechado_em, fundo::float8 as fundo, contado, obs from turnos where local_id=$1 and fechado_em is not null order by fechado_em desc limit 10`, [lid]);
  if (!tn) return { turno: null, ultimos };
  const porMeio = await db.q('select meio, sum(valor)::float8 as valor, count(*)::int as n from pagamentos where turno_id=$1 group by meio order by meio', [tn.id]);
  const movs = await db.q('select id, tipo, valor::float8 as valor, motivo, criado_em, utilizador_nome from mov_caixa where turno_id=$1 order by criado_em', [tn.id]);
  const [{ n: abertas }] = await db.q(`select count(*)::int as n from pedidos where local_id=$1 and estado='aberto'`, [lid]);
  return { turno: tn, porMeio, movs, abertas, ultimos };
}

async function relatorio(db, u, lid, de, ate) {
  const dia = `((p.fechado_em at time zone 'UTC') + interval '1 hour')`;
  const filtro = `p.local_id=$1 and p.estado='fechado' and ${dia}::date between $2::date and $3::date`;
  const a = [lid, de, ate];
  const [resumo] = await db.q(`select count(*)::int as contas, coalesce(sum(total),0)::float8 as vendas, coalesce(sum(desconto),0)::float8 as descontos from pedidos p where ${filtro}`, a);
  const porMeio = await db.q(`select g.meio, sum(g.valor)::float8 as valor from pagamentos g join pedidos p on p.id=g.pedido_id where ${filtro} group by g.meio order by 2 desc`, a);
  const porArtigo = await db.q(`select l.nome, sum(l.qtd)::int as qtd, sum(l.qtd*l.preco)::float8 as valor from linhas l join pedidos p on p.id=l.pedido_id where ${filtro} and l.estado<>'anulado' group by l.nome order by 3 desc limit 50`, a);
  const porHora = await db.q(`select extract(hour from ${dia})::int as hora, sum(total)::float8 as valor, count(*)::int as contas from pedidos p where ${filtro} group by 1 order by 1`, a);
  const porDia = await db.q(`select to_char(${dia}::date, 'YYYY-MM-DD') as dia, sum(total)::float8 as valor, count(*)::int as contas from pedidos p where ${filtro} group by 1 order by 1`, a);
  const porEmpregado = await db.q(`select aberto_por_nome as nome, sum(total)::float8 as valor, count(*)::int as contas from pedidos p where ${filtro} group by 1 order by 2 desc`, a);
  const [anul] = await db.q(`select count(*)::int as n, coalesce(sum(l.qtd*l.preco),0)::float8 as valor from linhas l join pedidos p on p.id=l.pedido_id where p.local_id=$1 and l.estado='anulado' and ((l.criado_em at time zone 'UTC') + interval '1 hour')::date between $2::date and $3::date`, a);
  return { resumo, porMeio, porArtigo, porHora, porDia, porEmpregado, anulacoes: anul };
}

async function facturacao(db, u, lid) {
  const docs = await db.q(`select p.id, p.doc_num, p.mesa_nome, p.fechado_em, p.cliente_nome, p.cliente_nif, p.total::float8 as total, p.desconto::float8 as desconto, p.sync_estado, p.sync_ref from pedidos p where p.local_id=$1 and p.estado='fechado' order by p.fechado_em desc limit 300`, [lid]);
  if (!docs.length) return { docs };
  const ids = docs.map((d) => d.id);
  const ls = await db.q(`select pedido_id, nome, qtd, preco::float8 as preco from linhas where pedido_id = any($1) and estado<>'anulado'`, [ids]);
  const pg = await db.q(`select pedido_id, meio, valor::float8 as valor from pagamentos where pedido_id = any($1)`, [ids]);
  for (const d of docs) { d.linhas = ls.filter((l) => l.pedido_id === d.id); d.pagamentos = pg.filter((g) => g.pedido_id === d.id); }
  return { docs };
}

async function menuPublico(db, slug, mesaId) {
  const [local] = await db.q('select id, nome, morada, coalesce(imagem, $$$$) as imagem from locais where slug=$1 and activo', [slug || 'principal']);
  if (!local) throw E(404, 'Menu não encontrado');
  const [empresa] = await db.q(`select nome, coalesce(tema, 'classico') as tema, coalesce(taxa_servico, 0)::float8 as taxa_servico from empresas limit 1`);
  const fams = await db.q(`select id, nome, seccao, coalesce(carta, 'menu') as carta from familias where activo order by ordem, nome`);
  const arts = await db.q(`select a.id, a.familia_id, a.nome, a.descricao, coalesce(a.imagem, '') as imagem, coalesce(pl.preco, a.preco)::float8 as preco from artigos a left join precos_local pl on pl.artigo_id=a.id and pl.local_id=$1 where a.activo and a.no_menu and not exists (select 1 from indisponiveis x where x.artigo_id=a.id and x.local_id=$1) order by a.nome`, [local.id]);
  let mesa = null;
  if (mesaId) { const [m] = await db.q('select id, nome from mesas where id=$1 and local_id=$2 and activo', [mesaId, local.id]); mesa = m || null; }
  return { empresa: empresa.nome, tema: empresa.tema, taxa_servico: empresa.taxa_servico, capa: local.imagem, local: local.nome, morada: local.morada, mesa, familias: fams.map((f) => ({ nome: f.nome, carta: f.carta, seccao: f.seccao, artigos: arts.filter((a) => a.familia_id === f.id) })).filter((f) => f.artigos.length) };
}

const CFG = {
  locais: ['nome', 'tipo', 'morada', 'slug', 'imagem', 'activo'],
  mesas: ['local_id', 'zona', 'nome', 'lugares', 'ordem', 'activo'],
  familias: ['nome', 'seccao', 'carta', 'ordem', 'activo'],
  artigos: ['familia_id', 'nome', 'descricao', 'preco', 'activo', 'no_menu', 'favorito'],
  utilizadores: ['nome', 'login', 'perfil', 'local_id', 'activo'],
};
const PERFIS = ['admin', 'gerente', 'caixa', 'empregado', 'cozinha', 'bar'];

async function cfgGet(db) {
  const [empresa] = await db.q('select id, nome, nif, regime_iva, taxa_iva::float8 as taxa_iva, factura_software, coalesce(inss_taxa,3)::float8 as inss_taxa, coalesce(tema, $$classico$$) as tema, coalesce(obs_cozinha, $$$$) as obs_cozinha, coalesce(obs_bar, $$$$) as obs_bar, coalesce(emb_preco, 0)::float8 as emb_preco, coalesce(emb_modo, $$prato$$) as emb_modo, coalesce(taxa_servico, 0)::float8 as taxa_servico from empresas limit 1');
  const [locais, mesas, familias, artigos, utilizadores, precos] = await Promise.all([
    db.q('select id, nome, tipo, morada, slug, coalesce(imagem, $$$$) as imagem, activo from locais order by nome'),
    db.q('select id, local_id, zona, nome, lugares, ordem, activo from mesas order by ordem, nome'),
    db.q(`select id, nome, seccao, coalesce(carta, 'menu') as carta, ordem, activo from familias order by ordem, nome`),
    db.q('select a.id, a.familia_id, a.nome, a.descricao, a.preco::float8 as preco, a.activo, a.no_menu, coalesce(a.favorito, false) as favorito, coalesce(a.imagem, $$$$) as imagem, exists (select 1 from linhas l where l.artigo_id = a.id) as vendido from artigos a order by a.nome'),
    db.q('select id, nome, login, perfil, local_id, activo from utilizadores order by nome'),
    db.q('select artigo_id, local_id, preco::float8 as preco from precos_local'),
  ]);
  return { empresa, locais, mesas, familias, artigos, utilizadores, precos };
}

async function cfgSave(db, u, b) {
  const ent = b.entidade, r = b.linha || {};
  if (b.apagar) {
    if (ent === 'artigos') {
      const [v] = await db.q('select 1 as x from linhas where artigo_id=$1 limit 1', [b.apagar]);
      if (v) throw E(409, 'Este artigo já tem vendas registadas: desactive-o em vez de o apagar, para o histórico ficar certo');
      await db.tx(async (q) => { for (const t of ['fichas', 'precos_local', 'indisponiveis', 'fotos']) await q(`delete from ${t} where artigo_id=$1`, [b.apagar]); await q('delete from artigos where id=$1', [b.apagar]); });
      return { ok: true };
    }
    if (ent === 'familias') {
      const [v] = await db.q('select count(*)::int as n from artigos where familia_id=$1', [b.apagar]);
      if (v.n) throw E(409, 'Esta família ainda tem ' + v.n + ' artigo(s): mude-os de família ou apague-os primeiro');
      await db.q('delete from familias where id=$1', [b.apagar]);
      return { ok: true };
    }
    throw E(400, 'Este registo não pode ser apagado; desactive-o');
  }
  if (ent === 'precos_lote') {
    const pct = Number(r.pct), arr = [1, 10, 50, 100, 500].includes(Number(r.arredondar)) ? Number(r.arredondar) : 50;
    if (!pct || pct < -90 || pct > 300) throw E(400, 'Indique a percentagem (entre -90 e 300)');
    const rows = await db.q('update artigos set preco = greatest(0, round(preco * (1 + $1::numeric / 100) / $2) * $2) where ($3::text is null or familia_id = $3) and activo returning id', [pct, arr, r.familia_id || null]);
    return { ok: true, n: rows.length };
  }
  if (ent === 'empresa') {
    exige(u, 'admin');
    await db.q('update empresas set nome=$1, nif=$2, regime_iva=$3, taxa_iva=$4, factura_software=$5, inss_taxa=$6, tema=$7, obs_cozinha=$8, obs_bar=$9, emb_preco=$10, emb_modo=$11, taxa_servico=$12', [r.nome || 'Mesa de Imbondeiro', r.nif || '', r.regime_iva || 'geral', Number(r.taxa_iva) || 0, r.factura_software || '', r.inss_taxa === '' || r.inss_taxa == null ? 3 : Number(r.inss_taxa), r.tema === 'luxo' ? 'luxo' : 'classico', String(r.obs_cozinha || '').slice(0, 600), String(r.obs_bar || '').slice(0, 600), Math.max(0, Number(r.emb_preco) || 0), r.emb_modo === 'pedido' ? 'pedido' : 'prato', Math.min(30, Math.max(0, Number(r.taxa_servico) || 0))]);
    return { ok: true };
  }
  if (ent === 'preco_local') {
    if (r.preco === '' || r.preco == null) await db.q('delete from precos_local where artigo_id=$1 and local_id=$2', [r.artigo_id, r.local_id]);
    else await db.q('insert into precos_local (artigo_id, local_id, preco) values ($1,$2,$3) on conflict (artigo_id, local_id) do update set preco=excluded.preco', [r.artigo_id, r.local_id, Number(r.preco) || 0]);
    return { ok: true };
  }
  const cols = CFG[ent];
  if (!cols) throw E(400, 'Entidade desconhecida');
  if (ent === 'locais' || ent === 'utilizadores') exige(u, 'admin');
  if (ent === 'utilizadores') {
    if (!PERFIS.includes(r.perfil)) throw E(400, 'Perfil inválido');
    r.login = String(r.login || '').trim().toLowerCase();
    if (!r.login) throw E(400, 'Indique o nome de utilizador');
    r.local_id = r.local_id || null;
  }
  if (ent === 'locais') r.imagem = CAPAS.includes(r.imagem) ? r.imagem : '';
  if (ent === 'locais') r.slug = String(r.slug || r.nome || '').toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || uid().slice(0, 8);
  if (!String(r.nome || '').trim()) throw E(400, 'Indique o nome');
  for (const c of ['activo', 'no_menu']) if (cols.includes(c)) r[c] = r[c] !== false && r[c] !== 'false';
  if (cols.includes('favorito')) r.favorito = r.favorito === true || r.favorito === 'true';
  for (const c of ['lugares', 'ordem', 'preco']) if (cols.includes(c)) r[c] = Number(r[c]) || 0;
  const vals = cols.map((c) => r[c]);
  try {
    if (r.id) {
      await db.q(`update ${ent} set ${cols.map((c, i) => `${c}=$${i + 2}`).join(', ')} where id=$1`, [r.id, ...vals]);
      if (ent === 'utilizadores' && r.password) await db.q('update utilizadores set pass_hash=$2 where id=$1', [r.id, hashPass(r.password)]);
      return { ok: true, id: r.id };
    }
    const id = uid();
    const extra = ['familias', 'artigos', 'locais', 'utilizadores'].includes(ent) ? { empresa_id: 'emp1' } : {};
    if (ent === 'utilizadores') { if (!r.password || String(r.password).length < 6) throw E(400, 'Palavra-passe com pelo menos 6 caracteres'); extra.pass_hash = hashPass(r.password); }
    const allCols = ['id', ...cols, ...Object.keys(extra)], allVals = [id, ...vals, ...Object.values(extra)];
    await db.q(`insert into ${ent} (${allCols.join(', ')}) values (${allCols.map((_, i) => '$' + (i + 1)).join(', ')})`, allVals);
    return { ok: true, id };
  } catch (e) {
    if (String(e.code) === '23505') throw E(409, 'Já existe um registo com esse identificador (login ou endereço do menu)');
    throw e;
  }
}

async function handle(db, env, req) {
  try {
    if (!env.AUTH_SECRET) throw E(500, 'Configuração em falta: AUTH_SECRET');
    await ensure(db, env);
    const p = String(req.path || '').replace(/^\/api\/?/, '').replace(/\/$/, '');
    const b = req.body || {}, qy = req.query || {}, post = req.method === 'POST';
    if (p === 'menu') return { status: 200, json: await menuPublico(db, qy.l, qy.m) };
    if (p === 'pedido-publico' && post) return { status: 200, json: await mod.pedidoPublico(db, b) };
    if (p === 'pedido-estado') return { status: 200, json: await mod.pedidoEstado(db, qy.t) };
    if (p === 'reserva-publica' && post) return { status: 200, json: await mod.reservaPublica(db, b) };
    if (p === 'foto' && !post) return await fotoGet(db, qy.a);
    if (p === 'qr') {
      const QR = require('qrcode');
      const svg = await QR.toString(String(qy.t || '').slice(0, 500), { type: 'svg', margin: 1, color: { dark: '#4A1A0C', light: '#FFFFFF' } });
      return { status: 200, svg };
    }
    if (p === 'login' && post) {
      const [u] = await db.q('select id, nome, login, pass_hash, perfil, local_id from utilizadores where login=$1 and activo', [String(b.login || '').trim().toLowerCase()]);
      if (!u || !checkPass(b.password, u.pass_hash)) throw E(401, 'Utilizador ou palavra-passe incorrectos');
      const user = { id: u.id, nome: u.nome, login: u.login, perfil: u.perfil, local_id: u.local_id };
      return { status: 200, json: { token: sign(env, { ...user, exp: Date.now() + 30 * 864e5 }), user } };
    }
    const u = verify(env, req.token);
    const lid = qy.local || b.local;
    if (lid) acessoLocal(u, lid);
    if (p === 'state') return { status: 200, json: await estado(db, u, lid) };
    if (p === 'ops' && post) return { status: 200, json: { resultados: await runOps(db, u, b.ops) } };
    if (p === 'password' && post) {
      const [r] = await db.q('select pass_hash from utilizadores where id=$1', [u.id]);
      if (!r || !checkPass(b.actual, r.pass_hash)) throw E(400, 'Palavra-passe actual incorrecta');
      if (String(b.nova || '').length < 6) throw E(400, 'A nova palavra-passe precisa de pelo menos 6 caracteres');
      await db.q('update utilizadores set pass_hash=$2 where id=$1', [u.id, hashPass(b.nova)]);
      return { status: 200, json: { ok: true } };
    }
    if (p === 'turno') { exige(u, 'pagar'); return { status: 200, json: await turnoResumo(db, u, lid) }; }
    if (p === 'relatorio') { exige(u, 'aprovar'); return { status: 200, json: await relatorio(db, u, lid, qy.de, qy.ate) }; }
    if (p === 'facturacao' && !post) { exige(u, 'pagar'); return { status: 200, json: await facturacao(db, u, lid) }; }
    if (p === 'facturacao' && post) {
      exige(u, 'aprovar');
      if (!['pendente', 'enviado', 'erro'].includes(b.estado)) throw E(400, 'Estado inválido');
      await db.q(`update pedidos set sync_estado=$2, sync_ref=$3 where id = any($1) and estado='fechado'`, [b.ids || [], b.estado, b.ref || '']);
      return { status: 200, json: { ok: true } };
    }
    if (p === 'cfg' && !post) { exige(u, 'cfg'); return { status: 200, json: await cfgGet(db) }; }
    if (p === 'cfg' && post) { exige(u, 'cfg'); const r = await cfgSave(db, u, b); if (b.entidade === 'artigos') await imagens(db); return { status: 200, json: r }; }
    if (p === 'foto' && post) { exige(u, 'cfg'); return { status: 200, json: await fotoPost(db, b) }; }
    if (p === 'demo' && post) { exige(u, 'admin'); return { status: 200, json: b.acao === 'apagar' ? await demo.apagar(db) : await demo.carregar(db) }; }
    const r = await mod.rotas(db, u, p, post, b, qy);
    if (r) return { status: 200, json: r };
    throw E(404, 'Rota não encontrada');
  } catch (e) {
    if (!e.status) console.error(e);
    return { status: e.status || 500, json: { erro: e.status ? e.message : 'Erro interno do servidor' } };
  }
}

module.exports = { handle, _reset: () => { pronto = null; } };
