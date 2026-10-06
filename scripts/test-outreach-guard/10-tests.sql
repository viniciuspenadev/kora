-- Ataque funcional à trava (roda como service_role, o papel do servidor do app).
\set ON_ERROR_STOP on
SET ROLE service_role;

-- Atalho: pede vaga e devolve a linha da resposta.
CREATE TEMP TABLE r (n int, log_id uuid, allowed boolean, reason text, first_cap_hit boolean);
CREATE OR REPLACE FUNCTION pg_temp.claim(t uuid, phone text, k text, cap int DEFAULT 60, origin text DEFAULT 'site')
RETURNS TABLE (log_id uuid, allowed boolean, reason text, first_cap_hit boolean) LANGUAGE sql AS $$
  SELECT * FROM public.claim_outreach(t, phone, k, origin, NULL, NULL, NULL, NULL, 24, cap)
$$;

DO $t$
DECLARE
  A constant uuid := 'aaaaaaaa-0000-4000-8000-000000000001';
  B constant uuid := 'bbbbbbbb-0000-4000-8000-000000000002';
  C constant uuid := 'cccccccc-0000-4000-8000-000000000003';
  x record; y record; z record; n int; ok boolean;
BEGIN
  -- 1. Primeira vez: libera e reserva.
  SELECT * INTO x FROM pg_temp.claim(A, '5547998124471', '554798124471');
  ASSERT x.allowed AND x.reason IS NULL, '1: primeira vez devia liberar';
  ASSERT (SELECT outcome FROM public.outreach_log WHERE id = x.log_id) = 'claimed', '1: devia gravar claimed';

  -- 2. Mesmo número (com ou sem o 9 → mesma chave): recusa por janela e GRAVA a recusa.
  SELECT * INTO y FROM pg_temp.claim(A, '554798124471', '554798124471');
  ASSERT NOT y.allowed AND y.reason = 'phone_window', '2: devia recusar por janela';
  ASSERT (SELECT outcome FROM public.outreach_log WHERE id = y.log_id) = 'throttled', '2: recusa devia virar throttled';

  -- 3. A mesma pessoa em OUTRA empresa não é afetada.
  SELECT * INTO z FROM pg_temp.claim(B, '5547998124471', '554798124471');
  ASSERT z.allowed, '3: outra empresa devia liberar';

  -- 4. Envio que FALHOU não fecha a janela do número.
  SELECT * INTO x FROM pg_temp.claim(A, '5511940175730', '551140175730');
  UPDATE public.outreach_log SET outcome = 'failed', reason = 'send_failed', settled_at = now() WHERE id = x.log_id;
  SELECT * INTO y FROM pg_temp.claim(A, '5511940175730', '551140175730');
  ASSERT y.allowed, '4: depois de falha devia liberar de novo';

  -- 5. Reserva que nunca foi acertada (servidor caiu) conta como enviada: não manda de novo.
  SELECT * INTO x FROM pg_temp.claim(A, '5521999990001', '552199990001');
  SELECT * INTO y FROM pg_temp.claim(A, '5521999990001', '552199990001');
  ASSERT NOT y.allowed AND y.reason = 'phone_window', '5: reserva sem acerto devia segurar';

  -- 6. Fora da janela (25 h atrás) libera.
  RESET ROLE;
  INSERT INTO public.outreach_log (tenant_id, phone_e164, phone_key, origin, outcome, created_at)
    VALUES (A, '5531988887777', '553188887777', 'site', 'sent', now() - interval '25 hours');
  SET ROLE service_role;
  SELECT * INTO x FROM pg_temp.claim(A, '5531988887777', '553188887777');
  ASSERT x.allowed, '6: 25 h depois devia liberar';

  -- 7. Teto por empresa (cap 3 na empresa C): 3 passam, a 4ª recusa avisando 1 vez, a 5ª não avisa.
  FOR i IN 1..3 LOOP
    SELECT * INTO x FROM pg_temp.claim(C, '55479990000' || lpad(i::text, 2, '0'), '5547990000' || lpad(i::text, 2, '0'), 3);
    ASSERT x.allowed, format('7: %s-ésima devia passar', i);
  END LOOP;
  SELECT * INTO x FROM pg_temp.claim(C, '5547999000099', '554799000099', 3);
  ASSERT NOT x.allowed AND x.reason = 'tenant_hourly_cap' AND x.first_cap_hit, '7: 4ª devia recusar por teto e avisar';
  SELECT * INTO y FROM pg_temp.claim(C, '5547999000098', '554799000098', 3);
  ASSERT NOT y.allowed AND y.reason = 'tenant_hourly_cap' AND NOT y.first_cap_hit, '7: 5ª recusa não avisa de novo';
  -- Recusas NÃO contam no teto: a contagem continua 3 (só reservas/envios/falhas).
  SELECT count(*) INTO n FROM public.outreach_log WHERE tenant_id = C AND outcome IN ('claimed','sent','failed');
  ASSERT n = 3, '7: recusas não podem contar no teto';
  -- Falha CONTA no teto (é volume de tentativa).
  UPDATE public.outreach_log SET outcome = 'failed', settled_at = now()
   WHERE id = (SELECT id FROM public.outreach_log WHERE tenant_id = C AND outcome = 'claimed' LIMIT 1);
  SELECT * INTO x FROM pg_temp.claim(C, '5547999000097', '554799000097', 3);
  ASSERT NOT x.allowed AND x.reason = 'tenant_hourly_cap', '7: falha devia contar no teto';

  -- 8. Livro: campos que não mudam.
  SELECT * INTO x FROM pg_temp.claim(A, '5541988881111', '554188881111');
  ok := false; BEGIN UPDATE public.outreach_log SET phone_e164 = '5541900000000' WHERE id = x.log_id; EXCEPTION WHEN check_violation THEN ok := true; END;
  ASSERT ok, '8: telefone não pode mudar';
  ok := false; BEGIN UPDATE public.outreach_log SET created_at = now() - interval '2 days' WHERE id = x.log_id; EXCEPTION WHEN check_violation THEN ok := true; END;
  ASSERT ok, '8: data não pode mudar (seria jeito de reabrir a janela)';
  ok := false; BEGIN UPDATE public.outreach_log SET origin = 'form' WHERE id = x.log_id; EXCEPTION WHEN check_violation THEN ok := true; END;
  ASSERT ok, '8: origem não pode mudar';

  -- 9. Acerto: claimed → sent com conversa; depois NADA muda o desfecho.
  UPDATE public.outreach_log SET outcome = 'sent', settled_at = now(), conversation_id = 'c0000000-0000-4000-8000-000000000001' WHERE id = x.log_id;
  ok := false; BEGIN UPDATE public.outreach_log SET outcome = 'failed' WHERE id = x.log_id; EXCEPTION WHEN check_violation THEN ok := true; END;
  ASSERT ok, '9: sent não pode virar failed';
  ok := false; BEGIN UPDATE public.outreach_log SET conversation_id = 'c0000000-0000-4000-8000-000000000002' WHERE id = x.log_id; EXCEPTION WHEN check_violation THEN ok := true; END;
  ASSERT ok, '9: conversa preenchida não pode ser trocada';
  ok := false; BEGIN UPDATE public.outreach_log SET outcome = 'sent' WHERE id = y.log_id; EXCEPTION WHEN check_violation THEN ok := true; END;
  ASSERT ok, '9: recusa (throttled) não pode virar enviada';
  ok := false; BEGIN UPDATE public.outreach_log SET outcome = 'claimed' WHERE id = x.log_id; EXCEPTION WHEN check_violation THEN ok := true; END;
  ASSERT ok, '9: enviada não pode voltar a reserva (reabriria nada, mas mente)';

  -- 10. Parede tenant_id-imutável.
  ok := false; BEGIN UPDATE public.outreach_log SET tenant_id = B WHERE id = x.log_id; EXCEPTION WHEN check_violation THEN ok := true; END;
  ASSERT ok, '10: tenant_id não pode mudar';

  -- 11. Vocabulário fechado e formato do número.
  ok := false; BEGIN PERFORM * FROM public.claim_outreach(A, '5541988881112', '554188881112', 'robo', NULL, NULL, NULL, NULL, 24, 60); EXCEPTION WHEN check_violation THEN ok := true; END;
  ASSERT ok, '11: origem fora do vocabulário';
  ok := false; BEGIN PERFORM * FROM public.claim_outreach(A, '+55 41 9888', '554188881112', 'site', NULL, NULL, NULL, NULL, 24, 60); EXCEPTION WHEN check_violation THEN ok := true; END;
  ASSERT ok, '11: telefone com lixo';
  ok := false; BEGIN PERFORM * FROM public.claim_outreach(A, '5541988881112', '554188881112', 'site', NULL, NULL, NULL, NULL, 0, 60); EXCEPTION WHEN invalid_parameter_value THEN ok := true; END;
  ASSERT ok, '11: janela 0 recusada';
  ok := false; BEGIN PERFORM * FROM public.claim_outreach(A, '5541988881112', '554188881112', 'site', NULL, NULL, NULL, NULL, 24, 0); EXCEPTION WHEN invalid_parameter_value THEN ok := true; END;
  ASSERT ok, '11: teto 0 recusado';

  RAISE NOTICE 'funcional: 11 blocos OK';
END
$t$;

-- 12. Apagar a conversa (ex.: LGPD do contato) solta o vínculo sem esbarrar no livro.
RESET ROLE;
DELETE FROM public.chat_conversations WHERE id = 'c0000000-0000-4000-8000-000000000001';
DO $$ BEGIN
  ASSERT NOT EXISTS (SELECT 1 FROM public.outreach_log WHERE conversation_id = 'c0000000-0000-4000-8000-000000000001'), '12: vínculo devia virar NULL';
  RAISE NOTICE 'apagar conversa: OK';
END $$;

-- 13. Blindagem: o navegador (anon/authenticated) não lê, não grava, não chama a função.
DO $$ BEGIN
  ASSERT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.outreach_log'::regclass), '13: RLS desligada';
  ASSERT NOT EXISTS (SELECT 1 FROM information_schema.role_table_grants
                      WHERE table_schema = 'public' AND table_name = 'outreach_log' AND grantee IN ('anon', 'authenticated', 'PUBLIC')), '13: grant vazado';
  ASSERT NOT has_function_privilege('anon', 'public.claim_outreach(uuid,text,text,text,uuid,uuid,uuid,uuid,integer,integer)', 'EXECUTE'), '13: anon executa';
  ASSERT NOT has_function_privilege('authenticated', 'public.claim_outreach(uuid,text,text,text,uuid,uuid,uuid,uuid,integer,integer)', 'EXECUTE'), '13: authenticated executa';
  ASSERT has_function_privilege('service_role', 'public.claim_outreach(uuid,text,text,text,uuid,uuid,uuid,uuid,integer,integer)', 'EXECUTE'), '13: servidor sem execute';
  ASSERT (SELECT count(*) FROM pg_trigger WHERE tgrelid = 'public.outreach_log'::regclass AND NOT tgisinternal) = 2, '13: triggers';
  RAISE NOTICE 'blindagem: OK';
END $$;
SET ROLE authenticated;
SET request.jwt.claims = '{"app_tenant_id":"aaaaaaaa-0000-4000-8000-000000000001"}';
DO $$ DECLARE ok boolean := false; BEGIN
  BEGIN PERFORM 1 FROM public.outreach_log LIMIT 1; EXCEPTION WHEN insufficient_privilege THEN ok := true; END;
  ASSERT ok, '13: authenticated leu o livro';
  ok := false;
  BEGIN PERFORM * FROM public.claim_outreach('aaaaaaaa-0000-4000-8000-000000000001', '5541988881113', '554188881113', 'site', NULL, NULL, NULL, NULL, 24, 60);
  EXCEPTION WHEN insufficient_privilege THEN ok := true; END;
  ASSERT ok, '13: authenticated chamou a função';
  RAISE NOTICE 'token do navegador barrado: OK';
END $$;
RESET ROLE;

-- 14. Apagar a empresa leva o livro dela junto.
DELETE FROM public.tenants WHERE id = 'cccccccc-0000-4000-8000-000000000003';
DO $$ BEGIN
  ASSERT NOT EXISTS (SELECT 1 FROM public.outreach_log WHERE tenant_id = 'cccccccc-0000-4000-8000-000000000003'), '14: cascade';
  RAISE NOTICE 'apagar empresa: OK';
END $$;
