-- Execute somente no PostgreSQL descartável kora_tasks_test, depois do fixture.
\set ON_ERROR_STOP on
BEGIN;
DO $$ BEGIN IF current_database()<>'kora_tasks_test' THEN RAISE EXCEPTION 'Somente banco descartável de teste'; END IF; END $$;
INSERT INTO tenants VALUES ('00000000-0000-0000-0000-000000000001'),('00000000-0000-0000-0000-000000000002');
INSERT INTO tenant_users VALUES
 ('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011','admin',true),
 ('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000012','agent',true),
 ('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000013','agent',true),
 ('00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000014','agent',true);
DO $$
DECLARE t uuid:='00000000-0000-0000-0000-000000000001'; a uuid:='00000000-0000-0000-0000-000000000011';
 u uuid:='00000000-0000-0000-0000-000000000012'; v uuid:='00000000-0000-0000-0000-000000000013';
 task uuid; ver timestamptz; notice uuid; n integer; result jsonb;
BEGIN
 task:=public.crm_task_mutate(t,u,NULL,NULL,jsonb_build_object('title','Ligar','due_at',now()-interval '1 hour'));
 SELECT updated_at INTO ver FROM tenant_tasks WHERE id=task;
 IF (SELECT assigned_to FROM tenant_tasks WHERE id=task)<>u THEN RAISE EXCEPTION 'owner default'; END IF;
 IF (SELECT count(*) FROM tenant_task_events WHERE task_id=task)<>1 THEN RAISE EXCEPTION 'audit creation'; END IF;
 BEGIN PERFORM crm_task_mutate(t,v,task,ver,'{"title":"Intruso"}'); RAISE EXCEPTION 'unauthorized accepted'; EXCEPTION WHEN OTHERS THEN IF SQLERRM='unauthorized accepted' THEN RAISE; END IF; END;
 BEGIN PERFORM crm_task_mutate(t,u,task,ver,jsonb_build_object('assigned_to',v)); RAISE EXCEPTION 'assignment accepted'; EXCEPTION WHEN OTHERS THEN IF SQLERRM='assignment accepted' THEN RAISE; END IF; END;
 notice:=crm_task_notify(t,task,ver);
 IF notice IS NULL THEN RAISE EXCEPTION 'missing notice'; END IF;
 IF crm_task_notify(t,task,ver) IS NOT NULL THEN RAISE EXCEPTION 'duplicate notice'; END IF;
 PERFORM crm_task_mutate(t,u,task,ver,jsonb_build_object('due_at',now()-interval '30 minutes'));
 IF (SELECT status FROM tenant_tasks WHERE id=task)<>'pending' OR (SELECT done_at FROM tenant_tasks WHERE id=task) IS NOT NULL THEN RAISE EXCEPTION 'reschedule completed'; END IF;
 IF (SELECT reminded_at FROM tenant_tasks WHERE id=task) IS NOT NULL THEN RAISE EXCEPTION 'not rearmed'; END IF;
 IF crm_task_notify(t,task,ver) IS NOT NULL THEN RAISE EXCEPTION 'stale sweep'; END IF;
 BEGIN PERFORM crm_task_mutate(t,u,task,ver,'{"title":"Stale"}'); RAISE EXCEPTION 'stale edit accepted'; EXCEPTION WHEN OTHERS THEN IF SQLERRM='stale edit accepted' THEN RAISE; END IF; END;
 SELECT updated_at INTO ver FROM tenant_tasks WHERE id=task;
 PERFORM crm_task_mutate(t,a,task,ver,jsonb_build_object('assigned_to',v));
 SELECT updated_at INTO ver FROM tenant_tasks WHERE id=task;
 IF (SELECT assigned_to FROM tenant_tasks WHERE id=task)<>v THEN RAISE EXCEPTION 'admin assignment'; END IF;
 PERFORM crm_task_mutate(t,v,task,ver,'{"status":"done"}');
 SELECT updated_at INTO ver FROM tenant_tasks WHERE id=task;
 IF crm_task_notify(t,task,ver) IS NOT NULL THEN RAISE EXCEPTION 'done notified'; END IF;
 PERFORM crm_task_mutate(t,v,task,ver,'{"status":"pending"}');
 SELECT updated_at INTO ver FROM tenant_tasks WHERE id=task;
 PERFORM crm_task_mutate(t,v,task,ver,'{"status":"canceled"}');
 SELECT updated_at INTO ver FROM tenant_tasks WHERE id=task;
 IF crm_task_notify(t,task,ver) IS NOT NULL THEN RAISE EXCEPTION 'canceled notified'; END IF;
 PERFORM crm_task_mutate(t,v,task,ver,'{"status":"pending"}');
 SELECT updated_at INTO ver FROM tenant_tasks WHERE id=task;
 UPDATE tenant_users SET active=false WHERE tenant_id=t AND user_id=v;
 IF crm_task_notify(t,task,ver) IS NOT NULL THEN RAISE EXCEPTION 'inactive notified'; END IF;
 UPDATE tenant_users SET active=true WHERE tenant_id=t AND user_id=v;
 BEGIN PERFORM crm_task_mutate(t,a,task,ver,'{"assigned_to":"00000000-0000-0000-0000-000000000014"}'); RAISE EXCEPTION 'cross tenant accepted'; EXCEPTION WHEN OTHERS THEN IF SQLERRM='cross tenant accepted' THEN RAISE; END IF; END;
 IF (SELECT assigned_to FROM tenant_tasks WHERE id=task)<>v THEN RAISE EXCEPTION 'failed change persisted'; END IF;
 SELECT count(*) INTO n FROM tenant_task_events WHERE task_id=task;
 IF n<>7 THEN RAISE EXCEPTION 'history count %',n; END IF;
 -- Insert que falha deve deixar o lembrete disponível para retry.
 ALTER TABLE notifications ADD CONSTRAINT reject_test CHECK(type<>'task_due') NOT VALID;
 BEGIN PERFORM crm_task_notify(t,task,ver); RAISE EXCEPTION 'notice insert accepted'; EXCEPTION WHEN check_violation THEN NULL; END;
 IF (SELECT reminded_at FROM tenant_tasks WHERE id=task) IS NOT NULL THEN RAISE EXCEPTION 'failed notice stamped'; END IF;
 ALTER TABLE notifications DROP CONSTRAINT reject_test;
 IF crm_task_notify(t,task,ver) IS NULL THEN RAISE EXCEPTION 'retry failed'; END IF;
 result:=crm_task_list(t,ARRAY[v],false,ARRAY[]::uuid[],ARRAY[]::uuid[],'{}',0,30);
 IF (result->>'total')::integer<>1 OR jsonb_array_length(result->'items')<>1 THEN RAISE EXCEPTION 'list count'; END IF;
 result:=crm_task_list(t,ARRAY[u],false,ARRAY[]::uuid[],ARRAY[]::uuid[],'{}',0,30);
 IF (result->>'total')::integer<>0 THEN RAISE EXCEPTION 'list owner scope'; END IF;
 INSERT INTO chat_contacts VALUES('00000000-0000-0000-0000-000000000088',t);
 UPDATE tenant_tasks SET contact_id='00000000-0000-0000-0000-000000000088' WHERE id=task;
 result:=crm_task_list(t,ARRAY[v],false,ARRAY[]::uuid[],ARRAY[]::uuid[],'{}',0,30);
 IF (result->>'total')::integer<>0 THEN RAISE EXCEPTION 'list context leakage'; END IF;
 result:=crm_task_list(t,ARRAY[v],false,ARRAY['00000000-0000-0000-0000-000000000088']::uuid[],ARRAY[]::uuid[],'{}',0,30);
 IF (result->>'total')::integer<>1 THEN RAISE EXCEPTION 'list visible context'; END IF;
 IF has_function_privilege('authenticated','public.crm_task_list(uuid,uuid[],boolean,uuid[],uuid[],jsonb,integer,integer)','EXECUTE') THEN RAISE EXCEPTION 'public list scope forgery'; END IF;
 DELETE FROM tenant_tasks WHERE id=task;
 IF EXISTS(SELECT 1 FROM tenant_task_events WHERE task_id=task) THEN RAISE EXCEPTION 'audit orphan'; END IF;
 RAISE NOTICE 'PASS: criação, posse, atribuição, histórico, reagendamento, CAS, deduplicação, conclusão, reabertura, cancelamento, inativo, tenant, rollback, retry, cascade, listagem/contagem/ACL/alcance';
END $$;
ROLLBACK;
