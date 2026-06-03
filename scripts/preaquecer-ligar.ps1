# ============================================================
#  PRE-AQUECIMENTO: LIGAR  (rodar ~30-45 min ANTES da abertura)
# ============================================================
#  Sobe instancias "quentes" para eliminar o cold start no pico.
#  Para o evento de 08/06/2026 18h: rode por volta das 17h15.
#
#  COMO USAR:
#    1. Abra o PowerShell na pasta do projeto (agendamentorg)
#    2. Execute:  .\scripts\preaquecer-ligar.ps1
#
#  IMPORTANTE: nao faca outros "firebase deploy" entre LIGAR e
#  DESLIGAR, senao o pre-aquecimento e desfeito.
# ============================================================

$ErrorActionPreference = "Stop"
$env:PICO_MIN_INSTANCES = "10"

Write-Host ""
Write-Host "==> Pre-aquecimento LIGADO (minInstances = 10 para criar agendamento)" -ForegroundColor Yellow
Write-Host "==> Fazendo deploy das funcoes de pico..." -ForegroundColor Yellow
Write-Host ""

firebase deploy --only functions:criarAgendamentoCidadao,functions:carregarAgendaPublicaHttp --project agendamento-cin-itanhandu

Write-Host ""
Write-Host "==> PRONTO. Instancias quentes ativas." -ForegroundColor Green
Write-Host "==> Lembre-se de rodar .\scripts\preaquecer-desligar.ps1 cerca de 1h apos a abertura." -ForegroundColor Green
Write-Host ""
