# ============================================================
#  PRE-AQUECIMENTO: LIGAR  (rodar ~30-45 min ANTES da abertura)
# ============================================================
#  Modo economico: uma instancia quente em cada funcao do caminho
#  critico - criacao, leitura publica e verificacao de vaga.
#  A leitura NAO pode ficar em escala zero: nos minutos ao redor da
#  abertura a resposta publica vale apenas 5 segundos, o CDN deixa de
#  absorver a espera e um cold start de ~2s cai em cima da virada.
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
Write-Host "==> Pre-aquecimento ECONOMICO (1 instancia em criacao, leitura publica e verificacao de vaga)" -ForegroundColor Yellow
Write-Host "==> Fazendo deploy das tres funcoes do caminho critico..." -ForegroundColor Yellow
Write-Host ""

$firebaseCli = Get-Command firebase.cmd -ErrorAction SilentlyContinue
if ($firebaseCli) {
    & firebase.cmd deploy --only functions:criarAgendamentoCidadao,functions:carregarAgendaPublicaHttp,functions:verificarDisponibilidadeSlotCidadao --project agendamento-cin-itanhandu
} else {
    Write-Host "==> Firebase CLI global nao encontrado; usando npx (firebase-tools 15.26.0)." -ForegroundColor DarkYellow
    & npx.cmd --yes firebase-tools@15.26.0 deploy --only functions:criarAgendamentoCidadao,functions:carregarAgendaPublicaHttp,functions:verificarDisponibilidadeSlotCidadao --project agendamento-cin-itanhandu
}
if ($LASTEXITCODE -ne 0) { throw "Falha ao ativar o pre-aquecimento. Confira o login do Firebase e tente novamente." }

Write-Host ""
Write-Host "==> PRONTO. Uma instancia quente em cada funcao do caminho critico." -ForegroundColor Green
Write-Host "==> Lembre-se de rodar .\scripts\preaquecer-desligar.ps1 cerca de 1h apos a abertura." -ForegroundColor Green
Write-Host ""
