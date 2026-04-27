@echo off
setlocal
cd /d "%~dp0.."
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0backup-project.ps1" -SourcePath "%CD%" -OutputRoot "%CD%\backups" -KeepLast 30 -Mode daily
