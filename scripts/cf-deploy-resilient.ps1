param(
  [int]$MaxAttempts = 12,
  [int]$DelaySeconds = 60,
  [switch]$SkipPages
)

$ErrorActionPreference = "Stop"

function Invoke-WorkerDeployWithRetry {
  param(
    [int]$Attempts,
    [int]$DelaySec
  )

  for ($i = 1; $i -le $Attempts; $i++) {
    Write-Host ("[{0}/{1}] Worker deploy..." -f $i, $Attempts) -ForegroundColor Cyan
    & npx.cmd wrangler deploy
    if ($LASTEXITCODE -eq 0) {
      Write-Host "Worker deploy OK." -ForegroundColor Green
      return
    }
    if ($i -lt $Attempts) {
      Write-Host ("Worker deploy failed. Waiting {0}s..." -f $DelaySec) -ForegroundColor Yellow
      Start-Sleep -Seconds $DelaySec
    }
  }

  throw "Worker deploy failed after $Attempts attempts."
}

function Invoke-PagesDeploySafe {
  $renamed = $false
  if (Test-Path ".\functions") {
    Rename-Item ".\functions" "functions_tmp"
    $renamed = $true
  }

  try {
    & npm.cmd run cf:pages:deploy
    if ($LASTEXITCODE -ne 0) {
      throw "Pages deploy failed."
    }
    Write-Host "Pages deploy OK." -ForegroundColor Green
  } finally {
    if ($renamed -and (Test-Path ".\functions_tmp")) {
      Rename-Item ".\functions_tmp" "functions"
    }
  }
}

Invoke-WorkerDeployWithRetry -Attempts $MaxAttempts -DelaySec $DelaySeconds

if (-not $SkipPages) {
  Invoke-PagesDeploySafe
}

Write-Host "Resilient deploy flow complete." -ForegroundColor Green
