-- Additive control-plane foundation. Apply only after the live preflight passes.
BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE SEQUENCE public.voice_call_fence_seq AS bigint;
CREATE TABLE public.voice_call_attempts (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  instance_id uuid NOT NULL,
  conversation_id uuid NOT NULL,
  operator_id uuid NOT NULL,
  backend_origin text NOT NULL,
  backend_instance_name text NOT NULL,
  backend_line_key text NOT NULL,
  browser_session_id uuid NOT NULL,
  owner_token_hash text NOT NULL CHECK (owner_token_hash ~ '^[0-9a-f]{64}$'),
  fence bigint NOT NULL UNIQUE DEFAULT nextval('public.voice_call_fence_seq'),
  state text NOT NULL DEFAULT 'preparing' CHECK (state IN
    ('preparing','dialing','ringing','connected','ending','recovering','ended','cancelled','failed','interrupted','unknown')),
  backend_boot_id uuid,
  backend_call_id text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  prepare_deadline_at timestamptz NOT NULL DEFAULT clock_timestamp() + interval '120 seconds',
  lease_expires_at timestamptz NOT NULL DEFAULT clock_timestamp() + interval '90 seconds',
  heartbeat_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  recovery_worker_id uuid,
  recovery_until timestamptz,
  connected_at timestamptz,
  dial_requested_at timestamptz,
  finished_at timestamptz,
  finish_reason text CHECK (length(finish_reason) <= 120),
  CHECK ((state IN ('ended','cancelled','failed','interrupted','unknown')) = (finished_at IS NOT NULL))
);
-- Stable identifiers are validated atomically on admission. These are snapshots,
-- not restrictive FKs that would prevent existing conversation/profile deletion.
CREATE UNIQUE INDEX voice_call_attempts_live_line_uidx ON public.voice_call_attempts(instance_id)
  WHERE finished_at IS NULL;
CREATE UNIQUE INDEX voice_call_attempts_live_backend_line_uidx ON public.voice_call_attempts(backend_line_key)
  WHERE finished_at IS NULL;
CREATE UNIQUE INDEX voice_call_attempts_live_operator_uidx ON public.voice_call_attempts(operator_id)
  WHERE finished_at IS NULL;
CREATE INDEX voice_call_attempts_recovery_idx ON public.voice_call_attempts(lease_expires_at,id)
  WHERE finished_at IS NULL;
CREATE INDEX voice_call_attempts_tenant_created_idx ON public.voice_call_attempts(tenant_id,created_at DESC);
CREATE INDEX voice_call_attempts_operator_created_idx ON public.voice_call_attempts(operator_id,created_at DESC);

-- A cancelled, not-yet-visible claim must not appear later after a lost HTTP response.
CREATE TABLE public.voice_cancelled_claims (
  id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL,operator_id uuid NOT NULL,browser_session_id uuid NOT NULL,
  owner_token_hash text NOT NULL CHECK(owner_token_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX voice_cancelled_claims_operator_created_idx ON public.voice_cancelled_claims(operator_id,created_at DESC);

CREATE TABLE public.voice_call_control_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  attempt_id uuid NOT NULL REFERENCES public.voice_call_attempts(id) ON DELETE CASCADE,
  event_key text NOT NULL CHECK (length(event_key) BETWEEN 1 AND 160),
  kind text NOT NULL,
  observed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE(attempt_id,event_key)
);
ALTER TABLE public.voice_call_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.voice_call_control_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.voice_cancelled_claims ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.voice_call_attempts, public.voice_call_control_events FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.voice_call_attempts, public.voice_call_control_events TO service_role;
REVOKE ALL ON public.voice_cancelled_claims FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON SEQUENCE public.voice_call_fence_seq FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.voice_attempt_result(p_row public.voice_call_attempts)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT pg_catalog.jsonb_build_object('ok',true,'attempt',
    pg_catalog.to_jsonb(p_row) || pg_catalog.jsonb_build_object('fence',(p_row).fence::text));
$$;
REVOKE ALL ON FUNCTION public.voice_attempt_result(public.voice_call_attempts) FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.voice_operator_allowed(p_tenant_id uuid,p_operator_id uuid,p_instance_id uuid)
RETURNS boolean LANGUAGE sql STABLE SET search_path='' AS $$
  SELECT COALESCE(public.tenant_has_module(p_tenant_id,'voice_calls'),false) AND EXISTS(
    SELECT 1 FROM public.tenant_users WHERE tenant_id=p_tenant_id AND user_id=p_operator_id AND active=true AND
      (role IN ('owner','admin') OR (role='agent' AND p_instance_id=ANY(voice_instance_ids)
        AND (instance_ids IS NULL OR p_instance_id=ANY(instance_ids))))
  );
$$;
REVOKE ALL ON FUNCTION public.voice_operator_allowed(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.voice_claim_call(
  p_tenant_id uuid, p_instance_id uuid, p_conversation_id uuid, p_operator_id uuid,
  p_browser_session_id uuid, p_attempt_id uuid, p_owner_token_hash text,
  p_backend_origin text, p_backend_instance_name text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_row public.voice_call_attempts;
  v_conflict public.voice_call_attempts;
  v_lock bigint;
  v_member public.tenant_users;
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_backend_key text;
BEGIN
  IF p_tenant_id IS NULL OR p_instance_id IS NULL OR p_conversation_id IS NULL OR p_operator_id IS NULL
     OR p_browser_session_id IS NULL OR p_attempt_id IS NULL OR p_owner_token_hash IS NULL
     OR p_owner_token_hash !~ '^[0-9a-f]{64}$' OR p_backend_origin IS NULL OR length(p_backend_origin)>255
     OR p_backend_origin !~ '^https://[^/@?#[:space:]]+$'
     OR p_backend_instance_name IS NULL OR p_backend_instance_name !~ '^[a-zA-Z0-9_.-]{1,100}$' THEN
    RETURN pg_catalog.jsonb_build_object('ok',false,'code','INVALID_OWNER');
  END IF;
  v_backend_key := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
    p_backend_origin || pg_catalog.chr(10) || p_backend_instance_name,'UTF8')),'hex');
  -- Ordering is shared by every claim, including cross-tenant operator claims.
  FOR v_lock IN SELECT DISTINCT value FROM pg_catalog.unnest(ARRAY[
    pg_catalog.hashtextextended('voice-line:' || p_instance_id::text,0),
    pg_catalog.hashtextextended('voice-backend-line:' || v_backend_key,0),
    pg_catalog.hashtextextended('voice-operator:' || p_operator_id::text,0),
    pg_catalog.hashtextextended('voice-attempt:' || p_attempt_id::text,0)
  ]) AS t(value) ORDER BY value LOOP
    PERFORM pg_catalog.pg_advisory_xact_lock(v_lock);
  END LOOP;
  IF EXISTS(SELECT 1 FROM public.voice_cancelled_claims WHERE id=p_attempt_id) THEN
    RETURN pg_catalog.jsonb_build_object('ok',false,'code','ATTEMPT_CLOSED');
  END IF;
  SELECT * INTO v_member FROM public.tenant_users
    WHERE tenant_id=p_tenant_id AND user_id=p_operator_id AND active=true;
  IF NOT FOUND OR NOT COALESCE(public.tenant_has_module(p_tenant_id,'voice_calls'),false) THEN
    RETURN pg_catalog.jsonb_build_object('ok',false,'code','NOT_ALLOWED');
  END IF;
  IF v_member.role NOT IN ('owner','admin') AND
    (v_member.role <> 'agent' OR NOT (p_instance_id=ANY(v_member.voice_instance_ids))
      OR (v_member.instance_ids IS NOT NULL AND NOT (p_instance_id=ANY(v_member.instance_ids)))) THEN
    RETURN pg_catalog.jsonb_build_object('ok',false,'code','NOT_ALLOWED');
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.whatsapp_instances WHERE id=p_instance_id AND tenant_id=p_tenant_id
    AND COALESCE(provider,'baileys')='baileys' AND instance_name=p_backend_instance_name) OR NOT EXISTS(
    SELECT 1 FROM public.chat_conversations WHERE id=p_conversation_id AND tenant_id=p_tenant_id
      AND instance_id=p_instance_id AND COALESCE(is_group,false)=false AND COALESCE(channel,'whatsapp')='whatsapp'
  ) THEN RETURN pg_catalog.jsonb_build_object('ok',false,'code','NOT_ALLOWED'); END IF;

  SELECT * INTO v_row FROM public.voice_call_attempts WHERE id=p_attempt_id FOR UPDATE;
  IF FOUND THEN
    IF v_row.tenant_id<>p_tenant_id OR v_row.instance_id<>p_instance_id OR v_row.conversation_id<>p_conversation_id
       OR v_row.operator_id<>p_operator_id OR v_row.browser_session_id<>p_browser_session_id
       OR v_row.owner_token_hash<>p_owner_token_hash OR v_row.backend_line_key<>v_backend_key THEN
      RETURN pg_catalog.jsonb_build_object('ok',false,'code','INVALID_OWNER');
    END IF;
    IF v_row.finished_at IS NOT NULL THEN RETURN pg_catalog.jsonb_build_object('ok',false,'code','ATTEMPT_CLOSED'); END IF;
    IF v_row.lease_expires_at <= v_now OR v_row.state='recovering' THEN
      RETURN pg_catalog.jsonb_build_object('ok',false,'code','RECOVERY_REQUIRED','attemptId',v_row.id);
    END IF;
    RETURN public.voice_attempt_result(v_row);
  END IF;
  SELECT * INTO v_conflict FROM public.voice_call_attempts WHERE (instance_id=p_instance_id OR backend_line_key=v_backend_key) AND finished_at IS NULL;
  IF FOUND THEN
    RETURN pg_catalog.jsonb_build_object('ok',false,'code',
      CASE WHEN v_conflict.lease_expires_at <= v_now OR v_conflict.state='recovering'
        THEN 'RECOVERY_REQUIRED' ELSE 'LINE_BUSY' END);
  END IF;
  SELECT * INTO v_conflict FROM public.voice_call_attempts WHERE operator_id=p_operator_id AND finished_at IS NULL;
  IF FOUND THEN RETURN pg_catalog.jsonb_build_object('ok',false,'code','OPERATOR_BUSY'); END IF;
  IF (SELECT count(*) FROM public.voice_call_attempts WHERE operator_id=p_operator_id AND created_at>v_now-interval '1 minute')>=30 THEN
    RETURN pg_catalog.jsonb_build_object('ok',false,'code','RATE_LIMITED');
  END IF;
  INSERT INTO public.voice_call_attempts(id,tenant_id,instance_id,conversation_id,operator_id,browser_session_id,owner_token_hash,
    backend_origin,backend_instance_name,backend_line_key)
    VALUES(p_attempt_id,p_tenant_id,p_instance_id,p_conversation_id,p_operator_id,p_browser_session_id,p_owner_token_hash,
      p_backend_origin,p_backend_instance_name,v_backend_key)
    RETURNING * INTO v_row;
  INSERT INTO public.voice_call_control_events(attempt_id,event_key,kind)
    VALUES(v_row.id,'reserved','reserved');
  RETURN public.voice_attempt_result(v_row);
END;
$$;

CREATE FUNCTION public.voice_update_owned_call(
  p_tenant_id uuid, p_operator_id uuid, p_browser_session_id uuid, p_attempt_id uuid,
  p_owner_token_hash text, p_fence bigint, p_action text, p_boot_id uuid DEFAULT NULL,
  p_call_id text DEFAULT NULL, p_call_state text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_row public.voice_call_attempts; v_now timestamptz := pg_catalog.clock_timestamp(); v_rank integer; v_current_rank integer;
BEGIN
  SELECT * INTO v_row FROM public.voice_call_attempts WHERE id=p_attempt_id AND tenant_id=p_tenant_id
    AND operator_id=p_operator_id AND browser_session_id=p_browser_session_id
    AND owner_token_hash=p_owner_token_hash AND fence=p_fence FOR UPDATE;
  IF NOT FOUND THEN RETURN pg_catalog.jsonb_build_object('ok',false,'code','INVALID_OWNER'); END IF;
  IF v_row.finished_at IS NOT NULL THEN RETURN pg_catalog.jsonb_build_object('ok',false,'code','ATTEMPT_CLOSED'); END IF;
  IF p_action IN ('confirm-backend','renew','dialing') AND NOT public.voice_operator_allowed(v_row.tenant_id,v_row.operator_id,v_row.instance_id) THEN
    UPDATE public.voice_call_attempts SET state='recovering' WHERE id=v_row.id;
    RETURN pg_catalog.jsonb_build_object('ok',false,'code','PERMISSION_REVOKED');
  END IF;
  IF p_action='recovering' THEN
    UPDATE public.voice_call_attempts SET state='recovering' WHERE id=v_row.id RETURNING * INTO v_row;
    INSERT INTO public.voice_call_control_events(attempt_id,event_key,kind)
      VALUES(v_row.id,'recovery-entered','recovery-entered') ON CONFLICT DO NOTHING;
  ELSIF p_action='confirm-backend' THEN
    IF p_boot_id IS NULL OR (v_row.backend_boot_id IS NOT NULL AND v_row.backend_boot_id<>p_boot_id) THEN
      RETURN pg_catalog.jsonb_build_object('ok',false,'code','BACKEND_CHANGED');
    END IF;
    UPDATE public.voice_call_attempts SET backend_boot_id=p_boot_id WHERE id=v_row.id RETURNING * INTO v_row;
  ELSIF p_action='renew' THEN
    IF v_row.state='recovering' OR v_row.lease_expires_at<=v_now
       OR (v_row.state='preparing' AND v_row.prepare_deadline_at<=v_now) THEN
      RETURN pg_catalog.jsonb_build_object('ok',false,'code','RECOVERY_REQUIRED');
    END IF;
    -- Reads/status polling need not produce a write and event every time.
    IF v_row.lease_expires_at < v_now + interval '60 seconds' THEN
      UPDATE public.voice_call_attempts SET heartbeat_at=v_now,
        lease_expires_at=CASE WHEN state='preparing' THEN LEAST(v_now+interval '90 seconds',prepare_deadline_at)
          ELSE v_now+interval '90 seconds' END WHERE id=v_row.id RETURNING * INTO v_row;
    END IF;
  ELSIF p_action='dialing' THEN
    IF v_row.state<>'preparing' OR v_row.lease_expires_at<=v_now OR v_row.prepare_deadline_at<=v_now
       OR v_row.backend_boot_id IS NULL THEN RETURN pg_catalog.jsonb_build_object('ok',false,'code','DIAL_NOT_ALLOWED'); END IF;
    UPDATE public.voice_call_attempts SET state='dialing',dial_requested_at=v_now,heartbeat_at=v_now,lease_expires_at=v_now+interval '90 seconds'
      WHERE id=v_row.id RETURNING * INTO v_row;
    INSERT INTO public.voice_call_control_events(attempt_id,event_key,kind) VALUES(v_row.id,'dial-requested','dial-requested') ON CONFLICT DO NOTHING;
  ELSIF p_action='observe' THEN
    IF p_boot_id IS DISTINCT FROM v_row.backend_boot_id OR p_call_id IS NULL OR length(p_call_id)>128 THEN
      RETURN pg_catalog.jsonb_build_object('ok',false,'code','BACKEND_CHANGED');
    END IF;
    IF v_row.backend_call_id IS NOT NULL AND v_row.backend_call_id<>p_call_id THEN
      RETURN pg_catalog.jsonb_build_object('ok',false,'code','CALL_CHANGED');
    END IF;
    v_rank := CASE p_call_state WHEN 'dialing' THEN 1 WHEN 'offering' THEN 1 WHEN 'ringing' THEN 2 WHEN 'connected' THEN 3 WHEN 'ending' THEN 4 ELSE 0 END;
    v_current_rank := CASE v_row.state WHEN 'dialing' THEN 1 WHEN 'ringing' THEN 2 WHEN 'connected' THEN 3 WHEN 'ending' THEN 4 ELSE 0 END;
    IF v_rank=0 OR v_row.state IN ('preparing','recovering') THEN RETURN pg_catalog.jsonb_build_object('ok',false,'code','INVALID_STATE'); END IF;
    IF v_rank<=v_current_rank AND v_row.backend_call_id=p_call_id THEN RETURN public.voice_attempt_result(v_row); END IF;
    UPDATE public.voice_call_attempts SET backend_call_id=COALESCE(backend_call_id,p_call_id),
      state=CASE WHEN v_rank>=v_current_rank THEN CASE WHEN p_call_state='offering' THEN 'dialing' ELSE p_call_state END ELSE state END,
      connected_at=CASE WHEN p_call_state='connected' AND connected_at IS NULL THEN v_now ELSE connected_at END
      WHERE id=v_row.id RETURNING * INTO v_row;
    INSERT INTO public.voice_call_control_events(attempt_id,event_key,kind,data)
      VALUES(v_row.id,'observed:' || p_call_state,'backend-observed',pg_catalog.jsonb_build_object('state',p_call_state)) ON CONFLICT DO NOTHING;
  ELSE RETURN pg_catalog.jsonb_build_object('ok',false,'code','INVALID_ACTION'); END IF;
  RETURN public.voice_attempt_result(v_row);
END;
$$;

-- This service-only finalizer is called after the server's backend reconciliation,
-- never because a browser claimed a call ended or because a TTL elapsed alone.
CREATE FUNCTION public.voice_finish_reconciled_call(
  p_attempt_id uuid, p_tenant_id uuid, p_fence bigint, p_outcome text, p_reason text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_row public.voice_call_attempts;
BEGIN
  SELECT * INTO v_row FROM public.voice_call_attempts WHERE id=p_attempt_id AND tenant_id=p_tenant_id AND fence=p_fence FOR UPDATE;
  IF NOT FOUND THEN RETURN pg_catalog.jsonb_build_object('ok',false,'code','STALE_FENCE'); END IF;
  IF v_row.finished_at IS NOT NULL THEN RETURN public.voice_attempt_result(v_row); END IF;
  IF p_outcome IS NULL OR p_outcome NOT IN ('ended','cancelled','failed','interrupted','unknown')
     OR p_reason IS NULL OR length(p_reason) NOT BETWEEN 1 AND 120 THEN
    RETURN pg_catalog.jsonb_build_object('ok',false,'code','INVALID_OUTCOME');
  END IF;
  UPDATE public.voice_call_attempts SET state=p_outcome,finish_reason=p_reason,finished_at=pg_catalog.clock_timestamp()
    WHERE id=v_row.id RETURNING * INTO v_row;
  INSERT INTO public.voice_call_control_events(attempt_id,event_key,kind,data)
    VALUES(v_row.id,'finished','finished',pg_catalog.jsonb_build_object('state',p_outcome,'reason',p_reason)) ON CONFLICT DO NOTHING;
  RETURN public.voice_attempt_result(v_row);
END;
$$;
REVOKE ALL ON FUNCTION public.voice_claim_call(uuid,uuid,uuid,uuid,uuid,uuid,text,text,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.voice_update_owned_call(uuid,uuid,uuid,uuid,text,bigint,text,uuid,text,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.voice_finish_reconciled_call(uuid,uuid,bigint,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.voice_claim_call(uuid,uuid,uuid,uuid,uuid,uuid,text,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.voice_update_owned_call(uuid,uuid,uuid,uuid,text,bigint,text,uuid,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.voice_finish_reconciled_call(uuid,uuid,bigint,text,text) TO service_role;

CREATE FUNCTION public.voice_cancel_pending_claim(p_attempt_id uuid,p_tenant_id uuid,p_conversation_id uuid,
  p_operator_id uuid,p_browser_session_id uuid,p_owner_token_hash text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_row public.voice_call_attempts; v_cancel public.voice_cancelled_claims; v_lock bigint;
BEGIN
  IF p_attempt_id IS NULL OR p_tenant_id IS NULL OR p_conversation_id IS NULL OR p_operator_id IS NULL
    OR p_browser_session_id IS NULL OR p_owner_token_hash IS NULL OR p_owner_token_hash !~ '^[0-9a-f]{64}$' THEN
    RETURN pg_catalog.jsonb_build_object('ok',false,'code','INVALID_OWNER');
  END IF;
  FOR v_lock IN SELECT DISTINCT value FROM pg_catalog.unnest(ARRAY[
    pg_catalog.hashtextextended('voice-attempt:'||p_attempt_id::text,0),
    pg_catalog.hashtextextended('voice-operator:'||p_operator_id::text,0)
  ]) AS t(value) ORDER BY value LOOP PERFORM pg_catalog.pg_advisory_xact_lock(v_lock); END LOOP;
  SELECT * INTO v_row FROM public.voice_call_attempts WHERE id=p_attempt_id FOR UPDATE;
  IF FOUND THEN
    IF v_row.tenant_id<>p_tenant_id OR v_row.conversation_id<>p_conversation_id OR v_row.operator_id<>p_operator_id
      OR v_row.browser_session_id<>p_browser_session_id OR v_row.owner_token_hash<>p_owner_token_hash THEN
      RETURN pg_catalog.jsonb_build_object('ok',false,'code','INVALID_OWNER');
    END IF;
    IF v_row.finished_at IS NOT NULL THEN RETURN pg_catalog.jsonb_build_object('ok',true,'released',true); END IF;
    UPDATE public.voice_call_attempts SET state='recovering' WHERE id=v_row.id RETURNING * INTO v_row;
    RETURN public.voice_attempt_result(v_row)||pg_catalog.jsonb_build_object('released',false);
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.tenant_users WHERE tenant_id=p_tenant_id AND user_id=p_operator_id AND active=true) THEN
    RETURN pg_catalog.jsonb_build_object('ok',false,'code','NOT_ALLOWED');
  END IF;
  SELECT * INTO v_cancel FROM public.voice_cancelled_claims WHERE id=p_attempt_id;
  IF FOUND AND (v_cancel.tenant_id<>p_tenant_id OR v_cancel.conversation_id<>p_conversation_id OR v_cancel.operator_id<>p_operator_id
    OR v_cancel.browser_session_id<>p_browser_session_id OR v_cancel.owner_token_hash<>p_owner_token_hash) THEN
    RETURN pg_catalog.jsonb_build_object('ok',false,'code','INVALID_OWNER');
  END IF;
  IF NOT FOUND AND (SELECT count(*) FROM public.voice_cancelled_claims WHERE operator_id=p_operator_id
    AND created_at>pg_catalog.clock_timestamp()-interval '1 minute')>=30 THEN
    RETURN pg_catalog.jsonb_build_object('ok',false,'code','RATE_LIMITED');
  END IF;
  INSERT INTO public.voice_cancelled_claims(id,tenant_id,conversation_id,operator_id,browser_session_id,owner_token_hash)
    VALUES(p_attempt_id,p_tenant_id,p_conversation_id,p_operator_id,p_browser_session_id,p_owner_token_hash) ON CONFLICT DO NOTHING;
  RETURN pg_catalog.jsonb_build_object('ok',true,'released',true);
END;
$$;
REVOKE ALL ON FUNCTION public.voice_cancel_pending_claim(uuid,uuid,uuid,uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.voice_cancel_pending_claim(uuid,uuid,uuid,uuid,uuid,text) TO service_role;

CREATE FUNCTION public.voice_claim_recovery_batch(p_worker_id uuid,p_instance_ids uuid[],p_limit integer DEFAULT 4)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
  WITH candidates AS (
    SELECT id FROM public.voice_call_attempts
    WHERE finished_at IS NULL AND instance_id=ANY(p_instance_ids) AND lease_expires_at<=pg_catalog.clock_timestamp()
      AND (recovery_until IS NULL OR recovery_until<=pg_catalog.clock_timestamp()) AND p_worker_id IS NOT NULL
    ORDER BY lease_expires_at,id LIMIT LEAST(GREATEST(p_limit,1),4) FOR UPDATE SKIP LOCKED
  ), claimed AS (
    UPDATE public.voice_call_attempts a SET state='recovering',recovery_worker_id=p_worker_id,
      recovery_until=pg_catalog.clock_timestamp()+interval '180 seconds'
    FROM candidates c WHERE a.id=c.id RETURNING a.*
  ) SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(claimed)||pg_catalog.jsonb_build_object('fence',claimed.fence::text)),'[]'::jsonb) FROM claimed;
$$;
CREATE FUNCTION public.voice_defer_recovery(p_attempt_id uuid,p_tenant_id uuid,p_fence bigint,p_worker_id uuid,p_delay_seconds integer)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
  UPDATE public.voice_call_attempts SET recovery_until=pg_catalog.clock_timestamp()+
    pg_catalog.make_interval(secs=>LEAST(GREATEST(p_delay_seconds,5),120))
  WHERE id=p_attempt_id AND tenant_id=p_tenant_id AND fence=p_fence AND recovery_worker_id=p_worker_id AND finished_at IS NULL;
$$;
REVOKE ALL ON FUNCTION public.voice_claim_recovery_batch(uuid,uuid[],integer) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.voice_defer_recovery(uuid,uuid,bigint,uuid,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.voice_claim_recovery_batch(uuid,uuid[],integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.voice_defer_recovery(uuid,uuid,bigint,uuid,integer) TO service_role;
COMMIT;
