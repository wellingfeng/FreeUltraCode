param(
  [ValidateSet("ollama")]
  [string]$Provider = "ollama",
  [string]$Model = "",
  [switch]$SkipInstall
)

$ErrorActionPreference = "Stop"

$ModelProfiles = @(
  [pscustomobject]@{
    Id = "llama3.2:3b"
    Label = "Light 3B"
    MinRamGb = 8
    Note = "Low RAM / older laptop. Fastest setup, weaker coding."
  },
  [pscustomobject]@{
    Id = "qwen2.5-coder:7b"
    Label = "Coder 7B"
    MinRamGb = 16
    Note = "Recommended for most dev laptops."
  },
  [pscustomobject]@{
    Id = "qwen2.5-coder:14b"
    Label = "Coder 14B"
    MinRamGb = 32
    Note = "Better coding quality, slower on CPU-only machines."
  },
  [pscustomobject]@{
    Id = "qwen2.5-coder:32b"
    Label = "Coder 32B"
    MinRamGb = 64
    Note = "High-end workstation / strong GPU recommended."
  }
)

function Write-Step([string]$Message) {
  Write-Host "[..] $Message"
}

function Write-Ok([string]$Message) {
  Write-Host "[OK] $Message"
}

function Get-MachineProfile {
  $ramGb = 0
  $cores = [Environment]::ProcessorCount
  $vramGb = 0

  try {
    $ramBytes = (Get-CimInstance Win32_ComputerSystem -ErrorAction Stop).TotalPhysicalMemory
    if ($ramBytes) { $ramGb = [math]::Round($ramBytes / 1GB, 1) }
  } catch {}

  try {
    $cpuSum = (Get-CimInstance Win32_Processor -ErrorAction Stop |
      Measure-Object -Property NumberOfLogicalProcessors -Sum).Sum
    if ($cpuSum) { $cores = [int]$cpuSum }
  } catch {}

  try {
    $vramBytes = (Get-CimInstance Win32_VideoController -ErrorAction Stop |
      Where-Object { $_.AdapterRAM -gt 0 } |
      Measure-Object -Property AdapterRAM -Maximum).Maximum
    if ($vramBytes) { $vramGb = [math]::Round($vramBytes / 1GB, 1) }
  } catch {}

  [pscustomobject]@{
    RamGb = $ramGb
    CpuThreads = $cores
    GpuVramGb = $vramGb
  }
}

function Get-RecommendedModel([pscustomobject]$Machine) {
  if (($Machine.GpuVramGb -ge 24) -or ($Machine.RamGb -ge 64 -and $Machine.CpuThreads -ge 16)) {
    return "qwen2.5-coder:32b"
  }
  if (($Machine.GpuVramGb -ge 12) -or ($Machine.RamGb -ge 32 -and $Machine.CpuThreads -ge 8)) {
    return "qwen2.5-coder:14b"
  }
  if (($Machine.GpuVramGb -ge 6) -or ($Machine.RamGb -ge 16 -and $Machine.CpuThreads -ge 4)) {
    return "qwen2.5-coder:7b"
  }
  return "llama3.2:3b"
}

function Select-LocalModel([string]$RequestedModel) {
  $trimmed = $RequestedModel.Trim()
  if ($trimmed) { return $trimmed }

  $machine = Get-MachineProfile
  $recommended = Get-RecommendedModel -Machine $machine
  $recommendedIndex = 0
  for ($i = 0; $i -lt $ModelProfiles.Count; $i++) {
    if ($ModelProfiles[$i].Id -eq $recommended) {
      $recommendedIndex = $i
      break
    }
  }

  Write-Host ""
  Write-Host "Local model choices:"
  Write-Host ("Detected: RAM {0} GB, CPU threads {1}, GPU VRAM {2} GB" -f $machine.RamGb, $machine.CpuThreads, $machine.GpuVramGb)
  for ($i = 0; $i -lt $ModelProfiles.Count; $i++) {
    $profile = $ModelProfiles[$i]
    $mark = if ($profile.Id -eq $recommended) { " [recommended]" } else { "" }
    Write-Host ("  {0}. {1} - {2} (min RAM {3} GB){4}" -f ($i + 1), $profile.Id, $profile.Label, $profile.MinRamGb, $mark)
    Write-Host ("     {0}" -f $profile.Note)
  }
  Write-Host ""
  $choice = Read-Host ("Choose model [default {0}]" -f ($recommendedIndex + 1))
  if (!$choice.Trim()) { return $recommended }
  $selectedIndex = 0
  if ([int]::TryParse($choice, [ref]$selectedIndex)) {
    if ($selectedIndex -ge 1 -and $selectedIndex -le $ModelProfiles.Count) {
      return $ModelProfiles[$selectedIndex - 1].Id
    }
  }
  return $choice.Trim()
}

function Find-Ollama {
  $cmd = Get-Command "ollama" -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }

  $candidates = @(
    "$env:LOCALAPPDATA\Programs\Ollama\ollama.exe",
    "$env:ProgramFiles\Ollama\ollama.exe",
    "${env:ProgramFiles(x86)}\Ollama\ollama.exe"
  )
  foreach ($path in $candidates) {
    if ($path -and (Test-Path -LiteralPath $path)) { return $path }
  }
  return $null
}

function Ensure-Winget {
  if (Get-Command "winget" -ErrorAction SilentlyContinue) { return }
  throw "winget not found. Install App Installer from Microsoft Store, then rerun."
}

function Ensure-Ollama {
  $ollama = Find-Ollama
  if ($ollama) { return $ollama }
  if ($SkipInstall) { throw "Ollama not found and -SkipInstall was set." }

  Ensure-Winget
  Write-Step "Installing Ollama via winget..."
  winget install --id Ollama.Ollama -e --accept-source-agreements --accept-package-agreements
  if ($LASTEXITCODE -ne 0) { throw "winget install Ollama failed with exit code $LASTEXITCODE." }

  $ollama = Find-Ollama
  if (!$ollama) { throw "Ollama installed, but ollama.exe was not found. Restart the terminal and rerun." }
  return $ollama
}

function Test-OllamaServer {
  try {
    Invoke-RestMethod -Uri "http://127.0.0.1:11434/api/tags" -Method Get -TimeoutSec 2 | Out-Null
    return $true
  } catch {
    return $false
  }
}

function Ensure-OllamaServer([string]$OllamaPath) {
  if (Test-OllamaServer) { return }

  Write-Step "Starting Ollama server..."
  Start-Process -FilePath $OllamaPath -ArgumentList "serve" -WindowStyle Hidden | Out-Null
  for ($i = 0; $i -lt 30; $i++) {
    Start-Sleep -Seconds 1
    if (Test-OllamaServer) { return }
  }
  throw "Ollama server did not become ready on http://127.0.0.1:11434."
}

if ($Provider -ne "ollama") {
  throw "Only Ollama is supported by this one-click script."
}

$Model = Select-LocalModel -RequestedModel $Model

Write-Step "Preparing Ollama local model runtime..."
$ollama = Ensure-Ollama
Write-Ok "Ollama found: $ollama"

Ensure-OllamaServer -OllamaPath $ollama
Write-Ok "Ollama server is ready."

Write-Step "Pulling model: $Model"
& $ollama pull $Model
if ($LASTEXITCODE -ne 0) { throw "ollama pull $Model failed with exit code $LASTEXITCODE." }

Write-Ok "Model ready: $Model"
Write-Host ""
Write-Host "Next in UltraGameStudio:"
Write-Host "  1. Runtime: Claude Code"
Write-Host "  2. Channel: Free - Ollama (local)"
Write-Host "  3. If you pulled a different model, set that model in Settings -> Free Channels -> Ollama."
