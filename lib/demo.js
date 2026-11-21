'use strict';
// Dados fictícios de demonstração. Todos os registos têm id começado por «demo-», para poderem ser apagados de uma vez.
const TABELAS = ['pedidos', 'turnos', 'ingredientes', 'fornecedores', 'compras', 'compra_linhas', 'stock_mov', 'funcionarios', 'escalas', 'ausencias', 'ponto', 'salarios', 'despesas', 'contas_banc', 'mov_tes', 'clientes', 'reservas', 'bairros', 'mesas', 'locais', 'mov_caixa'];

async function apagar(db) {
  await db.tx(async (q) => {
    await q(`delete from linhas where pedido_id like 'demo-%'`);
    await q(`delete from pagamentos where pedido_id like 'demo-%'`);
    await q(`delete from fichas where ingrediente_id like 'demo-%'`);
    for (const t of TABELAS) await q(`delete from ${t} where id like 'demo-%'`);
    await q(`insert into meta (k, v) values ('demo', 'apagado') on conflict (k) do update set v = excluded.v`);
  });
  return { ok: true };
}

async function ins(q, tabela, cols, rows) {
  const max = Math.max(1, Math.floor(900 / cols.length));
  for (let i = 0; i < rows.length; i += max) {
    const lote = rows.slice(i, i + max), ps = [];
    const vals = lote.map((r) => '(' + r.map((v) => { ps.push(v); return '$' + ps.length; }).join(',') + ')').join(',');
    await q(`insert into ${tabela} (${cols.join(',')}) values ${vals} on conflict do nothing`, ps);
  }
}

async function carregar(db) {
  let s = 20261120; const rnd = () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
  const ri = (a, b) => a + Math.floor(rnd() * (b - a + 1)), pick = (arr) => arr[Math.floor(rnd() * arr.length)];
  const agora = Date.now(), DIA = 864e5;
  const dia = (n) => new Date(agora + 3600e3 - n * DIA).toISOString().slice(0, 10); // dia de Luanda, n dias atrás
  const ts = (n, h, m) => new Date(Date.parse(dia(n) + 'T00:00:00Z') + (h - 1) * 3600e3 + (m || 0) * 6e4).toISOString(); // hora de Luanda → UTC
  const mes = (n) => { const d = new Date(agora + 3600e3); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - n); return d.toISOString().slice(0, 7); };

  await db.tx(async (q) => {
    const [loc] = await q(`select id, nome, seq_doc from locais where activo and id not like 'demo-%' order by id limit 1`);
    if (!loc) return;
    const L = loc.id, B = 'demo-loc2';
    await ins(q, 'locais', ['id', 'empresa_id', 'nome', 'tipo', 'morada', 'slug'], [[B, 'emp1', 'Bar da Ilha (exemplo)', 'bar', 'Ilha de Luanda', 'demo-bar-da-ilha']]);
    await ins(q, 'mesas', ['id', 'local_id', 'zona', 'nome', 'lugares', 'ordem'], [1, 2, 3, 4, 5, 6].map((n) => ['demo-mb' + n, B, n <= 4 ? 'Bar' : 'Esplanada', (n <= 4 ? 'Mesa alta ' : 'Esplanada ') + (n <= 4 ? n : n - 4), n <= 4 ? 2 : 4, n]));

    // Ingredientes, fichas técnicas
    const ING = [['peixe', 'Peixe carapau', 'kg', 3200, 8], ['galinha', 'Galinha rija', 'kg', 2800, 10], ['vaca', 'Carne de vaca', 'kg', 6500, 6], ['palma', 'Óleo de palma', 'L', 1800, 5], ['bombo', 'Farinha de bombó', 'kg', 900, 10], ['feijao', 'Feijão', 'kg', 1200, 8], ['banana', 'Banana-pão', 'kg', 700, 6], ['mandioca', 'Mandioca', 'kg', 500, 8], ['quiabo', 'Quiabos', 'kg', 1500, 3], ['ginguba', 'Ginguba', 'kg', 2200, 2], ['batata', 'Batata', 'kg', 800, 15], ['ovo', 'Ovos', 'un', 120, 60], ['coco', 'Coco', 'un', 400, 10], ['acucar', 'Açúcar', 'kg', 900, 5], ['mucua', 'Múcua', 'kg', 2500, 2], ['cafe', 'Café em grão', 'kg', 9000, 9], ['agua', 'Água 0,5 L', 'un', 250, 48], ['refri', 'Refrigerante lata', 'un', 450, 48], ['cerveja', 'Cerveja nacional', 'un', 600, 72], ['gin', 'Gin (garrafa)', 'gf', 14000, 12], ['tonica', 'Água tónica', 'un', 500, 24], ['vinho', 'Vinho da casa (garrafa)', 'gf', 6000, 6]];
    await ins(q, 'ingredientes', ['id', 'nome', 'unidade', 'custo_medio', 'stock_min'], ING.map((i) => ['demo-i-' + i[0], i[1], i[2], i[3], i[4]]));
    const FICHAS = { 'Mufete': { peixe: 0.4, feijao: 0.15, palma: 0.05, banana: 0.2, mandioca: 0.2 }, 'Moamba de galinha': { galinha: 0.35, palma: 0.06, quiabo: 0.08, bombo: 0.15 }, 'Calulu de peixe': { peixe: 0.3, quiabo: 0.1, palma: 0.04, bombo: 0.15 }, 'Bife à casa': { vaca: 0.22, batata: 0.25, ovo: 1 }, 'Kitaba': { ginguba: 0.1 }, 'Chamuças de carne': { vaca: 0.08 }, 'Cocada amarela': { coco: 0.5, acucar: 0.1, ovo: 2 }, 'Mousse de múcua': { mucua: 0.06, acucar: 0.05 }, 'Água 0,5 L': { agua: 1 }, 'Refrigerante': { refri: 1 }, 'Sumo natural de múcua': { mucua: 0.05, acucar: 0.03 }, 'Café': { cafe: 0.008 }, 'Cerveja nacional': { cerveja: 1 }, 'Gin tónico': { gin: 0.07, tonica: 1 }, 'Vinho da casa (copo)': { vinho: 0.2 } };
    const arts = await q(`select a.id, a.nome, a.preco::float8 as preco, f.seccao from artigos a join familias f on f.id = a.familia_id where a.activo`);
    const fr = [];
    for (const a of arts) if (FICHAS[a.nome]) for (const k in FICHAS[a.nome]) fr.push([a.id, 'demo-i-' + k, FICHAS[a.nome][k]]);
    await ins(q, 'fichas', ['artigo_id', 'ingrediente_id', 'qtd'], fr);

    // Fornecedores e compras
    const FORN = [['peixaria', 'Peixaria da Ilha', 7, ['peixe']], ['talho', 'Talho Central', 15, ['galinha', 'vaca', 'ovo']], ['frescos', 'Frescos do Kinaxixi', 7, ['banana', 'mandioca', 'quiabo', 'batata', 'coco', 'mucua', 'ginguba']], ['bebidas', 'Distribuidora Kwanza Bebidas', 30, ['agua', 'refri', 'cerveja', 'gin', 'tonica', 'vinho']], ['mercearia', 'Mercearia Boa Esperança', 30, ['palma', 'bombo', 'feijao', 'acucar', 'cafe']]];
    await ins(q, 'fornecedores', ['id', 'nome', 'nif', 'contacto', 'email', 'prazo_dias'], FORN.map((f, i) => ['demo-f-' + f[0], f[1], '54170000' + (10 + i), '+244 923 000 0' + (10 + i), f[0] + '@exemplo.ao', f[2]]));
    const QTD = { peixe: 45, galinha: 40, vaca: 25, ovo: 240, banana: 30, mandioca: 30, quiabo: 15, batata: 40, coco: 60, mucua: 6, ginguba: 6, agua: 240, refri: 240, cerveja: 480, gin: 4, tonica: 96, vinho: 18, palma: 15, bombo: 30, feijao: 25, acucar: 15, cafe: 3 };
    const custo = Object.fromEntries(ING.map((i) => [i[0], i[3]]));
    const compras = [], cl = [], sm = [], addDias = (d, n) => new Date(Date.parse(d + 'T12:00:00Z') + n * DIA).toISOString().slice(0, 10);
    [16, 9, 2].forEach((n, sem) => FORN.forEach((f, fi) => {
      const id = `demo-c-${sem}-${f[0]}`, d = dia(n); let total = 0;
      f[3].forEach((k) => { const qt = QTD[k]; total += qt * custo[k]; cl.push([`${id}-${k}`, id, 'demo-i-' + k, qt, custo[k]]); sm.push([`demo-sm-${id}-${k}`, L, 'demo-i-' + k, 'entrada', qt, custo[k], 'Compra ' + f[1], id, ts(n, 9, 30), 'Dados de exemplo']); });
      const pago = sem === 0 ? total : sem === 1 && fi % 2 === 0 ? total : sem === 1 ? Math.round(total / 2) : 0;
      compras.push([id, L, 'demo-f-' + f[0], 'recebida', `FT ${2026}/${400 + sem * 10 + fi}`, d, addDias(d, f[2]), total, pago, 'Dados de exemplo', ts(n, 9, 0)]);
    }));
    compras.push(['demo-c-enc', L, 'demo-f-peixaria', 'encomendada', '', dia(0), '', 30 * 3200, 0, 'Dados de exemplo', ts(0, 8, 0)]); cl.push(['demo-c-enc-peixe', 'demo-c-enc', 'demo-i-peixe', 30, 3200]);
    await ins(q, 'compras', ['id', 'local_id', 'fornecedor_id', 'estado', 'num_factura', 'dia', 'vencimento', 'total', 'pago', 'criado_por', 'criado_em'], compras);
    await ins(q, 'compra_linhas', ['id', 'compra_id', 'ingrediente_id', 'qtd', 'preco'], cl);
    ['cerveja', 'refri', 'agua', 'gin', 'tonica', 'vinho'].forEach((k) => sm.push([`demo-sm-bar-${k}`, B, 'demo-i-' + k, 'entrada', Math.round(QTD[k] / 2), custo[k], 'Transferência inicial', '', ts(16, 10, 0), 'Dados de exemplo']));
    [['peixe', 1.5, 'Peixe estragado no frio', 6], ['banana', 2, 'Banana passada', 4], ['cerveja', 6, 'Garrafas partidas', 3], ['ovo', 12, 'Tabuleiro caído', 1]].forEach((x, i) => sm.push([`demo-sm-q${i}`, L, 'demo-i-' + x[0], 'quebra', -x[1], custo[x[0]], x[2], '', ts(x[3], 16, 0), 'Dados de exemplo']));

    // Vendas de 14 dias (contas fechadas), caixas diárias e contas abertas hoje
    const EMP = ['Ana Paula', 'Mateus Kiala', 'Luzia Domingos'], MEIOS = ['numerario', 'numerario', 'tpa', 'tpa', 'tpa', 'express', 'express', 'transferencia'];
    const mesas = await q(`select id, nome from mesas where local_id=$1 and activo and junta_a is null order by ordem, nome`, [L]);
    const comida = arts.filter((a) => a.seccao === 'cozinha'), bebida = arts.filter((a) => a.seccao === 'bar');
    const ped = [], lin = [], pag = [], tur = [], mcx = []; let doc = { [L]: loc.seq_doc || 0, [B]: 0 }, np = 0;
    const conta = (lid, n, h, m, tid, soBar) => {
      const id = 'demo-p-' + (++np), aberto = ts(n, h, m), fechado = new Date(Date.parse(aberto) + ri(25, 80) * 6e4).toISOString(), emp = pick(EMP); let total = 0;
      const escolhas = soBar ? Array.from({ length: ri(1, 4) }, () => pick(bebida)) : [pick(comida), pick(comida), pick(bebida), pick(bebida)].slice(0, ri(2, 4)).concat(rnd() < 0.35 ? [pick(comida)] : []);
      const vistos = new Map(); escolhas.forEach((a) => vistos.set(a.id, a));
      [...vistos.values()].forEach((a, i) => { const qt = a.seccao === 'bar' ? ri(1, 4) : ri(1, 2); total += qt * a.preco; lin.push([`${id}-l${i}`, id, a.id, a.nome, a.preco, qt, a.seccao, 'entregue', aberto, aberto, emp]); });
      const desc = rnd() < 0.06 ? Math.round(total * 0.1 / 100) * 100 : 0; total -= desc;
      const meio = pick(MEIOS); pag.push([id + '-g', id, tid, meio, total, fechado, emp]);
      const mesa = soBar ? { id: null, nome: 'Balcão' } : pick(mesas) || { id: null, nome: 'Balcão' };
      ped.push([id, lid, mesa.id, mesa.nome, mesa.id ? 'mesa' : 'balcao', 'fechado', emp, aberto, fechado, rnd() < 0.15 ? 'Empresa Exemplo, Lda' : '', '', desc, total, tid, ++doc[lid], n > 3 ? 'enviado' : 'pendente', n > 3 ? 'FT 2026/' + (1000 + np) : '']);
      return { meio, total };
    };
    for (let n = 14; n >= 0; n--) {
      const dsem = new Date(dia(n) + 'T12:00:00Z').getUTCDay(), forte = dsem === 5 || dsem === 6, hNow = new Date(agora + 3600e3).getUTCHours();
      for (const [lid, base, soBar] of [[L, forte ? 26 : 16, false], [B, forte ? 18 : 8, true]]) {
        const tid = `demo-t-${lid === L ? 'r' : 'b'}-${n}`, por = { numerario: 0, tpa: 0, express: 0, transferencia: 0 }; let k = base + ri(-3, 4);
        if (n === 0) k = Math.round(k * Math.max(0, Math.min(1, (hNow - 11) / 12)));
        for (let i = 0; i < k; i++) { let h = soBar ? ri(17, 23) : rnd() < 0.45 ? ri(12, 14) : ri(19, 22); if (n === 0) h = Math.min(h, Math.max(11, hNow - 2)); const r = conta(lid, n, h, ri(0, 59), tid, soBar); por[r.meio] += r.total; }
        if (n === 0) continue; // hoje fica sem caixa de exemplo: a caixa real abre-se no menu Caixa
        const dif = pick([0, 0, 0, -500, 1000, -2000]);
        tur.push([tid, lid, 'Luzia Domingos', ts(n, 11, 0), 20000, ts(n, 23, 40), JSON.stringify({ numerario: 20000 + por.numerario - 10000 + dif, tpa: por.tpa, express: por.express, transferencia: por.transferencia, esperado: { numerario: 20000 + por.numerario - 10000, tpa: por.tpa, express: por.express, transferencia: por.transferencia } })]);
        mcx.push([tid + '-m', tid, 'sangria', 10000, 'Depósito no cofre', ts(n, 22, 0), 'Luzia Domingos']);
      }
    }
    // contas abertas agora (para os ecrãs de mesas, cozinha e bar)
    const ocup = (await q(`select mesa_id from pedidos where local_id=$1 and estado='aberto' and mesa_id is not null`, [L])).map((x) => x.mesa_id);
    const livres = mesas.filter((m) => !ocup.includes(m.id)).slice(0, 4), ESTS = ['enviado', 'preparar', 'pronto', 'entregue'];
    livres.slice(0, 3).forEach((m, i) => { const id = 'demo-pa-' + i, t0 = new Date(agora - (12 + i * 9) * 6e4).toISOString(); let total = 0;
      [pick(comida), pick(comida), pick(bebida)].forEach((a, j) => { const qt = ri(1, 2); total += qt * a.preco; lin.push([`${id}-l${j}`, id, a.id, a.nome, a.preco, qt, a.seccao, j === 2 && i === 0 ? 'novo' : ESTS[(i + j) % 4], t0, t0, EMP[i]]); });
      ped.push([id, L, m.id, m.nome, 'mesa', 'aberto', EMP[i], t0, null, '', '', 0, total, null, null, null, '']); });
    await ins(q, 'turnos', ['id', 'local_id', 'utilizador_nome', 'aberto_em', 'fundo', 'fechado_em', 'contado'], tur);
    await ins(q, 'mov_caixa', ['id', 'turno_id', 'tipo', 'valor', 'motivo', 'criado_em', 'utilizador_nome'], mcx);
    await ins(q, 'pedidos', ['id', 'local_id', 'mesa_id', 'mesa_nome', 'tipo', 'estado', 'aberto_por_nome', 'aberto_em', 'fechado_em', 'cliente_nome', 'cliente_nif', 'desconto', 'total', 'turno_id', 'doc_num', 'sync_estado', 'sync_ref'], ped);
    await ins(q, 'linhas', ['id', 'pedido_id', 'artigo_id', 'nome', 'preco', 'qtd', 'seccao', 'estado', 'criado_em', 'enviado_em', 'criado_por_nome'], lin);
    await ins(q, 'pagamentos', ['id', 'pedido_id', 'turno_id', 'meio', 'valor', 'criado_em', 'utilizador_nome'], pag);
    // bairros com taxa de entrega e duas entregas em curso (valores de exemplo)
    await ins(q, 'bairros', ['id', 'nome', 'taxa'], [['Maianga', 1500], ['Alvalade', 1500], ['Ilha de Luanda', 2000], ['Talatona', 3500], ['Kilamba', 4500], ['Viana', 5000]].map((b, i) => ['demo-b-' + i, b[0], b[1]]));
    const ENT = [['Marta Lopes', '+244 923 000 111', 'Maianga', 'Rua de exemplo, n.º 12, 2.º andar', 1500, 'preparar', '', 'preparar'], ['Hélder Cruz', '+244 924 000 222', 'Talatona', 'Condomínio de exemplo, casa 7', 3500, 'caminho', 'João (mota)', 'entregue']];
    for (let i = 0; i < ENT.length; i++) { const [nm, tel, bai, mor, tx, est, estaf, le] = ENT[i], id = 'demo-en-' + i, a = comida[i % comida.length], t0 = new Date(agora - (14 + i * 20) * 6e4).toISOString();
      await q(`insert into pedidos (id, local_id, mesa_nome, tipo, estado, aberto_por_nome, aberto_em, cliente_nome, cliente_tel, morada, bairro, taxa_entrega, estafeta, entrega_estado, total) values ($1,$2,$3,'entrega','aberto',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`, [id, L, 'Entrega · ' + nm, EMP[0], t0, nm, tel, mor, bai, tx, estaf, est, a.preco + tx + 300]);
      await ins(q, 'linhas', ['id', 'pedido_id', 'artigo_id', 'nome', 'preco', 'qtd', 'seccao', 'estado', 'criado_em', 'enviado_em', 'criado_por_nome'], [[id + '-l0', id, a.id, a.nome, a.preco, 1, a.seccao, le, t0, t0, EMP[0]], [id + '-emb', id, null, 'Embalagem take-away', 300, 1, 'embalagem', 'entregue', t0, t0, 'Automático'], [id + '-ent', id, null, 'Taxa de entrega · ' + bai, tx, 1, 'entrega', 'entregue', t0, t0, 'Automático']]); }
    await q(`update locais set seq_doc = greatest(seq_doc, $2) where id = $1`, [L, doc[L]]); await q(`update locais set seq_doc = $1 where id = $2`, [doc[B], B]);
    await ins(q, 'stock_mov', ['id', 'local_id', 'ingrediente_id', 'tipo', 'qtd', 'custo', 'motivo', 'ref', 'criado_em', 'utilizador_nome'], sm);
    await q(`insert into stock_mov (id, local_id, ingrediente_id, tipo, qtd, custo, ref, criado_em, utilizador_nome)
      select 'demo-sv-' || p.id || '-' || f.ingrediente_id, p.local_id, f.ingrediente_id, 'venda', -sum(l.qtd * f.qtd), max(i.custo_medio), p.id, p.fechado_em, 'Dados de exemplo'
      from pedidos p join linhas l on l.pedido_id = p.id join fichas f on f.artigo_id = l.artigo_id join ingredientes i on i.id = f.ingrediente_id
      where p.id like 'demo-p-%' and p.estado = 'fechado' group by p.id, p.local_id, f.ingrediente_id, p.fechado_em on conflict do nothing`);

    // Equipa, escalas, ponto, férias e faltas, salários
    const FUNC = [['Ana Paula Tavares', 'Empregada de mesa', L, 120000, 25000], ['Mateus Kiala', 'Empregado de mesa', L, 120000, 25000], ['Luzia Domingos', 'Gerente de sala', L, 280000, 40000], ['João Baptista', 'Chefe de cozinha', L, 320000, 40000], ['Esperança Mbala', 'Cozinheira', L, 160000, 25000], ['Pedro Sebastião', 'Ajudante de cozinha', L, 95000, 20000], ['Carlos Zua', 'Barman', B, 140000, 25000], ['Marta Calunga', 'Caixa', L, 130000, 25000]];
    await ins(q, 'funcionarios', ['id', 'nome', 'funcao', 'local_id', 'salario_base', 'subsidios', 'data_admissao', 'contacto'], FUNC.map((f, i) => ['demo-fu-' + i, f[0], f[1], f[2], f[3], f[4], `202${3 + (i % 3)}-0${1 + (i % 9)}-15`, '+244 924 000 0' + (20 + i)]));
    const esc = [], pt = [];
    for (let n = -3; n <= 5; n++) FUNC.forEach((f, i) => { if ((i + n + 30) % 6 === 0) return; const tarde = i % 2 === 0; if (n <= 0) esc.push([`demo-e-${i}-${n}`, 'demo-fu-' + i, f[2], dia(n), tarde ? '16:00' : '10:00', tarde ? '00:00' : '18:00']);
      if (n >= 1) pt.push([`demo-pt-${i}-${n}`, 'demo-fu-' + i, f[2], ts(n, tarde ? 16 : 10, ri(-8, 12) + 10), ts(n, tarde ? 23 : 18, ri(0, 40))]); });
    await ins(q, 'escalas', ['id', 'funcionario_id', 'local_id', 'dia', 'inicio', 'fim'], esc);
    await ins(q, 'ponto', ['id', 'funcionario_id', 'local_id', 'entrada', 'saida'], pt);
    await ins(q, 'ausencias', ['id', 'funcionario_id', 'tipo', 'de', 'ate', 'obs'], [['demo-a-1', 'demo-fu-5', 'falta', dia(8), dia(8), 'Sem justificação'], ['demo-a-2', 'demo-fu-1', 'ferias', dia(-10), dia(-17), 'Férias aprovadas'], ['demo-a-3', 'demo-fu-4', 'baixa', dia(5), dia(4), 'Atestado entregue']]);
    const sal = [];
    [1, 0].forEach((m) => FUNC.forEach((f, i) => { const faltas = m === 0 && i === 5 ? Math.round(f[3] / 30) : 0, extras = i === 3 ? 30000 : 0, bruto = f[3] + f[4] + extras - faltas, inss = Math.round(bruto * 0.03);
      sal.push([`demo-s-${m}-${i}`, mes(m), 'demo-fu-' + i, f[0], f[3], f[4], extras, faltas, inss, 0, 0, bruto - inss, m ? 'pago' : 'processado', m ? 'enviado' : 'pendente']); }));
    await ins(q, 'salarios', ['id', 'mes', 'funcionario_id', 'nome', 'base', 'subsidios', 'extras', 'faltas', 'inss', 'irt', 'descontos', 'liquido', 'estado', 'sync_estado'], sal);

    // Finanças: despesas, bancos e tesouraria
    const DESP = [['Renda', 'Renda do restaurante', 450000, 1], ['Energia e água', 'ENDE e EPAL', 118000, 1], ['Gás', 'Botijas de gás', 64000, 1], ['Internet e telefone', 'Internet e telemóveis', 45000, 1], ['Marketing', 'Publicidade nas redes sociais', 60000, 1], ['Manutenção', 'Reparação da câmara frigorífica', 85000, 0], ['Limpeza', 'Produtos de limpeza', 32000, 1]];
    const desp = []; [1, 0].forEach((m) => DESP.forEach((d, i) => { if (m === 1 && i === 5) return; desp.push([`demo-d-${m}-${i}`, L, d[0], d[1], d[2], mes(m) + '-0' + (2 + i), m === 1 ? true : !!d[3], 'Transferência']); }));
    await ins(q, 'despesas', ['id', 'local_id', 'categoria', 'descricao', 'valor', 'dia', 'pago', 'meio'], desp);
    await ins(q, 'contas_banc', ['id', 'nome', 'saldo_inicial'], [['demo-b-1', 'BAI — conta à ordem (exemplo)', 2500000], ['demo-b-2', 'Cofre (exemplo)', 150000]]);
    const mt = [['demo-mt-1', 'demo-b-1', dia(12), 1850000, 'Depósito de vendas (TPA e Express)'], ['demo-mt-2', 'demo-b-1', dia(10), -450000, 'Renda'], ['demo-mt-3', 'demo-b-1', dia(9), -1650000, 'Salários ' + mes(1)], ['demo-mt-4', 'demo-b-1', dia(5), 2100000, 'Depósito de vendas (TPA e Express)'], ['demo-mt-5', 'demo-b-1', dia(4), -620000, 'Pagamento a fornecedores'], ['demo-mt-6', 'demo-b-2', dia(3), 70000, 'Sangrias da caixa'], ['demo-mt-7', 'demo-b-2', dia(1), -40000, 'Compras miúdas']];
    await ins(q, 'mov_tes', ['id', 'conta_id', 'dia', 'valor', 'descricao'], mt);

    // Clientes e reservas
    const CLI = ['Família Santos', 'Dr. António Neto', 'Empresa Exemplo, Lda', 'Maria João Fernandes', 'Paulo Kapela', 'Teresa Van-Dúnem', 'Grupo de Amigos de Benguela', 'Helena Dias'];
    await ins(q, 'clientes', ['id', 'nome', 'nif', 'telefone', 'email', 'notas'], CLI.map((c, i) => ['demo-cl-' + i, c, i === 2 ? '5417000099' : '', '+244 925 000 0' + (30 + i), '', ['Mesa junto à janela', 'Alérgico a marisco', 'Factura com NIF, pagamento a 30 dias', '', 'Gosta do mufete bem passado', '', 'Costuma vir em grupo de 10', 'Vegetariana'][i]]));
    const RES = [[0, '13:00', 0, 4, 'confirmada', ''], [0, '20:00', 6, 10, 'confirmada', 'Aniversário, trazem bolo'], [0, '20:30', 1, 2, 'confirmada', 'Mesa sossegada'], [-1, '13:30', 2, 6, 'confirmada', 'Almoço de empresa'], [-1, '21:00', 5, 4, 'confirmada', ''], [-3, '20:00', 3, 2, 'confirmada', ''], [1, '20:00', 4, 2, 'sentada', ''], [2, '21:00', 7, 2, 'faltou', 'Não atendeu o telefone']];
    await ins(q, 'reservas', ['id', 'local_id', 'cliente_nome', 'telefone', 'dia', 'hora', 'pessoas', 'mesa_id', 'estado', 'notas'], RES.map((r, i) => ['demo-r-' + i, L, CLI[r[2]], '+244 925 000 0' + (30 + r[2]), dia(r[0]), r[1], r[3], (mesas[i % Math.max(1, mesas.length)] || {}).id || null, r[4], r[5]]));
    await q(`insert into meta (k, v) values ('demo', 'carregado') on conflict (k) do update set v = excluded.v`);
  });
  return { ok: true };
}

module.exports = { carregar, apagar };
