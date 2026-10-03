param([string]$RetentionScript=(Join-Path $PSScriptRoot 'Workspace-Retention.ps1'))
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
. $RetentionScript
$testRoot='C:\DevCache\projects\maimai-chart-browser-registry\retention-validation-'+[guid]::NewGuid().ToString('N')
$source=Join-Path $testRoot 'source'
New-Item -ItemType Directory -Path $source -Force | Out-Null
Set-Content -LiteralPath (Join-Path $source 'uncommitted.txt') -Value 'canonical source must survive'
$sourceHash=(Get-FileHash -LiteralPath (Join-Path $source 'uncommitted.txt')).Hash
$passedChecks=[Collections.Generic.List[string]]::new()
$heldLease=$null;$junctionPath=$null;$childProcess=$null;$completed=$false
function Assert-True([bool]$Value,[string]$Message) {if(-not $Value){throw $Message};$passedChecks.Add($Message)}
function New-Finished([string]$Outcome='passed',[int]$AgeHours=1,[string]$Check='python',[switch]$Pin) {
 $run=Start-RegistryWorkspace -CacheRoot $testRoot -Source $source -Check $Check -Keep:$Pin
 Set-Content -LiteralPath (Join-Path $run.Path 'payload.txt') -Value 'disposable fixture'
 Complete-RegistryWorkspace $run $Outcome
 $state=Get-RegistryWorkspaceState $run.Path $testRoot $source
 $state.FinishedUtc=[DateTime]::UtcNow.AddHours(-$AgeHours).ToString('o')
 Write-RegistryWorkspaceState $run.Path $state
 return $run.Path
}
try {
 $successes=@(1,2,3,4 | ForEach-Object {New-Finished -AgeHours $_})
 $failures=@(1,2,3,4,200 | ForEach-Object {New-Finished -Outcome failed -AgeHours $_})
 $otherCheck=New-Finished -AgeHours 100 -Check browser
 $pinned=New-Finished -AgeHours 100 -Pin
 $pinFile=New-Finished -AgeHours 101
 New-Item -ItemType File -Path (Join-Path $pinFile '.keep-workspace') | Out-Null
 $prepared=New-Finished -Outcome prepared -AgeHours 102 -Check prepare
 $locked=New-Finished -AgeHours 103
 $heldLease=Open-RegistryWorkspaceLease $locked
 $running=Start-RegistryWorkspace -CacheRoot $testRoot -Source $source -Check worker
 $running.Lease.Dispose() # An interrupted run without a finished marker stays protected.
 $legacy=Join-Path (Get-RegistryWorkspaceRoot $testRoot) '20250101T000000000-12345678'
 New-Item -ItemType Directory -Path $legacy | Out-Null
 Set-Content -LiteralPath (Join-Path $legacy 'precious.txt') -Value 'unmarked older source'
 $malformed=New-Finished -AgeHours 104
 Set-Content -LiteralPath (Join-Path $malformed '.registry-workspace.json') -Value '{broken'
 $foreign=New-Finished -AgeHours 105
 $foreignState=Get-RegistryWorkspaceState $foreign $testRoot $source
 $foreignState.Source='C:\Dev\a-different-project';Write-RegistryWorkspaceState $foreign $foreignState
 $outside=Join-Path $testRoot 'outside-target'
 New-Item -ItemType Directory -Path $outside | Out-Null
 Set-Content -LiteralPath (Join-Path $outside 'keep.txt') -Value 'outside the workspace'
 $linked=New-Finished -AgeHours 106
 $junctionPath=Join-Path $linked 'redirect'
 New-Item -ItemType Junction -Path $junctionPath -Target $outside | Out-Null
 $childWorkspace=New-Finished -AgeHours 107
 $childScript=Join-Path $childWorkspace 'running-child.ps1'
 Set-Content -LiteralPath $childScript -Value 'Start-Sleep -Seconds 30'
 $childProcess=Start-Process -FilePath (Join-Path $PSHOME 'pwsh.exe') -ArgumentList @('-NoLogo','-NoProfile','-NonInteractive','-File',$childScript) -WindowStyle Hidden -PassThru
 $preview=Invoke-RegistryWorkspaceRetention $testRoot $source -Preview
 Assert-True ($preview.Deleted.Count -eq 0) 'Preview never deletes'
 Assert-True (Test-Path -LiteralPath $successes[3]) 'Preview preserves old successful payload'
 $result=Invoke-RegistryWorkspaceRetention $testRoot $source
 Assert-True ($result.Deleted.Count -eq 4) 'Only two old successes and two old failures are removed'
 Assert-True ((Test-Path -LiteralPath $successes[0]) -and (Test-Path -LiteralPath $successes[1])) 'Two newest successful runs remain'
 Assert-True (-not(Test-Path -LiteralPath $successes[2]) -and -not(Test-Path -LiteralPath $successes[3])) 'Older completed successes are pruned'
 Assert-True ((Test-Path -LiteralPath $failures[0]) -and (Test-Path -LiteralPath $failures[1]) -and (Test-Path -LiteralPath $failures[2])) 'Three recent failures remain'
 foreach($path in @($pinned,$pinFile,$prepared,$locked,$running.Path,$legacy,$malformed,$foreign,$linked,$otherCheck,$childWorkspace)) {Assert-True (Test-Path -LiteralPath $path) ('Protected fixture remains: '+[IO.Path]::GetFileName($path))}
 Assert-True ((Get-Content -LiteralPath (Join-Path $outside 'keep.txt') -Raw).Trim() -eq 'outside the workspace') 'Junction target is never touched'
 $heldLease.Dispose();$heldLease=$null
 $afterUnlock=Invoke-RegistryWorkspaceRetention $testRoot $source
 Assert-True (-not(Test-Path -LiteralPath $locked)) 'Completed workspace becomes eligible after its active lease closes'
 Complete-RegistryPreparedWorkspace $prepared $testRoot $source -Outcome failed
 Assert-True ((Get-RegistryWorkspaceState $prepared $testRoot $source).Outcome -eq 'failed') 'Manual preparation requires explicit completion'
 $mutex=[IO.FileStream]::new((Join-Path $testRoot '.registry-retention.lock'),[IO.FileMode]::Open,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None)
 try {Assert-True (Invoke-RegistryWorkspaceRetention $testRoot $source).Busy 'Concurrent cleanup does not race another cleanup'} finally {$mutex.Dispose()}
 $escaped=$false
 try {Get-RegistryWorkspaceState $outside $testRoot $source | Out-Null} catch {$escaped=$true}
 Assert-True $escaped 'Outside-root workspace request is rejected'
 Assert-True ((Get-FileHash -LiteralPath (Join-Path $source 'uncommitted.txt')).Hash -eq $sourceHash) 'Canonical uncommitted source bytes remain unchanged'
 $completed=$true
 [pscustomobject]@{Passed=$true;Checks=$passedChecks.Count;Details=$passedChecks;FixtureRoot=$testRoot}|ConvertTo-Json -Depth 4
} finally {
 if($null -ne $heldLease){$heldLease.Dispose()}
 if($null -ne $childProcess -and -not $childProcess.HasExited){Stop-Process -Id $childProcess.Id -ErrorAction Stop}
 if($junctionPath -and (Test-Path -LiteralPath $junctionPath)){[IO.Directory]::Delete($junctionPath,$false)}
 if($completed){
  $resolved=(Resolve-Path -LiteralPath $testRoot).ProviderPath
  if($resolved -cne $testRoot -or -not $resolved.StartsWith('C:\DevCache\projects\maimai-chart-browser-registry\retention-validation-',[StringComparison]::Ordinal)){throw 'Fixture cleanup scope failed'}
  Remove-Item -LiteralPath $resolved -Recurse -Force
 }
}

