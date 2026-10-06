# Ensaio da Fase 2 dos Formulários (migrations 20261002000200 + 20261002000300)

Roda as migrations **num PostgreSQL descartável** e ataca as regras. Nunca aponte para produção.
Validado em 02/10/2026 com PostgreSQL 17 portátil (`.tmp/billing-pg17/runtime/pgsql/bin`), porta 5565.

```bash
PG=.tmp/billing-pg17/runtime/pgsql/bin; D=<pasta-temporária>
$PG/initdb.exe -D $D/data -U postgres -A trust -E UTF8 --locale=C
$PG/pg_ctl.exe -D $D/data -o "-p 5565 -c listen_addresses=127.0.0.1" -l $D/server.log -W start
C="-h 127.0.0.1 -p 5565 -U postgres -v ON_ERROR_STOP=1 -q"
$PG/psql.exe $C -d postgres -c "CREATE DATABASE kora_forms_publish"
for f in scripts/test-forms-publish/00-stubs.sql supabase/migrations/20261002000100_forms_base.sql \
         supabase/migrations/20261002000200_forms_publish.sql supabase/migrations/20261002000300_merge_contacts_forms.sql \
         scripts/test-forms-publish/10-tests.sql; do $PG/psql.exe $C -d kora_forms_publish -f $f; done
PG=$PG PORT=5565 DB=kora_forms_publish bash scripts/test-forms-publish/20-race.sh
```

**`10-tests.sql`** (9 blocos):
1. tabelas fechadas para o navegador, RLS ligada, funções só do servidor, fusão de contatos com as respostas;
2. o token do navegador (authenticated) não lê nem executa, mesmo com a empresa certa;
3. versão só do próprio formulário/empresa, número único, formatos, "publicado tem versão", até 20 sites;
4. versão append-only até para o dono do banco (nem a empresa muda);
5. porta de gravação: empresa errada, versão trocada, mesmo número com e sem 9 (teto 3), teto do formulário, teto do aparelho, aceite obrigatório, formatos, pausado;
6. comprovante imutável (respostas, aceite, telefone, data, empresa); situação/ficha/sugestões mudam; FK de versão de outro formulário recusada;
7. números da lista por empresa (não vaza a outra);
8. apagar a ficha solta o vínculo (o comprovante fica — a LGPD apaga explícito); formulário com resposta não some; apagar a empresa leva tudo;
9. o rollback documentado desfaz tudo (transação desfeita).

**`20-race.sh`**: 25 envios simultâneos do mesmo número → exatamente 3; 25 números diferentes com teto 10 → exatamente 10.

Resultado de 02/10: tudo OK. Controle: `ASSERT 1 = 2` falha, então as checagens estão ligadas.
