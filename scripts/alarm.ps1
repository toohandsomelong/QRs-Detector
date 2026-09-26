$ErrorActionPreference = 'Stop'
$wav = if ($args.Count -ge 1 -and $args[0]) { $args[0] } else { 'C:\Windows\Media\Alarm01.wav' }
if (-not (Test-Path $wav)) { $wav = 'C:\Windows\Media\Ring01.wav' }
$player = New-Object System.Media.SoundPlayer $wav
while ($true) {
    try { $player.PlaySync() } catch { Start-Sleep -Milliseconds 500 }
}
