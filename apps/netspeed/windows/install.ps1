# 回線速度の記録を始める（1 回だけ実行）。右クリック →「PowerShell で実行」ではなく、
# 「管理者として実行」した PowerShell で：  powershell -ExecutionPolicy Bypass -File .\install.ps1
#
# やること：
#   1. %LOCALAPPDATA%\netspeed に測定のスクリプトと設定（送り先・鍵）を置く（自分だけが読めるようにする）
#   2. 試しに 1 回測って送る
#   3. タスク スケジューラに「毎分」で登録する（ログインしていなくても、画面を出さずに動く）
#   4. スリープしない設定にする（選んだときだけ）
$ErrorActionPreference = 'Stop'

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
  Write-Host '管理者として実行した PowerShell で、もう一度実行してください（タスクの登録に必要です）。' -ForegroundColor Yellow
  exit 1
}

$Dir = Join-Path $env:LOCALAPPDATA 'netspeed'
New-Item -ItemType Directory -Force -Path $Dir | Out-Null
Copy-Item -Path (Join-Path $PSScriptRoot 'collect.ps1') -Destination $Dir -Force

Write-Host ''
Write-Host '=== 回線速度の記録：設定 ===' -ForegroundColor Cyan
$endpoint = Read-Host '結果を送る先の URL（例：https://netspeed.あなたの名前.workers.dev）'
$endpoint = $endpoint.Trim().TrimEnd('/')
if ($endpoint -notmatch '^https://') { Write-Host 'https:// から始まる URL を入れてください。' -ForegroundColor Yellow; exit 1 }
$sec = Read-Host '送信用の鍵（Cloudflare に登録した INGEST_TOKEN と同じもの。画面には出ません）' -AsSecureString
$token = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec))
if ($token.Length -lt 16) { Write-Host '鍵が短すぎます（16 文字以上）。' -ForegroundColor Yellow; exit 1 }

$cfg = [ordered]@{
  endpoint = $endpoint
  token = $token
  pingHost = '1.1.1.1'
  quickDownBytes = 2000000; quickUpBytes = 1000000   # 毎分：下り 2 MB・上り 1 MB
  fullDownBytes = 25000000; fullUpBytes = 10000000   # 確かめ用：下り 25 MB・上り 10 MB
  fullEveryMin = 120                                 # 確かめ用は 2 時間ごと
  fullOffsetMin = (Get-Random -Minimum 0 -Maximum 120)
}
$cfgPath = Join-Path $Dir 'config.json'
($cfg | ConvertTo-Json) | Set-Content -Path $cfgPath -Encoding UTF8

# 設定（鍵を含む）は、自分と SYSTEM と管理者だけが読めるようにする
$me = "$env:USERDOMAIN\$env:USERNAME"
icacls $Dir /inheritance:r /grant:r "${me}:(OI)(CI)F" "SYSTEM:(OI)(CI)F" "Administrators:(OI)(CI)F" | Out-Null

Write-Host ''
Write-Host '試しに 1 回測って送ります（10〜20 秒）…' -ForegroundColor Cyan
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Dir 'collect.ps1')
Write-Host ''

# タスク スケジューラ：毎分。ログオンしていなくても動く（S4U）。画面は出さない
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument ('-NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File "{0}"' -f (Join-Path $Dir 'collect.ps1'))
$start = (Get-Date).AddMinutes(1); $start = $start.AddSeconds(-$start.Second)
$trigger = New-ScheduledTaskTrigger -Once -At $start -RepetitionInterval (New-TimeSpan -Minutes 1)
$principal = New-ScheduledTaskPrincipal -UserId $me -LogonType S4U -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 5) -Hidden
Register-ScheduledTask -TaskName 'netspeed' -Description '回線速度を毎分測って記録する' -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null
Write-Host 'タスク「netspeed」を登録しました（毎分）。' -ForegroundColor Green

$ans = Read-Host 'この PC がスリープしないように設定しますか？（コンセントにつないでいるとき）[Y/n]'
if ($ans -eq '' -or $ans -match '^[Yy]') {
  powercfg /change standby-timeout-ac 0
  powercfg /change hibernate-timeout-ac 0
  Write-Host 'スリープしない設定にしました。' -ForegroundColor Green
}

Write-Host ''
Write-Host "記録のログ：$Dir\log.txt" -ForegroundColor Cyan
Write-Host "結果を見る：$endpoint" -ForegroundColor Cyan
Write-Host 'やめるときは uninstall.ps1 を実行してください。'
