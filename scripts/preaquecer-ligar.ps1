# ============================================================
#  PRE-AQUECIMENTO: LIGAR  (rodar ~30-45 min ANTES da abertura)
# ============================================================
#  Modo economico: mantem somente uma instancia quente da funcao
#  de criacao. A leitura continua em escala zero e usa o cache CDN.
#
#  COMO USAR:
#    1. Abra o PowerShell na pasta do projeto (agendamentorg)
#    2. Execute:  .\scripts\preaquecer-ligar.ps1
#
#  IMPORTANTE: nao faca outros "firebase deploy" entre LIGAR e
#  DESLIGAR, senao o pre-aquecimento e desfeito.
# ============================================================

$ErrorActionPreference = "Stop"
$env:PICO_MIN_INSTANCES = "1"

Write-Host ""
Write-Host "==> Pre-aquecimento ECONOMICO (1 instancia para criar agendamento; leitura permanece em 0)" -ForegroundColor Yellow
Write-Host "==> Fazendo deploy somente da funcao de criacao..." -ForegroundColor Yellow
Write-Host ""

$firebaseCli = Get-Command firebase.cmd -ErrorAction SilentlyContinue
if ($firebaseCli) {
    & firebase.cmd deploy --only functions:criarAgendamentoCidadao --project agendamento-cin-itanhandu
} else {
    Write-Host "==> Firebase CLI global nao encontrado; usando npx (firebase-tools 15.26.0)." -ForegroundColor DarkYellow
    & npx.cmd --yes firebase-tools@15.26.0 deploy --only functions:criarAgendamentoCidadao --project agendamento-cin-itanhandu
}
if ($LASTEXITCODE -ne 0) { throw "Falha ao ativar o pre-aquecimento. Confira o login do Firebase e tente novamente." }

Write-Host ""
Write-Host "==> PRONTO. Uma instancia quente ativa para a operacao critica." -ForegroundColor Green
Write-Host "==> Lembre-se de rodar .\scripts\preaquecer-desligar.ps1 cerca de 1h apos a abertura." -ForegroundColor Green
Write-Host ""
