param(
 [Parameter(Mandatory=$true)][string]$ProfileUrl,
 [ValidateSet('intl','jp')][string]$Region='intl',
 [ValidateRange(1024,65535)][int]$Port=8895
)
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'Use-DevelopmentEnvironment.ps1')
$pilotOutput=Join-Path $RegistryCache ('workspaces\pilot-preview-'+[DateTime]::UtcNow.ToString('yyyyMMddTHHmmssfff')+'-'+[guid]::NewGuid().ToString('N').Substring(0,8))
$env:PYTHONPATH=(Join-Path $RegistrySource 'src')+[IO.Path]::PathSeparator+$RegistrySource
& $RegistryPython -B (Join-Path $RegistrySource 'scripts\build_maishift_pilot.py') --output $pilotOutput | Out-Null
if($LASTEXITCODE){throw 'Pilot artifact build failed'}
# Passing one public profile is approval for manual reads of that profile only.
# Environment values belong to this process, not a saved machine/user setting.
$pilotPrevious=@{}
$pilotValues=@{MAISHIFT_PREVIEW_ARTIFACT=$pilotOutput;MAISHIFT_PREVIEW_PORT=[string]$Port;MAISHIFT_PREVIEW_LIVE='true';MAISHIFT_CANARY_APPROVED='true';MAISHIFT_CANARY_URL=$ProfileUrl;MAISHIFT_CANARY_REGION=$Region}
foreach($entry in $pilotValues.GetEnumerator()){$pilotPrevious[$entry.Key]=[Environment]::GetEnvironmentVariable($entry.Key,'Process');[Environment]::SetEnvironmentVariable($entry.Key,$entry.Value,'Process')}
try { & node (Join-Path $RegistrySource 'scripts\serve_maishift_pilot.mjs'); if($LASTEXITCODE){throw 'Local pilot stopped with an error'} }
finally {foreach($entry in $pilotPrevious.GetEnumerator()){[Environment]::SetEnvironmentVariable($entry.Key,$entry.Value,'Process')}}
