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
    $cacheStatus = "-"
    try {
      $xh = $response.Headers["x-cache-status"]
      if ($null -ne $xh -and "$xh".Trim().Length -gt 0) {
        $cacheStatus = "$xh".Trim()
      }
    } catch {
      $cacheStatus = "-"
    }
    [pscustomobject]@{
      Name = $Name
      Ok = ($status -ge 200 -and $status -lt 300)
      Status = $status
      Ms = [int]$sw.ElapsedMilliseconds
      SizeKB = [math]::Round($sizeBytes / 1024, 2)
      Cache = $cacheStatus
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
      Cache = "-"
      Url = $Url
    }
  }
}

$cb = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
$distilleriesSmokeUrl = "$BaseUrl/api/public/distilleries?limit=5&_cb=$cb"
$productsSmokeUrl = "$BaseUrl/api/public/products?limit=5&_cb=$cb"
$ratingsFeedSmokeUrl = "$BaseUrl/api/public/ratings-feed?limit=5&_cb=$cb"
$communityLinksSmokeUrl = "$BaseUrl/api/public/community-links?limit=10&_cb=$cb"
$clubActionsSmokeUrl = "$BaseUrl/api/public/club-actions?limit=5&_cb=$cb"
$ratingsSummarySmokeUrl = "$BaseUrl/api/public/ratings-summary/$SampleProductId?_cb=$cb"
$productRatingsSmokeUrl = "$BaseUrl/api/public/product-ratings/$SampleProductId?limit=5&_cb=$cb"
$productsByDistillerySmokeUrl = "$BaseUrl/api/public/products-by-distillery/smoke-test?limit=5&_cb=$cb"
$clubActionsByDistillerySmokeUrl = "$BaseUrl/api/public/club-actions-by-distillery/smoke-test?limit=5&_cb=$cb"
$clubMembershipCountSmokeUrl = "$BaseUrl/api/public/club-membership-count/smoke-test?_cb=$cb"
$productLookupSmokeUrl = "$BaseUrl/api/public/product-lookup?n=0&r=0&_cb=$cb"
$scanClustersSmokeUrl = "$BaseUrl/api/public/scan-clusters/$SampleProductId?limit=5&_cb=$cb"
$targets = @(
  @{ Name = "health"; Url = "$BaseUrl/health?_cb=$cb" },
  @{ Name = "distilleries"; Url = $distilleriesSmokeUrl },
  @{ Name = "distilleries-repeat"; Url = $distilleriesSmokeUrl },
  @{ Name = "products"; Url = $productsSmokeUrl },
  @{ Name = "products-repeat"; Url = $productsSmokeUrl },
  @{ Name = "ratings-feed"; Url = $ratingsFeedSmokeUrl },
  @{ Name = "ratings-feed-repeat"; Url = $ratingsFeedSmokeUrl },
  @{ Name = "ratings-summary"; Url = $ratingsSummarySmokeUrl },
  @{ Name = "ratings-summary-repeat"; Url = $ratingsSummarySmokeUrl },
  @{ Name = "product-ratings"; Url = $productRatingsSmokeUrl },
  @{ Name = "product-ratings-repeat"; Url = $productRatingsSmokeUrl },
  @{ Name = "club-actions"; Url = $clubActionsSmokeUrl },
  @{ Name = "club-actions-repeat"; Url = $clubActionsSmokeUrl },
  @{ Name = "community-links"; Url = $communityLinksSmokeUrl },
  @{ Name = "community-links-repeat"; Url = $communityLinksSmokeUrl },
  @{ Name = "products-by-distillery"; Url = $productsByDistillerySmokeUrl },
  @{ Name = "products-by-distillery-repeat"; Url = $productsByDistillerySmokeUrl },
  @{ Name = "club-actions-by-distillery"; Url = $clubActionsByDistillerySmokeUrl },
  @{ Name = "club-actions-by-distillery-repeat"; Url = $clubActionsByDistillerySmokeUrl },
  @{ Name = "club-membership-count"; Url = $clubMembershipCountSmokeUrl },
  @{ Name = "club-membership-count-repeat"; Url = $clubMembershipCountSmokeUrl },
  @{ Name = "product-lookup"; Url = $productLookupSmokeUrl },
  @{ Name = "product-lookup-repeat"; Url = $productLookupSmokeUrl },
  @{ Name = "scan-clusters"; Url = $scanClustersSmokeUrl },
  @{ Name = "scan-clusters-repeat"; Url = $scanClustersSmokeUrl }
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

$results | Format-Table Name, Ok, Status, Ms, SizeKB, Cache -AutoSize

$failed = $results | Where-Object { -not $_.Ok }
if ($failed.Count -gt 0) {
  Write-Host ""
  Write-Host "Smoke FAILED for:" -ForegroundColor Red
  $failed | ForEach-Object { Write-Host ("- {0} -> {1}" -f $_.Name, $_.Url) -ForegroundColor Red }
  exit 1
}

Write-Host ""
Write-Host "Smoke OK: all edge checks passed." -ForegroundColor Green



