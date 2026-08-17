<#
  testar-radmin.ps1
  --------------------------------------------------------------------
  Mede se a sua VPN aguenta 1080p60 ANTES de voce perder tempo com o app.

  Sao dois testes:
    1. Latencia e perda de pacote (ping) - nao precisa baixar nada.
    2. Banda real (iperf3)               - precisa do iperf3.exe.

  COMO USAR (precisa de duas pessoas):
    Na maquina A (quem vai transmitir):   .\testar-radmin.ps1 -Modo servidor
    Na maquina B (o espectador):          .\testar-radmin.ps1 -Modo cliente -Alvo 26.x.x.x

  O numero que importa e o do SENTIDO A -> B, porque e o upload de quem
  transmite que limita tudo.
#>

param(
  [ValidateSet('servidor', 'cliente')]
  [string]$Modo = 'servidor',

  [string]$Alvo = '',

  [int]$Porta = 5201,

  # Quantos espectadores voce pretende ter. Usado pra calcular o veredito.
  [int]$Espectadores = 3
)

$ErrorActionPreference = 'Stop'

function Escrever($texto, $cor = 'White') { Write-Host $texto -ForegroundColor $cor }

Escrever ""
Escrever "  Teste de rede - GoLive LAN" Cyan
Escrever "  ================================" Cyan
Escrever ""

# --- Mostra o IP da VPN nesta maquina ----------------------------------

$ips = Get-NetIPAddress -AddressFamily IPv4 |
       Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' }

Escrever "  Enderecos IPv4 desta maquina:" White
foreach ($ip in $ips) {
  $marca = ''
  if ($ip.IPAddress -like '26.*')  { $marca = '   <-- Radmin VPN' }
  if ($ip.IPAddress -like '100.*') { $marca = '   <-- Tailscale' }
  $cor = if ($marca) { 'Green' } else { 'DarkGray' }
  Escrever ("    {0,-16} {1}{2}" -f $ip.IPAddress, $ip.InterfaceAlias, $marca) $cor
}
Escrever ""

# --- Localiza o iperf3 -------------------------------------------------

$iperf = $null
foreach ($caminho in @(
  (Join-Path $PSScriptRoot 'iperf3.exe'),
  (Join-Path $PSScriptRoot 'iperf3\iperf3.exe')
)) {
  if (Test-Path $caminho) { $iperf = $caminho; break }
}
if (-not $iperf) {
  $cmd = Get-Command iperf3.exe -ErrorAction SilentlyContinue
  if ($cmd) { $iperf = $cmd.Source }
}

# --- Modo servidor -----------------------------------------------------

if ($Modo -eq 'servidor') {
  if (-not $iperf) {
    Escrever "  iperf3.exe nao encontrado." Yellow
    Escrever "  Baixe o build de Windows em https://iperf.fr/iperf-download.php" Yellow
    Escrever "  e coloque o iperf3.exe nesta pasta ($PSScriptRoot)." Yellow
    Escrever ""
    exit 1
  }

  Escrever "  Liberando a porta $Porta no firewall (precisa de admin)..." DarkGray
  try {
    New-NetFirewallRule -DisplayName "iperf3 GoLive" -Direction Inbound `
      -Protocol TCP -LocalPort $Porta -Action Allow -ErrorAction SilentlyContinue | Out-Null
  } catch {
    Escrever "  Nao consegui criar a regra de firewall. Rode como administrador se o teste travar." Yellow
  }

  Escrever ""
  Escrever "  Servidor escutando na porta $Porta." Green
  Escrever "  Na outra maquina rode:" White
  Escrever "    .\testar-radmin.ps1 -Modo cliente -Alvo <o IP 26.x.x.x marcado acima>" Cyan
  Escrever ""
  Escrever "  (Ctrl+C encerra)" DarkGray
  Escrever ""

  & $iperf -s -p $Porta
  exit 0
}

# --- Modo cliente ------------------------------------------------------

if (-not $Alvo) {
  Escrever "  Faltou o -Alvo. Exemplo:" Red
  Escrever "    .\testar-radmin.ps1 -Modo cliente -Alvo 26.13.45.201" Cyan
  Escrever ""
  exit 1
}

# Teste 1: latencia e perda. Roda sempre, nao depende do iperf3.
Escrever "  [1/2] Latencia e perda de pacote (30 pings)..." White
$pings = Test-Connection -ComputerName $Alvo -Count 30 -ErrorAction SilentlyContinue

if (-not $pings) {
  Escrever "  Sem resposta de $Alvo." Red
  Escrever "  A VPN esta conectada nos dois lados? O firewall do Windows responde a ping?" Yellow
  Escrever ""
  exit 1
}

# O nome da propriedade mudou entre Windows PowerShell 5 e PowerShell 7.
$tempos = $pings | ForEach-Object {
  if ($null -ne $_.ResponseTime) { $_.ResponseTime } else { $_.Latency }
} | Where-Object { $null -ne $_ }

$media  = [math]::Round(($tempos | Measure-Object -Average).Average, 1)
$maximo = ($tempos | Measure-Object -Maximum).Maximum
$minimo = ($tempos | Measure-Object -Minimum).Minimum
$perda  = [math]::Round((1 - ($tempos.Count / 30)) * 100, 1)
# Jitter aproximado: o quanto a latencia balanca entre o melhor e o pior caso.
$jitter = $maximo - $minimo

Escrever ("        media {0} ms | min {1} ms | max {2} ms | jitter ~{3} ms | perda {4}%" -f `
          $media, $minimo, $maximo, $jitter, $perda) DarkGray

if ($media -gt 80)   { Escrever "        Latencia alta. Vai dar delay perceptivel." Yellow }
if ($jitter -gt 60)  { Escrever "        Jitter alto. Espere engasgos mesmo com banda sobrando." Yellow }
if ($perda -gt 2)    { Escrever "        Perda de pacote relevante. Imagem vai quebrar." Red }
Escrever ""

# Teste 2: banda.
if (-not $iperf) {
  Escrever "  [2/2] Pulado: iperf3.exe nao encontrado." Yellow
  Escrever "        Baixe em https://iperf.fr/iperf-download.php e coloque em $PSScriptRoot" Yellow
  Escrever ""
  exit 0
}

Escrever "  [2/2] Banda real (10s por sentido)..." White
Escrever ""
Escrever "  --- Espectador -> Transmissor (upload deste PC) ---" DarkGray
& $iperf -c $Alvo -p $Porta -t 10 -f m

Escrever ""
Escrever "  --- Transmissor -> Espectador (o que importa) ---" DarkGray
# -R inverte o sentido: mede o upload de quem roda o servidor.
& $iperf -c $Alvo -p $Porta -t 10 -f m -R

Escrever ""
Escrever "  ================================" Cyan
Escrever "  Como ler o resultado" Cyan
Escrever "  ================================" Cyan
Escrever ""
Escrever "  Olhe o Mbits/sec do segundo teste (o com -R). Esse e o quanto" White
Escrever "  quem transmite consegue empurrar pra UM espectador." White
Escrever ""
$necessario = 12 * $Espectadores
Escrever ("  Pra {0} espectador(es) em 1080p60 voce precisa de ~{1} Mbps no total." -f $Espectadores, $necessario) White
Escrever ""
Escrever "  Referencia por espectador:" White
Escrever "    abaixo de  5 Mbps  ->  so 720p30. Radmin nao vai servir." Red
Escrever "    5 a 10 Mbps        ->  1080p30 ou 720p60." Yellow
Escrever "    10 a 20 Mbps       ->  1080p60 confortavel." Green
Escrever "    acima de 20 Mbps   ->  1440p60 na mesa." Green
Escrever ""
Escrever "  Se o numero vier baixo, troque o Radmin por Tailscale e repita." White
Escrever "  O Radmin cai pra rele quando nao consegue P2P, e o rele e lento." White
Escrever ""
