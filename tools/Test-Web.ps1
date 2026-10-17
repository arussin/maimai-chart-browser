param([switch]$Offline, [switch]$KeepWorkspace, [switch]$Build, [string]$DependencyManifest='')
$ErrorActionPreference='Stop'
$dependencyRoots=$null
$savedNodeOptions=$env:NODE_OPTIONS
$savedPath=$env:PATH
$savedDependencyManifest=$env:MAIMAI_VALIDATION_DEPENDENCIES
if($DependencyManifest){
 $dependencyRoots=Get-Content -LiteralPath $DependencyManifest -Raw|ConvertFrom-Json
 foreach($part in @('web','usage-worker')){
  $root=[IO.Path]::GetFullPath($dependencyRoots.$part)
  if(-not $root.StartsWith('C:\DevCache\projects\',[StringComparison]::OrdinalIgnoreCase)){throw 'Dependencies must remain in the approved project cache'}
  $expected=Get-FileHash (Join-Path (Split-Path $PSScriptRoot -Parent) "$part\package-lock.json")
  $actual=Get-FileHash (Join-Path $root 'package-lock.json')
  if($expected.Hash -ne $actual.Hash){throw "Dependency lock mismatch: $part"}
 }
}
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
   if($dependencyRoots){
    $env:MAIMAI_VALIDATION_DEPENDENCIES=[IO.Path]::GetFullPath($DependencyManifest)
    $env:NODE_OPTIONS='--import '+([Uri](Join-Path $workspace 'tools\validation-dependencies.mjs')).AbsoluteUri
    $env:PATH=(Join-Path $dependencyRoots.$part 'node_modules\.bin')+';'+$savedPath
   }else{
    $installArgs=@('ci','--no-audit','--no-fund');if($Offline){$installArgs+='--offline'}
    & npm.cmd @installArgs;if($LASTEXITCODE){throw "$part dependencies failed"}
   }
   if($Build -and $part -eq 'web'){& npm.cmd run build;if($LASTEXITCODE){throw 'Browser asset build failed'}}
   & npm.cmd run check;if($LASTEXITCODE){throw "$part type/generated check failed"}
   & npm.cmd test;if($LASTEXITCODE){throw "$part tests failed"}
  } finally {Pop-Location}
 }
 $outcome='passed'
 [pscustomobject]@{Workspace=$workspace;Passed=$true;Check='typed-browser-and-usage-worker';Keep=[bool]$KeepWorkspace}|ConvertTo-Json
} finally {
 $env:NODE_OPTIONS=$savedNodeOptions
 $env:PATH=$savedPath
 $env:MAIMAI_VALIDATION_DEPENDENCIES=$savedDependencyManifest
 $lease.Dispose()
 Complete-RegistryPreparedWorkspace -Workspace $workspace -CacheRoot $cache -Source $record.Source -Outcome $outcome
 $retention=Invoke-RegistryWorkspaceRetention -CacheRoot $cache -Source $record.Source -ExcludeWorkspace $workspace
 foreach($warning in $retention.Warnings){Write-Warning $warning}
}
