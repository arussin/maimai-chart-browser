param([ValidateSet('python','browser','worker','prepare')][string]$Check='python', [string]$TestFile='', [string]$BrowserProject='')
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'Use-DevelopmentEnvironment.ps1') -Install
$workspace=Join-Path $RegistryCache ('workspaces\'+[DateTime]::UtcNow.ToString('yyyyMMddTHHmmssfff')+'-'+[guid]::NewGuid().ToString('N').Substring(0,8))
if(-not [IO.Path]::GetFullPath($workspace).StartsWith($RegistryCache+'\',[StringComparison]::OrdinalIgnoreCase)){throw 'Workspace path validation failed'}
if((Get-PSDrive C).Free -lt 31GB){throw 'Leave at least 30 GiB free before setup'}
New-Item -ItemType Directory -Path $workspace|Out-Null
# A fresh copy includes current edited and untracked source, never stale files.
$copyLog='/LOG:'+(Join-Path $workspace 'source-copy.log')
& robocopy.exe $RegistrySource $workspace /E /COPY:DAT /DCOPY:DAT /XJ /R:0 /W:0 /NP /NFL /NDL /XD .git .venv .ruff_cache .pytest_cache __pycache__ node_modules .wrangler output retained-results /XF .env .git $copyLog|Out-Null
if($LASTEXITCODE -ge 8){throw 'Source copy failed'}
$env:PYTHONPATH=(Join-Path $workspace 'src')+[IO.Path]::PathSeparator+$workspace
$env:MAIMAI_BROWSER_OUTPUT=Join-Path $workspace 'output\browser-tests'
$env:WRANGLER_SEND_METRICS='false'
Push-Location $workspace
try {
 if($Check -eq 'python') {& $RegistryPython -m unittest discover -s tests; if($LASTEXITCODE){throw 'Python tests failed'}}
 elseif($Check -eq 'worker') {
  Push-Location player-import-worker
  try {& npm.cmd ci --no-audit --no-fund;if($LASTEXITCODE){throw 'Worker dependencies failed'};& npm.cmd test;if($LASTEXITCODE){throw 'Worker tests failed'};& npm.cmd run types;if($LASTEXITCODE){throw 'Worker binding types failed'}}finally{Pop-Location}
 }
 elseif($Check -eq 'browser') {
  & $RegistryPython tests/browser/prepare.py;if($LASTEXITCODE){throw 'Fixture setup failed'}
  Push-Location tests/browser
  try {& npm.cmd ci --ignore-scripts --no-audit --no-fund;if($LASTEXITCODE){throw 'Browser dependencies failed'};$testArgs=@('test','--');if($TestFile){$testArgs+=$TestFile};if($BrowserProject){$testArgs+=@('--project',$BrowserProject)};& npm.cmd @testArgs;if($LASTEXITCODE){throw 'Browser tests failed'}}finally{Pop-Location}
 }
 [pscustomobject]@{Source=$RegistrySource;Workspace=$workspace;Check=$Check;Passed=$true;EditingLocation=$RegistrySource}|ConvertTo-Json
}finally{Pop-Location}
