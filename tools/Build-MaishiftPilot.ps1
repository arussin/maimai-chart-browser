param()
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'Use-DevelopmentEnvironment.ps1') -Install
$pilotOutput=Join-Path $RegistryCache ('workspaces\pilot-artifact-'+[DateTime]::UtcNow.ToString('yyyyMMddTHHmmssfff')+'-'+[guid]::NewGuid().ToString('N').Substring(0,8))
$env:PYTHONPATH=(Join-Path $RegistrySource 'src')+[IO.Path]::PathSeparator+$RegistrySource
& $RegistryPython -B (Join-Path $RegistrySource 'scripts\build_maishift_pilot.py') --output $pilotOutput | Out-Null
if($LASTEXITCODE){throw 'Pilot artifact build failed'}
[pscustomobject]@{Artifact=$pilotOutput;Entry='/pilot/maishift/';Endpoint='/api/player-import/maishift';Deployed=$false}|ConvertTo-Json
