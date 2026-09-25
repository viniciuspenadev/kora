BEGIN;
ALTER TABLE public.tenant_config ADD COLUMN IF NOT EXISTS agent_signature jsonb;
ALTER TABLE public.tenant_config ADD CONSTRAINT tenant_config_agent_signature_object
  CHECK (agent_signature IS NULL OR jsonb_typeof(agent_signature) = 'object');
COMMENT ON COLUMN public.tenant_config.agent_signature IS
  'Manual WhatsApp signature: enabled default, department overrides, agent mode/name. NULL means off. Server-only configuration; no new browser grant.';
COMMIT;

-- Verification (read-only):
SELECT column_name, data_type, is_nullable FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'tenant_config' AND column_name = 'agent_signature';
-- Existing RLS/grants are unchanged. No UPDATE/backfill and no automatic activation.
-- Rollback (only after disabling this application feature; deletes saved signature rules):
-- BEGIN;
-- ALTER TABLE public.tenant_config DROP COLUMN IF EXISTS agent_signature;
-- COMMIT;
