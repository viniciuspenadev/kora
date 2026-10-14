# Production preflight: call ownership

Read-only catalog mapping completed on 2026-10-14 in Supabase project **WhatsApp** using the Management API with `read_only=true`. This is the dependency map for `20261014000100_voice_call_ownership.sql`, not an inventory of customer data. No migration was applied during this mapping.

## Confirmed dependencies

| Object | Live structure and compatibility |
| --- | --- |
| PostgreSQL | 17.6; disposable concurrency tests use PostgreSQL 17. |
| `tenants` | UUID primary key. New reservation and cancellation tables reference it with cascading tenant deletion. |
| `tenant_users` | UUID tenant/user IDs; unique pair; `active boolean`; roles `owner`, `admin`, `agent`; nullable `instance_ids uuid[]`; nonnullable `voice_instance_ids uuid[]` default empty. |
| `whatsapp_instances` | UUID ID and tenant; nonnullable instance name/provider; providers `baileys`, `meta_cloud`; nullable Evolution URL. Existing uniqueness covers tenant/name and registered phone. |
| `chat_conversations` | UUID ID/tenant; nullable UUID instance; nonnullable text channel and boolean group marker. Admission requires a real matching instance and individual WhatsApp conversation. |
| `tenant_has_module(uuid,text)` | Existing function owned by `postgres`, executable by `service_role`. Module results are explicitly coalesced to false in new authorization helpers. |
| Scheduler extensions | `pg_cron` 1.6.4 and `pg_net` 0.20.0 are installed. The new recovery route still needs its own scheduled job before activation. |

The scheduler metadata showed 15 existing active jobs and no `kora-voice-reconcile`. Vault already contains an entry named `cron_secret`; its value was not read. The prepared operation `supabase/operations/voice-recovery-schedule.sql` references that value only inside the database and adds a separate one-minute job after the authenticated route is deployed. Existing jobs are unchanged. Because `pg_net` is asynchronous, checking that cron ran is insufficient: also check HTTP success and recovery counts. A one-minute schedule with four-item batches suits this pilot; future demand needs measured recovery throughput and a dedicated worker pool.

All four existing tables have RLS enabled. Existing triggers prevent tenant reassignment, clear voice grants on role changes, enforce billing updates and check the active CRM deal's tenant. The proposed migration modifies none of those tables, indices, policies or triggers.

The preflight found no existing `voice_call_attempts`, `voice_call_control_events`, `voice_cancelled_claims`, `voice_call_fence_seq` or `voice_*` functions. New names therefore have no observed collisions. Recheck immediately before applying; fail rather than overwrite a colliding object.

Reservation IDs for conversations, operators and registered numbers are validated on admission and kept as snapshots. They introduce no restrictive foreign keys that could block existing profile or conversation deletion. Deprovisioning a line while its call is live needs an explicit shutdown procedure; an unreachable/deleted configuration must not silently free the lease.

## Permissions and evidence

The migration enables RLS on new tables, denies browser roles direct access, and restricts service writes to defined RPCs. Only the server can read reservation/event rows. Raw ownership tokens are not persisted; only hashes are stored. RPCs use an empty search path and qualified object names.

The complete catalog result stays in the ignored local `supabase/preflight/voice-call-ownership-live.json`. It contains structure, constraints, indices, triggers, RLS policies and execute grants. It excludes customer rows, secret values and cron command bodies. The API token is not in either file or the repository.

The disposable database test passed 14 scenarios, including 20 concurrent connections on one line, competing operator tabs, cross-tenant access, physical backend aliases, lost-response cancellation, exact large fences, permission revocation, one dial winner, monotonic observations, disjoint recovery batches and bounded attempt rates. The fixture had no exposed ports or persistent volumes and was removed after execution. These checks prove control-plane behavior in the fixture, not production call capacity.

## Still required before activation

1. Review and apply the additive migration in a bounded transaction; reconcile Supabase migration history if applying through the API.
2. Deploy compatible Kora and Evolution code with ownership flags initially off.
3. Install and verify the authenticated recovery job, using the existing cron credential entirely on the server.
4. While the pilot lines are idle, activate both sides of ownership for Blue and then Leads. Keep explicit matching allowlists; do not mix legacy call controls with owned controls on a guarded line.
5. Validate two operators contesting one line, owner tab loss, remote hangup, sequential calls and two separate lines concurrently. Use different authenticated operator identities for concurrent calls.
6. Observe recovery and resource usage before expanding access. Current eager engines still limit growth; on-demand allocation and provisioning are separate milestones.

Rollback must first drain live reservations. Disabling guards while a lease or call remains can reopen the race this protocol closes. Keep additive tables and fences during rollback; never rewind the fencing sequence against a running backend.
