-- Read-only: current dependencies, name collisions, security and scheduler metadata.
BEGIN READ ONLY;
SET LOCAL statement_timeout='15s';
SELECT current_database() AS database_name,version() AS postgres_version;
SELECT table_name,column_name,udt_name,is_nullable,column_default
FROM information_schema.columns WHERE table_schema='public' AND (
 (table_name='tenants' AND column_name='id') OR
 (table_name='tenant_users' AND column_name IN ('tenant_id','user_id','active','role','instance_ids','voice_instance_ids')) OR
 (table_name='whatsapp_instances' AND column_name IN ('id','tenant_id','provider','instance_name','evolution_url')) OR
 (table_name='chat_conversations' AND column_name IN ('id','tenant_id','instance_id','is_group','channel')) OR
 table_name IN ('voice_call_attempts','voice_call_control_events','voice_cancelled_claims')
) ORDER BY table_name,ordinal_position;
SELECT n.nspname AS schema_name,c.relname,c.relkind,c.relrowsecurity,c.relforcerowsecurity
FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND c.relname IN ('tenants','tenant_users','whatsapp_instances','chat_conversations',
 'voice_call_attempts','voice_call_control_events','voice_cancelled_claims','voice_call_fence_seq');
SELECT c.conrelid::regclass::text AS table_name,c.conname,c.contype,pg_catalog.pg_get_constraintdef(c.oid) AS definition
FROM pg_catalog.pg_constraint c WHERE c.conrelid IN
 ('public.tenants'::regclass,'public.tenant_users'::regclass,'public.whatsapp_instances'::regclass,'public.chat_conversations'::regclass)
ORDER BY table_name,c.conname;
SELECT schemaname,tablename,indexname,indexdef FROM pg_catalog.pg_indexes WHERE schemaname='public'
 AND tablename IN ('tenants','tenant_users','whatsapp_instances','chat_conversations','voice_call_attempts','voice_call_control_events','voice_cancelled_claims');
SELECT c.relname AS table_name,t.tgname,t.tgenabled,pg_catalog.pg_get_triggerdef(t.oid) AS definition
FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_class c ON c.oid=t.tgrelid
WHERE NOT t.tgisinternal AND t.tgrelid IN
 ('public.tenants'::regclass,'public.tenant_users'::regclass,'public.whatsapp_instances'::regclass,'public.chat_conversations'::regclass);
SELECT schemaname,tablename,policyname,roles,cmd,qual,with_check FROM pg_catalog.pg_policies
WHERE schemaname='public' AND tablename IN ('tenant_users','whatsapp_instances','chat_conversations','voice_call_attempts','voice_call_control_events','voice_cancelled_claims');
SELECT p.proname,pg_catalog.pg_get_function_identity_arguments(p.oid) AS arguments,
 p.prosecdef,p.proconfig,r.rolname AS owner,
 pg_catalog.has_function_privilege('anon',p.oid,'EXECUTE') AS anon_execute,
 pg_catalog.has_function_privilege('authenticated',p.oid,'EXECUTE') AS authenticated_execute,
 pg_catalog.has_function_privilege('service_role',p.oid,'EXECUTE') AS service_execute
FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_roles r ON r.oid=p.proowner
WHERE p.pronamespace='public'::regnamespace AND (p.proname='tenant_has_module' OR p.proname LIKE 'voice\_%' ESCAPE '\');
SELECT extname,extversion FROM pg_catalog.pg_extension WHERE extname IN ('pg_cron','pg_net');
SELECT jobname,schedule,active FROM cron.job ORDER BY jobname;
SELECT name FROM vault.secrets WHERE name ILIKE '%cron%' ORDER BY name;
-- Deliberately excludes cron commands, Vault values, credentials and customer rows.
COMMIT;
