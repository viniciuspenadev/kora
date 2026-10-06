-- Peças mínimas que as migrations 20261002000100 (base) e 20261002000200/0300 (publicar) esperam.
-- Espelho de produção só no que importa para as regras testadas. NUNCA aponte para produção.
\set ON_ERROR_STOP on
DO $$ BEGIN CREATE ROLE anon NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE service_role NOLOGIN BYPASSRLS; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

CREATE TABLE public.tenants  (id uuid PRIMARY KEY);
CREATE TABLE public.profiles (id uuid PRIMARY KEY);
CREATE TABLE public.tenant_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  role text NOT NULL,
  marketing_access text NOT NULL DEFAULT 'none'
);
CREATE TABLE public.module_catalog (
  slug text PRIMARY KEY, category text, name text, description text,
  is_core boolean, default_on boolean, position int, parent_slug text
);
CREATE TABLE public.tenant_modules (
  tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE,
  module_slug text REFERENCES public.module_catalog(slug) ON DELETE CASCADE,
  enabled boolean, PRIMARY KEY (tenant_id, module_slug)
);
CREATE TABLE public.chat_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE
);
CREATE TABLE public.chat_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE
);
INSERT INTO public.module_catalog VALUES ('broadcasts', 'campanhas', 'Disparos em massa', 'x', false, false, 10, NULL);
-- Como no Supabase: o servidor (service_role) tem acesso às tabelas existentes.
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;

CREATE FUNCTION app_tenant_id() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('request.jwt.claims', true)::json->>'app_tenant_id', '')::uuid
$$;
CREATE FUNCTION public.reject_tenant_id_change() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
    RAISE EXCEPTION 'tenant_id imutavel' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$fn$;

INSERT INTO public.tenants VALUES ('aaaaaaaa-0000-4000-8000-000000000001'), ('bbbbbbbb-0000-4000-8000-000000000002');
INSERT INTO public.profiles VALUES ('eeeeeeee-0000-4000-8000-000000000001');
INSERT INTO public.chat_contacts (id, tenant_id) VALUES
  ('cccccccc-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000001'),
  ('cccccccc-0000-4000-8000-000000000002', 'aaaaaaaa-0000-4000-8000-000000000001');
