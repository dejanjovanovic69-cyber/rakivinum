param(
  [string]$BaseUrl = "https://rakivinum-api.ldjs1969.workers.dev",
  [string]$SampleProductId = "MVP-mvp-sljiva-stara",
  [string]$SampleVisitorId = "",
  [string]$SampleLicenseToken = "",
  [int]$TimeoutSec = 25
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

$cb = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
$targets = @(
  @{ Name = "health"; Url = "$BaseUrl/health?_cb=$cb" },
  @{ Name = "distilleries"; Url = "$BaseUrl/api/public/distilleries?limit=5&_cb=$cb" },
  @{ Name = "products"; Url = "$BaseUrl/api/public/products?limit=5&_cb=$cb" },
  @{ Name = "ratings-feed"; Url = "$BaseUrl/api/public/ratings-feed?limit=5&_cb=$cb" },
  @{ Name = "ratings-summary"; Url = "$BaseUrl/api/public/ratings-summary/$SampleProductId?_cb=$cb" },
  @{ Name = "product-ratings"; Url = "$BaseUrl/api/public/product-ratings/$SampleProductId?limit=5&_cb=$cb" },
  @{ Name = "club-actions"; Url = "$BaseUrl/api/public/club-actions?limit=5&_cb=$cb" },
  @{ Name = "home-bundle"; Url = "$BaseUrl/api/public/home-bundle?_cb=$cb" },
  @{ Name = "community-links"; Url = "$BaseUrl/api/public/community-links?limit=10&_cb=$cb" },
  @{ Name = "products-by-distillery"; Url = "$BaseUrl/api/public/products-by-distillery/smoke-test?limit=5&_cb=$cb" },
  @{ Name = "club-actions-by-distillery"; Url = "$BaseUrl/api/public/club-actions-by-distillery/smoke-test?limit=5&_cb=$cb" },
  @{ Name = "club-membership-count"; Url = "$BaseUrl/api/public/club-membership-count/smoke-test?_cb=$cb" },
  @{ Name = "product-lookup"; Url = "$BaseUrl/api/public/product-lookup?n=0&r=0&_cb=$cb" },
  @{ Name = "scan-clusters"; Url = "$BaseUrl/api/public/scan-clusters/$SampleProductId?limit=5&_cb=$cb" }
)

if ($SampleVisitorId -and $SampleVisitorId.Trim()) {
  $targets += @{ Name = "club-memberships"; Url = "$BaseUrl/api/public/club-memberships/$([uri]::EscapeDataString($SampleVisitorId))?limit=5&_cb=$cb" }
}

if ($SampleLicenseToken -and $SampleLicenseToken.Trim()) {
  $targets += @{ Name = "license"; Url = "$BaseUrl/api/public/license/$([uri]::EscapeDataString($SampleLicenseToken))?_cb=$cb" }
}

$results = foreach ($t in $targets) {
  Invoke-EdgeCheck -Name $t.Name -Url $t.Url
}

$results | Format-Table Name, Ok, Status, Ms, SizeKB -AutoSize

$failed = $results | Where-Object { -not $_.Ok }
if ($failed.Count -gt 0) {
  Write-Host ""
  Write-Host "Smoke FAILED for:" -ForegroundColor Red
  $failed | ForEach-Object { Write-Host ("- {0} -> {1}" -f $_.Name, $_.Url) -ForegroundColor Red }
  exit 1
}

Write-Host ""
Write-Host "Smoke OK: all edge checks passed." -ForegroundColor Green



