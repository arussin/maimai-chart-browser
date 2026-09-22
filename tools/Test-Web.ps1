param([switch]$Offline)
$ErrorActionPreference='Stop'
$prepared = (& (Join-Path $PSScriptRoot 'Test-Development.ps1') -Check prepare -Offline:$Offline | Out-String)
$record = $prepared.Substring($prepared.IndexOf('{')) | ConvertFrom-Json
$workspace=$record.Workspace
$env:npm_config_cache='C:\DevCache\npm'
$env:WRANGLER_SEND_METRICS='false'
foreach($part in @('web','usage-worker')){
 Push-Location (Join-Path $workspace $part)
 try{
  $installArgs=@('ci','--no-audit','--no-fund');if($Offline){$installArgs+='--offline'}
  & npm.cmd @installArgs;if($LASTEXITCODE){throw "$part dependencies failed"}
  & npm.cmd run check;if($LASTEXITCODE){throw "$part type/generated check failed"}
  & npm.cmd test;if($LASTEXITCODE){throw "$part tests failed"}
 } finally {Pop-Location}
}
[pscustomobject]@{Workspace=$workspace;Passed=$true;Check='typed-browser-and-usage-worker'}|ConvertTo-Json
