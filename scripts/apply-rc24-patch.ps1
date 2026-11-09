param([string]$SourcePath, [string]$OutputDirectory, [string]$ManifestPath, [switch]$NoDialogs, [switch]$NoOpen)
$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
function Read-FolaxFileHash([string]$Path) {
    $stream=[IO.File]::OpenRead($Path);$sha=[Security.Cryptography.SHA256]::Create()
    try { return ([BitConverter]::ToString($sha.ComputeHash($stream))).Replace('-','').ToLowerInvariant() } finally { $stream.Dispose();$sha.Dispose() }
}
$manifest=Get-Content -LiteralPath $ManifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
if ($manifest.format -ne 'FOLAX-COPY-LITERAL-v1' -or $manifest.source.name -ne 'Naver-Blog-Automator-0.3.0-rc.24.exe' -or $manifest.target.name -notin @('Naver-Blog-Automator-0.3.0-rc.24.1.exe','Naver-Blog-Automator-0.3.0-rc.24.2.exe') -or $manifest.payload.file -ne 'literal.bin') { throw 'Invalid patch manifest' }
foreach ($item in @($manifest.source,$manifest.target,$manifest.payload)) { if ($item.sha256 -notmatch '^[a-f0-9]{64}$' -or $item.size -lt 0) { throw 'Invalid patch checksum or size' } }
if ($manifest.source.size -le 0 -or $manifest.target.size -le 0) { throw 'Invalid executable size' }
$payload=Join-Path ([IO.Path]::GetDirectoryName($ManifestPath)) 'literal.bin'
if (!(Test-Path -LiteralPath $payload -PathType Leaf) -or (Get-Item -LiteralPath $payload).Length -ne $manifest.payload.size -or (Read-FolaxFileHash $payload) -ne $manifest.payload.sha256) { throw 'Patch data checksum verification failed' }
if (!$SourcePath) {
    if ($NoDialogs) { throw 'Select the original rc.24 executable' }
    Add-Type -AssemblyName System.Windows.Forms
    $dialog=New-Object System.Windows.Forms.OpenFileDialog
    $dialog.Title='사용 중인 rc.24 실행파일을 선택하세요'
    $dialog.Filter='FOLAX rc.24|Naver-Blog-Automator-0.3.0-rc.24.exe|실행파일|*.exe'
    $dialog.InitialDirectory=Join-Path $env:USERPROFILE 'Downloads'
    if ($dialog.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK) { Write-Host 'Cancelled. Original file unchanged.'; exit 2 }
    $SourcePath=$dialog.FileName
}
Write-Host 'Checking original rc.24 file. No Internet connection is required...'
if (!(Test-Path -LiteralPath $SourcePath -PathType Leaf) -or (Get-Item -LiteralPath $SourcePath).Length -ne $manifest.source.size -or (Read-FolaxFileHash $SourcePath) -ne $manifest.source.sha256) { throw '선택한 파일이 이 패치의 rc.24 원본과 일치하지 않습니다. 원본과 설정은 변경하지 않았습니다.' }
if (!$OutputDirectory -and !$NoDialogs) {
    Add-Type -AssemblyName System.Windows.Forms
    $save=New-Object System.Windows.Forms.SaveFileDialog
    $save.Title='수정된 실행파일을 저장할 위치를 선택하세요'
    $save.FileName=$manifest.target.name
    $save.InitialDirectory=[IO.Path]::GetDirectoryName($SourcePath)
    $save.Filter='실행파일|*.exe'
    if ($save.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK) { Write-Host 'Cancelled. Original file unchanged.'; exit 2 }
    $destination=$save.FileName
} else {
    if (!$OutputDirectory) { $OutputDirectory=[IO.Path]::GetDirectoryName($SourcePath) }
    $destination=Join-Path $OutputDirectory $manifest.target.name
}
if ([String]::Equals([IO.Path]::GetFullPath($SourcePath),[IO.Path]::GetFullPath($destination),[StringComparison]::OrdinalIgnoreCase)) { throw 'The original executable must not be overwritten' }
if (Test-Path -LiteralPath $destination) {
    if ((Get-Item -LiteralPath $destination).Length -ne $manifest.target.size -or (Read-FolaxFileHash $destination) -ne $manifest.target.sha256) { throw '다른 파일이 이미 있습니다. 새 파일 이름이나 저장 위치를 선택하세요. 원본은 보존했습니다.' }
    Write-Host ('Already patched: '+$destination)
} else {
    $staged=$destination+'.folax-tmp-'+[Guid]::NewGuid().ToString('N')
    $original=$null; $literals=$null; $output=$null
    try {
        $original=[IO.File]::OpenRead($SourcePath);$literals=[IO.File]::OpenRead($payload);$output=[IO.File]::Open($staged,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write)
        $buffer=New-Object byte[] (1024*1024);[long]$written=0;$lastPercent=-10
        foreach ($operation in $manifest.operations) {
            if ($operation.Count -ne 3) { throw 'Invalid patch operation' }
            [long]$kind=$operation[0];[long]$offset=$operation[1];[long]$remaining=$operation[2]
            if ($kind -eq 0) { $sourceStream=$original } elseif ($kind -eq 1) { $sourceStream=$literals } else { throw 'Unknown patch operation' }
            if ($offset -lt 0 -or $remaining -lt 1 -or $offset+$remaining -gt $sourceStream.Length -or $written+$remaining -gt $manifest.target.size) { throw 'Patch operation exceeds source bounds' }
            [void]$sourceStream.Seek($offset,[IO.SeekOrigin]::Begin)
            while ($remaining -gt 0) {
                $length=[int][Math]::Min($buffer.Length,$remaining);$read=$sourceStream.Read($buffer,0,$length)
                if ($read -le 0) { throw 'Truncated patch source' }
                $output.Write($buffer,0,$read);$remaining-=$read;$written+=$read
            }
            $percent=[int]($written*100/$manifest.target.size)
            if ($percent-$lastPercent -ge 10) { Write-Host ('Applying verified update: '+$percent+'%');$lastPercent=$percent }
        }
        $output.Dispose();$output=$null
        if ($written -ne $manifest.target.size -or (Read-FolaxFileHash $staged) -ne $manifest.target.sha256) { throw 'Updated executable checksum verification failed. Original file unchanged.' }
        Move-Item -LiteralPath $staged -Destination $destination
    } finally {
        if ($output) { $output.Dispose() };if ($original) { $original.Dispose() };if ($literals) { $literals.Dispose() }
        if (Test-Path -LiteralPath $staged) { Remove-Item -LiteralPath $staged -Force }
    }
    Write-Host ('Ready: '+$destination)
}
if (!$NoOpen) { Start-Process explorer.exe -ArgumentList ('/select,"'+$destination+'"') }
