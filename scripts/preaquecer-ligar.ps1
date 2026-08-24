# ============================================================
#  PRE-AQUECIMENTO: LIGAR  (rodar ~1h ANTES da abertura)
# ============================================================
#  Mantem uma instancia quente em cada funcao do caminho critico:
#  criacao, leitura publica e verificacao de vaga.
#
#  A leitura NAO pode ficar em escala zero: nos minutos ao redor da
#  abertura a resposta publica vale 5 segundos em vez de 60, entao o CDN
#  segue absorvendo a rajada mas busca na origem doze vezes mais, e um
#  cold start cai bem em cima da virada.
#
#  COMO USAR:
#    1. Abra o PowerShell na pasta do projeto (agendamentorg)
#    2. Execute:  .\scripts\preaquecer-ligar.ps1
#
#  POR QUE gcloud E NAO firebase deploy:
#    O script antigo fazia deploy das funcoes so para mudar minInstances.
#    Isso exigia functions/node_modules instalado, reconstruia os conteineres e
#    criava revisao nova -- tudo no pior momento possivel, minutos antes da
#    abertura. Em 24/08/2026 esse deploy falhou por falta das dependencias.
#    O minimo de servico do Cloud Run e aplicado sem build e SEM criar revisao
#    nova, em segundos. Foi o que se usou de fato naquela abertura.
#
#  REGIAO:
#    O caminho critico do pico vive em southamerica-east1 desde 24/08/2026,
#    junto do Firestore. Apontar para us-central1 aqui falharia em silencio:
#    o comando reclamaria de servico inexistente e o pico correria frio.
# ============================================================

$ErrorActionPreference = "Stop"

$projeto  = "agendamento-cin-itanhandu"
$regiao   = "southamerica-east1"
# Nomes de servico do Cloud Run sao sempre minusculos.
$servicos = @(
    "criaragendamentocidadao",
    "carregaragendapublicahttp",
    "verificardisponibilidadeslotcidadao"
)

if (-not (Get-Command gcloud -ErrorAction SilentlyContinue)) {
    throw "gcloud nao encontrado no PATH. Instale o Google Cloud SDK e rode 'gcloud auth login'."
}

Write-Host ""
Write-Host "==> Ligando o pre-aquecimento (1 instancia quente por servico)" -ForegroundColor Yellow
Write-Host ""

# No PowerShell 5.1, mesclar o stderr de um executavel nativo no fluxo de
# sucesso transforma CADA linha num ErrorRecord e, com
# $ErrorActionPreference = "Stop", a primeira delas vira excecao. O gcloud
# escreve "Updating..." em stderr como progresso normal -- foi assim que a
# primeira versao deste script morreu no primeiro servico. Aqui o stderr passa
# direto para o console e quem decide sucesso e o codigo de saida.
function Invoke-Gcloud {
    param([string[]] $Argumentos)
    $anterior = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        $saida = & gcloud @Argumentos
        $codigo = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $anterior
    }
    return [pscustomobject]@{ Codigo = $codigo; Saida = ("$saida").Trim() }
}

foreach ($servico in $servicos) {
    Write-Host "    $servico ..." -NoNewline
    $r = Invoke-Gcloud @("run","services","update",$servico,"--project",$projeto,"--region",$regiao,"--min=1","--quiet")
    if ($r.Codigo -ne 0) { throw "Falha em $servico. Confira 'gcloud auth login' e o acesso ao projeto." }
    Write-Host " ok" -ForegroundColor Green
}

# Conferencia obrigatoria: sem ela um erro silencioso so apareceria as 08:00.
Write-Host ""
Write-Host "==> Conferindo o estado real de cada servico:" -ForegroundColor Cyan
$problemas = 0
foreach ($servico in $servicos) {
    # Checar o codigo de saida importa mais aqui do que parece: no desligar, o
    # valor esperado e string VAZIA. Um describe que falha tambem devolve vazio,
    # e sem esta guarda o script imprimiria "PRONTO" sem ter conferido nada.
    $consulta = Invoke-Gcloud @("run","services","describe",$servico,"--project",$projeto,"--region",$regiao,"--format=value(metadata.annotations['run.googleapis.com/minScale'])")
    if ($consulta.Codigo -ne 0) {
        Write-Host "    $servico -> FALHA ao consultar o estado" -ForegroundColor Red
        $problemas++
        continue
    }
    $min = $consulta.Saida
    if ($min -eq "1") {
        Write-Host "    $servico -> min=1" -ForegroundColor Green
    } else {
        Write-Host "    $servico -> min='$min' (ESPERADO 1)" -ForegroundColor Red
        $problemas++
    }
}

Write-Host ""
if ($problemas -gt 0) {
    throw "$problemas servico(s) fora do esperado. NAO prossiga sem resolver."
}
Write-Host "==> PRONTO. Os tres servicos estao quentes." -ForegroundColor Green
Write-Host "==> Rode .\scripts\preaquecer-desligar.ps1 cerca de 1h apos a abertura." -ForegroundColor Green
Write-Host "==> Enquanto estiver ligado, NAO faca deploy: revisao nova desfaz o aquecimento." -ForegroundColor Yellow
Write-Host ""
