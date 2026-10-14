$ErrorActionPreference = 'Stop'
$token = Read-Host 'Supabase Management API token (hidden)' -AsSecureString
$pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($token)
try {
    $headers = @{ Authorization = 'Bearer ' + [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) }
    $sql = Get-Content -LiteralPath (Join-Path $PSScriptRoot '../supabase/preflight/voice-call-ownership.sql') -Raw
    $sql = [regex]::Replace($sql, '(?m)^--.*$', '')
    $queries = @($sql -split ';' | ForEach-Object { $_.Trim() } | Where-Object { $_ -match '^SELECT\s' })
    $results = @()
    foreach ($query in $queries) {
        $body = @{ query = $query; read_only = $true } | ConvertTo-Json -Compress
        $result = Invoke-RestMethod -Method Post -Uri 'https://api.supabase.com/v1/projects/jfpjuhnlqywxwfadwzlf/database/query' -Headers $headers -ContentType 'application/json' -Body $body -TimeoutSec 25
        $results += @{ query = $query; rows = @($result) }
    }
    $report = @{ checked_at = [DateTime]::UtcNow.ToString('o'); read_only = $true; sections = $results }
    $destination = Join-Path $PSScriptRoot '../supabase/preflight/voice-call-ownership-live.json'
    $report | ConvertTo-Json -Depth 25 | Set-Content -LiteralPath $destination -Encoding UTF8
    Write-Output ('Read-only schema sections saved: ' + $results.Count)
} catch {
    # Avoid printing HTTP request objects or credentials in diagnostics.
    Write-Output ('Read-only preflight failed: ' + $_.Exception.GetType().Name)
    exit 1
} finally {
    $headers = $null
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
    $token.Dispose()
}
