-- Synthetic schema only. Execute exclusively in the disposable test container.
CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE ROLE service_role BYPASSRLS;
CREATE TABLE public.tenants(id uuid PRIMARY KEY);
CREATE TABLE public.tenant_users(tenant_id uuid NOT NULL,user_id uuid NOT NULL,active boolean NOT NULL,
  role text NOT NULL,instance_ids uuid[],voice_instance_ids uuid[] NOT NULL DEFAULT '{}',PRIMARY KEY(tenant_id,user_id));
CREATE TABLE public.whatsapp_instances(id uuid PRIMARY KEY,tenant_id uuid NOT NULL,provider text,instance_name text);
CREATE TABLE public.chat_conversations(id uuid PRIMARY KEY,tenant_id uuid NOT NULL,instance_id uuid NOT NULL,is_group boolean,channel text);
CREATE TABLE public.fixture_modules(tenant_id uuid PRIMARY KEY, enabled boolean);
CREATE FUNCTION public.tenant_has_module(uuid,text) RETURNS boolean LANGUAGE sql SET search_path='' AS $$
  SELECT enabled FROM public.fixture_modules WHERE tenant_id=$1 AND $2='voice_calls';
$$;
INSERT INTO public.tenants VALUES('10000000-0000-0000-0000-000000000001'),('10000000-0000-0000-0000-000000000002');
INSERT INTO public.fixture_modules SELECT id,true FROM public.tenants;
INSERT INTO public.whatsapp_instances VALUES
 ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','baileys','fixture-line-1'),
 ('20000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','baileys','fixture-line-2'),
 ('20000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000002','baileys','fixture-line-3'),
 ('20000000-0000-0000-0000-000000000004','10000000-0000-0000-0000-000000000001','meta_cloud','fixture-line-4'),
 ('20000000-0000-0000-0000-000000000005','10000000-0000-0000-0000-000000000001','baileys','fixture-line-1');
INSERT INTO public.chat_conversations SELECT ('30000000-0000-0000-0000-' || lpad(n::text,12,'0'))::uuid,
  tenant_id,id,false,'whatsapp' FROM public.whatsapp_instances,generate_series(1,5) n
  WHERE id=('20000000-0000-0000-0000-' || lpad(n::text,12,'0'))::uuid;
INSERT INTO public.tenant_users SELECT t.id,('40000000-0000-0000-0000-' || lpad(n::text,12,'0'))::uuid,true,'owner',NULL,'{}'
  FROM public.tenants t,generate_series(1,40) n;
INSERT INTO public.tenant_users VALUES('10000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000041',true,'agent',
 ARRAY['20000000-0000-0000-0000-000000000001'::uuid],ARRAY['20000000-0000-0000-0000-000000000001'::uuid]);
