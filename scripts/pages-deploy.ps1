# Cloudflare Pages direct upload. Wrangler treats a root `functions/` folder as Pages Functions
# (not Firebase), so Firebase's `functions/node_modules` breaks the deploy (e.g. ci-info .d.ts).
# Temporarily rename Firebase `functions` while uploading `dist/`.
$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
if (-not (Test-Path (Join-Path $repoRoot "dist"))) {
  Write-Error "dist/ not found. Run npm run build from repo root first."
}

Set-Location $repoRoot

$fbFunctions = Join-Path $repoRoot "functions"
$fbFunctionsTmp = Join-Path $repoRoot "functions_tmp"
$renamed = $false
if (Test-Path $fbFunctions) {
  Rename-Item -LiteralPath $fbFunctions -NewName "functions_tmp"
  $renamed = $true
}

try {
  & npx.cmd wrangler pages deploy dist --project-name rakivinum --branch master --commit-dirty=true
  if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
  }
}
finally {
  if ($renamed -and (Test-Path $fbFunctionsTmp)) {
    Rename-Item -LiteralPath $fbFunctionsTmp -NewName "functions"
  }
}
