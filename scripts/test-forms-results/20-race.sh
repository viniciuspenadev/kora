#!/usr/bin/env bash
# Corrida nos contadores: N chegadas AO MESMO TEMPO somam todas (nenhuma se perde) e o teto do dia
# não fura. Uso: PG=<bin do postgres> PORT=5566 DB=kora_forms_results bash scripts/test-forms-results/20-race.sh
set -euo pipefail
C="-h 127.0.0.1 -p ${PORT:-5566} -U postgres -d ${DB:-kora_forms_results} -v ON_ERROR_STOP=1 -q -t -A"
T=cccc0000-0000-4000-8000-0000000000d1
F=f0000000-0000-4000-8000-0000000000d1
V=d0000000-0000-4000-8000-0000000000d1
"$PG/psql" $C -c "INSERT INTO public.tenants VALUES ('$T');
  INSERT INTO public.forms (id, tenant_id, public_id, slug, name) VALUES ('$F', '$T', 'corridacontador00001', 'corrida-contador', 'Corrida');
  INSERT INTO public.form_versions (id, tenant_id, form_id, version, definition, hash) VALUES ('$V', '$T', '$F', 1, '{\"questions\":[{\"id\":\"servico\"}]}', repeat('d', 64));
  UPDATE public.forms SET status = 'published', published_version_id = '$V' WHERE id = '$F';"

call() { "$PG/psql" $C -c "SET ROLE service_role; SELECT public.form_track('corridacontador00001', '$1', 'reached', $2)" >/dev/null; }

# 1. 40 "viu" simultâneos, teto alto → exatamente 40.
for i in $(seq 1 40); do call __view 100000 & done; wait
views=$("$PG/psql" $C -c "SELECT reached FROM public.form_step_stats WHERE form_id = '$F' AND step = '__view'")
# 2. 40 "começou" simultâneos com teto 15 → exatamente 15.
for i in $(seq 1 40); do call __start 15 & done; wait
starts=$("$PG/psql" $C -c "SELECT reached FROM public.form_step_stats WHERE form_id = '$F' AND step = '__start'")
echo "viu: $views (esperado 40) · começou com teto 15: $starts (esperado 15)"
[ "$views" = "40" ] && [ "$starts" = "15" ] && echo "CORRIDA OK" || { echo "CORRIDA FALHOU"; exit 1; }
