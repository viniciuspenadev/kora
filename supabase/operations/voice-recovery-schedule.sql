-- Install only after the new authenticated route is deployed and verified.
-- No secret is embedded in the job command or returned to the caller.
-- Leave recovery feature flags off until both sides of ownership are deployed.
BEGIN;
SET LOCAL lock_timeout='5s';
DO $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM vault.secrets WHERE name='cron_secret') THEN
    RAISE EXCEPTION 'Existing cron_secret Vault entry is required';
  END IF;
  IF EXISTS(SELECT 1 FROM cron.job WHERE jobname='kora-voice-reconcile') THEN
    RAISE EXCEPTION 'Recovery job already exists; inspect its metadata before updating';
  END IF;
  PERFORM cron.schedule('kora-voice-reconcile','* * * * *',$job$
    SELECT net.http_get(
      url:='https://kora.bluedigitalhub.com.br/api/cron/voice-reconcile',
      headers:=jsonb_build_object('Authorization','Bearer ' ||
        (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='cron_secret')),
      timeout_milliseconds:=120000
    );
  $job$);
END;
$$;
COMMIT;
-- Verify jobname/schedule/active and HTTP status only; do not print job commands,
-- request headers or decrypted Vault values. net.http_get is asynchronous.
