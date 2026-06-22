Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$Host.UI.RawUI.WindowTitle = 'UltraGameStudio Backend Local Server'

function Pause-And-Exit {
	param(
		[int] $Code
	)

	Read-Host 'Press Enter to continue...' | Out-Null
	exit $Code
}

$Root = $PSScriptRoot
if ([string]::IsNullOrWhiteSpace($Root)) {
	$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
}

$BackendDir = Join-Path $Root 'backend'
$PackageJson = Join-Path $BackendDir 'package.json'

if (-not (Test-Path -LiteralPath $PackageJson -PathType Leaf)) {
	Write-Host '[ERROR] backend\package.json not found.'
	Write-Host 'Run this file from the UltraGameStudio repository root.'
	Pause-And-Exit 1
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
	Write-Host '[ERROR] Node.js 20+ is required.'
	Write-Host 'Install Node.js, then run this file again.'
	Pause-And-Exit 1
}

if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
	Write-Host '[ERROR] npm is required.'
	Write-Host 'Install Node.js with npm, then run this file again.'
	Pause-And-Exit 1
}

$NodeMajorText = (& node -p "process.versions.node.split('.')[0]").Trim()
$NodeMajor = [int] $NodeMajorText
if ($NodeMajor -lt 20) {
	Write-Host "[ERROR] Node.js 20+ is required. Current major: $NodeMajor"
	Pause-And-Exit 1
}

Set-Location -LiteralPath $BackendDir

if (-not (Test-Path -LiteralPath '.env' -PathType Leaf)) {
	Copy-Item -LiteralPath '.env.example' -Destination '.env'
	Write-Host 'Created backend\.env'
}

$EnvPath = Join-Path $BackendDir '.env'
$EnvText = [IO.File]::ReadAllText($EnvPath)
if ($EnvText -notmatch '(?m)^UGS_RUNNER_TOKEN=.+') {
	$GeneratedToken = (& node (Join-Path $BackendDir 'src\local-token.mjs')).Trim()
	if ($EnvText -match '(?m)^UGS_RUNNER_TOKEN=') {
		$EnvText = $EnvText -replace '(?m)^UGS_RUNNER_TOKEN=.*', "UGS_RUNNER_TOKEN=$GeneratedToken"
	}
	else {
		$EnvText = "UGS_RUNNER_TOKEN=$GeneratedToken$([Environment]::NewLine)$EnvText"
	}

	[IO.File]::WriteAllText($EnvPath, $EnvText, [Text.UTF8Encoding]::new($false))
	Write-Host 'Generated stable local runner token.'
}

$RunnerToken = ''
foreach ($Line in [IO.File]::ReadLines($EnvPath)) {
	if ($Line.StartsWith('UGS_RUNNER_TOKEN=')) {
		$RunnerToken = $Line.Substring('UGS_RUNNER_TOKEN='.Length)
		break
	}
}

if (-not $env:UGS_RUNNER_HOST) {
	$env:UGS_RUNNER_HOST = '127.0.0.1'
}

if (-not $env:UGS_RUNNER_PORT) {
	$env:UGS_RUNNER_PORT = '8787'
}

Write-Host ''
Write-Host 'UltraGameStudio backend local server'
Write-Host "URL:   http://$($env:UGS_RUNNER_HOST):$($env:UGS_RUNNER_PORT)"
Write-Host "Token: $RunnerToken"
Write-Host ''
Write-Host 'Desktop app: add remote workspace with above URL + Token.'
Write-Host 'Stop server: press Ctrl+C in this window.'
Write-Host ''

if ($args.Count -gt 0 -and $args[0] -ieq '--check') {
	Write-Host 'Startup check OK.'
	exit 0
}

$env:HEALTH_HOST = $env:UGS_RUNNER_HOST
if ($env:HEALTH_HOST -eq '0.0.0.0') {
	$env:HEALTH_HOST = '127.0.0.1'
}

$PortStatus = (& node -e "const http=require('http'); const net=require('net'); const host=process.env.HEALTH_HOST; const port=Number(process.env.UGS_RUNNER_PORT); const req=http.get({host,port,path:'/health',timeout:1500}, res => { res.resume(); process.stdout.write(res.statusCode === 200 ? 'running' : 'busy'); }); req.on('timeout', () => req.destroy()); req.on('error', () => { const s=net.createConnection({host,port}); s.setTimeout(500); s.on('connect', () => { process.stdout.write('busy'); s.destroy(); }); s.on('timeout', () => { process.stdout.write('free'); s.destroy(); }); s.on('error', () => process.stdout.write('free')); });").Trim()
if ($PortStatus -eq 'running') {
	Write-Host "Backend already running: http://$($env:HEALTH_HOST):$($env:UGS_RUNNER_PORT)"
	Pause-And-Exit 0
}

if ($PortStatus -eq 'busy') {
	Write-Host "[ERROR] Port $($env:UGS_RUNNER_PORT) is already in use on $($env:HEALTH_HOST)."
	Write-Host 'Stop the process using that port, or set UGS_RUNNER_PORT to another value.'
	Pause-And-Exit 1
}

& npm start
$ExitCode = if ($LASTEXITCODE -is [int]) { $LASTEXITCODE } else { 0 }
Write-Host ''
Write-Host "Backend stopped. Exit code: $ExitCode"
Pause-And-Exit $ExitCode
