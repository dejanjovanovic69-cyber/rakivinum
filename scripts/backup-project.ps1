param(
  [string]$SourcePath = ".",
  [string]$OutputRoot = ".\backups",
  [int]$KeepLast = 14,
  [ValidateSet("daily", "full")]
  [string]$Mode = "daily"
)

$ErrorActionPreference = "Stop"

if (!(Test-Path -Path $OutputRoot)) {
  New-Item -ItemType Directory -Path $OutputRoot | Out-Null
}

$timestamp = Get-Date -Format "yyyy-MM-dd_HH-mm-ss"
$snapshotName = "rakivinum_backup_${Mode}_$timestamp"
$snapshotPath = Join-Path $OutputRoot $snapshotName

if ($Mode -eq "daily") {
  $includeItems = @(
    "src",
    "public",
    "scripts",
    "package.json",
    "package-lock.json",
    "tsconfig.json",
    "vite.config.ts",
    "index.html",
    ".env.example",
    ".gitignore",
    "firebase.json",
    "firestore.rules",
    "firestore.indexes.json",
    "firebase-applet-config.json",
    "README.md",
    "BACKUP_AND_RECOVERY.md",
    "MAINTENANCE.md",
    "TEST_PLAN.md"
  )
} else {
  $includeItems = @(
    "*"
  )
}

$exclude = @("node_modules", "dist", ".git", "backups")

New-Item -ItemType Directory -Path $snapshotPath -Force | Out-Null
foreach ($item in $includeItems) {
  if ($item -eq "*") {
    robocopy $SourcePath $snapshotPath /E /R:1 /W:1 /XD $exclude | Out-Null
    break
  }

  $fromPath = Join-Path $SourcePath $item
  if (!(Test-Path -Path $fromPath)) {
    continue
  }

  if ((Get-Item $fromPath).PSIsContainer) {
    $toPath = Join-Path $snapshotPath $item
    New-Item -ItemType Directory -Path $toPath -Force | Out-Null
    robocopy $fromPath $toPath /E /R:1 /W:1 /XD $exclude | Out-Null
  } else {
    $toDir = Split-Path (Join-Path $snapshotPath $item) -Parent
    if (!(Test-Path -Path $toDir)) {
      New-Item -ItemType Directory -Path $toDir -Force | Out-Null
    }
    Copy-Item -Path $fromPath -Destination (Join-Path $snapshotPath $item) -Force
  }
}

Write-Host "Backup created: $snapshotPath"

$snapshots = Get-ChildItem -Path $OutputRoot -Directory | Where-Object { $_.Name -like "rakivinum_backup_${Mode}_*" } | Sort-Object LastWriteTime -Descending
if ($snapshots.Count -gt $KeepLast) {
  $snapshots | Select-Object -Skip $KeepLast | Remove-Item -Recurse -Force
  Write-Host "Old backups removed. Kept latest $KeepLast."
}
