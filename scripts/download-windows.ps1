param(
    [string]$DownloadDirectory = (Join-Path $env:USERPROFILE 'Downloads\BlogAuto-Windows'),
    [string]$ManifestPath = (Join-Path $PSScriptRoot 'windows-download.json'),
    [int]$RetryDelaySeconds = 2,
    [string]$CurlExecutable = $(if (Get-Command curl.exe -ErrorAction SilentlyContinue) { (Get-Command curl.exe).Source }),
    [switch]$NoOpen,
    [switch]$FunctionsOnly
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

function Test-VerifiedFile {
    param([string]$Path, [string]$Sha256, [long]$Size = -1)
    if (!(Test-Path -LiteralPath $Path -PathType Leaf)) { return $false }
    if ($Size -ge 0 -and (Get-Item -LiteralPath $Path).Length -ne $Size) { return $false }
    return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant() -eq $Sha256
}

function Get-FreshUrl {
    param([string]$Uri)
    $separator = '?'
    if ($Uri.Contains('?')) { $separator = '&' }
    return $Uri + $separator + 'folax_download=' + [Guid]::NewGuid().ToString('N')
}

function Receive-File {
    param(
        [string]$Uri, [string]$ApiUri, [string]$Destination,
        [string]$Sha256, [long]$Size, [int]$Attempts = 4,
        [int]$TimeoutSeconds = 180,
        [string]$CurlExecutable = $(if (Get-Command curl.exe -ErrorAction SilentlyContinue) { (Get-Command curl.exe).Source })
    )
    if (Test-VerifiedFile $Destination $Sha256 $Size) { return }
    $staged = $Destination + '.download'
    for ($attempt = 1; $attempt -le $Attempts; $attempt++) {
        # Change both the route and transport, rather than retrying a cached 504.
        $useApi = ($attempt % 2) -eq 0
        $useCurl = $CurlExecutable -and ($attempt -eq 1 -or $attempt -eq 4)
        $route = 'GitHub download'
        $url = Get-FreshUrl $Uri
        $headers = @{ 'User-Agent' = 'FOLAX-Downloader/2'; 'Cache-Control' = 'no-cache' }
        if ($useApi) {
            $route = 'GitHub public API'
            $url = Get-FreshUrl $ApiUri
            $headers['Accept'] = 'application/octet-stream'
            $headers['X-GitHub-Api-Version'] = '2022-11-28'
        }
        try {
            Write-Host ('  ' + $route + ' - attempt ' + $attempt + '/' + $Attempts)
            if (Test-Path -LiteralPath $staged) { Remove-Item -LiteralPath $staged -Force }
            if ($useCurl) {
                $arguments = @('--fail', '--location', '--silent', '--show-error', '--connect-timeout', '20', '--max-time', [string]$TimeoutSeconds, '--speed-limit', '1024', '--speed-time', '45', '--write-out', '%{http_code}', '--output', $staged)
                foreach ($key in $headers.Keys) { $arguments += @('--header', ($key + ': ' + $headers[$key])) }
                $httpCode = & $CurlExecutable @arguments $url
                if ($LASTEXITCODE -ne 0) { throw ('HTTP ' + $httpCode + ' (curl ' + $LASTEXITCODE + ')') }
            } else {
                # Windows PowerShell 5 treats User-Agent as a restricted header.
                $webHeaders = @{}
                foreach ($key in $headers.Keys) { if ($key -ne 'User-Agent') { $webHeaders[$key] = $headers[$key] } }
                Invoke-WebRequest -UseBasicParsing -Uri $url -UserAgent $headers['User-Agent'] -Headers $webHeaders -OutFile $staged -TimeoutSec $TimeoutSeconds -MaximumRedirection 10 | Out-Null
            }
            if (!(Test-VerifiedFile $staged $Sha256 $Size)) { throw 'File size or SHA-256 verification failed' }
            Move-Item -LiteralPath $staged -Destination $Destination -Force
            return
        } catch {
            if (Test-Path -LiteralPath $staged) { Remove-Item -LiteralPath $staged -Force }
            if ($attempt -eq $Attempts) {
                throw ('Download failed on both official GitHub routes. Verified files are kept. Run the NEW downloader again to resume. Last error: ' + $_.Exception.Message)
            }
            Write-Host ('  Route failed; switching download route. ' + $_.Exception.Message)
            $delay = [int][Math]::Min(15, $RetryDelaySeconds * [Math]::Pow(2, $attempt - 1))
            if ($delay -gt 0) { Start-Sleep -Seconds $delay }
        }
    }
}

if ($FunctionsOnly) { return }
$manifest = Get-Content -LiteralPath $ManifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
if ($manifest.file -ne 'Naver-Blog-Automator-Windows-x64.zip' -or $manifest.sha256 -notmatch '^[a-f0-9]{64}$' -or $manifest.parts.Count -ne 30 -or $manifest.size -le 0) { throw 'Invalid bundled manifest' }
New-Item -ItemType Directory -Path $DownloadDirectory -Force | Out-Null
$zip = Join-Path $DownloadDirectory $manifest.file
$partPaths = @()
if (!(Test-VerifiedFile $zip $manifest.sha256 $manifest.size)) {
    for ($i = 1; $i -le $manifest.parts.Count; $i++) {
        $name = $manifest.file + '.part' + $i.ToString('000')
        $entries = @($manifest.parts | Where-Object { $_.name -eq $name })
        if ($entries.Count -ne 1) { throw ('Invalid part metadata: ' + $name) }
        $entry = $entries[0]
        if ($entry.sha256 -notmatch '^[a-f0-9]{64}$' -or $entry.size -le 0 -or $entry.url -notmatch '^https://github\.com/ymintl100-spec/FOLAX-Blog-Automation2/releases/download/v0\.3\.0-rc\.25/[^/?]+$' -or $entry.apiUrl -notmatch '^https://api\.github\.com/repos/ymintl100-spec/FOLAX-Blog-Automation2/releases/assets/\d+$') { throw ('Invalid part URL or hash: ' + $name) }
        $part = Join-Path $DownloadDirectory $name
        if (Test-VerifiedFile $part $entry.sha256 $entry.size) {
            Write-Host ('Using verified file ' + $i + '/' + $manifest.parts.Count)
        } else {
            Write-Host ('Downloading ' + $i + '/' + $manifest.parts.Count)
            Receive-File -Uri $entry.url -ApiUri $entry.apiUrl -Destination $part -Sha256 $entry.sha256 -Size $entry.size -CurlExecutable $CurlExecutable
        }
        $partPaths += $part
    }
    $zipStaged = $zip + '.download'
    $output = [IO.File]::Create($zipStaged)
    try {
        foreach ($part in $partPaths) {
            $inputFile = [IO.File]::OpenRead($part)
            try { $inputFile.CopyTo($output) } finally { $inputFile.Dispose() }
        }
    } finally { $output.Dispose() }
    if (!(Test-VerifiedFile $zipStaged $manifest.sha256 $manifest.size)) { throw 'Combined ZIP verification failed' }
    Move-Item -LiteralPath $zipStaged -Destination $zip -Force
}
Write-Host 'Verified. Extracting the app and Chrome extension...'
Expand-Archive -LiteralPath $zip -DestinationPath $DownloadDirectory -Force
$exe = Join-Path $DownloadDirectory 'Naver-Blog-Automator-0.3.0-rc.25.exe'
if (!(Test-Path -LiteralPath $exe -PathType Leaf)) { throw 'App executable missing after extraction' }
$extensionFolder = Join-Path $DownloadDirectory 'Chrome-Extension'
$extensionManifest = Join-Path $extensionFolder 'manifest.json'
if (!(Test-Path -LiteralPath $extensionManifest -PathType Leaf)) { throw 'Chrome extension folder missing after extraction' }
$extension = Get-Content -LiteralPath $extensionManifest -Raw -Encoding UTF8 | ConvertFrom-Json
if ($extension.version -ne '0.3.23') { throw 'Unexpected Chrome extension version' }
foreach ($part in $partPaths) { Remove-Item -LiteralPath $part -Force }
Write-Host ('Chrome extension folder: ' + $extensionFolder)
Write-Host ('Ready. Run: ' + $exe)
if (!$NoOpen) { Start-Process explorer.exe -ArgumentList ('"' + $DownloadDirectory + '"') }
