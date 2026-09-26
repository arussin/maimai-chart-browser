param(
 [ValidateSet('python','browser','worker','prepare')][string]$Check='python',
 [string]$TestFile='', [string]$BrowserProject='', [switch]$Offline,
 [switch]$KeepWorkspace, [switch]$CleanupOnly,
 [string]$CompletePreparedWorkspace='',
 [ValidateSet('passed','failed')][string]$PreparedOutcome='passed'
)
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'Use-DevelopmentEnvironment.ps1')
. (Join-Path $PSScriptRoot 'Workspace-Retention.ps1')
if($CompletePreparedWorkspace) {
 Complete-RegistryPreparedWorkspace -Workspace $CompletePreparedWorkspace -CacheRoot $RegistryCache -Source $RegistrySource -Outcome $PreparedOutcome
 Invoke-RegistryWorkspaceRetention -CacheRoot $RegistryCache -Source $RegistrySource -ExcludeWorkspace $CompletePreparedWorkspace | ConvertTo-Json -Depth 5
 return
}
$retentionBefore=Invoke-RegistryWorkspaceRetention -CacheRoot $RegistryCache -Source $RegistrySource
if($CleanupOnly) { $retentionBefore | ConvertTo-Json -Depth 5; return }
. (Join-Path $PSScriptRoot 'Use-DevelopmentEnvironment.ps1') -Install -Offline:$Offline
if((Get-PSDrive C).Free -lt 31GB){throw 'Leave at least 30 GiB free before setup'}
$run=Start-RegistryWorkspace -CacheRoot $RegistryCache -Source $RegistrySource -Check $Check -Keep:$KeepWorkspace
$workspace=$run.Path
$outcome='failed';$locationPushed=$false
try {
 # A fresh copy includes current edited and untracked source, never stale files.
 $copyLog='/LOG:'+(Join-Path $workspace 'source-copy.log')
 & robocopy.exe $RegistrySource $workspace /E /COPY:DAT /DCOPY:DAT /XJ /R:0 /W:0 /NP /NFL /NDL /XD .git .venv .ruff_cache .pytest_cache __pycache__ node_modules .wrangler output retained-results /XF .env .git .registry-workspace.json .registry-workspace.lock .keep-workspace $copyLog|Out-Null
 if($LASTEXITCODE -ge 8){throw 'Source copy failed'}
 $env:PYTHONPATH=(Join-Path $workspace 'src')+[IO.Path]::PathSeparator+$workspace
 $env:MAIMAI_BROWSER_OUTPUT=Join-Path $workspace 'output\browser-tests'
 $env:WRANGLER_SEND_METRICS='false'
 Push-Location $workspace;$locationPushed=$true
 if($Check -eq 'python') {& $RegistryPython -m unittest discover -s tests; if($LASTEXITCODE){throw 'Python tests failed'}}
 elseif($Check -eq 'worker') {
  Push-Location player-import-worker
  try {& npm.cmd ci --no-audit --no-fund;if($LASTEXITCODE){throw 'Worker dependencies failed'};& npm.cmd test;if($LASTEXITCODE){throw 'Worker tests failed'};& npm.cmd run types;if($LASTEXITCODE){throw 'Worker binding types failed'}}finally{Pop-Location}
 }
 elseif($Check -eq 'browser') {
  & $RegistryPython tests/browser/prepare.py;if($LASTEXITCODE){throw 'Fixture setup failed'}
  & $RegistryPython scripts/build_maishift_pilot.py --output (Join-Path $env:MAIMAI_BROWSER_OUTPUT 'maishift-pilot') | Out-Null;if($LASTEXITCODE){throw 'Pilot fixture setup failed'}
  Push-Location tests/browser
  try {& npm.cmd ci --ignore-scripts --no-audit --no-fund;if($LASTEXITCODE){throw 'Browser dependencies failed'};$testArgs=@('test','--');if($TestFile){$testArgs+=$TestFile};if($BrowserProject){$testArgs+=@('--project',$BrowserProject)};& npm.cmd @testArgs;if($LASTEXITCODE){throw 'Browser tests failed'}}finally{Pop-Location}
 }
 $outcome=if($Check -eq 'prepare'){'prepared'}else{'passed'}
 [pscustomobject]@{Source=$RegistrySource;Workspace=$workspace;Check=$Check;Passed=$true;EditingLocation=$RegistrySource;Outcome=$outcome;Keep=[bool]$KeepWorkspace}|ConvertTo-Json
} finally {
 if($locationPushed){Pop-Location}
 try {Complete-RegistryWorkspace -Run $run -Outcome $outcome}
 catch {Write-Warning ('Workspace completion could not be recorded; preserved for review: '+$_.Exception.Message)}
 try {
  $retentionAfter=Invoke-RegistryWorkspaceRetention -CacheRoot $RegistryCache -Source $RegistrySource -ExcludeWorkspace $workspace
  foreach($warning in $retentionAfter.Warnings){Write-Warning $warning}
 } catch {Write-Warning ('Workspace cleanup deferred: '+$_.Exception.Message)}
}
