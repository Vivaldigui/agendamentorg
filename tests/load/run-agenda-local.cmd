@echo off
setlocal
set "BASE_URL=http://127.0.0.1:5000"
set "CONFIRM_HOMOLOGATION=SIM"
if not defined MAX_VUS set "MAX_VUS=300"
if not defined RUN_ID set "RUN_ID=local"
if not defined K6_SUMMARY_EXPORT set "K6_SUMMARY_EXPORT=%TEMP%\agendamentorg-k6-summary.json"
if not defined K6_SUMMARY_TREND_STATS set "K6_SUMMARY_TREND_STATS=avg,min,med,max,p(90),p(95),p(99)"
"C:\Program Files\k6\k6.exe" run --summary-export "%K6_SUMMARY_EXPORT%" "%~dp0agenda-read.js"
exit /b %ERRORLEVEL%
