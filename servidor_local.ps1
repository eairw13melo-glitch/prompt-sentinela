# Extrator A Sentinela - servidor local Windows
# Recursos: arquivos locais, proxy de imagens/artigos e EPUBCheck oficial.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Net.Http
Add-Type -AssemblyName System.Web

$HostAddress = '127.0.0.1'
$StartPort = 8765
$EndPort = 8795
$MaxImageBytes = 35MB
$MaxArticleBytes = 12MB
$MaxEpubBytes = 80MB
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$AllowedHosts = @('jw.org', 'jw-cdn.org')
$EpubCheckVersion = '5.3.0'
$EpubCheckRoot = Join-Path $Root 'tools\epubcheck'
$EpubCheckDownload = "https://github.com/w3c/epubcheck/releases/download/v$EpubCheckVersion/epubcheck-$EpubCheckVersion.zip"

function Test-AllowedHost([string]$HostName) {
    if ([string]::IsNullOrWhiteSpace($HostName)) { return $false }
    $hostLower = $HostName.TrimEnd('.').ToLowerInvariant()
    foreach ($suffix in $AllowedHosts) {
        if ($hostLower -eq $suffix -or $hostLower.EndsWith('.' + $suffix)) { return $true }
    }
    return $false
}

function Get-ContentType([string]$Path) {
    switch ([IO.Path]::GetExtension($Path).ToLowerInvariant()) {
        '.html'  { 'text/html; charset=utf-8' }
        '.xhtml' { 'application/xhtml+xml; charset=utf-8' }
        '.js'    { 'application/javascript; charset=utf-8' }
        '.css'   { 'text/css; charset=utf-8' }
        '.json'  { 'application/json; charset=utf-8' }
        '.txt'   { 'text/plain; charset=utf-8' }
        '.svg'   { 'image/svg+xml' }
        '.png'   { 'image/png' }
        '.jpg'   { 'image/jpeg' }
        '.jpeg'  { 'image/jpeg' }
        '.webp'  { 'image/webp' }
        '.gif'   { 'image/gif' }
        '.epub'  { 'application/epub+zip' }
        '.zip'   { 'application/zip' }
        '.cmd'   { 'text/plain; charset=utf-8' }
        '.ps1'   { 'text/plain; charset=utf-8' }
        default  { 'application/octet-stream' }
    }
}

function Send-Response($Stream, [int]$Status, [string]$Reason, [byte[]]$Body, [string]$ContentType, [hashtable]$ExtraHeaders = @{}) {
    if ($null -eq $Body) { $Body = [byte[]]@() }
    $headers = [Text.StringBuilder]::new()
    [void]$headers.Append("HTTP/1.1 $Status $Reason`r`n")
    [void]$headers.Append("Content-Type: $ContentType`r`n")
    [void]$headers.Append("Content-Length: $($Body.Length)`r`n")
    [void]$headers.Append("X-Content-Type-Options: nosniff`r`n")
    [void]$headers.Append("Referrer-Policy: no-referrer`r`n")
    foreach ($key in $ExtraHeaders.Keys) { [void]$headers.Append("$key`: $($ExtraHeaders[$key])`r`n") }
    [void]$headers.Append("Connection: close`r`n`r`n")
    $headerBytes = [Text.Encoding]::ASCII.GetBytes($headers.ToString())
    $Stream.Write($headerBytes, 0, $headerBytes.Length)
    if ($Body.Length) { $Stream.Write($Body, 0, $Body.Length) }
    $Stream.Flush()
}

function Send-Text($Stream, [int]$Status, [string]$Reason, [string]$Text) {
    Send-Response $Stream $Status $Reason ([Text.Encoding]::UTF8.GetBytes($Text)) 'text/plain; charset=utf-8' @{ 'Cache-Control' = 'no-store' }
}

function Send-Json($Stream, [int]$Status, [string]$Reason, $Value) {
    $json = $Value | ConvertTo-Json -Depth 30 -Compress
    Send-Response $Stream $Status $Reason ([Text.Encoding]::UTF8.GetBytes($json)) 'application/json; charset=utf-8' @{ 'Cache-Control' = 'no-store' }
}

function Find-FreePort {
    foreach ($port in $StartPort..$EndPort) {
        $probe = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Parse($HostAddress), $port)
        try { $probe.Start(); $probe.Stop(); return $port } catch { try { $probe.Stop() } catch {} }
    }
    throw 'Nenhuma porta local disponivel entre 8765 e 8795.'
}

function Read-HttpRequest($Stream) {
    $headerBytes = [Collections.Generic.List[byte]]::new()
    $state = 0
    while ($headerBytes.Count -lt 65536) {
        $value = $Stream.ReadByte()
        if ($value -lt 0) { break }
        $headerBytes.Add([byte]$value)
        switch ($state) {
            0 { if ($value -eq 13) { $state = 1 } }
            1 { if ($value -eq 10) { $state = 2 } elseif ($value -ne 13) { $state = 0 } }
            2 { if ($value -eq 13) { $state = 3 } else { $state = 0 } }
            3 { if ($value -eq 10) { $state = 4 } else { $state = 0 } }
        }
        if ($state -eq 4) { break }
    }
    if ($state -ne 4) { throw 'Cabecalho HTTP incompleto.' }
    $headerText = [Text.Encoding]::ASCII.GetString($headerBytes.ToArray())
    $lines = $headerText -split "`r`n"
    $requestParts = $lines[0].Split(' ')
    if ($requestParts.Length -lt 2) { throw 'Linha de requisicao invalida.' }
    $headers = @{}
    foreach ($line in $lines[1..($lines.Length - 1)]) {
        if ([string]::IsNullOrWhiteSpace($line)) { continue }
        $separator = $line.IndexOf(':')
        if ($separator -gt 0) { $headers[$line.Substring(0, $separator).Trim().ToLowerInvariant()] = $line.Substring($separator + 1).Trim() }
    }
    $length = 0
    if ($headers.ContainsKey('content-length')) { [void][int]::TryParse($headers['content-length'], [ref]$length) }
    if ($length -gt $MaxEpubBytes) { throw 'Corpo da requisicao ultrapassa 80 MB.' }
    $body = [byte[]]::new($length)
    $offset = 0
    while ($offset -lt $length) {
        $read = $Stream.Read($body, $offset, $length - $offset)
        if ($read -le 0) { throw 'Corpo HTTP incompleto.' }
        $offset += $read
    }
    return @{ Method = $requestParts[0].ToUpperInvariant(); Target = $requestParts[1]; Headers = $headers; Body = $body }
}

function New-RemoteRequest([Uri]$Uri, [string]$Accept) {
    $request = [Net.Http.HttpRequestMessage]::new([Net.Http.HttpMethod]::Get, $Uri)
    $request.Headers.UserAgent.ParseAdd('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/142 Safari/537.36')
    $request.Headers.Accept.ParseAdd($Accept)
    $request.Headers.Referrer = [Uri]'https://wol.jw.org/'
    return $request
}

function Find-EpubCheckJar {
    if (-not (Test-Path -LiteralPath $EpubCheckRoot)) { return $null }
    return Get-ChildItem -LiteralPath $EpubCheckRoot -Recurse -Filter 'epubcheck.jar' -File -ErrorAction SilentlyContinue | Select-Object -First 1
}

function Ensure-EpubCheck {
    $java = Get-Command java -ErrorAction SilentlyContinue
    if (-not $java) { return @{ Available = $false; Java = $false; Message = 'Java nao encontrado. Instale Java 11 ou superior e reinicie o sistema.' } }
    $jar = Find-EpubCheckJar
    if ($jar) { return @{ Available = $true; Java = $true; Jar = $jar.FullName; Version = $EpubCheckVersion; Message = 'EPUBCheck pronto.' } }
    try {
        New-Item -ItemType Directory -Path $EpubCheckRoot -Force | Out-Null
        $tempZip = Join-Path $env:TEMP "epubcheck-$EpubCheckVersion-$([Guid]::NewGuid().ToString('N')).zip"
        Write-Host "Baixando EPUBCheck $EpubCheckVersion..." -ForegroundColor Yellow
        Invoke-WebRequest -Uri $EpubCheckDownload -OutFile $tempZip -UseBasicParsing
        Expand-Archive -LiteralPath $tempZip -DestinationPath $EpubCheckRoot -Force
        Remove-Item -LiteralPath $tempZip -Force -ErrorAction SilentlyContinue
        $jar = Find-EpubCheckJar
        if (-not $jar) { throw 'epubcheck.jar nao foi encontrado no pacote oficial.' }
        return @{ Available = $true; Java = $true; Jar = $jar.FullName; Version = $EpubCheckVersion; Message = 'EPUBCheck instalado e pronto.' }
    } catch {
        return @{ Available = $false; Java = $true; Message = ('Nao foi possivel instalar o EPUBCheck automaticamente: ' + $_.Exception.Message) }
    }
}

$handler = [Net.Http.HttpClientHandler]::new()
$handler.AllowAutoRedirect = $true
$handler.MaxAutomaticRedirections = 8
$handler.AutomaticDecompression = [Net.DecompressionMethods]::GZip -bor [Net.DecompressionMethods]::Deflate
$client = [Net.Http.HttpClient]::new($handler)
$client.Timeout = [TimeSpan]::FromSeconds(60)

$Port = Find-FreePort
$Listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Parse($HostAddress), $Port)
$Listener.Start()
$Url = "http://${HostAddress}:$Port/index.html"

Clear-Host
Write-Host ('=' * 72) -ForegroundColor DarkGreen
Write-Host ' EXTRATOR A SENTINELA - SERVIDOR LOCAL' -ForegroundColor Green
Write-Host ('=' * 72) -ForegroundColor DarkGreen
Write-Host "Sistema: $Url"
Write-Host 'Importacao por URL, imagens e EPUBCheck usam esta janela.'
Write-Host 'Mantenha aberta. Para encerrar, pressione Ctrl+C.'
Write-Host ('=' * 72) -ForegroundColor DarkGreen
Start-Process $Url

try {
    while ($true) {
        $tcp = $Listener.AcceptTcpClient()
        $stream = $null
        try {
            $stream = $tcp.GetStream()
            $request = Read-HttpRequest $stream
            $targetUri = [Uri]("http://localhost" + $request.Target)
            $path = [Uri]::UnescapeDataString($targetUri.AbsolutePath)

            if ($path -eq '/__health') {
                Send-Json $stream 200 'OK' @{ ok = $true; server = 'sentinela-local'; epubcheck = [bool](Find-EpubCheckJar); java = [bool](Get-Command java -ErrorAction SilentlyContinue) }
                continue
            }

            if ($path -eq '/__epubcheck_status') {
                $status = Ensure-EpubCheck
                $statusCode = if ($status.Available) { 200 } else { 503 }
                $reason = if ($status.Available) { 'OK' } else { 'Service Unavailable' }
                Send-Json $stream $statusCode $reason $status
                continue
            }

            if ($path -eq '/__epubcheck' -and $request.Method -eq 'POST') {
                if (-not $request.Body.Length) { Send-Json $stream 400 'Bad Request' @{ ok = $false; message = 'Nenhum EPUB foi recebido.' }; continue }
                $status = Ensure-EpubCheck
                if (-not $status.Available) { Send-Json $stream 503 'Service Unavailable' @{ ok = $false; message = $status.Message; setup = $status }; continue }
                $tempBase = Join-Path $env:TEMP ("sentinela-epubcheck-" + [Guid]::NewGuid().ToString('N'))
                $epubPath = $tempBase + '.epub'
                $reportPath = $tempBase + '.json'
                try {
                    [IO.File]::WriteAllBytes($epubPath, $request.Body)
                    $consoleLines = @(& java -jar $status.Jar --json $reportPath --locale pt-BR $epubPath 2>&1 | ForEach-Object { $_.ToString() })
                    $exitCode = $LASTEXITCODE
                    $report = $null
                    if (Test-Path -LiteralPath $reportPath) { $report = Get-Content -LiteralPath $reportPath -Raw -Encoding UTF8 | ConvertFrom-Json }
                    Send-Json $stream 200 'OK' @{ ok = ($exitCode -eq 0); exitCode = $exitCode; version = $EpubCheckVersion; report = $report; console = $consoleLines }
                } catch {
                    Send-Json $stream 500 'Internal Server Error' @{ ok = $false; message = $_.Exception.Message }
                } finally {
                    Remove-Item -LiteralPath $epubPath,$reportPath -Force -ErrorAction SilentlyContinue
                }
                continue
            }

            if ($path -eq '/__article_proxy') {
                if ($request.Method -ne 'GET') { Send-Text $stream 405 'Method Not Allowed' 'Somente GET e permitido.'; continue }
                $query = [Web.HttpUtility]::ParseQueryString($targetUri.Query)
                $remoteText = $query.Get('url')
                $remote = $null
                if (-not [Uri]::TryCreate($remoteText, [UriKind]::Absolute, [ref]$remote) -or $remote.Scheme -ne 'https' -or -not (Test-AllowedHost $remote.Host)) {
                    Send-Json $stream 400 'Bad Request' @{ ok = $false; message = 'URL nao permitida. Use um endereco HTTPS de jw.org ou wol.jw.org.' }
                    continue
                }
                try {
                    $remoteRequest = New-RemoteRequest $remote 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5'
                    $response = $client.SendAsync($remoteRequest).GetAwaiter().GetResult()
                    $finalUri = $response.RequestMessage.RequestUri
                    if (-not (Test-AllowedHost $finalUri.Host)) { throw 'O redirecionamento saiu dos dominios permitidos.' }
                    if (-not $response.IsSuccessStatusCode) { throw "Servidor remoto respondeu HTTP $([int]$response.StatusCode)." }
                    $bytes = $response.Content.ReadAsByteArrayAsync().GetAwaiter().GetResult()
                    if ($bytes.Length -gt $MaxArticleBytes) { throw 'A pagina ultrapassa o limite de 12 MB.' }
                    $text = [Text.Encoding]::UTF8.GetString($bytes)
                    Send-Json $stream 200 'OK' @{ ok = $true; url = $finalUri.AbsoluteUri; html = $text }
                } catch {
                    Send-Json $stream 502 'Bad Gateway' @{ ok = $false; message = ('Nao foi possivel importar a materia: ' + $_.Exception.Message) }
                }
                continue
            }

            if ($path -eq '/__image_proxy') {
                if ($request.Method -ne 'GET') { Send-Text $stream 405 'Method Not Allowed' 'Somente GET e permitido.'; continue }
                $query = [Web.HttpUtility]::ParseQueryString($targetUri.Query)
                $remoteText = $query.Get('url')
                $remote = $null
                if (-not [Uri]::TryCreate($remoteText, [UriKind]::Absolute, [ref]$remote) -or $remote.Scheme -ne 'https' -or -not (Test-AllowedHost $remote.Host)) {
                    Send-Text $stream 400 'Bad Request' 'Endereco de imagem nao permitido.'
                    continue
                }
                try {
                    $remoteRequest = New-RemoteRequest $remote 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8'
                    $response = $client.SendAsync($remoteRequest).GetAwaiter().GetResult()
                    $finalUri = $response.RequestMessage.RequestUri
                    if (-not (Test-AllowedHost $finalUri.Host)) { throw 'O redirecionamento saiu dos dominios permitidos.' }
                    if (-not $response.IsSuccessStatusCode) { throw "Servidor remoto respondeu HTTP $([int]$response.StatusCode)." }
                    $declared = $response.Content.Headers.ContentLength
                    if ($declared -and $declared -gt $MaxImageBytes) { throw 'A imagem ultrapassa o limite de 35 MB.' }
                    $bytes = $response.Content.ReadAsByteArrayAsync().GetAwaiter().GetResult()
                    if ($bytes.Length -gt $MaxImageBytes) { throw 'A imagem ultrapassa o limite de 35 MB.' }
                    $mediaType = $response.Content.Headers.ContentType.MediaType
                    if ([string]::IsNullOrWhiteSpace($mediaType)) { $mediaType = 'application/octet-stream' }
                    Send-Response $stream 200 'OK' $bytes $mediaType @{ 'Cache-Control' = 'private, max-age=86400'; 'X-Image-Final-Url' = $finalUri.AbsoluteUri }
                } catch {
                    Send-Text $stream 502 'Bad Gateway' ("Nao foi possivel baixar a imagem: " + $_.Exception.Message)
                }
                continue
            }

            if ($request.Method -ne 'GET') { Send-Text $stream 405 'Method Not Allowed' 'Metodo nao permitido.'; continue }
            if ($path -eq '/') { $path = '/index.html' }
            $relative = $path.TrimStart('/').Replace('/', [IO.Path]::DirectorySeparatorChar)
            $candidate = [IO.Path]::GetFullPath((Join-Path $Root $relative))
            $rootFull = [IO.Path]::GetFullPath($Root + [IO.Path]::DirectorySeparatorChar)
            if (-not $candidate.StartsWith($rootFull, [StringComparison]::OrdinalIgnoreCase) -or -not (Test-Path -LiteralPath $candidate -PathType Leaf)) {
                Send-Text $stream 404 'Not Found' 'Arquivo nao encontrado.'
                continue
            }
            $bytes = [IO.File]::ReadAllBytes($candidate)
            Send-Response $stream 200 'OK' $bytes (Get-ContentType $candidate) @{ 'Cache-Control' = 'no-cache' }
        } catch {
            try { Send-Json $stream 500 'Internal Server Error' @{ ok = $false; message = $_.Exception.Message } } catch {}
        } finally {
            try { $stream.Dispose() } catch {}
            try { $tcp.Close() } catch {}
        }
    }
} finally {
    $Listener.Stop()
    $client.Dispose()
}
