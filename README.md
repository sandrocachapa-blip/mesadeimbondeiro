# Mesa de Imbondeiro

Gestão unificada de restaurantes e bares. Esta versão cobre as fases 0 e 1 do mapa do projecto:
configuração (empresa, locais, mesas, utilizadores, carta e preços por local), ponto de venda,
ecrãs de cozinha e bar, caixa, fila de facturação para o software certificado, relatórios de vendas
e menu digital por QR. O ponto de venda funciona sem rede e sincroniza quando a ligação volta.

- `public/` — aplicação (HTML, CSS e JavaScript sem passo de compilação) e menu público em `/menu?l=<local>`
- `api/index.js` + `lib/core.js` — API (funções Vercel, Postgres no Neon)
- `dev.js` — servidor local com base de dados em memória: `npm install && npm run dev`
- `test/test.js` — testes da API: `npm test`

Variáveis no Vercel: `DATABASE_URL` (Neon), `AUTH_SECRET`, `ADMIN_PASSWORD` (só usada na primeira execução,
para criar o utilizador `admin`). O esquema da base de dados é criado automaticamente no primeiro pedido.
