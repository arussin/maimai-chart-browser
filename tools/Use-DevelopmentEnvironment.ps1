param([switch]$Install, [switch]$Offline)
$ErrorActionPreference='Stop'
$RegistrySource=(Resolve-Path -LiteralPath (Split-Path $PSScriptRoot -Parent)).Path
$identity=[Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($RegistrySource.ToLowerInvariant()))).Substring(0,16).ToLowerInvariant()
$RegistryCache="C:\DevCache\projects\maimai-chart-browser-registry\$identity"
$RegistryPython=Join-Path $RegistryCache 'venv\Scripts\python.exe'
$env:UV_PROJECT_ENVIRONMENT=Join-Path $RegistryCache 'venv'
$env:UV_CACHE_DIR='C:\DevCache\uv'
$env:UV_PYTHON_INSTALL_DIR='C:\DevTools\python'
$env:PYTHONPYCACHEPREFIX=Join-Path $RegistryCache 'pycache'
$env:RUFF_CACHE_DIR=Join-Path $RegistryCache 'ruff'
$env:MYPY_CACHE_DIR=Join-Path $RegistryCache 'mypy'
$env:PYTEST_ADDOPTS='-o cache_dir='+((Join-Path $RegistryCache 'pytest') -replace '\\','/')
$env:PLAYWRIGHT_BROWSERS_PATH='C:\DevCache\playwright'
$env:npm_config_cache='C:\DevCache\npm'
$env:MAIMAI_REGISTRY_OUTPUT=Join-Path $RegistryCache 'output'
$env:PYTHON=$RegistryPython
$env:TEMP=Join-Path $RegistryCache 'temp'
$env:TMP=$env:TEMP
New-Item -ItemType Directory -Path $env:TEMP -Force|Out-Null
New-Item -ItemType Directory -Path $RegistryCache -Force|Out-Null
if($Install){
 if(-not(Test-Path -LiteralPath $RegistryPython)){& 'C:\Users\adamr\.local\bin\uv.exe' venv --python 'C:\DevTools\python\cpython-3.11.14-windows-x86_64-none\python.exe' $env:UV_PROJECT_ENVIRONMENT;if($LASTEXITCODE){throw 'Environment creation failed'}}
 $installArgs=@('pip','install','--python',$RegistryPython,'-r',(Join-Path $RegistrySource 'requirements-dev.txt')); if($Offline){$installArgs+='--offline'}
 & 'C:\Users\adamr\.local\bin\uv.exe' @installArgs
 if($LASTEXITCODE){throw 'Dependency installation failed'}
}