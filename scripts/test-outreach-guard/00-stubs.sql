-- Peças mínimas que a migration 20261001000100 espera encontrar (espelho do que existe em prod).
\set ON_ERROR_STOP on
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;   -- como no Supabase: o servidor do app ignora RLS
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

CREATE TABLE public.tenants (id uuid PRIMARY KEY);
CREATE TABLE public.studio_flows (id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE);
CREATE TABLE public.chat_conversations (id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE);

CREATE FUNCTION app_tenant_id() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('request.jwt.claims', true)::json->>'app_tenant_id', '')::uuid
$$;
ALTER FUNCTION public.app_tenant_id() SET search_path = public, pg_temp;

CREATE FUNCTION public.reject_tenant_id_change() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
    RAISE EXCEPTION 'tenant_id é imutável: tentativa de mudar de % para % na tabela %',
      OLD.tenant_id, NEW.tenant_id, TG_TABLE_NAME USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$fn$;

INSERT INTO public.tenants VALUES
  ('aaaaaaaa-0000-4000-8000-000000000001'), ('bbbbbbbb-0000-4000-8000-000000000002'), ('cccccccc-0000-4000-8000-000000000003');
INSERT INTO public.studio_flows VALUES ('f0000000-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000001');
INSERT INTO public.chat_conversations VALUES
  ('c0000000-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000001'),
  ('c0000000-0000-4000-8000-000000000002', 'aaaaaaaa-0000-4000-8000-000000000001');
