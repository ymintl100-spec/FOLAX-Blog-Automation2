param([string]$OutputDirectory)
$ErrorActionPreference='Stop'
$repoRoot=Split-Path $PSScriptRoot -Parent
$version=(Get-Content -LiteralPath (Join-Path $repoRoot 'package.json') -Raw | ConvertFrom-Json).version
if ($version -notmatch '^0\.3\.0-rc\.24\.2$') { throw 'This bundle is for rc.24.2 only' }
if (!$OutputDirectory) { $OutputDirectory=Join-Path $repoRoot 'dist/full' }
[void](New-Item -ItemType Directory -Path $OutputDirectory -Force)
$baseName='FOLAX-Windows-'+$version
$exeName='Naver-Blog-Automator-'+$version+'.exe'
$files=@(@{Path=(Join-Path $repoRoot ('dist/'+$exeName));Name=$exeName},@{Path=(Join-Path $repoRoot 'docs/windows-full-rc24-README.txt');Name='README-ko.txt'})
$extensionRoot=Join-Path $repoRoot 'extension'
foreach ($file in Get-ChildItem -LiteralPath $extensionRoot -Recurse -File) {
    $relative=$file.FullName.Substring($extensionRoot.Length).TrimStart([char[]]@('/','\')).Replace('\','/')
    $files+=@{Path=$file.FullName;Name=('Chrome-Extension/'+$relative)}
}
$hashes=@{}
foreach ($file in $files) { $hashes[$file.Name]=(Get-FileHash -LiteralPath $file.Path -Algorithm SHA256).Hash.ToLowerInvariant() }
Add-Type -AssemblyName System.IO.Compression.FileSystem
$destination=Join-Path $OutputDirectory ($baseName+'.zip')
$temporary=$destination+'.tmp-'+[Guid]::NewGuid().ToString('N')
try {
    $archive=[IO.Compression.ZipFile]::Open($temporary,[IO.Compression.ZipArchiveMode]::Create)
    try {
        foreach ($file in $files) { [void][IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive,$file.Path,($baseName+'/'+$file.Name),[IO.Compression.CompressionLevel]::Optimal) }
        $entry=$archive.CreateEntry($baseName+'/SHA256SUMS.txt');$writer=[IO.StreamWriter]::new($entry.Open(),[Text.UTF8Encoding]::new($false))
        try { foreach ($key in ($hashes.Keys | Sort-Object)) { $writer.WriteLine($hashes[$key]+'  '+$key) } } finally { $writer.Dispose() }
    } finally { $archive.Dispose() }
    $verified=[IO.Compression.ZipFile]::OpenRead($temporary)
    try {
        if ($verified.Entries.Count -ne $files.Count+1) { throw 'Unexpected bundle entries' }
        foreach ($file in $files) {
            $stream=$verified.GetEntry($baseName+'/'+$file.Name).Open();$sha=[Security.Cryptography.SHA256]::Create()
            try { $digest=([BitConverter]::ToString($sha.ComputeHash($stream))).Replace('-','').ToLowerInvariant();if ($digest -ne $hashes[$file.Name]) { throw ('Bundle checksum mismatch: '+$file.Name) } } finally { $stream.Dispose();$sha.Dispose() }
        }
    } finally { $verified.Dispose() }
    $checksum=(Get-FileHash -LiteralPath $temporary -Algorithm SHA256).Hash.ToLowerInvariant()
    Move-Item -LiteralPath $temporary -Destination $destination -Force
    Set-Content -LiteralPath (Join-Path $OutputDirectory ($baseName+'.sha256')) -Value ($checksum+'  '+$baseName+'.zip') -Encoding UTF8
    Copy-Item -LiteralPath (Join-Path $repoRoot 'docs/windows-full-rc24-README.txt') -Destination (Join-Path $OutputDirectory ($baseName+'-README.txt')) -Force
    @{version=$version;archive=$destination;bytes=(Get-Item -LiteralPath $destination).Length;sha256=$checksum;verifiedFiles=$files.Count;containsUserData=$false} | ConvertTo-Json
} finally { if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary -Force } }
