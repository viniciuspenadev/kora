#!/usr/bin/env node
// Verifica contrato real de escrita em uma transação SEM COMMIT.
// Mesmo que alguma asserção falhe, a transação inteira é revertida.
const token = process.env.SUPABASE_ACCESS_TOKEN?.trim()
const projectUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
if (!token || !projectUrl) throw new Error("Credenciais administrativas indisponíveis")
const ref = new URL(projectUrl).hostname.split(".")[0]
const sql = `BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='20s';
DO $$ DECLARE
  tenant uuid := '0d907fdd-f4eb-435b-ae9d-d20d4e3f4fc5';
  blue uuid := '4ef9e921-011a-46b9-a6d2-bff111536434';
  other_number uuid;
  owner_user uuid;
  first_conv uuid;
  second_conv uuid;
  jid text := '999999999-' || txid_current()::text || '@g.us';
  message_id text := 'KORA_GROUP_SMOKE_' || txid_current()::text;
BEGIN
  SELECT id INTO other_number FROM public.whatsapp_instances
    WHERE tenant_id=tenant AND id<>blue LIMIT 1;
  SELECT user_id INTO owner_user FROM public.tenant_users
    WHERE tenant_id=tenant AND role IN ('owner','admin') AND active=true LIMIT 1;
  IF other_number IS NULL OR owner_user IS NULL THEN
    RAISE EXCEPTION 'Pré-requisito de teste ausente';
  END IF;
  INSERT INTO public.chat_conversations
    (tenant_id, instance_id, is_group, group_jid, group_name,
     group_live_enabled, group_access_mode, contact_id, channel, status)
    VALUES (tenant, blue, true, jid, 'Teste transacional', true,
      'management', NULL, 'whatsapp', 'open') RETURNING id INTO first_conv;
  INSERT INTO public.chat_conversations
    (tenant_id, instance_id, is_group, group_jid, group_name,
     group_live_enabled, group_access_mode, contact_id, channel, status)
    VALUES (tenant, other_number, true, jid, 'Teste transacional', true,
      'management', NULL, 'whatsapp', 'open') RETURNING id INTO second_conv;
  INSERT INTO public.chat_messages
    (tenant_id, conversation_id, sender_type, content_type, content,
     whatsapp_msg_id, group_participant_jid, status, is_private_note)
    VALUES
      (tenant, first_conv, 'contact', 'text', 'Teste transacional', message_id,
       '123456789@lid', 'delivered', false),
      (tenant, second_conv, 'contact', 'text', 'Teste transacional', message_id,
       '123456789@lid', 'delivered', false);
  INSERT INTO public.group_user_state
    (tenant_id, conversation_id, user_id, last_seen_at)
    VALUES (tenant, first_conv, owner_user, now());
  IF (SELECT count(*) FROM public.chat_conversations WHERE id IN (first_conv, second_conv)) <> 2
    OR (SELECT count(*) FROM public.chat_messages
      WHERE conversation_id IN (first_conv, second_conv) AND whatsapp_msg_id=message_id) <> 2
    OR (SELECT count(*) FROM public.group_user_state
      WHERE conversation_id=first_conv AND user_id=owner_user) <> 1
  THEN RAISE EXCEPTION 'Contrato de grupo não confirmado'; END IF;
END $$;
ROLLBACK;`
const response = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
  method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  body: JSON.stringify({ query: sql }), signal: AbortSignal.timeout(30_000),
})
if (!response.ok) {
  const payload = await response.json().catch(() => null)
  throw new Error(`Smoke transacional falhou: HTTP ${response.status}, ${String(payload?.message ?? "sem detalhe").slice(0, 240)}`)
}
console.log("Smoke transacional de grupos passou; todas as linhas foram revertidas.")
