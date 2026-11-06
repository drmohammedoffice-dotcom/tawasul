# Non-destructive Postgres backup via docker exec + pg_dump.
# Does NOT drop or restore data. Writes a timestamped dump under backups/.
$ErrorActionPreference = 'Stop'
$scriptsDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = (Resolve-Path (Join-Path $scriptsDir '..')).Path
$outDir = Join-Path $repoRoot 'backups'
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$outFile = Join-Path $outDir "postgres-$stamp.sql"

$container = docker ps --format '{{.Names}}' | Select-String -Pattern 'postgres' | Select-Object -First 1
if (-not $container) {
  throw 'No running postgres container found (docker ps).'
}
$name = $container.ToString().Trim()
$dbUser = if ($env:POSTGRES_USER) { $env:POSTGRES_USER } else { 'app' }
$dbName = if ($env:POSTGRES_DB) { $env:POSTGRES_DB } else { 'secure_messaging' }
Write-Host "[backup-postgres] container=$name user=$dbUser db=$dbName -> $outFile"
docker exec $name pg_dump -U $dbUser -d $dbName --no-owner --no-acl | Set-Content -LiteralPath $outFile -Encoding utf8
if (-not (Test-Path -LiteralPath $outFile) -or (Get-Item -LiteralPath $outFile).Length -lt 100) {
  throw 'Backup file missing or too small — check DB name/user in container.'
}
Write-Host "[backup-postgres] OK bytes=$((Get-Item -LiteralPath $outFile).Length)"
Write-Host "[backup-postgres] Restore (manual, destructive): docker exec -i $name psql -U $dbUser -d $dbName < backups\....sql"
exit 0
