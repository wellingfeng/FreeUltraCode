param(
  [string]$ExceptPath = ''
)

$ErrorActionPreference = 'Stop'

$except = ''
if ($ExceptPath -and (Test-Path -LiteralPath $ExceptPath)) {
  $except = (Resolve-Path -LiteralPath $ExceptPath).Path
}

$processes = @(
  Get-Process -Name 'UltraGameStudio' -ErrorAction SilentlyContinue | Where-Object {
    try {
      $_.Path -and (-not $except -or ([IO.Path]::GetFullPath($_.Path) -ine $except))
    } catch {
      $false
    }
  }
)

if ($processes.Count -eq 0) {
  exit 0
}

Write-Host "[..] closing existing UltraGameStudio instances before launch ..."

foreach ($process in $processes) {
  try {
    [void]$process.CloseMainWindow()
  } catch {
  }
}

$deadline = (Get-Date).AddSeconds(8)
do {
  Start-Sleep -Milliseconds 500
  $alive = @(
    $processes | Where-Object {
      try {
        [void](Get-Process -Id $_.Id -ErrorAction Stop)
        $true
      } catch {
        $false
      }
    }
  )
} while ($alive.Count -gt 0 -and (Get-Date) -lt $deadline)

if ($alive.Count -gt 0) {
  Write-Host "[..] forcing close hidden tray instances ..."
  $alive | ForEach-Object {
    Stop-Process -Id $_.Id -Force
  }
  Start-Sleep -Seconds 1
}

exit 0
