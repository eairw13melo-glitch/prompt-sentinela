$ErrorActionPreference = 'Stop'
$Version = '5.3.0'
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Destination = Join-Path $Root 'tools\epubcheck'
$Url = "https://github.com/w3c/epubcheck/releases/download/v$Version/epubcheck-$Version.zip"

Write-Host ('=' * 68) -ForegroundColor DarkGreen
Write-Host " INSTALADOR EPUBCHECK $Version" -ForegroundColor Green
Write-Host ('=' * 68) -ForegroundColor DarkGreen
if (-not (Get-Command java -ErrorAction SilentlyContinue)) {
  Write-Host 'Java nao foi encontrado.' -ForegroundColor Red
  Write-Host 'Instale Java 11 ou superior e execute este instalador novamente.'
  exit 2
}
New-Item -ItemType Directory -Path $Destination -Force | Out-Null
$existing = Get-ChildItem -LiteralPath $Destination -Recurse -Filter epubcheck.jar -File -ErrorAction SilentlyContinue | Select-Object -First 1
if ($existing) {
  Write-Host "EPUBCheck ja esta instalado em: $($existing.FullName)" -ForegroundColor Green
  exit 0
}
$temp = Join-Path $env:TEMP "epubcheck-$Version-$([Guid]::NewGuid().ToString('N')).zip"
try {
  Write-Host 'Baixando o pacote oficial da W3C/DAISY...'
  Invoke-WebRequest -Uri $Url -OutFile $temp -UseBasicParsing
  Expand-Archive -LiteralPath $temp -DestinationPath $Destination -Force
  $jar = Get-ChildItem -LiteralPath $Destination -Recurse -Filter epubcheck.jar -File | Select-Object -First 1
  if (-not $jar) { throw 'epubcheck.jar nao foi encontrado depois da extracao.' }
  Write-Host "Instalacao concluida: $($jar.FullName)" -ForegroundColor Green
} finally {
  Remove-Item -LiteralPath $temp -Force -ErrorAction SilentlyContinue
}
