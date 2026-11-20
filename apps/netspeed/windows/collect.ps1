# 回線速度を 1 回測って、Cloudflare の記録の受け口へ送る（タスク スケジューラが毎分実行する）
# Windows 11 に最初から入っている Windows PowerShell 5.1 で動く書き方にしている。
#   -Full     確かめ用の大きめの測定を必ず行う
#   -NoSend   測るだけで送らない（試すとき）
param([switch]$Full, [switch]$NoSend)

$ErrorActionPreference = 'Stop'
$Dir = $PSScriptRoot
$ConfigPath = Join-Path $Dir 'config.json'
$QueuePath = Join-Path $Dir 'pending.jsonl'
$LogPath = Join-Path $Dir 'log.txt'

function Write-Log([string]$msg) {
  $line = '{0}  {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $msg
  try {
    if ((Test-Path $LogPath) -and ((Get-Item $LogPath).Length -gt 1MB)) { Move-Item $LogPath "$LogPath.old" -Force }
    Add-Content -Path $LogPath -Value $line -Encoding UTF8
  } catch { }
  Write-Output $line
}

# 同時に 2 つ動かない
$mutex = New-Object System.Threading.Mutex($false, 'Local\netspeed-collect')
if (-not $mutex.WaitOne(0)) { Write-Log '前の測定がまだ動いているので、今回は休みます'; exit 0 }

try {
  if (-not (Test-Path $ConfigPath)) { throw "設定がありません：$ConfigPath（install.ps1 を実行してください）" }
  $cfg = Get-Content $ConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json
  function Get-Cfg($name, $default) { if ($null -ne $cfg.$name -and "$($cfg.$name)" -ne '') { return $cfg.$name } return $default }
  $speedBase = Get-Cfg 'speedBase' 'https://speed.cloudflare.com'
  $pingHost = Get-Cfg 'pingHost' '1.1.1.1'
  $fullEvery = [int](Get-Cfg 'fullEveryMin' 120)
  $fullOffset = [int](Get-Cfg 'fullOffsetMin' 7)

  try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 -bor [Net.SecurityProtocolType]::Tls13 } catch { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 }
  Add-Type -AssemblyName System.Net.Http
  $handler = New-Object System.Net.Http.HttpClientHandler
  $handler.AutomaticDecompression = [System.Net.DecompressionMethods]::None
  $client = New-Object System.Net.Http.HttpClient($handler)
  $client.Timeout = [TimeSpan]::FromSeconds(60)
  $client.DefaultRequestHeaders.UserAgent.ParseAdd('netspeed-home/1.0')

  # 時刻は分の始まりにそろえる（同じ分の記録は 1 つ）
  $nowSec = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
  $ts = $nowSec - ($nowSec % 60)
  $minuteOfDay = [int](((Get-Date).Hour * 60) + (Get-Date).Minute)
  $isFull = $Full.IsPresent -or ((($minuteOfDay - $fullOffset) % $fullEvery + $fullEvery) % $fullEvery -eq 0)
  if ($isFull) {
    $downBytes = [int](Get-Cfg 'fullDownBytes' 25000000); $upBytes = [int](Get-Cfg 'fullUpBytes' 10000000)
  } else {
    $downBytes = [int](Get-Cfg 'quickDownBytes' 2000000); $upBytes = [int](Get-Cfg 'quickUpBytes' 1000000)
  }

  # ---- 遅延（5 回） ----
  $rtts = @(); $lost = 0
  $pinger = New-Object System.Net.NetworkInformation.Ping
  for ($i = 0; $i -lt 5; $i++) {
    try {
      $r = $pinger.Send($pingHost, 1000)
      if ($r.Status -eq [System.Net.NetworkInformation.IPStatus]::Success) { $rtts += [double]$r.RoundtripTime } else { $lost++ }
    } catch { $lost++ }
    Start-Sleep -Milliseconds 150
  }
  $ping = $null; $jitter = $null
  if ($rtts.Count -gt 0) {
    $ping = ($rtts | Measure-Object -Average).Average
    if ($rtts.Count -gt 1) { $d = 0; for ($i = 1; $i -lt $rtts.Count; $i++) { $d += [Math]::Abs($rtts[$i] - $rtts[$i - 1]) }; $jitter = $d / ($rtts.Count - 1) } else { $jitter = 0 }
  }
  $loss = $lost / 5.0

  # ---- 下り：指定の大きさを受け取り、最初の 1 バイトが届くまでの時間を除いて速さを出す ----
  $down = $null; $colo = $null
  try {
    $sw = [Diagnostics.Stopwatch]::StartNew()
    $resp = $client.GetAsync("$speedBase/__down?bytes=$downBytes", [System.Net.Http.HttpCompletionOption]::ResponseHeadersRead).GetAwaiter().GetResult()
    $null = $resp.EnsureSuccessStatusCode()
    $stream = $resp.Content.ReadAsStreamAsync().GetAwaiter().GetResult()
    $buf = New-Object byte[] 65536
    $first = $stream.Read($buf, 0, $buf.Length)
    $ttfb = $sw.Elapsed.TotalSeconds
    $total = $first
    while (($n = $stream.Read($buf, 0, $buf.Length)) -gt 0) { $total += $n }
    $dur = [Math]::Max(0.001, $sw.Elapsed.TotalSeconds - $ttfb)
    $stream.Dispose()
    if ($total -gt 65536) { $down = ($total - $first) * 8 / $dur / 1e6 }
    $ray = $null
    if ($resp.Headers.Contains('cf-ray')) { $ray = ($resp.Headers.GetValues('cf-ray') | Select-Object -First 1) }
    if ($ray -and $ray -match '-([A-Za-z]{3,4})$') { $colo = $Matches[1].ToUpper() }
    $resp.Dispose()
  } catch { Write-Log "下りの測定に失敗：$($_.Exception.Message)" }

  # ---- 上り：指定の大きさを送り、往復の時間を除いて速さを出す ----
  $up = $null
  try {
    $payload = New-Object byte[] $upBytes
    (New-Object Random).NextBytes($payload)
    $content = New-Object System.Net.Http.ByteArrayContent(, $payload)
    $sw = [Diagnostics.Stopwatch]::StartNew()
    $resp = $client.PostAsync("$speedBase/__up", $content).GetAwaiter().GetResult()
    $t = $sw.Elapsed.TotalSeconds
    $null = $resp.EnsureSuccessStatusCode()
    $resp.Dispose()
    $rtt = 0.0; if ($null -ne $ping) { $rtt = $ping / 1000.0 }
    $up = $upBytes * 8 / [Math]::Max(0.001, $t - $rtt) / 1e6
  } catch { Write-Log "上りの測定に失敗：$($_.Exception.Message)" }

  $round = { param($v, $d) if ($null -eq $v) { $null } else { [Math]::Round([double]$v, $d) } }
  $sample = [ordered]@{
    ts = $ts; kind = $(if ($isFull) { 'full' } else { 'quick' })
    down = (& $round $down 2); up = (& $round $up 2); ping = (& $round $ping 1); jitter = (& $round $jitter 1); loss = (& $round $loss 2); colo = $colo
  }
  $json = $sample | ConvertTo-Json -Compress
  Write-Log ("測定：下り {0} Mbps・上り {1} Mbps・遅延 {2} ms・取りこぼし {3}{4}" -f $sample.down, $sample.up, $sample.ping, $sample.loss, $(if ($isFull) { '（確かめ用）' } else { '' }))
  if ($NoSend) { Write-Output $json; exit 0 }

  # ---- 送る（送れなかったものはためておき、次にまとめて送る） ----
  Add-Content -Path $QueuePath -Value $json -Encoding UTF8
  $lines = @(Get-Content $QueuePath -Encoding UTF8 | Where-Object { $_.Trim() -ne '' })
  if ($lines.Count -gt 20000) { $lines = $lines[($lines.Count - 20000)..($lines.Count - 1)] }
  $sent = 0
  while ($sent -lt $lines.Count) {
    $chunk = $lines[$sent..([Math]::Min($lines.Count, $sent + 500) - 1)]
    $body = '{"samples":[' + ($chunk -join ',') + ']}'
    $req = New-Object System.Net.Http.HttpRequestMessage([System.Net.Http.HttpMethod]::Post, ($cfg.endpoint.TrimEnd('/') + '/api/ingest'))
    $req.Headers.Authorization = New-Object System.Net.Http.Headers.AuthenticationHeaderValue('Bearer', $cfg.token)
    $req.Content = New-Object System.Net.Http.StringContent($body, [Text.Encoding]::UTF8, 'application/json')
    try {
      $resp = $client.SendAsync($req).GetAwaiter().GetResult()
      $code = [int]$resp.StatusCode
      $text = $resp.Content.ReadAsStringAsync().GetAwaiter().GetResult()
      $resp.Dispose()
      if ($code -eq 401) { Write-Log '送信の鍵がちがいます（config.json の token と、Cloudflare の INGEST_TOKEN を確かめてください）'; break }
      if ($code -lt 200 -or $code -ge 300) { Write-Log "送れませんでした（$code）：$text"; break }
      $sent += $chunk.Count
    } catch { Write-Log "送れませんでした：$($_.Exception.Message)（次の測定のときにまとめて送ります）"; break }
  }
  $rest = @(); if ($sent -lt $lines.Count) { $rest = $lines[$sent..($lines.Count - 1)] }
  if ($rest.Count -gt 0) { Set-Content -Path $QueuePath -Value $rest -Encoding UTF8 } else { Remove-Item $QueuePath -ErrorAction SilentlyContinue }
  if ($sent -gt 0) { Write-Log "送信：$sent 件（たまっている分：$($rest.Count) 件）" }
} catch {
  Write-Log "エラー：$($_.Exception.Message)"
  exit 1
} finally {
  if ($client) { $client.Dispose() }
  $mutex.ReleaseMutex() | Out-Null
  $mutex.Dispose()
}
