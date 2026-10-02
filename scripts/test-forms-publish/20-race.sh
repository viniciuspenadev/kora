#!/usr/bin/env bash
# Corrida na porta de gravação: N envios AO MESMO TEMPO não furam os tetos (trava por formulário).
# Uso: PG=<bin do postgres> PORT=5565 DB=kora_forms_publish bash scripts/test-forms-publish/20-race.sh
set -euo pipefail
C="-h 127.0.0.1 -p ${PORT:-5565} -U postgres -d ${DB:-kora_forms_publish} -v ON_ERROR_STOP=1 -q -t -A"
T=cccc0000-0000-4000-8000-0000000000c1
F=f0000000-0000-4000-8000-0000000000c1
V=d0000000-0000-4000-8000-0000000000c1
"$PG/psql" $C -c "INSERT INTO public.tenants VALUES ('$T');
  INSERT INTO public.forms (id, tenant_id, public_id, slug, name) VALUES ('$F', '$T', 'cccccccccccccccccccc', 'corrida', 'Corrida');
  INSERT INTO public.form_versions (id, tenant_id, form_id, version, definition, hash) VALUES ('$V', '$T', '$F', 1, '{}', repeat('c', 64));
  UPDATE public.forms SET status = 'published', published_version_id = '$V' WHERE id = '$F';"

call() { "$PG/psql" $C -c "SET ROLE service_role; SELECT public.form_submit('$T','$F','$V','$1','$2','R','{}','{\"accepted\":true}','{}',NULL,$3,3,1000)->>'ok'"; }

# 1. 25 envios simultâneos do MESMO número (teto 3) → exatamente 3.
for i in $(seq 1 25); do call 5547998124471 554798124471 1000 & done; wait
same=$("$PG/psql" $C -c "SELECT count(*) FROM public.form_submissions WHERE form_id = '$F'")
# 2. 25 números diferentes ao mesmo tempo com teto do formulário 10 (já há 3) → total 10.
for i in $(seq 10 34); do call "55119111100$i" "5511111100$i" 10 & done; wait
total=$("$PG/psql" $C -c "SELECT count(*) FROM public.form_submissions WHERE form_id = '$F'")
echo "mesmo numero: $same (esperado 3) · total com teto 10: $total (esperado 10)"
[ "$same" = "3" ] && [ "$total" = "10" ] && echo "CORRIDA OK" || { echo "CORRIDA FALHOU"; exit 1; }
