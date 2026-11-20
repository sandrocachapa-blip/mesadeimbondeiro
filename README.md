# Mesa de Imbondeiro

Gestão unificada de restaurantes e bares, com as quatro fases do mapa do projecto:

- Fases 0 e 1: configuração, planta da sala em 3D, ponto de venda (também em telemóvel e tablet), cozinha e bar, caixa, fila de facturação para o software certificado, relatórios e menu digital por QR.
- Fase 2: ingredientes, fichas técnicas e custo por prato, stock com baixa automática por venda, compras e fornecedores.
- Fase 3: equipa, escalas, ponto, férias e faltas, salários (exportação para o software oficial) e finanças (resultado por local, contas a pagar, tesouraria, despesas).
- Fase 4: reservas, clientes, pedido do cliente por QR na mesa, painel de alertas e consolidado do grupo.

O ponto de venda funciona sem rede e sincroniza quando a ligação volta; a retaguarda precisa de ligação.

- `public/` — aplicação (HTML, CSS e JavaScript sem passo de compilação) e menu público em `/menu?l=<local>`
- `public/modulos.js` — ecrãs das fases 2 a 4
- `api/index.js` + `lib/core.js` + `lib/mod.js` — API (funções Vercel, Postgres no Neon)
- `dev.js` — servidor local com base de dados em memória: `npm install && npm run dev`
- `test/test.js` — testes da API: `npm test`

Variáveis no Vercel: `DATABASE_URL` (Neon), `AUTH_SECRET`, `ADMIN_PASSWORD` (só usada na primeira execução,
para criar o utilizador `admin`). O esquema da base de dados é criado automaticamente no primeiro pedido.
