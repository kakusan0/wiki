# 回線速度の記録をやめる（管理者として実行した PowerShell で）
$ErrorActionPreference = 'Stop'
Unregister-ScheduledTask -TaskName 'netspeed' -Confirm:$false -ErrorAction SilentlyContinue
Write-Host 'タスク「netspeed」を止めて、削除しました。' -ForegroundColor Green
$Dir = Join-Path $env:LOCALAPPDATA 'netspeed'
$ans = Read-Host "設定とログのフォルダ（$Dir）も消しますか？ [y/N]"
if ($ans -match '^[Yy]') { Remove-Item -Recurse -Force $Dir; Write-Host '消しました。' }
Write-Host 'Cloudflare 側の記録は残っています（必要ならダッシュボードで Worker と D1 を削除してください）。'
