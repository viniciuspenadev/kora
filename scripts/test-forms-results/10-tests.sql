-- Ataque às regras da migration 20261006000100 (Resultados: contadores por passo, sem dado pessoal).
-- Rodar DEPOIS de test-forms-publish/00-stubs.sql, 20261002000100, 20261002000200, 20261002000300 e 20261006000100.
\set ON_ERROR_STOP on

-- Cenário: formulário publicado (perguntas servico e prazo), um rascunho, um pausado e um arquivado.
INSERT INTO public.forms (id, tenant_id, public_id, slug, name) VALUES
  ('f1000000-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000001', 'publicado00000000001', 'publicado', 'Publicado'),
  ('f1000000-0000-4000-8000-000000000002', 'aaaaaaaa-0000-4000-8000-000000000001', 'rascunho000000000002', 'rascunho', 'Rascunho'),
  ('f1000000-0000-4000-8000-000000000003', 'aaaaaaaa-0000-4000-8000-000000000001', 'pausado0000000000003', 'pausado', 'Pausado'),
  ('f1000000-0000-4000-8000-000000000004', 'bbbbbbbb-0000-4000-8000-000000000002', 'outraempresa00000004', 'outra', 'Outra empresa');
INSERT INTO public.form_versions (id, tenant_id, form_id, version, definition, hash) VALUES
  ('d1000000-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', 1,
   '{"questions":[{"id":"servico"},{"id":"prazo"}]}', repeat('a', 64)),
  ('d1000000-0000-4000-8000-000000000003', 'aaaaaaaa-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000003', 1,
   '{"questions":[{"id":"servico"}]}', repeat('b', 64)),
  ('d1000000-0000-4000-8000-000000000004', 'bbbbbbbb-0000-4000-8000-000000000002', 'f1000000-0000-4000-8000-000000000004', 1,
   '{"questions":[{"id":"servico"}]}', repeat('c', 64));
UPDATE public.forms SET status = 'published', published_version_id = 'd1000000-0000-4000-8000-000000000001',
  draft = '{"questions":[{"id":"servico"},{"id":"prazo"},{"id":"so_no_rascunho"}]}'
 WHERE id = 'f1000000-0000-4000-8000-000000000001';
UPDATE public.forms SET status = 'published', published_version_id = 'd1000000-0000-4000-8000-000000000003' WHERE id = 'f1000000-0000-4000-8000-000000000003';
UPDATE public.forms SET status = 'paused' WHERE id = 'f1000000-0000-4000-8000-000000000003';
UPDATE public.forms SET status = 'published', published_version_id = 'd1000000-0000-4000-8000-000000000004' WHERE id = 'f1000000-0000-4000-8000-000000000004';

-- 1. Fechada para o navegador; RLS ligada; a porta é só do servidor; o servidor não apaga.
DO $$ BEGIN
  ASSERT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.form_step_stats'::regclass), 'RLS desligada';
  ASSERT NOT has_table_privilege('anon', 'public.form_step_stats', 'SELECT') AND NOT has_table_privilege('anon', 'public.form_step_stats', 'INSERT'), 'anon alcança';
  ASSERT NOT has_table_privilege('authenticated', 'public.form_step_stats', 'SELECT') AND NOT has_table_privilege('authenticated', 'public.form_step_stats', 'UPDATE'), 'authenticated alcança';
  ASSERT NOT has_table_privilege('service_role', 'public.form_step_stats', 'DELETE'), 'servidor não deveria apagar contador';
  ASSERT NOT has_function_privilege('anon', 'public.form_track(text,text,text,integer)', 'EXECUTE'), 'anon executa';
  ASSERT NOT has_function_privilege('authenticated', 'public.form_track(text,text,text,integer)', 'EXECUTE'), 'authenticated executa';
  ASSERT has_function_privilege('service_role', 'public.form_track(text,text,text,integer)', 'EXECUTE'), 'servidor não executa';
  -- Nenhuma coluna de dado pessoal.
  ASSERT NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'form_step_stats'
                      AND column_name ~ '(phone|name|ip|email|device|contact|user)'), 'coluna com cara de dado pessoal';
  RAISE NOTICE '1 ok: fechada, RLS, porta só do servidor, sem dado pessoal';
END $$;

-- 2. O navegador (authenticated) bate na parede mesmo com a empresa certa no token.
SET ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"app_tenant_id":"aaaaaaaa-0000-4000-8000-000000000001"}', false);
DO $$ BEGIN
  BEGIN PERFORM 1 FROM public.form_step_stats; RAISE EXCEPTION 'leu'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM public.form_track('publicado00000000001', '__view', 'reached', 10); RAISE EXCEPTION 'executou'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  RAISE NOTICE '2 ok: navegador não lê nem conta';
END $$;
RESET ROLE;

-- 3. A porta: só formulário publicado, só passo da VERSÃO publicada, soma sem perder.
SET ROLE service_role;
DO $$
DECLARE r record;
BEGIN
  ASSERT public.form_track('publicado00000000001', '__view', 'reached', 100), 'viu não contou';
  ASSERT public.form_track('publicado00000000001', '__view', 'reached', 100), 'viu (2ª) não contou';
  ASSERT public.form_track('publicado00000000001', '__start', 'reached', 100), 'começou não contou';
  ASSERT public.form_track('publicado00000000001', 'servico', 'reached', 100), 'pergunta publicada não contou';
  ASSERT public.form_track('publicado00000000001', 'prazo', 'exit', 100), 'saída na pergunta não contou';
  ASSERT public.form_track('publicado00000000001', '__contact', 'exit', 100), 'saída em Seus dados não contou';
  ASSERT public.form_track('publicado00000000001', '__review', 'reached', 100), 'revisão não contou';
  SELECT reached, exits, tenant_id, day INTO r FROM public.form_step_stats WHERE form_id = 'f1000000-0000-4000-8000-000000000001' AND step = '__view';
  ASSERT r.reached = 2 AND r.exits = 0, 'viu deveria ser 2';
  ASSERT r.tenant_id = 'aaaaaaaa-0000-4000-8000-000000000001', 'empresa errada no contador';
  ASSERT r.day = (now() AT TIME ZONE 'America/Sao_Paulo')::date, 'dia fora do horário de Brasília';
  ASSERT (SELECT exits FROM public.form_step_stats WHERE form_id = 'f1000000-0000-4000-8000-000000000001' AND step = 'prazo') = 1, 'saída não somou';

  -- Recusas: passo que não existe na versão publicada (inclusive o que só está no rascunho),
  -- saída antes de começar, formulário rascunho/pausado/arquivado, códigos tortos.
  ASSERT NOT public.form_track('publicado00000000001', 'so_no_rascunho', 'reached', 100), 'pergunta só do rascunho contou';
  ASSERT NOT public.form_track('publicado00000000001', 'inventada', 'reached', 100), 'pergunta inventada contou';
  ASSERT NOT public.form_track('publicado00000000001', '__view', 'exit', 100), 'saída antes de começar contou';
  ASSERT NOT public.form_track('publicado00000000001', '__start', 'exit', 100), 'saída no começou contou';
  ASSERT NOT public.form_track('rascunho000000000002', '__view', 'reached', 100), 'rascunho contou';
  ASSERT NOT public.form_track('pausado0000000000003', '__view', 'reached', 100), 'pausado contou';
  ASSERT NOT public.form_track('PUBLICADO00000000001', '__view', 'reached', 100), 'código maiúsculo contou';
  ASSERT NOT public.form_track('publicado00000000001', '../admin', 'reached', 100), 'passo torto contou';
  ASSERT NOT public.form_track('publicado00000000001', 'Servico', 'reached', 100), 'passo maiúsculo contou';
  ASSERT NOT public.form_track('publicado00000000001', NULL, 'reached', 100), 'passo nulo contou';
  ASSERT NOT public.form_track(NULL, '__view', 'reached', 100), 'código nulo contou';
  BEGIN PERFORM public.form_track('publicado00000000001', '__view', 'apagar', 100); RAISE EXCEPTION 'tipo inválido passou';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN PERFORM public.form_track('publicado00000000001', '__view', 'reached', 0); RAISE EXCEPTION 'teto 0 passou';
  EXCEPTION WHEN check_violation THEN NULL; END;
  ASSERT NOT EXISTS (SELECT 1 FROM public.form_step_stats WHERE step IN ('so_no_rascunho', 'inventada')), 'linha de passo recusado';
  ASSERT NOT EXISTS (SELECT 1 FROM public.form_step_stats WHERE form_id IN ('f1000000-0000-4000-8000-000000000002', 'f1000000-0000-4000-8000-000000000003')), 'contou formulário fora do ar';

  -- Outra empresa: conta no formulário DELA, com a empresa DELA.
  ASSERT public.form_track('outraempresa00000004', '__view', 'reached', 100), 'outra empresa não contou';
  ASSERT (SELECT tenant_id FROM public.form_step_stats WHERE form_id = 'f1000000-0000-4000-8000-000000000004') = 'bbbbbbbb-0000-4000-8000-000000000002', 'misturou empresa';
  RAISE NOTICE '3 ok: só publicado, só passo da versão publicada, soma e recusa';
END $$;

-- 4. Teto por passo/dia: um robô não infla sem fim.
DO $$
DECLARE i int; n int := 0;
BEGIN
  FOR i IN 1..10 LOOP IF public.form_track('publicado00000000001', '__start', 'reached', 5) THEN n := n + 1; END IF; END LOOP;
  -- já havia 1 "começou": cabem mais 4 até 5.
  ASSERT n = 4, format('teto furou: contou %s', n);
  ASSERT (SELECT reached FROM public.form_step_stats WHERE form_id = 'f1000000-0000-4000-8000-000000000001' AND step = '__start') = 5, 'teto não segurou em 5';
  RAISE NOTICE '4 ok: teto por passo e dia';
END $$;
RESET ROLE;

-- 5. Parede: a empresa do contador não muda; arquivar mantém, apagar o formulário leva os contadores.
DO $$ BEGIN
  BEGIN
    UPDATE public.form_step_stats SET tenant_id = 'bbbbbbbb-0000-4000-8000-000000000002' WHERE form_id = 'f1000000-0000-4000-8000-000000000001';
    RAISE EXCEPTION 'empresa mudou';
  EXCEPTION WHEN check_violation OR foreign_key_violation THEN NULL; END;
  UPDATE public.forms SET archived_at = now() WHERE id = 'f1000000-0000-4000-8000-000000000001';
  ASSERT NOT public.form_track('publicado00000000001', '__view', 'reached', 100), 'arquivado contou';
  ASSERT EXISTS (SELECT 1 FROM public.form_step_stats WHERE form_id = 'f1000000-0000-4000-8000-000000000001'), 'arquivar apagou os números';
  DELETE FROM public.forms WHERE id = 'f1000000-0000-4000-8000-000000000004';
  ASSERT NOT EXISTS (SELECT 1 FROM public.form_step_stats WHERE form_id = 'f1000000-0000-4000-8000-000000000004'), 'contador ficou órfão';
  RAISE NOTICE '5 ok: parede de empresa, arquivado não conta, apagar leva junto';
END $$;

-- 6. O rollback documentado desfaz tudo (em transação desfeita).
BEGIN;
DROP FUNCTION public.form_track(text, text, text, integer);
DROP TABLE public.form_step_stats;
DO $$ BEGIN
  ASSERT to_regclass('public.form_step_stats') IS NULL, 'rollback não removeu a tabela';
  RAISE NOTICE '6 ok: rollback desfaz';
END $$;
ROLLBACK;
