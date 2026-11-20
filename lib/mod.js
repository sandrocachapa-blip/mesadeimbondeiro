'use strict';
// Fases 2 a 4: stock, fichas técnicas, compras, fornecedores, RH, DAF, clientes, reservas, alertas, consolidado, pedido por QR.
module.exports = ({ E, exige, uid, acessoLocal }) => {
  const SCHEMA2 = [
    `create table if not exists meta (k text primary key, v text)`,
    `alter table mesas add column if not exists x numeric`,
    `alter table mesas add column if not exists y numeric`,
    `alter table mesas add column if not exists forma text default 'quadrada'`,
    `alter table empresas add column if not exists inss_taxa numeric default 3`,
    `create table if not exists ingredientes (id text primary key, nome text not null, unidade text default 'un', custo_medio numeric default 0, stock_min numeric default 0, activo boolean default true)`,
    `create table if not exists fichas (artigo_id text not null, ingrediente_id text not null, qtd numeric not null, primary key (artigo_id, ingrediente_id))`,
    `create table if not exists stock_mov (id text primary key, local_id text not null, ingrediente_id text not null, tipo text not null, qtd numeric not null, custo numeric default 0, motivo text default '', ref text default '', criado_em timestamptz default now(), utilizador_nome text default '')`,
    `create index if not exists stock_mov_ing on stock_mov (ingrediente_id, local_id)`,
    `create table if not exists fornecedores (id text primary key, nome text not null, nif text default '', contacto text default '', email text default '', prazo_dias numeric default 30, activo boolean default true)`,
    `create table if not exists compras (id text primary key, local_id text not null, fornecedor_id text, estado text default 'encomendada', num_factura text default '', dia text, vencimento text default '', total numeric default 0, pago numeric default 0, criado_por text default '', obs text default '', criado_em timestamptz default now())`,
    `create table if not exists compra_linhas (id text primary key, compra_id text not null, ingrediente_id text not null, qtd numeric not null, preco numeric not null)`,
    `create table if not exists funcionarios (id text primary key, nome text not null, funcao text default '', local_id text, salario_base numeric default 0, subsidios numeric default 0, data_admissao text default '', contacto text default '', activo boolean default true)`,
    `create table if not exists escalas (id text primary key, funcionario_id text not null, local_id text, dia text, inicio text default '', fim text default '')`,
    `create table if not exists ausencias (id text primary key, funcionario_id text not null, tipo text default 'falta', de text, ate text, obs text default '')`,
    `create table if not exists ponto (id text primary key, funcionario_id text not null, local_id text, entrada timestamptz not null, saida timestamptz)`,
    `create table if not exists salarios (id text primary key, mes text not null, funcionario_id text not null, nome text default '', base numeric default 0, subsidios numeric default 0, extras numeric default 0, faltas numeric default 0, inss numeric default 0, irt numeric default 0, descontos numeric default 0, liquido numeric default 0, estado text default 'processado', sync_estado text default 'pendente', unique (mes, funcionario_id))`,
    `create table if not exists despesas (id text primary key, local_id text, categoria text default 'Outras', descricao text default '', valor numeric default 0, dia text, fornecedor_id text, pago boolean default true, meio text default '')`,
    `create table if not exists contas_banc (id text primary key, nome text not null, saldo_inicial numeric default 0, activo boolean default true)`,
    `create table if not exists mov_tes (id text primary key, conta_id text not null, dia text, valor numeric not null, descricao text default '', ref text default '', criado_em timestamptz default now())`,
    `create table if not exists clientes (id text primary key, nome text not null, nif text default '', telefone text default '', email text default '', notas text default '', activo boolean default true)`,
    `create table if not exists reservas (id text primary key, local_id text, cliente_nome text not null, telefone text default '', dia text, hora text default '', pessoas numeric default 2, mesa_id text, estado text default 'confirmada', notas text default '')`,
  ];

  const REG = {
    ingredientes: { cols: ['nome', 'unidade', 'custo_medio', 'stock_min', 'activo'], perm: 'cfg', num: ['custo_medio', 'stock_min'], bool: ['activo'], ord: 'nome', nome: 'nome' },
    fornecedores: { cols: ['nome', 'nif', 'contacto', 'email', 'prazo_dias', 'activo'], perm: 'cfg', num: ['prazo_dias'], bool: ['activo'], ord: 'nome', nome: 'nome' },
    funcionarios: { cols: ['nome', 'funcao', 'local_id', 'salario_base', 'subsidios', 'data_admissao', 'contacto', 'activo'], perm: 'aprovar', num: ['salario_base', 'subsidios'], bool: ['activo'], ord: 'nome', nome: 'nome' },
    clientes: { cols: ['nome', 'nif', 'telefone', 'email', 'notas', 'activo'], perm: 'pedir', bool: ['activo'], ord: 'nome', nome: 'nome' },
    reservas: { cols: ['local_id', 'cliente_nome', 'telefone', 'dia', 'hora', 'pessoas', 'mesa_id', 'estado', 'notas'], perm: 'pedir', num: ['pessoas'], del: 1, ord: 'dia desc, hora', local: 1, nome: 'cliente_nome' },
    despesas: { cols: ['local_id', 'categoria', 'descricao', 'valor', 'dia', 'fornecedor_id', 'pago', 'meio'], perm: 'aprovar', num: ['valor'], bool: ['pago'], del: 1, ord: 'dia desc', local: 1 },
    escalas: { cols: ['funcionario_id', 'local_id', 'dia', 'inicio', 'fim'], perm: 'aprovar', del: 1, ord: 'dia desc, inicio', local: 1 },
    ausencias: { cols: ['funcionario_id', 'tipo', 'de', 'ate', 'obs'], perm: 'aprovar', del: 1, ord: 'de desc' },
    contas_banc: { cols: ['nome', 'saldo_inicial', 'activo'], perm: 'aprovar', num: ['saldo_inicial'], bool: ['activo'], ord: 'nome', nome: 'nome' },
  };
  const MES = (col) => `to_char((${col} at time zone 'UTC') + interval '1 hour', 'YYYY-MM')`;
  const DIA = (col) => `to_char((${col} at time zone 'UTC') + interval '1 hour', 'YYYY-MM-DD')`;
  const hoje = () => new Date(Date.now() + 3600e3).toISOString().slice(0, 10);
  const maisDias = (d, n) => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };

  async function regGet(db, u, qy) {
    const d = REG[qy.e]; if (!d) throw E(400, 'Entidade desconhecida'); exige(u, d.perm);
    const sel = d.cols.map((c) => ((d.num || []).includes(c) ? `${c}::float8 as ${c}` : c)).join(', ');
    return db.q(`select id, ${sel} from ${qy.e} ${d.local && qy.local ? 'where local_id=$1 or local_id is null' : ''} order by ${d.ord} limit 800`, d.local && qy.local ? [qy.local] : []);
  }
  async function regSave(db, u, b) {
    const d = REG[b.entidade]; if (!d) throw E(400, 'Entidade desconhecida'); exige(u, d.perm);
    if (b.apagar) { if (!d.del) throw E(400, 'Este registo não pode ser apagado; desactive-o'); await db.q(`delete from ${b.entidade} where id=$1`, [b.apagar]); return { ok: true }; }
    const r = b.linha || {};
    if (d.nome && !String(r[d.nome] || '').trim()) throw E(400, 'Indique o nome');
    const vals = d.cols.map((c) => {
      if ((d.num || []).includes(c)) return Number(r[c]) || 0;
      if ((d.bool || []).includes(c)) return r[c] !== false && r[c] !== 'false';
      if (c.endsWith('_id')) return r[c] || null;
      return r[c] == null ? '' : String(r[c]);
    });
    if (r.id) { await db.q(`update ${b.entidade} set ${d.cols.map((c, i) => `${c}=$${i + 2}`).join(', ')} where id=$1`, [r.id, ...vals]); return { ok: true, id: r.id }; }
    const id = uid();
    await db.q(`insert into ${b.entidade} (id, ${d.cols.join(', ')}) values ($1, ${d.cols.map((_, i) => '$' + (i + 2)).join(', ')})`, [id, ...vals]);
    return { ok: true, id };
  }

  // Baixa de stock pela ficha técnica quando a conta fecha (chamado dentro da transacção).
  async function aoFechar(q, pedidoId, localId, t, nome) {
    await q(`insert into stock_mov (id, local_id, ingrediente_id, tipo, qtd, custo, ref, criado_em, utilizador_nome)
      select gen_random_uuid()::text, $2, f.ingrediente_id, 'venda', -sum(l.qtd * f.qtd), max(i.custo_medio), $1, $3, $4
      from linhas l join fichas f on f.artigo_id = l.artigo_id join ingredientes i on i.id = f.ingrediente_id
      where l.pedido_id = $1 and l.estado <> 'anulado' group by f.ingrediente_id`, [pedidoId, localId, t, nome]);
  }

  async function base(db) {
    const [locais, ingredientes, fornecedores, funcionarios, contas, artigos, mesas] = await Promise.all([
      db.q('select id, nome from locais where activo order by nome'),
      db.q('select id, nome, unidade, custo_medio::float8 as custo from ingredientes where activo order by nome'),
      db.q('select id, nome from fornecedores where activo order by nome'),
      db.q('select id, nome, local_id from funcionarios where activo order by nome'),
      db.q('select id, nome from contas_banc where activo order by nome'),
      db.q('select id, nome, preco::float8 as preco from artigos where activo order by nome'),
      db.q('select id, nome, local_id from mesas where activo order by ordem, nome'),
    ]);
    return { locais, ingredientes, fornecedores, funcionarios, contas, artigos, mesas };
  }

  async function stockGet(db, lid) {
    const itens = await db.q(`select i.id, i.nome, i.unidade, i.custo_medio::float8 as custo, i.stock_min::float8 as min, coalesce(s.q, 0)::float8 as qtd
      from ingredientes i left join (select ingrediente_id, sum(qtd) q from stock_mov where local_id=$1 group by 1) s on s.ingrediente_id = i.id where i.activo order by i.nome`, [lid]);
    const movs = await db.q(`select m.id, m.tipo, m.qtd::float8 as qtd, m.motivo, m.criado_em, m.utilizador_nome, i.nome, i.unidade from stock_mov m join ingredientes i on i.id=m.ingrediente_id where m.local_id=$1 and m.tipo<>'venda' order by m.criado_em desc limit 60`, [lid]);
    return { itens, movs };
  }
  async function stockPost(db, u, b) {
    exige(u, 'cfg'); acessoLocal(u, b.local);
    const [i] = await db.q('select id, custo_medio::float8 as custo from ingredientes where id=$1', [b.ingrediente_id]);
    if (!i) throw E(404, 'Ingrediente não encontrado');
    const [{ q: actual }] = await db.q('select coalesce(sum(qtd),0)::float8 as q from stock_mov where ingrediente_id=$1 and local_id=$2', [i.id, b.local]);
    const n = Number(b.qtd); if (!isFinite(n) || n < 0) throw E(400, 'Quantidade inválida');
    const mov = (lid, tipo, qtd, motivo) => db.q('insert into stock_mov (id, local_id, ingrediente_id, tipo, qtd, custo, motivo, utilizador_nome) values ($1,$2,$3,$4,$5,$6,$7,$8)', [uid(), lid, i.id, tipo, qtd, i.custo, motivo || '', u.nome]);
    if (b.tipo === 'contagem') { if (n !== actual) await mov(b.local, 'contagem', n - actual, b.motivo || 'Contagem'); }
    else if (b.tipo === 'entrada') await mov(b.local, 'entrada', n, b.motivo);
    else if (b.tipo === 'quebra' || b.tipo === 'consumo') await mov(b.local, b.tipo, -n, b.motivo);
    else if (b.tipo === 'transferencia') { if (!b.destino || b.destino === b.local) throw E(400, 'Escolha o local de destino'); await mov(b.local, 'transferencia', -n, 'Para outro local'); await mov(b.destino, 'transferencia', n, 'De outro local'); }
    else throw E(400, 'Tipo de movimento inválido');
    return { ok: true };
  }

  async function comprasGet(db, lid) {
    const compras = await db.q(`select c.id, c.fornecedor_id, f.nome as fornecedor, c.estado, c.num_factura, c.dia, c.vencimento, c.total::float8 as total, c.pago::float8 as pago, c.obs from compras c left join fornecedores f on f.id=c.fornecedor_id where c.local_id=$1 order by c.criado_em desc limit 200`, [lid]);
    if (compras.length) {
      const ls = await db.q(`select l.compra_id, l.ingrediente_id, i.nome, i.unidade, l.qtd::float8 as qtd, l.preco::float8 as preco from compra_linhas l join ingredientes i on i.id=l.ingrediente_id where l.compra_id = any($1)`, [compras.map((c) => c.id)]);
      for (const c of compras) c.linhas = ls.filter((l) => l.compra_id === c.id);
    }
    const sugestao = (await stockGet(db, lid)).itens.filter((i) => i.min > 0 && i.qtd < i.min);
    return { compras, sugestao };
  }
  async function comprasPost(db, u, b) {
    exige(u, 'cfg');
    if (b.acao === 'criar') {
      acessoLocal(u, b.local);
      const ls = (b.linhas || []).filter((l) => l.ingrediente_id && Number(l.qtd) > 0);
      if (!ls.length) throw E(400, 'Junte pelo menos um artigo à encomenda');
      const id = uid(), total = ls.reduce((s, l) => s + Number(l.qtd) * (Number(l.preco) || 0), 0);
      await db.tx(async (q) => {
        await q('insert into compras (id, local_id, fornecedor_id, dia, total, criado_por, obs) values ($1,$2,$3,$4,$5,$6,$7)', [id, b.local, b.fornecedor_id || null, b.dia || hoje(), total, u.nome, b.obs || '']);
        for (const l of ls) await q('insert into compra_linhas (id, compra_id, ingrediente_id, qtd, preco) values ($1,$2,$3,$4,$5)', [uid(), id, l.ingrediente_id, Number(l.qtd), Number(l.preco) || 0]);
      });
      return { ok: true, id };
    }
    const [c] = await db.q('select c.id, c.local_id, c.estado, c.total::float8 as total, c.pago::float8 as pago, c.dia, coalesce(f.prazo_dias, 30)::int as prazo, f.nome as fornecedor from compras c left join fornecedores f on f.id=c.fornecedor_id where c.id=$1', [b.id]);
    if (!c) throw E(404, 'Compra não encontrada'); acessoLocal(u, c.local_id);
    if (b.acao === 'receber') {
      if (c.estado !== 'encomendada') throw E(409, 'Esta compra já foi recebida ou anulada');
      await db.tx(async (q) => {
        const ls = await q('select ingrediente_id, qtd::float8 as qtd, preco::float8 as preco from compra_linhas where compra_id=$1', [c.id]);
        for (const l of ls) {
          await q(`update ingredientes i set custo_medio = case when s.q <= 0 then $2::numeric else (s.q * i.custo_medio + $3::numeric * $2::numeric) / (s.q + $3::numeric) end from (select coalesce(sum(qtd), 0) q from stock_mov where ingrediente_id=$1) s where i.id=$1`, [l.ingrediente_id, l.preco, l.qtd]);
          await q(`insert into stock_mov (id, local_id, ingrediente_id, tipo, qtd, custo, motivo, ref, utilizador_nome) values ($1,$2,$3,'entrada',$4,$5,$6,$7,$8)`, [uid(), c.local_id, l.ingrediente_id, l.qtd, l.preco, 'Compra ' + (c.fornecedor || ''), c.id, u.nome]);
        }
        const d = b.dia || hoje();
        await q(`update compras set estado='recebida', num_factura=$2, dia=$3, vencimento=$4 where id=$1`, [c.id, b.num_factura || '', d, maisDias(d, c.prazo)]);
      });
      return { ok: true };
    }
    if (b.acao === 'pagar') {
      exige(u, 'aprovar');
      if (c.estado !== 'recebida') throw E(409, 'Só se pagam compras recebidas');
      const v = Math.min(Number(b.valor) || 0, c.total - c.pago); if (v <= 0) throw E(400, 'Valor inválido');
      await db.tx(async (q) => {
        await q('update compras set pago = pago + $2 where id=$1', [c.id, v]);
        if (b.conta_id) await q('insert into mov_tes (id, conta_id, dia, valor, descricao, ref) values ($1,$2,$3,$4,$5,$6)', [uid(), b.conta_id, hoje(), -v, 'Pagamento a ' + (c.fornecedor || 'fornecedor'), c.id]);
      });
      return { ok: true };
    }
    if (b.acao === 'anular') { if (c.estado !== 'encomendada') throw E(409, 'Só se anulam encomendas ainda não recebidas'); await db.q(`update compras set estado='anulada' where id=$1`, [c.id]); return { ok: true }; }
    throw E(400, 'Acção desconhecida');
  }

  const custos = (db) => db.q(`select a.id, a.nome, a.preco::float8 as preco, coalesce(sum(f.qtd * i.custo_medio), 0)::float8 as custo, count(f.ingrediente_id)::int as n from artigos a left join fichas f on f.artigo_id=a.id left join ingredientes i on i.id=f.ingrediente_id where a.activo group by a.id, a.nome, a.preco order by a.nome`);
  async function fichaPost(db, u, b) {
    exige(u, 'cfg');
    await db.tx(async (q) => {
      await q('delete from fichas where artigo_id=$1', [b.artigo_id]);
      for (const l of b.linhas || []) if (l.ingrediente_id && Number(l.qtd) > 0) await q('insert into fichas (artigo_id, ingrediente_id, qtd) values ($1,$2,$3) on conflict (artigo_id, ingrediente_id) do update set qtd = fichas.qtd + excluded.qtd', [b.artigo_id, l.ingrediente_id, Number(l.qtd)]);
    });
    return { ok: true };
  }

  async function pontoGet(db, qy) {
    const de = qy.de || hoje(), ate = qy.ate || de;
    const rows = await db.q(`select p.id, p.funcionario_id, f.nome, p.entrada, p.saida, round((extract(epoch from (coalesce(p.saida, now()) - p.entrada)) / 3600)::numeric, 2)::float8 as horas from ponto p join funcionarios f on f.id=p.funcionario_id where ${DIA('p.entrada')} between $1 and $2 and ($3::text is null or p.local_id=$3) order by p.entrada desc`, [de, ate, qy.local || null]);
    const abertos = await db.q('select funcionario_id from ponto where saida is null');
    return { rows, abertos: abertos.map((a) => a.funcionario_id) };
  }
  async function pontoPost(db, u, b) {
    const [ab] = await db.q('select id from ponto where funcionario_id=$1 and saida is null', [b.funcionario_id]);
    if (b.acao === 'entrada') { if (ab) throw E(409, 'Já tem uma entrada por fechar'); await db.q('insert into ponto (id, funcionario_id, local_id, entrada) values ($1,$2,$3, now())', [uid(), b.funcionario_id, b.local || null]); }
    else { if (!ab) throw E(409, 'Não há entrada registada'); await db.q('update ponto set saida=now() where id=$1', [ab.id]); }
    return { ok: true };
  }

  const liq = (s) => s.base + s.subsidios + s.extras - s.faltas - s.inss - s.irt - s.descontos;
  const SAL = 'id, mes, funcionario_id, nome, base::float8 as base, subsidios::float8 as subsidios, extras::float8 as extras, faltas::float8 as faltas, inss::float8 as inss, irt::float8 as irt, descontos::float8 as descontos, liquido::float8 as liquido, estado, sync_estado';
  async function salariosPost(db, u, b) {
    exige(u, 'aprovar');
    const [{ taxa }] = await db.q('select coalesce(inss_taxa, 3)::float8 as taxa from empresas limit 1');
    if (b.acao === 'processar') {
      if (!/^\d{4}-\d{2}$/.test(b.mes || '')) throw E(400, 'Mês inválido');
      const fs = await db.q('select id, nome, salario_base::float8 as base, subsidios::float8 as subsidios from funcionarios where activo');
      const aus = await db.q(`select funcionario_id, de, ate from ausencias where tipo='falta'`);
      const ex = await db.q(`select ${SAL} from salarios where mes=$1`, [b.mes]);
      const ini = b.mes + '-01', fim = b.mes + '-31';
      for (const f of fs) {
        const e = ex.find((x) => x.funcionario_id === f.id); if (e && e.estado === 'pago') continue;
        let dias = 0;
        for (const a of aus.filter((x) => x.funcionario_id === f.id)) { const d0 = a.de > ini ? a.de : ini, d1 = (a.ate || a.de) < fim ? (a.ate || a.de) : fim; if (d0 <= d1) dias += Math.round((new Date(d1) - new Date(d0)) / 864e5) + 1; }
        const s = { base: f.base, subsidios: f.subsidios, extras: e ? e.extras : 0, faltas: Math.round(f.base / 30 * dias), irt: e ? e.irt : 0, descontos: e ? e.descontos : 0 };
        s.inss = Math.round((s.base + s.subsidios + s.extras - s.faltas) * taxa / 100);
        await db.q(`insert into salarios (id, mes, funcionario_id, nome, base, subsidios, extras, faltas, inss, irt, descontos, liquido) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
          on conflict (mes, funcionario_id) do update set nome=excluded.nome, base=excluded.base, subsidios=excluded.subsidios, faltas=excluded.faltas, inss=excluded.inss, liquido=excluded.liquido`,
          [uid(), b.mes, f.id, f.nome, s.base, s.subsidios, s.extras, s.faltas, s.inss, s.irt, s.descontos, liq(s)]);
      }
      return { ok: true };
    }
    if (b.acao === 'editar') {
      const [s] = await db.q(`select ${SAL} from salarios where id=$1`, [b.id]);
      if (!s) throw E(404, 'Recibo não encontrado'); if (s.estado === 'pago') throw E(409, 'Salário já pago');
      s.extras = Number(b.extras) || 0; s.irt = Number(b.irt) || 0; s.descontos = Number(b.descontos) || 0;
      s.inss = Math.round((s.base + s.subsidios + s.extras - s.faltas) * taxa / 100);
      await db.q('update salarios set extras=$2, irt=$3, descontos=$4, inss=$5, liquido=$6 where id=$1', [s.id, s.extras, s.irt, s.descontos, s.inss, liq(s)]);
      return { ok: true };
    }
    if (b.acao === 'pagar') {
      const [{ t }] = await db.q(`select coalesce(sum(liquido),0)::float8 as t from salarios where mes=$1 and estado<>'pago'`, [b.mes]);
      if (t <= 0) throw E(409, 'Não há salários por pagar neste mês');
      await db.tx(async (q) => {
        await q(`update salarios set estado='pago' where mes=$1`, [b.mes]);
        if (b.conta_id) await q('insert into mov_tes (id, conta_id, dia, valor, descricao, ref) values ($1,$2,$3,$4,$5,$6)', [uid(), b.conta_id, hoje(), -t, 'Salários ' + b.mes, 'sal-' + b.mes]);
      });
      return { ok: true };
    }
    if (b.acao === 'sync') { await db.q(`update salarios set sync_estado='enviado' where mes=$1`, [b.mes]); return { ok: true }; }
    throw E(400, 'Acção desconhecida');
  }

  async function daf(db, qy) {
    const lid = qy.local, mes = qy.mes || hoje().slice(0, 7);
    const [[v], [st], [pes], desp, pagarC, pagarD, contas, movs] = await Promise.all([
      db.q(`select coalesce(sum(total),0)::float8 as vendas, count(*)::int as contas from pedidos where local_id=$1 and estado='fechado' and ${MES('fechado_em')}=$2`, [lid, mes]),
      db.q(`select coalesce(sum(case when tipo='venda' then -qtd*custo else 0 end),0)::float8 as cmv, coalesce(sum(case when tipo in ('quebra','consumo','contagem') then -qtd*custo else 0 end),0)::float8 as perdas from stock_mov where local_id=$1 and ${MES('criado_em')}=$2`, [lid, mes]),
      db.q(`select coalesce(sum(s.base + s.subsidios + s.extras - s.faltas),0)::float8 as pessoal from salarios s join funcionarios f on f.id=s.funcionario_id where s.mes=$2 and (f.local_id=$1 or f.local_id is null)`, [lid, mes]),
      db.q(`select categoria, sum(valor)::float8 as valor from despesas where (local_id=$1 or local_id is null) and substr(dia,1,7)=$2 group by 1 order by 2 desc`, [lid, mes]),
      db.q(`select c.id, f.nome as fornecedor, c.num_factura, c.vencimento, (c.total - c.pago)::float8 as falta from compras c left join fornecedores f on f.id=c.fornecedor_id where c.local_id=$1 and c.estado='recebida' and c.total > c.pago order by c.vencimento`, [lid]),
      db.q(`select id, categoria, descricao, dia, valor::float8 as valor from despesas where (local_id=$1 or local_id is null) and not pago order by dia`, [lid]),
      db.q(`select c.id, c.nome, (c.saldo_inicial + coalesce((select sum(valor) from mov_tes m where m.conta_id=c.id),0))::float8 as saldo from contas_banc c where c.activo order by c.nome`),
      db.q(`select m.dia, m.valor::float8 as valor, m.descricao, c.nome as conta from mov_tes m join contas_banc c on c.id=m.conta_id order by m.criado_em desc limit 40`),
    ]);
    const despesas = desp.reduce((s, d) => s + d.valor, 0);
    return { mes, vendas: v.vendas, contas: v.contas, cmv: st.cmv, perdas: st.perdas, pessoal: pes.pessoal, despesas, porCategoria: desp, resultado: v.vendas - st.cmv - st.perdas - pes.pessoal - despesas, pagarCompras: pagarC, pagarDespesas: pagarD, bancos: contas, movs, hoje: hoje() };
  }

  async function alertas(db, lid) {
    const h = hoje();
    const [[kp], [ab], [an], stock, venc, res, [qr], margem, fecho] = await Promise.all([
      db.q(`select coalesce(sum(total),0)::float8 as vendas, count(*)::int as contas, coalesce(sum(desconto),0)::float8 as descontos from pedidos where local_id=$1 and estado='fechado' and ${DIA('fechado_em')}=$2`, [lid, h]),
      db.q(`select count(*)::int as n, coalesce(sum(total),0)::float8 as valor from pedidos where local_id=$1 and estado='aberto'`, [lid]),
      db.q(`select count(*)::int as n, coalesce(sum(l.qtd*l.preco),0)::float8 as valor from linhas l join pedidos p on p.id=l.pedido_id where p.local_id=$1 and l.estado='anulado' and ${DIA('l.criado_em')}=$2`, [lid, h]),
      db.q(`select i.nome, i.unidade, i.stock_min::float8 as min, coalesce(s.q,0)::float8 as qtd from ingredientes i left join (select ingrediente_id, sum(qtd) q from stock_mov where local_id=$1 group by 1) s on s.ingrediente_id=i.id where i.activo and i.stock_min > 0 and coalesce(s.q,0) < i.stock_min order by i.nome`, [lid]),
      db.q(`select f.nome as fornecedor, c.vencimento, (c.total-c.pago)::float8 as falta from compras c left join fornecedores f on f.id=c.fornecedor_id where c.local_id=$1 and c.estado='recebida' and c.total > c.pago and c.vencimento <> '' and c.vencimento < $2 order by c.vencimento`, [lid, h]),
      db.q(`select cliente_nome, hora, pessoas::int as pessoas, estado from reservas where local_id=$1 and dia=$2 and estado<>'cancelada' order by hora`, [lid, h]),
      db.q(`select count(*)::int as n from linhas l join pedidos p on p.id=l.pedido_id where p.local_id=$1 and p.estado='aberto' and l.estado='novo' and l.criado_por_nome='Cliente (QR)'`, [lid]),
      db.q(`select a.nome, a.preco::float8 as preco, sum(f.qtd*i.custo_medio)::float8 as custo from artigos a join fichas f on f.artigo_id=a.id join ingredientes i on i.id=f.ingrediente_id where a.activo and a.preco > 0 group by a.id, a.nome, a.preco having sum(f.qtd*i.custo_medio) > a.preco * 0.4 order by sum(f.qtd*i.custo_medio)/a.preco desc limit 10`),
      db.q(`select fechado_em, utilizador_nome, contado from turnos where local_id=$1 and fechado_em is not null order by fechado_em desc limit 1`, [lid]),
    ]);
    return { hoje: kp, abertas: ab, anulacoes: an, stock, vencidas: venc, reservas: res, qr: qr.n, margem, fecho: fecho[0] || null };
  }

  async function consolidado(db, qy) {
    const de = qy.de || hoje(), ate = qy.ate || de;
    return db.q(`select l.id, l.nome, l.tipo,
      coalesce((select sum(total) from pedidos p where p.local_id=l.id and p.estado='fechado' and ${DIA('p.fechado_em')} between $1 and $2),0)::float8 as vendas,
      (select count(*) from pedidos p where p.local_id=l.id and p.estado='fechado' and ${DIA('p.fechado_em')} between $1 and $2)::int as contas,
      coalesce((select sum(-qtd*custo) from stock_mov m where m.local_id=l.id and m.tipo='venda' and ${DIA('m.criado_em')} between $1 and $2),0)::float8 as cmv,
      (select count(*) from pedidos p where p.local_id=l.id and p.estado='aberto')::int as abertas
      from locais l where l.activo order by l.nome`, [de, ate]);
  }

  // Pedido feito pelo cliente no menu digital: entra na conta da mesa como «por enviar», para o empregado confirmar.
  async function pedidoPublico(db, b) {
    const itens = (b.itens || []).filter((i) => i && i.artigo_id && Number(i.qtd) > 0).slice(0, 30);
    if (!itens.length) throw E(400, 'O pedido está vazio');
    const [m] = await db.q('select m.id, m.nome, m.local_id from mesas m join locais l on l.id=m.local_id where m.id=$1 and m.activo and l.slug=$2 and l.activo', [b.mesa, b.l]);
    if (!m) throw E(404, 'Mesa não encontrada');
    await db.tx(async (q) => {
      let [p] = await q(`select id from pedidos where mesa_id=$1 and estado='aberto'`, [m.id]);
      if (!p) { p = { id: uid() }; await q(`insert into pedidos (id, local_id, mesa_id, mesa_nome, tipo, aberto_por_nome) values ($1,$2,$3,$4,'mesa','Cliente (QR)')`, [p.id, m.local_id, m.id, m.nome]); }
      const [{ n }] = await q(`select count(*)::int as n from linhas where pedido_id=$1 and estado='novo' and criado_por_nome='Cliente (QR)'`, [p.id]);
      if (n + itens.length > 40) throw E(429, 'Há um pedido à espera de confirmação. Chame o empregado, por favor.');
      for (const it of itens) {
        const [a] = await q(`select a.nome, coalesce(pl.preco, a.preco)::float8 as preco, f.seccao from artigos a join familias f on f.id=a.familia_id left join precos_local pl on pl.artigo_id=a.id and pl.local_id=$2 where a.id=$1 and a.activo and a.no_menu`, [it.artigo_id, m.local_id]);
        if (!a) continue;
        await q(`insert into linhas (id, pedido_id, artigo_id, nome, preco, qtd, notas, seccao, criado_por_nome) values ($1,$2,$3,$4,$5,$6,$7,$8,'Cliente (QR)')`, [uid(), p.id, it.artigo_id, a.nome, a.preco, Math.min(20, Math.max(1, parseInt(it.qtd) || 1)), String(it.notas || '').slice(0, 120), a.seccao]);
      }
      await q(`update pedidos set total = greatest(0, coalesce((select sum(preco*qtd) from linhas where pedido_id=$1 and estado<>'anulado'),0) - desconto) where id=$1`, [p.id]);
    });
    return { ok: true, mesa: m.nome };
  }

  async function rotas(db, u, p, post, b, qy) {
    const lid = qy.local || b.local;
    if (p === 'base') return base(db);
    if (p === 'reg') return post ? regSave(db, u, b) : regGet(db, u, qy);
    if (p === 'planta' && post) { exige(u, 'cfg'); for (const m of b.mesas || []) await db.q('update mesas set x=$2, y=$3, forma=$4 where id=$1', [m.id, Number(m.x) || 0, Number(m.y) || 0, m.forma || 'quadrada']); return { ok: true }; }
    if (p === 'stock') { exige(u, 'cfg'); return post ? stockPost(db, u, b) : stockGet(db, lid); }
    if (p === 'compras') { exige(u, 'cfg'); return post ? comprasPost(db, u, b) : comprasGet(db, lid); }
    if (p === 'custos') { exige(u, 'cfg'); return { artigos: await custos(db) }; }
    if (p === 'fichas') { exige(u, 'cfg'); return post ? fichaPost(db, u, b) : { linhas: await db.q('select f.ingrediente_id, f.qtd::float8 as qtd from fichas f where f.artigo_id=$1', [qy.artigo]) }; }
    if (p === 'ponto') return post ? pontoPost(db, u, b) : pontoGet(db, qy);
    if (p === 'salarios') { exige(u, 'aprovar'); return post ? salariosPost(db, u, b) : { linhas: await db.q(`select ${SAL} from salarios where mes=$1 order by nome`, [qy.mes]) }; }
    if (p === 'daf') { exige(u, 'aprovar'); return daf(db, qy); }
    if (p === 'tes' && post) { exige(u, 'aprovar'); if (!b.conta_id || !Number(b.valor)) throw E(400, 'Indique a conta e o valor'); await db.q('insert into mov_tes (id, conta_id, dia, valor, descricao) values ($1,$2,$3,$4,$5)', [uid(), b.conta_id, b.dia || hoje(), Number(b.valor), b.descricao || '']); return { ok: true }; }
    if (p === 'alertas') { exige(u, 'aprovar'); return alertas(db, lid); }
    if (p === 'consolidado') { exige(u, 'admin'); return { locais: await consolidado(db, qy) }; }
    return null;
  }

  return { SCHEMA2, aoFechar, rotas, pedidoPublico };
};
