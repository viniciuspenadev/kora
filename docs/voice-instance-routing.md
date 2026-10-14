# Routing calls through the registered Evolution instance

Implemented on 2026-10-14. No database migration.

The server authenticates the current tenant/user, loads the selected conversation, checks visibility and per-line call permission, then loads **that conversation's** `whatsapp_instances` row with the same tenant filter. Its `instance_name`, `evolution_url` and decrypted `evolution_key` select the voice backend. The caller cannot submit a URL, key, number or another instance. Meta Cloud numbers and groups do not use this Baileys path.

If the row lacks an Evolution URL, `EVOLUTION_API_URL` supplies it. If it lacks a credential, `EVOLUTION_API_KEY` supplies it only when the resolved origin is the configured global Evolution. Changing the global ENV alone does not migrate existing rows, credentials or QR sessions.

The URL must be an HTTPS origin without user info, path, query or fragment. Allowed origins are the global Evolution and optional comma-separated `VOICE_EVOLUTION_ALLOWED_ORIGINS`. The exact same origin list feeds the browser CSP, preventing a working API from handing the browser a blocked audio endpoint. Fetches refuse redirects so an Evolution credential is not forwarded elsewhere.

Inbox now receives an array of permitted line IDs instead of one fixed Blue ID. Module entitlement, active membership, assigned numbers, per-number call grants and conversation participation remain enforced. Only IDs reach the client, never the Evolution credentials. Runtime readiness is checked when opening the call panel; an Evolution without `/voice/status` remains unavailable for dialing.

## Existing Blue compatibility and migration

Production read check on 2026-10-14 found all eight Baileys rows on the original Evolution origin, with the Blue voice origin still configured as a pilot override. One Meta Cloud row was also present. Until the original messaging Evolution has a verified voice image, the exact Blue row/name can retain its existing `BLUE_VOICE_*` override. Other numbers always resolve from their own row.

Set `VOICE_USE_INSTANCE_CONFIG=true` after voice is verified on the messaging Evolution to disable that compatibility override. The Blue call then uses its registered messaging instance, as all other lines do. Remove obsolete `BLUE_VOICE_*` settings after validation. Do not redirect every row to the pilot service: it does not own those sessions.

The Evolution image must also explicitly enable voice for each instance. Its `VOICE_CALLS_INSTANCE_NAME`/`VOICE_CALLS_INSTANCE_NAMES` allowlist is separate from Kora's account and agent permission grants. Process isolation and measured capacity are required for multiple engines. This routing change does not itself move or update the original Evolution service.
