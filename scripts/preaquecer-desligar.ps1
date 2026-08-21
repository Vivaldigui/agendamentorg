# ============================================================
#  PRE-AQUECIMENTO: DESLIGAR  (rodar ~1h DEPOIS da abertura)
# ============================================================
#  Volta ao repouso (escala a zero) para nao gerar custo
#  desnecessario.
#
#  COMO USAR:
#    1. Abra o PowerShell na pasta do projeto (agendamentorg)
#    2. Execute:  .\scripts\preaquecer-desligar.ps1
# ============================================================

$ErrorActionPreference = "Stop"
$env:PICO_MIN_INSTANCES = "0"

Write-Host ""
Write-Host "==> Pre-aquecimento DESLIGADO (voltando ao repouso: minInstances = 0)" -ForegroundColor Cyan
Write-Host "==> Fazendo deploy de criacao, leitura publica e verificacao de vaga..." -ForegroundColor Cyan
Write-Host ""

$firebaseCli = Get-Command firebase.cmd -ErrorAction SilentlyContinue
if ($firebaseCli) {
    & firebase.cmd deploy --only functions:criarAgendamentoCidadao,functions:carregarAgendaPublicaHttp,functions:verificarDisponibilidadeSlotCidadao --project agendamento-cin-itanhandu
} else {
    Write-Host "==> Firebase CLI global nao encontrado; usando npx (firebase-tools 15.26.0)." -ForegroundColor DarkCyan
    & npx.cmd --yes firebase-tools@15.26.0 deploy --only functions:criarAgendamentoCidadao,functions:carregarAgendaPublicaHttp,functions:verificarDisponibilidadeSlotCidadao --project agendamento-cin-itanhandu
}
if ($LASTEXITCODE -ne 0) { throw "Falha ao desativar o pre-aquecimento. Confira o login do Firebase e tente novamente." }

Write-Host ""
Write-Host "==> PRONTO. Sistema de volta ao estado normal." -ForegroundColor Green
Write-Host ""
