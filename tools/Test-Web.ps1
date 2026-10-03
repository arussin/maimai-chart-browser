param([switch]$Offline, [switch]$KeepWorkspace)
$ErrorActionPreference='Stop'
$prepared = (& (Join-Path $PSScriptRoot 'Test-Development.ps1') -Check prepare -Offline:$Offline -KeepWorkspace:$KeepWorkspace | Out-String)
$record = $prepared.Substring($prepared.IndexOf('{')) | ConvertFrom-Json
$workspace=$record.Workspace
. (Join-Path $PSScriptRoot 'Workspace-Retention.ps1')
$cache=Split-Path -Parent (Split-Path -Parent $workspace)
$lease=Open-RegistryWorkspaceLease $workspace
$outcome='failed'
$env:npm_config_cache='C:\DevCache\npm'
$env:WRANGLER_SEND_METRICS='false'
try {
 foreach($part in @('web','usage-worker')){
  Push-Location (Join-Path $workspace $part)
  try{
   $installArgs=@('ci','--no-audit','--no-fund');if($Offline){$installArgs+='--offline'}
   & npm.cmd @installArgs;if($LASTEXITCODE){throw "$part dependencies failed"}
   & npm.cmd run check;if($LASTEXITCODE){throw "$part type/generated check failed"}
   & npm.cmd test;if($LASTEXITCODE){throw "$part tests failed"}
  } finally {Pop-Location}
 }
 $outcome='passed'
 [pscustomobject]@{Workspace=$workspace;Passed=$true;Check='typed-browser-and-usage-worker';Keep=[bool]$KeepWorkspace}|ConvertTo-Json
} finally {
 $lease.Dispose()
 Complete-RegistryPreparedWorkspace -Workspace $workspace -CacheRoot $cache -Source $record.Source -Outcome $outcome
 $retention=Invoke-RegistryWorkspaceRetention -CacheRoot $cache -Source $record.Source -ExcludeWorkspace $workspace
 foreach($warning in $retention.Warnings){Write-Warning $warning}
}
