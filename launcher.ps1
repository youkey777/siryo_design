param(
  [int]$Port = 3000,
  [int]$StartupTimeoutSeconds = 60,
  [switch]$AppMode
)

$ErrorActionPreference = "Stop"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $scriptDir

$timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
$logsDir = Join-Path $scriptDir "logs"
$launcherLogPath = Join-Path $logsDir ("launcher_{0}.log" -f $timestamp)
New-Item -ItemType Directory -Path $logsDir -Force | Out-Null

function Write-Log {
  param(
    [string]$Message,
    [ValidateSet("INFO", "WARN", "ERROR")]
    [string]$Level = "INFO"
  )

  $line = "[{0}] [{1}] {2}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Level, $Message
  Write-Host $line
  Add-Content -Path $launcherLogPath -Value $line -Encoding UTF8
}

function Stop-WithError {
  param(
    [string]$Message,
    [int]$Code = 1
  )

  Write-Log -Level "ERROR" -Message $Message
  Write-Host ""
  Write-Host "起動に失敗しました。ログ: $launcherLogPath"
  Read-Host "Enterキーで終了します"
  exit $Code
}

function Test-LocalUrl {
  param(
    [int]$TargetPort
  )

  try {
    $null = Invoke-WebRequest -Uri ("http://localhost:{0}" -f $TargetPort) -TimeoutSec 2 -UseBasicParsing
    return $true
  }
  catch {
    return $false
  }
}

function Open-TargetWindow {
  param(
    [int]$TargetPort,
    [switch]$UseAppMode
  )

  $url = "http://localhost:{0}" -f $TargetPort
  if (-not $UseAppMode) {
    Start-Process $url
    Write-Log -Message ("Browser opened: {0}" -f $url)
    return
  }

  $edgeCandidates = @(
    "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    "C:\Program Files\Microsoft\Edge\Application\msedge.exe"
  )
  $chromeCandidates = @(
    "C:\Program Files\Google\Chrome\Application\chrome.exe",
    "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"
  )

  $edgePath = $edgeCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1
  if ($edgePath) {
    Start-Process -FilePath $edgePath -ArgumentList "--app=$url", "--new-window"
    Write-Log -Message ("Edge app window opened: {0}" -f $url)
    return
  }

  $chromePath = $chromeCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1
  if ($chromePath) {
    Start-Process -FilePath $chromePath -ArgumentList "--app=$url", "--new-window"
    Write-Log -Message ("Chrome app window opened: {0}" -f $url)
    return
  }

  Start-Process $url
  Write-Log -Level "WARN" -Message "Edge/Chrome が見つからないため通常ブラウザで開きました。"
}

Write-Log -Message ("Launcher started. workdir={0} appMode={1}" -f $scriptDir, $AppMode)

if (-not (Test-Path (Join-Path $scriptDir "package.json"))) {
  Stop-WithError "package.json が見つかりません。プロジェクト直下で実行してください。"
}

$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCommand) {
  Stop-WithError "node が見つかりません。Node.js をインストールして PATH を確認してください。"
}
Write-Log -Message ("node command found: {0}" -f $nodeCommand.Source)

$npmCommand = Get-Command npm -ErrorAction SilentlyContinue
if (-not $npmCommand) {
  Stop-WithError "npm が見つかりません。Node.js をインストールして PATH を確認してください。"
}
Write-Log -Message ("npm command found: {0}" -f $npmCommand.Source)

if (-not (Test-Path (Join-Path $scriptDir "node_modules"))) {
  Write-Log -Message "node_modules がないため npm install を実行します。"
  & npm install 2>&1 | Tee-Object -FilePath $launcherLogPath -Append
  if ($LASTEXITCODE -ne 0) {
    Stop-WithError "npm install に失敗しました。"
  }
  Write-Log -Message "npm install completed."
}

if (Test-LocalUrl -TargetPort $Port) {
  Write-Log -Level "WARN" -Message ("http://localhost:{0} は既に応答しています。既存サーバーを利用します。" -f $Port)
  Open-TargetWindow -TargetPort $Port -UseAppMode:$AppMode
  exit 0
}

$devCommand = 'cd /d "{0}" && npm run dev' -f $scriptDir
Write-Log -Message ("Launching dev server command: {0}" -f $devCommand)

$devProcess = Start-Process -FilePath "cmd.exe" -ArgumentList "/k", $devCommand -WorkingDirectory $scriptDir -PassThru
Write-Log -Message ("Dev server process started. pid={0}" -f $devProcess.Id)

$deadline = (Get-Date).AddSeconds($StartupTimeoutSeconds)
$serverReady = $false
while ((Get-Date) -lt $deadline) {
  Start-Sleep -Seconds 2
  if (Test-LocalUrl -TargetPort $Port) {
    $serverReady = $true
    break
  }
}

if ($serverReady) {
  Open-TargetWindow -TargetPort $Port -UseAppMode:$AppMode
  Write-Host "起動完了: http://localhost:$Port"
  exit 0
}

Write-Log -Level "WARN" -Message ("{0} 秒以内に http://localhost:{1} の応答を確認できませんでした。" -f $StartupTimeoutSeconds, $Port)
Write-Host ""
Write-Host "開発サーバーのウィンドウを確認してください。"
Write-Host "手動アクセスURL: http://localhost:$Port"
Write-Host "ログ: $launcherLogPath"
Read-Host "Enterキーで終了します"
exit 1
