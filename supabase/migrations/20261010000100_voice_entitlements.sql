-- Mapeado contra o esquema de produção em 2026-10-10.
-- Ligações WhatsApp: concessão da plataforma e permissão por atendente/número.
-- O módulo filho de gravação reserva a concessão; captura e preferência do owner
-- ainda não existem, portanto nenhuma coluna de gravação é criada nesta etapa.
BEGIN;
SET LOCAL lock_timeout = '5s';

INSERT INTO public.module_catalog
  (slug, category, name, description, is_core, default_on, position, parent_slug)
VALUES
  ('voice_calls', 'atendimento', 'Ligações WhatsApp',
   'Permite chamadas de saída nos números com infraestrutura de voz configurada.', false, false, 70, NULL),
  ('voice_recording', 'atendimento', 'Gravação de ligações (em preparação)',
   'Reserva o acesso à gravação. A captura e o armazenamento ainda precisam ser implantados.', false, false, 71, 'voice_calls')
ON CONFLICT (slug) DO UPDATE SET
  category = EXCLUDED.category,
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  is_core = EXCLUDED.is_core,
  default_on = EXCLUDED.default_on,
  position = EXCLUDED.position,
  parent_slug = EXCLUDED.parent_slug;

ALTER TABLE public.tenant_users
  ADD COLUMN IF NOT EXISTS voice_instance_ids uuid[] NOT NULL DEFAULT '{}';

CREATE OR REPLACE FUNCTION public.clear_voice_grants_on_role_change()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.role <> 'agent' THEN NEW.voice_instance_ids := '{}'; END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_clear_voice_grants_on_role_change ON public.tenant_users;
CREATE TRIGGER trg_clear_voice_grants_on_role_change
  BEFORE UPDATE OF role ON public.tenant_users
  FOR EACH ROW EXECUTE FUNCTION public.clear_voice_grants_on_role_change();

COMMIT;
