param(
  [string]$BaseUrl = "https://rakivinum-api.dejanjovanovic69.workers.dev",
  [string]$SampleProductId = "MVP-mvp-sljiva-stara",
  [int]$TimeoutSec = 25,
  [int]$Runs = 5,
  [int]$DelaySec = 5,
  [string]$OutCsv = ""
)

$ErrorActionPreference = "Stop"

function Invoke-EdgeCheck {
  param(
    [Parameter(Mandatory = $true)][string]$Name,
    [Parameter(Mandatory = $true)][string]$Url
  )

  $sw = [System.Diagnostics.Stopwatch]::StartNew()
  try {
    $response = Invoke-WebRequest -Uri $Url -Method Get -TimeoutSec $TimeoutSec -UseBasicParsing
    $sw.Stop()
    $status = [int]$response.StatusCode
    $body = [string]$response.Content
    $sizeBytes = [Text.Encoding]::UTF8.GetByteCount($body)
    [pscustomobject]@{
      Name = $Name
      Ok = ($status -ge 200 -and $status -lt 300)
      Status = $status
      Ms = [int]$sw.ElapsedMilliseconds
      SizeKB = [math]::Round($sizeBytes / 1024, 2)
      Url = $Url
    }
  } catch {
    $sw.Stop()
    [pscustomobject]@{
      Name = $Name
      Ok = $false
      Status = 0
      Ms = [int]$sw.ElapsedMilliseconds
      SizeKB = 0
      Url = $Url
    }
  }
}

function Get-Percentile {
  param(
    [Parameter(Mandatory = $true)][double[]]$Values,
    [Parameter(Mandatory = $true)][double]$Percentile
  )

  if ($Values.Count -eq 0) { return 0 }
  $sorted = $Values | Sort-Object
  $rank = [math]::Ceiling(($Percentile / 100) * $sorted.Count) - 1
  $idx = [math]::Max(0, [math]::Min($rank, $sorted.Count - 1))
  return [double]$sorted[$idx]
}

if ($Runs -lt 1) { throw "Runs must be >= 1." }
if ($DelaySec -lt 0) { throw "DelaySec must be >= 0." }

if (-not $OutCsv -or -not $OutCsv.Trim()) {
  $logDir = Join-Path $PSScriptRoot "..\logs"
  if (-not (Test-Path $logDir)) {
    New-Item -ItemType Directory -Path $logDir | Out-Null
  }
  $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
  $OutCsv = Join-Path $logDir ("edge-monitor-{0}.csv" -f $stamp)
}

$all = @()
for ($i = 1; $i -le $Runs; $i++) {
  $cb = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
  $targets = @(
    @{ Name = "health"; Url = "$BaseUrl/health?_cb=$cb" },
    @{ Name = "distilleries"; Url = "$BaseUrl/api/public/distilleries?limit=5&_cb=$cb" },
    @{ Name = "products"; Url = "$BaseUrl/api/public/products?limit=5&_cb=$cb" },
    @{ Name = "ratings-feed"; Url = "$BaseUrl/api/public/ratings-feed?limit=5&_cb=$cb" },
    @{ Name = "ratings-summary"; Url = "$BaseUrl/api/public/ratings-summary/$SampleProductId?_cb=$cb" },
    @{ Name = "product-ratings"; Url = "$BaseUrl/api/public/product-ratings/$SampleProductId?limit=5&_cb=$cb" },
    @{ Name = "club-actions"; Url = "$BaseUrl/api/public/club-actions?limit=5&_cb=$cb" },
    @{ Name = "community-links"; Url = "$BaseUrl/api/public/community-links?limit=10&_cb=$cb" },
    @{ Name = "products-by-distillery"; Url = "$BaseUrl/api/public/products-by-distillery/smoke-test?limit=5&_cb=$cb" },
    @{ Name = "club-actions-by-distillery"; Url = "$BaseUrl/api/public/club-actions-by-distillery/smoke-test?limit=5&_cb=$cb" },
    @{ Name = "club-membership-count"; Url = "$BaseUrl/api/public/club-membership-count/smoke-test?_cb=$cb" },
    @{ Name = "product-lookup"; Url = "$BaseUrl/api/public/product-lookup?n=0&r=0&_cb=$cb" },
    @{ Name = "scan-clusters"; Url = "$BaseUrl/api/public/scan-clusters/$SampleProductId?limit=5&_cb=$cb" }
  )

  Write-Host ""
  Write-Host ("Run {0}/{1}" -f $i, $Runs) -ForegroundColor Cyan

  foreach ($t in $targets) {
    $r = Invoke-EdgeCheck -Name $t.Name -Url $t.Url
    $all += [pscustomobject]@{
      Run = $i
      Name = $r.Name
      Ok = $r.Ok
      Status = $r.Status
      Ms = $r.Ms
      SizeKB = $r.SizeKB
      Url = $r.Url
      Timestamp = (Get-Date).ToString("s")
    }
  }

  $thisRun = $all | Where-Object { $_.Run -eq $i }
  $failed = $thisRun | Where-Object { -not $_.Ok }
  if ($failed.Count -gt 0) {
    Write-Host ("Run {0}: failures detected ({1})" -f $i, $failed.Count) -ForegroundColor Yellow
  } else {
    Write-Host ("Run {0}: all OK" -f $i) -ForegroundColor Green
  }

  if ($i -lt $Runs -and $DelaySec -gt 0) {
    Start-Sleep -Seconds $DelaySec
  }
}

$all | Export-Csv -Path $OutCsv -NoTypeInformation -Encoding UTF8

$summary = foreach ($group in ($all | Group-Object Name)) {
  $rows = $group.Group
  $msValues = @($rows | ForEach-Object { [double]$_.Ms })
  $okCount = @($rows | Where-Object { $_.Ok }).Count
  $total = $rows.Count
  [pscustomobject]@{
    Name = $group.Name
    Runs = $total
    OkRatePct = [math]::Round((100.0 * $okCount / [math]::Max(1, $total)), 1)
    AvgMs = [math]::Round((($msValues | Measure-Object -Average).Average), 0)
    MedianMs = [math]::Round((Get-Percentile -Values $msValues -Percentile 50), 0)
    P95Ms = [math]::Round((Get-Percentile -Values $msValues -Percentile 95), 0)
    MaxMs = [math]::Round((($msValues | Measure-Object -Maximum).Maximum), 0)
    AvgSizeKB = [math]::Round((($rows | Measure-Object -Property SizeKB -Average).Average), 2)
  }
}

Write-Host ""
Write-Host "=== Edge Monitor Summary ===" -ForegroundColor Cyan
$summary | Sort-Object P95Ms -Descending | Format-Table Name, Runs, OkRatePct, AvgMs, MedianMs, P95Ms, MaxMs, AvgSizeKB -AutoSize

$hot = $summary | Sort-Object P95Ms -Descending | Select-Object -First 3
Write-Host ""
Write-Host "Top 3 hot routes (by p95):" -ForegroundColor Yellow
$hot | ForEach-Object {
  Write-Host ("- {0}: p95={1}ms, median={2}ms, ok={3}%" -f $_.Name, $_.P95Ms, $_.MedianMs, $_.OkRatePct)
}

Write-Host ""
Write-Host ("CSV saved: {0}" -f (Resolve-Path $OutCsv)) -ForegroundColor Green
