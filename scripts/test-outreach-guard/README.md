# Ensaio da trava do Disparar (migration 20261001000100)

Roda a migration **num PostgreSQL descartável** e ataca a trava. Nunca aponte para produção.

Validado em 01/10/2026 com PostgreSQL 17 portátil (`.tmp/billing-pg17/runtime/pgsql/bin`), porta 5563.

```bash
PG=.tmp/billing-pg17/runtime/pgsql/bin; D=<pasta-temporária>/data
$PG/initdb.exe -D $D -U postgres -A trust -E UTF8 --locale=C
$PG/pg_ctl.exe -D $D -o "-p 5563 -c listen_addresses=127.0.0.1" -l $D/../server.log start
C="-h 127.0.0.1 -p 5563 -U postgres -v ON_ERROR_STOP=1 -q"
$PG/psql.exe $C -d postgres -c "CREATE DATABASE kora_outreach_test"
$PG/psql.exe $C -d kora_outreach_test -f scripts/test-outreach-guard/00-stubs.sql
$PG/psql.exe $C -d kora_outreach_test -f supabase/migrations/20261001000100_outreach_guard.sql
$PG/psql.exe $C -d kora_outreach_test -f scripts/test-outreach-guard/10-tests.sql
```

**`10-tests.sql`** (como `service_role`, o papel do servidor): libera a 1ª vez · segura o mesmo número (com e sem o 9) · outra empresa não é afetada · falha não fecha a janela · reserva sem acerto segura · 25 h depois libera · teto por empresa com aviso 1× · recusa não conta no teto, falha conta · campos do livro imutáveis (telefone, data, origem) · desfecho só `claimed → sent|failed` · `tenant_id` imutável · vocabulário e limites validados · apagar conversa solta o vínculo · navegador (`anon`/`authenticated`) não lê nem chama a função · apagar empresa leva o livro.

**Corrida** (resultado de 01/10): 25 pedidos simultâneos para o mesmo número → 1 liberado, 24 barrados. 40 simultâneos contra 10 vagas → exatamente 10. 30 simultâneos contra teto 5 → aviso ao dono **1** vez.

```bash
for i in $(seq 1 25); do $PG/psql.exe $C -d kora_outreach_test -tAc "SELECT allowed FROM public.claim_outreach('aaaaaaaa-0000-4000-8000-000000000001','5548991230000','554891230000','form',NULL,NULL,NULL,NULL,24,60)" & done; wait
$PG/psql.exe $C -d kora_outreach_test -tAc "SELECT outcome, count(*) FROM public.outreach_log WHERE phone_key='554891230000' GROUP BY 1"   # claimed|1 · throttled|24
```
