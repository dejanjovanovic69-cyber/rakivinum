@echo off
cd /d c:\rakivinum
powershell -ExecutionPolicy Bypass -File "c:\rakivinum\scripts\backup-project.ps1" -SourcePath "c:\rakivinum" -OutputRoot "c:\rakivinum\backups" -KeepLast 8 -Mode full
