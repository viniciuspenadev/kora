# Ensaio da base dos Formulários (migration 20261002000100)

Roda a migration **num PostgreSQL descartável** e ataca as regras. Nunca aponte para produção.
Validado em 02/10/2026 com PostgreSQL 17 portátil (`.tmp/billing-pg17/runtime/pgsql/bin`), porta 5564,
antes da aplicação em produção (01:07).

```bash
PG=.tmp/billing-pg17/runtime/pgsql/bin; D=<pasta-temporária>/data
$PG/initdb.exe -D $D -U postgres -A trust -E UTF8 --locale=C
$PG/pg_ctl.exe -D $D -o "-p 5564 -c listen_addresses=127.0.0.1" -l $D/../server.log -W start
C="-h 127.0.0.1 -p 5564 -U postgres -v ON_ERROR_STOP=1 -q"
$PG/psql.exe $C -d postgres -c "CREATE DATABASE kora_forms_test"
$PG/psql.exe $C -d kora_forms_test -f scripts/test-forms-base/00-stubs.sql
$PG/psql.exe $C -d kora_forms_test -f supabase/migrations/20261002000100_forms_base.sql
$PG/psql.exe $C -d kora_forms_test -f scripts/test-forms-base/10-tests.sql
```

**`10-tests.sql`** (como `service_role`):
1. permissão nasce `none` e só aceita o vocabulário;
2. módulo desligado, fora de plano, na categoria de Marketing;
3. formulário válido entra com os padrões;
4. formatos e limites: código público, slug, nome só de espaço, status, rascunho objeto e ≤ 256 KB;
5. slug único por empresa e código público único em todo o Kora;
6. guarda: código público, modelo de origem, data, autor e `tenant_id` não mudam;
7. o que pode mudar, muda;
8. apagar o perfil do autor solta o vínculo;
9. o navegador não lê nem grava;
10. apagar a empresa leva os formulários;
11. o rollback documentado desfaz tudo (dentro de transação desfeita).

Resultado de 02/10: todos OK. Controle: um `ASSERT 1 = 2` falha, ou seja, as checagens estão ligadas.
