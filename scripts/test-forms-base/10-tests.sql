-- Ataque à migration 20261002000100_forms_base (roda como service_role, o papel do servidor).
\set ON_ERROR_STOP on
SET ROLE service_role;
DO $t$
DECLARE
  A constant uuid := 'aaaaaaaa-0000-4000-8000-000000000001';
  B constant uuid := 'bbbbbbbb-0000-4000-8000-000000000002';
  U1 constant uuid := 'eeeeeeee-0000-4000-8000-000000000001';
  f uuid; ok boolean;
BEGIN
  -- 1. Permissão nasce 'none' para todos e só aceita o vocabulário.
  ASSERT (SELECT count(*) FROM public.tenant_users WHERE forms_access <> 'none') = 0, '1: default none';
  ok := false; BEGIN UPDATE public.tenant_users SET forms_access = 'super' WHERE role = 'agent'; EXCEPTION WHEN check_violation THEN ok := true; END;
  ASSERT ok, '1: nivel fora do vocabulario';
  UPDATE public.tenant_users SET forms_access = 'manage' WHERE role = 'agent';

  -- 2. Módulo registrado desligado, fora de plano, na categoria de Marketing.
  ASSERT (SELECT category = 'campanhas' AND NOT default_on AND NOT is_core AND parent_slug IS NULL FROM public.module_catalog WHERE slug = 'forms'), '2: modulo';

  -- 3. Formulário válido entra.
  INSERT INTO public.forms (tenant_id, public_id, slug, name, template_key, draft, created_by, updated_by)
    VALUES (A, 'abcdefghij0123456789', 'orcamento-guiado', 'Orçamento guiado', 'quote_guided', '{"version":1,"questions":[]}', U1, U1)
    RETURNING id INTO f;
  ASSERT (SELECT status = 'draft' AND draft_revision = 1 FROM public.forms WHERE id = f), '3: padroes';

  -- 4. Formatos e limites.
  ok := false; BEGIN INSERT INTO public.forms (tenant_id, public_id, slug, name) VALUES (A, 'CURTO', 'x', 'x'); EXCEPTION WHEN check_violation THEN ok := true; END;
  ASSERT ok, '4: public_id fora do formato';
  ok := false; BEGIN INSERT INTO public.forms (tenant_id, public_id, slug, name) VALUES (A, 'zzzzzzzzzz0123456789', 'Com Espaco', 'x'); EXCEPTION WHEN check_violation THEN ok := true; END;
  ASSERT ok, '4: slug fora do formato';
  ok := false; BEGIN INSERT INTO public.forms (tenant_id, public_id, slug, name) VALUES (A, 'zzzzzzzzzz0123456789', 'ok', E'  \n '); EXCEPTION WHEN check_violation THEN ok := true; END;
  ASSERT ok, '4: nome so de espaco';
  ok := false; BEGIN INSERT INTO public.forms (tenant_id, public_id, slug, name, status) VALUES (A, 'zzzzzzzzzz0123456789', 'ok', 'x', 'apagado'); EXCEPTION WHEN check_violation THEN ok := true; END;
  ASSERT ok, '4: status fora do vocabulario';
  ok := false; BEGIN INSERT INTO public.forms (tenant_id, public_id, slug, name, draft) VALUES (A, 'zzzzzzzzzz0123456789', 'ok', 'x', '[1,2]'); EXCEPTION WHEN check_violation THEN ok := true; END;
  ASSERT ok, '4: rascunho tem que ser objeto';
  ok := false; BEGIN INSERT INTO public.forms (tenant_id, public_id, slug, name, draft)
    VALUES (A, 'zzzzzzzzzz0123456789', 'ok', 'x', jsonb_build_object('lixo', (SELECT string_agg(md5(i::text), '') FROM generate_series(1, 12000) i)));
    EXCEPTION WHEN check_violation THEN ok := true; END;
  ASSERT ok, '4: rascunho acima de 256 KB';

  -- 5. Únicos: slug por empresa (outra empresa pode repetir); código público em todo o Kora.
  ok := false; BEGIN INSERT INTO public.forms (tenant_id, public_id, slug, name) VALUES (A, 'zzzzzzzzzz0123456789', 'orcamento-guiado', 'x'); EXCEPTION WHEN unique_violation THEN ok := true; END;
  ASSERT ok, '5: slug repetido na mesma empresa';
  INSERT INTO public.forms (tenant_id, public_id, slug, name) VALUES (B, 'zzzzzzzzzz0123456789', 'orcamento-guiado', 'x');
  ok := false; BEGIN INSERT INTO public.forms (tenant_id, public_id, slug, name) VALUES (B, 'abcdefghij0123456789', 'outro', 'x'); EXCEPTION WHEN unique_violation THEN ok := true; END;
  ASSERT ok, '5: codigo publico repetido entre empresas';

  -- 6. Guarda: identidade pública, modelo de origem, data e autor não mudam.
  ok := false; BEGIN UPDATE public.forms SET public_id = 'yyyyyyyyyy0123456789' WHERE id = f; EXCEPTION WHEN check_violation THEN ok := true; END;
  ASSERT ok, '6: public_id imutavel';
  ok := false; BEGIN UPDATE public.forms SET template_key = 'blank' WHERE id = f; EXCEPTION WHEN check_violation THEN ok := true; END;
  ASSERT ok, '6: modelo de origem imutavel';
  ok := false; BEGIN UPDATE public.forms SET created_at = now() - interval '1 day' WHERE id = f; EXCEPTION WHEN check_violation THEN ok := true; END;
  ASSERT ok, '6: data de criacao imutavel';
  ok := false; BEGIN UPDATE public.forms SET created_by = 'eeeeeeee-0000-4000-8000-000000000002' WHERE id = f; EXCEPTION WHEN check_violation THEN ok := true; END;
  ASSERT ok, '6: autor nao muda';
  ok := false; BEGIN UPDATE public.forms SET tenant_id = B WHERE id = f; EXCEPTION WHEN check_violation THEN ok := true; END;
  ASSERT ok, '6: tenant_id imutavel';

  -- 7. O que pode mudar, muda: nome, slug (rascunho), rascunho com versão, status.
  UPDATE public.forms SET name = 'Novo nome', slug = 'novo-nome', draft = '{"version":1}', draft_revision = 2, status = 'published' WHERE id = f;
  ASSERT (SELECT name = 'Novo nome' AND draft_revision = 2 FROM public.forms WHERE id = f), '7: edicao legitima';

  RAISE NOTICE 'funcional: 7 blocos OK';
END
$t$;

-- 8. Apagar o perfil do autor solta o vínculo (SET NULL) sem esbarrar na guarda.
RESET ROLE;
DELETE FROM public.tenant_users WHERE user_id = 'eeeeeeee-0000-4000-8000-000000000001';
DELETE FROM public.profiles WHERE id = 'eeeeeeee-0000-4000-8000-000000000001';
DO $$ BEGIN
  ASSERT (SELECT created_by IS NULL AND updated_by IS NULL FROM public.forms WHERE slug = 'novo-nome'), '8: autor vira NULL';
  RAISE NOTICE 'apagar perfil: OK';
END $$;

-- 9. Blindagem: o navegador não lê nem grava.
DO $$ BEGIN
  ASSERT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.forms'::regclass), '9: RLS';
  ASSERT NOT has_table_privilege('anon', 'public.forms', 'SELECT'), '9: anon le';
  ASSERT NOT has_table_privilege('authenticated', 'public.forms', 'SELECT'), '9: authenticated le';
  ASSERT NOT has_table_privilege('authenticated', 'public.forms', 'INSERT'), '9: authenticated grava';
  ASSERT has_table_privilege('service_role', 'public.forms', 'UPDATE'), '9: servidor altera';
  RAISE NOTICE 'blindagem: OK';
END $$;
SET ROLE authenticated;
DO $$ DECLARE ok boolean := false; BEGIN
  BEGIN PERFORM 1 FROM public.forms LIMIT 1; EXCEPTION WHEN insufficient_privilege THEN ok := true; END;
  ASSERT ok, '9: authenticated leu forms';
  RAISE NOTICE 'token do navegador barrado: OK';
END $$;
RESET ROLE;

-- 10. Apagar a empresa leva os formulários dela.
DELETE FROM public.tenant_users WHERE tenant_id = 'bbbbbbbb-0000-4000-8000-000000000002';
DELETE FROM public.tenants WHERE id = 'bbbbbbbb-0000-4000-8000-000000000002';
DO $$ BEGIN
  ASSERT NOT EXISTS (SELECT 1 FROM public.forms WHERE tenant_id = 'bbbbbbbb-0000-4000-8000-000000000002'), '10: cascade';
  RAISE NOTICE 'apagar empresa: OK';
END $$;

-- 11. O rollback documentado desfaz tudo (testado dentro de uma transação desfeita).
BEGIN;
DROP TABLE public.forms;
DROP FUNCTION public.forms_guard();
DELETE FROM public.tenant_modules WHERE module_slug = 'forms';
DELETE FROM public.module_catalog WHERE slug = 'forms';
ALTER TABLE public.tenant_users DROP CONSTRAINT tenant_users_forms_access_chk, DROP COLUMN forms_access;
DO $$ BEGIN
  ASSERT to_regclass('public.forms') IS NULL, '11: rollback tabela';
  ASSERT NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'tenant_users' AND column_name = 'forms_access'), '11: rollback coluna';
  RAISE NOTICE 'rollback: OK';
END $$;
ROLLBACK;
