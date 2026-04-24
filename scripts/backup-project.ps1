param(
  [string]$SourcePath = ".",
  [string]$OutputRoot = ".\backups",
  [int]$KeepLast = 14
)

$ErrorActionPreference = "Stop"

if (!(Test-Path -Path $OutputRoot)) {
  New-Item -ItemType Directory -Path $OutputRoot | Out-Null
}

$timestamp = Get-Date -Format "yyyy-MM-dd_HH-mm-ss"
$archiveName = "rakivinum_backup_$timestamp.zip"
$archivePath = Join-Path $OutputRoot $archiveName

$exclude = @(
  "node_modules",
  "dist",
  ".git",
  "backups"
)

$items = Get-ChildItem -Path $SourcePath -Force | Where-Object { $exclude -notcontains $_.Name }
Compress-Archive -Path $items.FullName -DestinationPath $archivePath -CompressionLevel Optimal

Write-Host "Backup created: $archivePath"

$archives = Get-ChildItem -Path $OutputRoot -Filter "rakivinum_backup_*.zip" | Sort-Object LastWriteTime -Descending
if ($archives.Count -gt $KeepLast) {
  $archives | Select-Object -Skip $KeepLast | Remove-Item -Force
  Write-Host "Old backups removed. Kept latest $KeepLast."
}
