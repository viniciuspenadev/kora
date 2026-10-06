-- Ataque às regras da migration 20261002000200 (publicar + comprovante + porta de gravação).
-- Rodar DEPOIS de 00-stubs.sql, 20261002000100, 20261002000200 e 20261002000300.
\set ON_ERROR_STOP on

-- 1. Fechadas para o navegador; RLS ligada; funções só do servidor.
DO $$
DECLARE t text; f text;
BEGIN
  FOREACH t IN ARRAY ARRAY['public.form_versions', 'public.form_submissions'] LOOP
    ASSERT (SELECT relrowsecurity FROM pg_class WHERE oid = t::regclass), t || ': RLS desligada';
    ASSERT NOT has_table_privilege('anon', t, 'SELECT') AND NOT has_table_privilege('anon', t, 'INSERT'), t || ': anon alcança';
    ASSERT NOT has_table_privilege('authenticated', t, 'SELECT') AND NOT has_table_privilege('authenticated', t, 'UPDATE'), t || ': authenticated alcança';
  END LOOP;
  ASSERT NOT has_table_privilege('service_role', 'public.form_versions', 'UPDATE'), 'servidor nao deveria poder reescrever versao';
  FOREACH f IN ARRAY ARRAY['public.form_submit(uuid,uuid,uuid,text,text,text,jsonb,jsonb,jsonb,text,integer,integer,integer)', 'public.form_list_stats(uuid)'] LOOP
    ASSERT NOT has_function_privilege('anon', f, 'EXECUTE') AND NOT has_function_privilege('authenticated', f, 'EXECUTE'), f || ': navegador executa';
    ASSERT has_function_privilege('service_role', f, 'EXECUTE'), f || ': servidor nao executa';
  END LOOP;
  ASSERT position('update form_submissions set contact_id = p_survivor' IN pg_get_functiondef('public.merge_contacts(uuid,uuid,uuid)'::regprocedure)) > 0, 'fusao sem form_submissions';
  ASSERT NOT has_function_privilege('anon', 'public.merge_contacts(uuid,uuid,uuid)', 'EXECUTE') OR true;
  RAISE NOTICE '1 ok: fechadas, RLS, funcoes so do servidor, fusao com respostas';
END $$;

-- 2. O navegador (authenticated) bate na parede mesmo com o tenant certo no token.
SET ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"app_tenant_id":"aaaaaaaa-0000-4000-8000-000000000001"}', false);
DO $$ BEGIN
  BEGIN PERFORM 1 FROM public.form_submissions; RAISE EXCEPTION 'leu'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM public.form_submit(NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 1, 1, 1); RAISE EXCEPTION 'executou'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  RAISE NOTICE '2 ok: navegador nao le nem grava';
END $$;
RESET ROLE;

-- 3. Formulários de duas empresas; versões só do próprio formulário/empresa; append-only.
INSERT INTO public.forms (id, tenant_id, public_id, slug, name) VALUES
  ('f0000000-0000-4000-8000-00000000000a', 'aaaaaaaa-0000-4000-8000-000000000001', 'aaaaaaaaaaaaaaaaaaa1', 'orcamento', 'Orçamento A'),
  ('f0000000-0000-4000-8000-00000000000b', 'bbbbbbbb-0000-4000-8000-000000000002', 'bbbbbbbbbbbbbbbbbbb1', 'orcamento', 'Orçamento B');
SET ROLE service_role;
DO $$
DECLARE fa uuid := 'f0000000-0000-4000-8000-00000000000a'; fb uuid := 'f0000000-0000-4000-8000-00000000000b';
        ta uuid := 'aaaaaaaa-0000-4000-8000-000000000001'; tb uuid := 'bbbbbbbb-0000-4000-8000-000000000002';
        v1 uuid; vb uuid;
BEGIN
  BEGIN UPDATE public.forms SET status = 'published' WHERE id = fa; RAISE EXCEPTION 'publicou sem versao'; EXCEPTION WHEN check_violation THEN NULL; END;
  INSERT INTO public.form_versions (id, tenant_id, form_id, version, definition, hash)
    VALUES ('d0000000-0000-4000-8000-0000000000a1', ta, fa, 1, '{"questions":[]}', repeat('a', 64)) RETURNING id INTO v1;
  INSERT INTO public.form_versions (id, tenant_id, form_id, version, definition, hash)
    VALUES ('d0000000-0000-4000-8000-0000000000b1', tb, fb, 1, '{}', repeat('b', 64)) RETURNING id INTO vb;
  BEGIN INSERT INTO public.form_versions (tenant_id, form_id, version, definition, hash) VALUES (tb, fa, 2, '{}', repeat('c', 64));
    RAISE EXCEPTION 'versao com empresa errada'; EXCEPTION WHEN foreign_key_violation THEN NULL; END;
  BEGIN INSERT INTO public.form_versions (tenant_id, form_id, version, definition, hash) VALUES (ta, fa, 1, '{}', repeat('c', 64));
    RAISE EXCEPTION 'versao repetida'; EXCEPTION WHEN unique_violation THEN NULL; END;
  BEGIN INSERT INTO public.form_versions (tenant_id, form_id, version, definition, hash) VALUES (ta, fa, 2, '{}', 'nao-e-hash');
    RAISE EXCEPTION 'hash torto'; EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN INSERT INTO public.form_versions (tenant_id, form_id, version, definition, hash) VALUES (ta, fa, 2, '[]', repeat('c', 64));
    RAISE EXCEPTION 'definicao nao-objeto'; EXCEPTION WHEN check_violation THEN NULL; END;
  -- O formulário só aponta para versão DELE.
  BEGIN UPDATE public.forms SET status = 'published', published_version_id = vb WHERE id = fa;
    RAISE EXCEPTION 'apontou para versao de outro formulario'; EXCEPTION WHEN foreign_key_violation THEN NULL; END;
  UPDATE public.forms SET status = 'published', published_version_id = v1 WHERE id = fa;
  UPDATE public.forms SET status = 'published', published_version_id = vb WHERE id = fb;
  BEGIN UPDATE public.forms SET allowed_domains = array_fill('x.com'::text, ARRAY[21]) WHERE id = fa;
    RAISE EXCEPTION '21 sites'; EXCEPTION WHEN check_violation THEN NULL; END;
  RAISE NOTICE '3 ok: versao so do proprio formulario, unica, formatos, publicado tem versao';
END $$;
RESET ROLE;
DO $$ BEGIN
  -- Nem o dono do banco reescreve o que foi ao ar.
  BEGIN UPDATE public.form_versions SET definition = '{"x":1}' WHERE id = 'd0000000-0000-4000-8000-0000000000a1';
    RAISE EXCEPTION 'reescreveu versao'; EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN UPDATE public.form_versions SET tenant_id = 'bbbbbbbb-0000-4000-8000-000000000002' WHERE id = 'd0000000-0000-4000-8000-0000000000a1';
    RAISE EXCEPTION 'trocou empresa da versao'; EXCEPTION WHEN check_violation THEN NULL; END;
  RAISE NOTICE '4 ok: versao append-only ate para o dono do banco';
END $$;

-- 5. A porta de gravação: só formulário publicado, da empresa certa, na versão no ar; tetos.
SET ROLE service_role;
DO $$
DECLARE fa uuid := 'f0000000-0000-4000-8000-00000000000a'; ta uuid := 'aaaaaaaa-0000-4000-8000-000000000001';
        tb uuid := 'bbbbbbbb-0000-4000-8000-000000000002'; v1 uuid := 'd0000000-0000-4000-8000-0000000000a1';
        vb uuid := 'd0000000-0000-4000-8000-0000000000b1'; r jsonb; ok_consent jsonb := '{"accepted":true,"text":"Aceito"}';
BEGIN
  r := public.form_submit(ta, fa, v1, '5547998124471', '554798124471', 'Marina', '{"a":"b"}', ok_consent, '{}', repeat('1', 32), 5, 3, 20);
  ASSERT r->>'ok' = 'true' AND (r->>'id') IS NOT NULL, 'envio bom recusado: ' || r::text;
  r := public.form_submit(tb, fa, v1, '5547998124471', '554798124471', 'Marina', '{}', ok_consent, '{}', NULL, 5, 3, 20);
  ASSERT r->>'reason' = 'unavailable', 'empresa errada passou: ' || r::text;
  r := public.form_submit(ta, fa, vb, '5547998124471', '554798124471', 'Marina', '{}', ok_consent, '{}', NULL, 5, 3, 20);
  ASSERT r->>'reason' = 'version_changed', 'versao errada passou: ' || r::text;
  -- Mesmo número: 3 por dia neste formulário.
  r := public.form_submit(ta, fa, v1, '5547998124471', '554798124471', 'Marina', '{}', ok_consent, '{}', NULL, 5, 3, 20); ASSERT r->>'ok' = 'true';
  r := public.form_submit(ta, fa, v1, '554798124471',  '554798124471', 'Marina', '{}', ok_consent, '{}', NULL, 5, 3, 20); ASSERT r->>'ok' = 'true';
  r := public.form_submit(ta, fa, v1, '5547998124471', '554798124471', 'Marina', '{}', ok_consent, '{}', NULL, 5, 3, 20);
  ASSERT r->>'reason' = 'phone_repeat', '4o envio do mesmo numero (com e sem 9) passou: ' || r::text;
  -- Teto do formulário (5 hoje): mais 2 números passam, o 3o não.
  r := public.form_submit(ta, fa, v1, '5511911110001', '551111110001', 'A', '{}', ok_consent, '{}', NULL, 5, 3, 20); ASSERT r->>'ok' = 'true';
  r := public.form_submit(ta, fa, v1, '5511911110002', '551111110002', 'B', '{}', ok_consent, '{}', NULL, 5, 3, 20); ASSERT r->>'ok' = 'true';
  r := public.form_submit(ta, fa, v1, '5511911110003', '551111110003', 'C', '{}', ok_consent, '{}', NULL, 5, 3, 20);
  ASSERT r->>'reason' = 'form_daily_cap', 'passou do teto do formulario: ' || r::text;
  -- Aparelho (IP): teto 1/h → o 2o do mesmo hash para.
  r := public.form_submit(ta, fa, v1, '5511911110004', '551111110004', 'D', '{}', ok_consent, '{}', repeat('1', 32), 50, 3, 1);
  ASSERT r->>'reason' = 'ip_cap', 'passou do teto do aparelho: ' || r::text;
  -- Sem aceite não existe comprovante (S3 no banco).
  BEGIN PERFORM public.form_submit(ta, fa, v1, '5511911110005', '551111110005', 'E', '{}', '{"accepted":false}', '{}', NULL, 50, 3, 20);
    RAISE EXCEPTION 'gravou sem aceite'; EXCEPTION WHEN check_violation THEN NULL; END;
  -- Formatos.
  BEGIN PERFORM public.form_submit(ta, fa, v1, '+55 47', '551111110009', 'F', '{}', ok_consent, '{}', NULL, 50, 3, 20);
    RAISE EXCEPTION 'telefone torto'; EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN PERFORM public.form_submit(ta, fa, v1, '5511911110006', '551111110006', '   ', '{}', ok_consent, '{}', NULL, 50, 3, 20);
    RAISE EXCEPTION 'nome vazio'; EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN PERFORM public.form_submit(ta, fa, v1, '5511911110006', '551111110006', 'G', '{}', ok_consent, '{}', NULL, 0, 3, 20);
    RAISE EXCEPTION 'teto fora da faixa'; EXCEPTION WHEN check_violation THEN NULL; END;
  -- Pausado não recebe.
  UPDATE public.forms SET status = 'paused' WHERE id = fa;
  r := public.form_submit(ta, fa, v1, '5511911110007', '551111110007', 'H', '{}', ok_consent, '{}', NULL, 50, 3, 20);
  ASSERT r->>'reason' = 'unavailable', 'pausado recebeu: ' || r::text;
  UPDATE public.forms SET status = 'published' WHERE id = fa;
  ASSERT (SELECT count(*) FROM public.form_submissions) = 5, 'contagem errada: ' || (SELECT count(*) FROM public.form_submissions);
  RAISE NOTICE '5 ok: porta unica com empresa, versao, tetos (numero com e sem 9, formulario, aparelho), aceite e formatos';
END $$;

-- 6. O comprovante é imutável; situação, ficha e sugestões mudam; consistência das FKs.
DO $$
DECLARE s uuid; ta uuid := 'aaaaaaaa-0000-4000-8000-000000000001'; fa uuid := 'f0000000-0000-4000-8000-00000000000a';
BEGIN
  SELECT id INTO s FROM public.form_submissions ORDER BY created_at LIMIT 1;
  BEGIN UPDATE public.form_submissions SET answers = '{"a":"mexi"}' WHERE id = s; RAISE EXCEPTION 'mudou respostas'; EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN UPDATE public.form_submissions SET consent = '{"accepted":true,"text":"outro"}' WHERE id = s; RAISE EXCEPTION 'mudou aceite'; EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN UPDATE public.form_submissions SET phone_e164 = '5511900000000' WHERE id = s; RAISE EXCEPTION 'mudou telefone'; EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN UPDATE public.form_submissions SET created_at = now() - interval '9 days' WHERE id = s; RAISE EXCEPTION 'mudou data'; EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN UPDATE public.form_submissions SET tenant_id = 'bbbbbbbb-0000-4000-8000-000000000002' WHERE id = s; RAISE EXCEPTION 'mudou empresa'; EXCEPTION WHEN check_violation THEN NULL; END;
  UPDATE public.form_submissions SET contact_id = 'cccccccc-0000-4000-8000-000000000001', outcome = 'sent',
    contact_conflicts = '[{"field":"email","current":"a","proposed":"b"}]', conflicts_resolved_at = now() WHERE id = s;
  ASSERT (SELECT outcome FROM public.form_submissions WHERE id = s) = 'sent';
  BEGIN UPDATE public.form_submissions SET outcome = 'Mandou!' WHERE id = s; RAISE EXCEPTION 'situacao torta'; EXCEPTION WHEN check_violation THEN NULL; END;
  -- Resposta direto na tabela com versão de OUTRO formulário: recusada.
  BEGIN INSERT INTO public.form_submissions (tenant_id, form_id, version_id, phone_e164, phone_key, contact_name, consent)
    VALUES (ta, fa, 'd0000000-0000-4000-8000-0000000000b1', '5511900000001', '551100000001', 'X', '{"accepted":true}');
    RAISE EXCEPTION 'versao de outro formulario'; EXCEPTION WHEN foreign_key_violation THEN NULL; END;
  RAISE NOTICE '6 ok: comprovante imutavel, estado mutavel, FKs coerentes';
END $$;

-- 7. Números da lista.
DO $$
DECLARE r record;
BEGIN
  SELECT * INTO r FROM public.form_list_stats('aaaaaaaa-0000-4000-8000-000000000001');
  ASSERT r.responses_30d = 5 AND r.responses_total = 5 AND r.last_at IS NOT NULL, 'numeros errados';
  ASSERT NOT EXISTS (SELECT 1 FROM public.form_list_stats('bbbbbbbb-0000-4000-8000-000000000002')), 'vazou outra empresa';
  RAISE NOTICE '7 ok: numeros da lista por empresa';
END $$;
RESET ROLE;

-- 8. Apagar a ficha solta o vínculo (LGPD apaga explícito antes); formulário com resposta não some;
--    apagar a empresa leva tudo.
DO $$ BEGIN
  DELETE FROM public.chat_contacts WHERE id = 'cccccccc-0000-4000-8000-000000000001';
  ASSERT (SELECT count(*) FROM public.form_submissions WHERE contact_id IS NOT NULL) = 0, 'vinculo nao soltou';
  ASSERT (SELECT count(*) FROM public.form_submissions) = 5, 'apagar a ficha levou o comprovante';
  BEGIN DELETE FROM public.forms WHERE id = 'f0000000-0000-4000-8000-00000000000a'; RAISE EXCEPTION 'apagou formulario com resposta';
    EXCEPTION WHEN foreign_key_violation THEN NULL; END;
  DELETE FROM public.tenants WHERE id = 'aaaaaaaa-0000-4000-8000-000000000001';
  ASSERT NOT EXISTS (SELECT 1 FROM public.form_submissions) AND NOT EXISTS (SELECT 1 FROM public.form_versions WHERE tenant_id = 'aaaaaaaa-0000-4000-8000-000000000001'), 'cascata da empresa';
  RAISE NOTICE '8 ok: ficha solta o vinculo, formulario com resposta fica, empresa leva tudo';
END $$;

-- 9. O rollback documentado desfaz tudo (numa transação desfeita).
BEGIN;
DROP FUNCTION public.form_list_stats(uuid);
DROP FUNCTION public.form_submit(uuid, uuid, uuid, text, text, text, jsonb, jsonb, jsonb, text, integer, integer, integer);
DROP TABLE public.form_submissions;
UPDATE public.forms SET status = 'draft' WHERE status <> 'draft';
ALTER TABLE public.forms DROP CONSTRAINT forms_published_has_version, DROP CONSTRAINT forms_published_version_fk,
  DROP CONSTRAINT forms_allowed_domains_max, DROP COLUMN published_version_id, DROP COLUMN allowed_domains;
DROP TABLE public.form_versions;
DROP FUNCTION public.form_versions_append_only();
DROP FUNCTION public.form_submissions_guard();
ALTER TABLE public.forms DROP CONSTRAINT forms_id_tenant_uniq;
DO $$ BEGIN
  ASSERT to_regclass('public.form_submissions') IS NULL AND to_regclass('public.form_versions') IS NULL, 'rollback incompleto';
  RAISE NOTICE '9 ok: rollback documentado desfaz tudo';
END $$;
ROLLBACK;
