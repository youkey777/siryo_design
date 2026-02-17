param(
  [Parameter(Mandatory = $true)]
  [string]$InputPath,
  [Parameter(Mandatory = $true)]
  [string]$OutputDir
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path -LiteralPath $InputPath)) {
  throw "Input file not found: $InputPath"
}

New-Item -ItemType Directory -Path $OutputDir -Force | Out-Null
Get-ChildItem -LiteralPath $OutputDir -Filter *.png -ErrorAction SilentlyContinue | Remove-Item -Force -ErrorAction SilentlyContinue
Get-ChildItem -LiteralPath $OutputDir -Filter *.PNG -ErrorAction SilentlyContinue | Remove-Item -Force -ErrorAction SilentlyContinue

$pp = $null
$pres = $null

try {
  $pp = New-Object -ComObject PowerPoint.Application
  $pp.Visible = 1

  $pres = $pp.Presentations.Open($InputPath, $false, $false, $false)
  # 18 = ppSaveAsPNG
  $pres.SaveAs($OutputDir, 18)
}
catch {
  throw "PowerPoint export failed: $($_.Exception.Message)"
}
finally {
  if ($pres -ne $null) {
    $pres.Close()
  }
  if ($pp -ne $null) {
    $pp.Quit()
  }
}
