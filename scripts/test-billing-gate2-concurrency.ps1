[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$PsqlPath,

  [Parameter(Mandatory = $true)]
  [switch]$AcknowledgeDisposableDatabase
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

if ($env:PGHOST -cne "127.0.0.1") {
  throw "Gate 2 recusado: PGHOST deve ser exatamente 127.0.0.1."
}
if ($env:PGPORT -cne "55432") {
  throw "Gate 2 recusado: PGPORT deve ser exatamente 55432."
}
if ([string]::IsNullOrWhiteSpace($env:PGDATABASE) -or $env:PGDATABASE -cnotlike "billing_gate2_*") {
  throw "Gate 2 recusado: PGDATABASE deve usar o prefixo billing_gate2_."
}
if (-not $AcknowledgeDisposableDatabase) {
  throw "Gate 2 recusado: confirme explicitamente o banco descartavel."
}

$resolvedPsql = (Resolve-Path -LiteralPath $PsqlPath -ErrorAction Stop).Path
if ([System.IO.Path]::GetFileName($resolvedPsql) -cne "psql.exe") {
  throw "Gate 2 recusado: PsqlPath deve apontar para psql.exe."
}

function Invoke-Gate2Psql {
  param([Parameter(Mandatory = $true)][string]$Sql)

  $output = & $resolvedPsql -X -v ON_ERROR_STOP=1 -Atq -d $env:PGDATABASE -c $Sql 2>&1
  if ($LASTEXITCODE -ne 0) {
    throw "psql falhou ($LASTEXITCODE): $($output -join [Environment]::NewLine)"
  }
  return ([string]($output -join [Environment]::NewLine)).Trim()
}

function Start-Gate2Psql {
  param([Parameter(Mandatory = $true)][string]$Sql)

  $startInfo = [System.Diagnostics.ProcessStartInfo]::new()
  $startInfo.FileName = $resolvedPsql
  $startInfo.UseShellExecute = $false
  $startInfo.CreateNoWindow = $true
  $startInfo.RedirectStandardInput = $true
  $startInfo.RedirectStandardOutput = $true
  $startInfo.RedirectStandardError = $true
  foreach ($argument in @("-X", "-v", "ON_ERROR_STOP=1", "-Atq", "-d", $env:PGDATABASE)) {
    [void]$startInfo.ArgumentList.Add($argument)
  }

  $process = [System.Diagnostics.Process]::new()
  $process.StartInfo = $startInfo
  if (-not $process.Start()) {
    throw "Nao foi possivel iniciar psql concorrente."
  }
  $process.StandardInput.WriteLine($Sql)
  $process.StandardInput.Close()
  return $process
}

function Complete-Gate2Psql {
  param(
    [Parameter(Mandatory = $true)][System.Diagnostics.Process]$Process,
    [Parameter(Mandatory = $true)][string]$Actor
  )

  if (-not $Process.WaitForExit(45000)) {
    $Process.Kill($true)
    throw "Gate 2: sessao $Actor excedeu 45 segundos (possivel deadlock)."
  }
  $stdout = $Process.StandardOutput.ReadToEnd().Trim()
  $stderr = $Process.StandardError.ReadToEnd().Trim()
  if ($Process.ExitCode -ne 0) {
    throw "Gate 2: sessao $Actor falhou ($($Process.ExitCode)): $stderr"
  }
  return $stdout
}

function Invoke-ConcurrentPair {
  param(
    [Parameter(Mandatory = $true)][string]$SqlA,
    [Parameter(Mandatory = $true)][string]$SqlB,
    [int]$DelayBeforeBMilliseconds = 0,
    [string]$BarrierSqlBeforeB = "",
    [string]$ActorA = "A",
    [string]$ActorB = "B"
  )

  $processA = $null
  $processB = $null
  try {
    $processA = Start-Gate2Psql -Sql $SqlA
    if (-not [string]::IsNullOrWhiteSpace($BarrierSqlBeforeB)) {
      $barrierReached = $false
      for ($attempt = 0; $attempt -lt 100; $attempt++) {
        if ((Invoke-Gate2Psql -Sql $BarrierSqlBeforeB) -ceq "t") {
          $barrierReached = $true
          break
        }
        Start-Sleep -Milliseconds 50
      }
      if (-not $barrierReached) {
        throw "Gate 2: sessao $ActorA nao atingiu a barreira antes de iniciar $ActorB."
      }
    }
    elseif ($DelayBeforeBMilliseconds -gt 0) {
      Start-Sleep -Milliseconds $DelayBeforeBMilliseconds
    }
    $processB = Start-Gate2Psql -Sql $SqlB
    $outputA = Complete-Gate2Psql -Process $processA -Actor $ActorA
    $outputB = Complete-Gate2Psql -Process $processB -Actor $ActorB
    return @($outputA, $outputB)
  }
  finally {
    foreach ($process in @($processA, $processB)) {
      if ($null -ne $process -and -not $process.HasExited) {
        $process.Kill($true)
      }
      if ($null -ne $process) {
        $process.Dispose()
      }
    }
  }
}

function Assert-Gate2True {
  param(
    [Parameter(Mandatory = $true)][string]$Sql,
    [Parameter(Mandatory = $true)][string]$Message
  )
  $actual = Invoke-Gate2Psql -Sql $Sql
  if ($actual -cne "t") {
    throw "Gate 2: $Message (resultado=$actual)."
  }
}

# Atestacao no servidor, alem das variaveis do processo. Nenhum seed ocorre antes dela.
Assert-Gate2True -Message "conexao nao aponta para o cluster local descartavel esperado" -Sql @'
SELECT inet_server_addr() = '127.0.0.1'::inet
   AND inet_server_port() = 55432
   AND current_database() LIKE 'billing_gate2\_%' ESCAPE '\';
'@

# O harness e deliberadamente one-shot. IDs existentes indicam DB reutilizado/contaminado;
# nao apagamos ledger para maquiar isso.
Assert-Gate2True -Message "fixture concorrente ja existe; use outro DB descartavel" -Sql @'
SELECT NOT EXISTS (
  SELECT 1 FROM public.tenants
   WHERE id = '75000000-0000-0000-0000-000000000001'
) AND NOT EXISTS (
  SELECT 1 FROM public.invoice_payments
   WHERE payment_id LIKE 'gate2c_pay_%'
);
'@

[void](Invoke-Gate2Psql -Sql @'
BEGIN;
SET lock_timeout = '10s';
SET statement_timeout = '30s';

INSERT INTO public.module_catalog
  (slug, category, name, description, is_core, default_on, position)
VALUES
  ('gate2c_alpha', 'commercial', 'Gate 2C Alpha', 'fixture concorrente local', false, false, 996),
  ('gate2c_beta',  'commercial', 'Gate 2C Beta',  'fixture concorrente local', false, false, 997),
  ('gate2c_gamma', 'commercial', 'Gate 2C Gamma', 'fixture concorrente local', false, false, 998);

INSERT INTO public.plans (
  id, name, description, price_cents, user_quota, extra_user_price_cents,
  included_modules, pro_modules, limits, trial_days, trial_activation_mode,
  active, position, updated_at
) VALUES
  (
    '74000000-0000-0000-0000-000000000001', 'Gate 2C Plano A', 'fixture local',
    10000, 3, 1500, ARRAY['gate2c_alpha'], '{}'::text[], '{"users":3}'::jsonb,
    5, 'auto', true, 996, '2026-02-01 00:00:00+00'
  ),
  (
    '74000000-0000-0000-0000-000000000002', 'Gate 2C Plano B', 'fixture local',
    20000, 5, 1200, ARRAY['gate2c_beta'], '{}'::text[], '{"users":5}'::jsonb,
    0, 'manual', true, 997, '2026-02-01 00:00:00+00'
  );

INSERT INTO public.tenants (
  id, name, slug, active, plan_id, billing_mode,
  asaas_customer_id, asaas_subscription_id, subscription_status,
  subscription_ends_at, lifecycle_state, trial_ends_at, past_due_since, past_due_reason
) VALUES (
  '75000000-0000-0000-0000-000000000001', 'Gate 2C Tenant', 'gate2c-tenant',
  true, '74000000-0000-0000-0000-000000000002', 'gateway',
  'gate2c_customer', 'gate2c_subscription', 'active', NULL, 'active', NULL, NULL, NULL
);

DO $fixture$
DECLARE v_result record;
BEGIN
  SELECT * INTO v_result
    FROM public.aplicar_plano_atomico(
      p_tenant => '75000000-0000-0000-0000-000000000001',
      p_plan => '74000000-0000-0000-0000-000000000002',
      p_check_current_plan => true,
      p_expected_current_plan => '74000000-0000-0000-0000-000000000002'
    );
  IF v_result.aplicado IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'fixture: plano inicial nao aplicado: %', v_result.motivo;
  END IF;
END
$fixture$;

INSERT INTO public.invoices (
  id, tenant_id, status, period_start, period_end, due_date,
  subtotal_cents, total_cents, paid_cents, gateway_charge_id, gateway_ref, kind
) VALUES
  (
    '76000000-0000-0000-0000-000000000001',
    '75000000-0000-0000-0000-000000000001',
    'open', DATE '2026-11-01', DATE '2026-11-30', DATE '2026-11-01',
    10000, 10000, 0, NULL, NULL, 'recorrente'
  ),
  (
    '76000000-0000-0000-0000-000000000002',
    '75000000-0000-0000-0000-000000000001',
    'open', DATE '2026-12-01', DATE '2026-12-31', DATE '2026-12-01',
    10000, 10000, 0, NULL, NULL, 'recorrente'
  );

INSERT INTO public.asaas_webhook_events (id, event_type, tenant_id, payment_id, payload)
VALUES
  ('gate2c_evt_same_a', 'PAYMENT_CONFIRMED',
   '75000000-0000-0000-0000-000000000001', 'gate2c_pay_same', '{}'::jsonb),
  ('gate2c_evt_same_b', 'PAYMENT_RECEIVED',
   '75000000-0000-0000-0000-000000000001', 'gate2c_pay_same', '{}'::jsonb),
  ('gate2c_evt_split_a', 'PAYMENT_CONFIRMED',
   '75000000-0000-0000-0000-000000000001', 'gate2c_pay_split_a', '{}'::jsonb),
  ('gate2c_evt_split_b', 'PAYMENT_RECEIVED',
   '75000000-0000-0000-0000-000000000001', 'gate2c_pay_split_b', '{}'::jsonb);

-- Amplia deterministicamente a janela critica: a atribuicao ja leu/travou o plano e
-- pausa antes de trocar B->A. Com a ordem antiga tenant->plano, a edicao de A passava,
-- nao enxergava o tenant ainda em B e a atribuicao terminava com arrays antigos.
CREATE FUNCTION public.gate2c_pause_assignment_to_a()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $pause$
BEGIN
  IF OLD.id = '75000000-0000-0000-0000-000000000001'::uuid
     AND OLD.plan_id = '74000000-0000-0000-0000-000000000002'::uuid
     AND NEW.plan_id = '74000000-0000-0000-0000-000000000001'::uuid THEN
    PERFORM pg_catalog.pg_sleep(2);
  END IF;
  RETURN NEW;
END
$pause$;

CREATE TRIGGER gate2c_pause_assignment_to_a
  BEFORE UPDATE OF plan_id ON public.tenants
  FOR EACH ROW EXECUTE FUNCTION public.gate2c_pause_assignment_to_a();
COMMIT;
'@)

# Corrida 1: tenant em B entra em A enquanto o catalogo de A muda. O contrato correto
# trava A FOR SHARE antes do tenant; a edicao espera, depois reconcilia o tenant ja em A.
$assignmentSql = @'
SET application_name = 'gate2c_assignment';
SET lock_timeout = '10s';
SET statement_timeout = '30s';
SELECT aplicado
  FROM public.aplicar_plano_atomico(
    p_tenant => '75000000-0000-0000-0000-000000000001',
    p_plan => '74000000-0000-0000-0000-000000000001',
    p_check_current_plan => true,
    p_expected_current_plan => '74000000-0000-0000-0000-000000000002'
  );
'@
$assignmentPausedSql = @'
SELECT EXISTS (
  SELECT 1
    FROM pg_catalog.pg_stat_activity
   WHERE datname = current_database()
     AND application_name = 'gate2c_assignment'
     AND wait_event_type = 'Timeout'
     AND wait_event = 'PgSleep'
);
'@
$catalogUpdateSql = @'
SET lock_timeout = '10s';
SET statement_timeout = '30s';
SELECT atualizado
  FROM public.atualizar_plano_atomico(
    '74000000-0000-0000-0000-000000000001',
    'Gate 2C Plano A atualizado', 'fixture local', 10000, 3, 1500,
    ARRAY['gate2c_gamma'], '{}'::text[], '{"users":3}'::jsonb,
    5, 'auto', true, '2026-02-01 00:00:00+00'
  );
'@
$raceParameters = @{
  SqlA = $assignmentSql
  SqlB = $catalogUpdateSql
  BarrierSqlBeforeB = $assignmentPausedSql
  ActorA = "atribuicao"
  ActorB = "catalogo"
}
$raceResult = Invoke-ConcurrentPair @raceParameters
if ($raceResult[0] -cne "t" -or $raceResult[1] -cne "t") {
  throw "Gate 2: corrida catalogo/atribuicao nao concluiu os dois writers: $($raceResult -join ',')."
}
[void](Invoke-Gate2Psql -Sql @'
DROP TRIGGER gate2c_pause_assignment_to_a ON public.tenants;
DROP FUNCTION public.gate2c_pause_assignment_to_a();
'@)
Assert-Gate2True -Message "tenant entrou no plano atualizado com entitlements antigos" -Sql @'
SELECT t.plan_id = '74000000-0000-0000-0000-000000000001'
   AND EXISTS (
     SELECT 1 FROM public.tenant_modules tm
      WHERE tm.tenant_id = t.id AND tm.module_slug = 'gate2c_gamma'
        AND tm.source = 'plan' AND tm.enabled
   )
   AND NOT EXISTS (
     SELECT 1 FROM public.tenant_modules tm
      WHERE tm.tenant_id = t.id AND tm.module_slug IN ('gate2c_alpha','gate2c_beta')
        AND tm.source = 'plan' AND tm.enabled
   )
  FROM public.tenants t
 WHERE t.id = '75000000-0000-0000-0000-000000000001';
'@

# Corrida 2: dois eventos diferentes do mesmo payment_id. Advisory lock + event_key devem
# produzir uma insercao e um replay, nunca dois fatos.
$samePaymentA = @'
SET lock_timeout = '10s'; SET statement_timeout = '30s';
SELECT inserido FROM public.registrar_e_aplicar_fato_gateway(
  '75000000-0000-0000-0000-000000000001', 'pagamento', 'gate2c_pay_same',
  '76000000-0000-0000-0000-000000000001', 10000, NULL,
  '2026-11-01 12:00:00+00', 'webhook', 'gate2c_evt_same_a',
  'pix', DATE '2026-11-01', 'gate2c_subscription', 'gate2c_ref_same',
  'kora:inv:76000000-0000-0000-0000-000000000001'
);
'@
$samePaymentB = $samePaymentA.Replace("gate2c_evt_same_a", "gate2c_evt_same_b")
$samePaymentParameters = @{
  SqlA = $samePaymentA
  SqlB = $samePaymentB
  ActorA = "same-payment-a"
  ActorB = "same-payment-b"
}
$samePaymentResult = Invoke-ConcurrentPair @samePaymentParameters
$samePaymentFlags = @($samePaymentResult | Sort-Object)
if (($samePaymentFlags -join ",") -cne "f,t") {
  throw "Gate 2: mesmo payment_id deveria produzir inserido=false,true: $($samePaymentResult -join ',')."
}
Assert-Gate2True -Message "mesmo payment_id concorrente duplicou ledger/projecao" -Sql @'
SELECT (SELECT count(*) = 1 AND sum(amount_cents) = 10000
          FROM public.invoice_payments
         WHERE provider = 'asaas' AND payment_id = 'gate2c_pay_same')
   AND (SELECT status = 'paid' AND paid_cents = 10000
          FROM public.invoices
         WHERE id = '76000000-0000-0000-0000-000000000001');
'@

# Corrida 3: pagamentos diferentes na mesma invoice. O row lock precisa fazer a segunda
# soma observar o primeiro commit; resultado final exato, sem lost update.
$splitPaymentA = @'
SET lock_timeout = '10s'; SET statement_timeout = '30s';
SELECT inserido FROM public.registrar_e_aplicar_fato_gateway(
  '75000000-0000-0000-0000-000000000001', 'pagamento', 'gate2c_pay_split_a',
  '76000000-0000-0000-0000-000000000002', 4000, NULL,
  '2026-12-01 12:00:00+00', 'webhook', 'gate2c_evt_split_a',
  'pix', DATE '2026-12-01', 'gate2c_subscription', 'gate2c_ref_split_a',
  'kora:inv:76000000-0000-0000-0000-000000000002'
);
'@
$splitPaymentB = @'
SET lock_timeout = '10s'; SET statement_timeout = '30s';
SELECT inserido FROM public.registrar_e_aplicar_fato_gateway(
  '75000000-0000-0000-0000-000000000001', 'pagamento', 'gate2c_pay_split_b',
  '76000000-0000-0000-0000-000000000002', 6000, NULL,
  '2026-12-01 12:00:01+00', 'webhook', 'gate2c_evt_split_b',
  'pix', DATE '2026-12-01', 'gate2c_subscription', 'gate2c_ref_split_b',
  'kora:inv:76000000-0000-0000-0000-000000000002'
);
'@
$splitPaymentParameters = @{
  SqlA = $splitPaymentA
  SqlB = $splitPaymentB
  ActorA = "split-payment-a"
  ActorB = "split-payment-b"
}
$splitPaymentResult = Invoke-ConcurrentPair @splitPaymentParameters
if ($splitPaymentResult[0] -cne "t" -or $splitPaymentResult[1] -cne "t") {
  throw "Gate 2: pagamentos distintos nao inseriram exatamente um fato cada: $($splitPaymentResult -join ',')."
}
Assert-Gate2True -Message "pagamentos concorrentes na mesma invoice perderam atualizacao" -Sql @'
SELECT (SELECT count(*) = 2 AND sum(amount_cents) = 10000
          FROM public.invoice_payments
         WHERE provider = 'asaas'
           AND payment_id IN ('gate2c_pay_split_a','gate2c_pay_split_b'))
   AND (SELECT status = 'paid' AND paid_cents = 10000 AND paid_at IS NOT NULL
          FROM public.invoices
         WHERE id = '76000000-0000-0000-0000-000000000002');
'@

Write-Output "Gate 2 concurrency: PASS (catalog-vs-assignment, same-payment, same-invoice)."
