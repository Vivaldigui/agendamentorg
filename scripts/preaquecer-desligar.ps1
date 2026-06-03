# ============================================================
#  PRE-AQUECIMENTO: DESLIGAR  (rodar ~1h DEPOIS da abertura)
# ============================================================
#  Volta ao repouso (1 instancia quente) para nao gerar custo
#  desnecessario. Para o evento de 08/06/2026 18h: rode por
#  volta das 19h30-20h.
#
#  COMO USAR:
#    1. Abra o PowerShell na pasta do projeto (agendamentorg)
#    2. Execute:  .\scripts\preaquecer-desligar.ps1
# ============================================================

$ErrorActionPreference = "Stop"
$env:PICO_MIN_INSTANCES = "1"

Write-Host ""
Write-Host "==> Pre-aquecimento DESLIGADO (voltando ao repouso: minInstances = 1)" -ForegroundColor Cyan
Write-Host "==> Fazendo deploy das funcoes de pico..." -ForegroundColor Cyan
Write-Host ""

firebase deploy --only functions:criarAgendamentoCidadao,functions:carregarAgendaPublicaHttp --project agendamento-cin-itanhandu

Write-Host ""
Write-Host "==> PRONTO. Sistema de volta ao estado normal." -ForegroundColor Green
Write-Host ""
