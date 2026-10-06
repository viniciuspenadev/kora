# Ensaio dos Resultados dos Formulários (migration 20261006000100)

Roda a migration **num PostgreSQL descartável** e ataca as regras. Nunca aponte para produção.
Validado em 06/10/2026 com PostgreSQL 17 portátil (`.tmp/billing-pg17/runtime/pgsql/bin`), porta 5566.

```bash
PG=.tmp/billing-pg17/runtime/pgsql/bin; D=<pasta-temporária>
$PG/initdb.exe -D $D/data -U postgres -A trust -E UTF8 --locale=C
$PG/pg_ctl.exe -D $D/data -o "-p 5566 -c listen_addresses=127.0.0.1" -l $D/server.log -W start
C="-h 127.0.0.1 -p 5566 -U postgres -v ON_ERROR_STOP=1 -q"
$PG/psql.exe $C -d postgres -c "CREATE DATABASE kora_forms_results"
for f in scripts/test-forms-publish/00-stubs.sql supabase/migrations/20261002000100_forms_base.sql \
         supabase/migrations/20261002000200_forms_publish.sql supabase/migrations/20261002000300_merge_contacts_forms.sql \
         supabase/migrations/20261006000100_forms_step_stats.sql scripts/test-forms-results/10-tests.sql; do
  $PG/psql.exe $C -d kora_forms_results -f $f; done
PG=$PG PORT=5566 DB=kora_forms_results bash scripts/test-forms-results/20-race.sh
```

**`10-tests.sql`** (6 blocos):
1. tabela fechada para o navegador, RLS ligada, a porta (`form_track`) só do servidor, o servidor não apaga contador, nenhuma coluna de dado pessoal;
2. o token do navegador (authenticated) não lê nem conta, mesmo com a empresa certa;
3. só formulário publicado; só passo da VERSÃO publicada (o que está só no rascunho é recusado); "saiu" antes de começar não conta; códigos e passos tortos; tipo e teto fora da faixa estouram; cada empresa no seu contador;
4. teto por passo e dia (um robô não infla sem fim);
5. a empresa do contador não muda; arquivado não conta e mantém os números; apagar o formulário leva os contadores;
6. o rollback documentado desfaz tudo (transação desfeita).

**`20-race.sh`**: 40 "viu" ao mesmo tempo → exatamente 40; 40 "começou" com teto 15 → exatamente 15.

Resultado de 06/10: tudo OK. Controle: `ASSERT 1 = 2` falha, então as checagens estão ligadas.
