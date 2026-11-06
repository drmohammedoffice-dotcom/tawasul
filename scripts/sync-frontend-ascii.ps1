# Sync monorepo frontend (Unicode path) into an ASCII staging tree for Vite on Windows.
# Source of truth remains the monorepo frontend/. Staging is for `vite` / browser only.
$ErrorActionPreference = 'Stop'
$scriptsDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = (Resolve-Path (Join-Path $scriptsDir '..')).Path
$source = Join-Path $repoRoot 'frontend'
$dest = 'C:\xampp\htdocs\securechat-web'

if (-not (Test-Path -LiteralPath $source)) {
  throw "Source frontend not found: $source"
}

New-Item -ItemType Directory -Force -Path $dest | Out-Null

Write-Host "[sync-frontend-ascii] source=$source"
Write-Host "[sync-frontend-ascii] dest=$dest"

# Mirror src + config needed to run Vite. Do not wipe node_modules in dest if present.
robocopy (Join-Path $source 'src') (Join-Path $dest 'src') /MIR /NFL /NDL /NJH /NJS /nc /ns /np | Out-Null
$copyFiles = @(
  'index.html',
  'package.json',
  'tsconfig.json',
  'tsconfig.app.json',
  'tsconfig.node.json',
  'vite.config.ts',
  'vite.config.js',
  '.env',
  '.env.local',
  'index.css'
)
foreach ($name in $copyFiles) {
  $from = Join-Path $source $name
  if (Test-Path -LiteralPath $from) {
    Copy-Item -LiteralPath $from -Destination (Join-Path $dest $name) -Force
  }
}

# Staging lives outside the monorepo, so ../tsconfig.base.json would miss.
# Ship a local base config and rewrite extends for Vite/esbuild.
$baseFrom = Join-Path $repoRoot 'tsconfig.base.json'
$baseTo = Join-Path $dest 'tsconfig.base.json'
if (Test-Path -LiteralPath $baseFrom) {
  Copy-Item -LiteralPath $baseFrom -Destination $baseTo -Force
  $stagingTsconfig = Join-Path $dest 'tsconfig.json'
  if (Test-Path -LiteralPath $stagingTsconfig) {
    $raw = Get-Content -LiteralPath $stagingTsconfig -Raw
    $patched = $raw -replace '"extends"\s*:\s*"\.\./tsconfig\.base\.json"', '"extends": "./tsconfig.base.json"'
    Set-Content -LiteralPath $stagingTsconfig -Value $patched -Encoding UTF8
  }
}

# Stale emitted .js beside .tsx confuses Vite resolution — remove from staging src only.
Get-ChildItem -Path (Join-Path $dest 'src') -Recurse -Include *.js,*.js.map -ErrorAction SilentlyContinue |
  Remove-Item -Force -ErrorAction SilentlyContinue

# Workspace hoists vite to repo-root node_modules (not frontend/node_modules).
$rootNm = Join-Path $repoRoot 'node_modules'
$destNm = Join-Path $dest 'node_modules'
if (Test-Path -LiteralPath $destNm) {
  cmd /c "rmdir `"$destNm`"" | Out-Null
}
if (Test-Path -LiteralPath $rootNm) {
  Write-Host '[sync-frontend-ascii] linking node_modules from monorepo root...'
  cmd /c "mklink /J `"$destNm`" `"$rootNm`"" | Out-Null
}

Write-Host '[sync-frontend-ascii] done. Run Vite from C:\xampp\htdocs\securechat-web'
exit 0
