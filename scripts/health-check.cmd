@echo off
REM Dnevna provera zdravlja Rakivinum (pravila + Worker + App Check).
REM Pokrece se preko Windows Task Scheduler-a; rezultat ide u backups\health-check.log
REM Rucno: scripts\health-check.cmd

setlocal
set "PROJ=%~dp0.."
cd /d "%PROJ%"

if not exist "backups" mkdir "backups"
set "LOG=%PROJ%\backups\health-check.log"

echo. >> "%LOG%"
echo ================================================== >> "%LOG%"
echo %DATE% %TIME% >> "%LOG%"
echo ================================================== >> "%LOG%"

node scripts\health-check.mjs >> "%LOG%" 2>&1
set "RC=%ERRORLEVEL%"

if "%RC%"=="0" (
  echo REZULTAT: SVE U REDU >> "%LOG%"
) else (
  echo REZULTAT: PROBLEM ^(izlazni kod %RC%^) >> "%LOG%"
  REM Marker fajl koji se lako primeti - obrisi ga kad resis problem
  echo Provera je pala %DATE% %TIME%. Detalji: backups\health-check.log > "%PROJ%\PROVERA-PALA.txt"
)

endlocal & exit /b %RC%
