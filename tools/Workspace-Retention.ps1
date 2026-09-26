function ConvertTo-RegistryUtc {
    param([object]$Value)
    if ($Value -is [DateTimeOffset]) { return $Value.ToUniversalTime() }
    if ($Value -is [DateTime]) {
        if ($Value.Kind -eq [DateTimeKind]::Unspecified) { $Value=[DateTime]::SpecifyKind($Value,[DateTimeKind]::Utc) }
        return [DateTimeOffset]::new($Value.ToUniversalTime())
    }
    if ([string]::IsNullOrWhiteSpace([string]$Value)) { throw 'Missing timestamp.' }
    return [DateTimeOffset]::Parse([string]$Value,[Globalization.CultureInfo]::InvariantCulture,[Globalization.DateTimeStyles]::AssumeUniversal).ToUniversalTime()
}
# Lifecycle and bounded retention for helper-owned disposable test workspaces.
# Unknown/legacy folders, unfinished preparations and explicit pins are never pruned.
function Assert-RegistryPlainPath {
    param([Parameter(Mandatory)][string]$Path)
    $absolute = [IO.Path]::GetFullPath($Path)
    $cursor = $absolute
    while ($cursor) {
        if (Test-Path -LiteralPath $cursor) {
            $item = Get-Item -LiteralPath $cursor -Force -ErrorAction Stop
            if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "Refusing linked path: $cursor" }
        }
        $cursor = [IO.Path]::GetDirectoryName($cursor)
    }
    return $absolute
}

function Get-RegistryWorkspaceRoot {
    param([string]$CacheRoot)
    $cache = Assert-RegistryPlainPath $CacheRoot
    if (-not $cache.StartsWith('C:\DevCache\projects\',[StringComparison]::OrdinalIgnoreCase)) { throw 'Cache root must be under C:\DevCache\projects.' }
    return (Join-Path $cache 'workspaces')
}

function Get-RegistryWorkspaceState {
    param([string]$Workspace, [string]$CacheRoot, [string]$Source)
    $root = Get-RegistryWorkspaceRoot $CacheRoot
    $path = Assert-RegistryPlainPath $Workspace
    if ([IO.Path]::GetDirectoryName($path) -ine $root -or [IO.Path]::GetFileName($path) -notmatch '^\d{8}T\d{9}-[a-f0-9]{8}$') { throw 'Workspace is not a direct generated child.' }
    $marker = Join-Path $path '.registry-workspace.json'
    [void](Assert-RegistryPlainPath $marker)
    $item = Get-Item -LiteralPath $marker -Force -ErrorAction Stop
    if ($item.PSIsContainer -or $item.Length -gt 65536) { throw 'Invalid workspace marker.' }
    $state = Get-Content -LiteralPath $marker -Raw -ErrorAction Stop | ConvertFrom-Json -ErrorAction Stop
    foreach ($key in @('Schema','Owner','Source','Workspace','RunId','Check','Outcome','Keep','StartedUtc','FinishedUtc')) {
        if ($key -notin $state.PSObject.Properties.Name) { throw "Incomplete workspace marker: $key" }
    }
    if ($state.Schema -ne 1 -or $state.Owner -ne 'registry-test-helper' -or $state.Source -ine [IO.Path]::GetFullPath($Source) -or $state.Workspace -ine $path -or $state.RunId -notmatch '^[a-f0-9]{32}$' -or $state.Check -notin @('python','browser','worker','prepare') -or $state.Outcome -notin @('running','prepared','passed','failed') -or $state.Keep -isnot [bool]) { throw 'Foreign or invalid workspace marker.' }
    [void](ConvertTo-RegistryUtc $state.StartedUtc)
    if ($state.Outcome -in @('passed','failed')) { [void](ConvertTo-RegistryUtc $state.FinishedUtc) }
    return $state
}

function Write-RegistryWorkspaceState {
    param([string]$Workspace, $State)
    [void](Assert-RegistryPlainPath $Workspace)
    $target = Join-Path $Workspace '.registry-workspace.json'
    [void](Assert-RegistryPlainPath $target)
    $temporary = Join-Path $Workspace ('.registry-workspace-'+[guid]::NewGuid().ToString('N')+'.tmp')
    [IO.File]::WriteAllText($temporary,($State | ConvertTo-Json -Depth 6),[Text.UTF8Encoding]::new($false))
    [IO.File]::Move($temporary,$target,$true)
}

function Open-RegistryWorkspaceLease {
    param([string]$Workspace, [switch]$Create)
    $leasePath = Join-Path $Workspace '.registry-workspace.lock'
    [void](Assert-RegistryPlainPath $leasePath)
    $mode = if ($Create) { [IO.FileMode]::CreateNew } else { [IO.FileMode]::Open }
    return [IO.FileStream]::new($leasePath,$mode,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None)
}

function Start-RegistryWorkspace {
    param([string]$CacheRoot, [string]$Source, [string]$Check, [switch]$Keep)
    $root = Get-RegistryWorkspaceRoot $CacheRoot
    New-Item -ItemType Directory -Path $root -Force | Out-Null
    $path = Join-Path $root ([DateTime]::UtcNow.ToString('yyyyMMddTHHmmssfff')+'-'+[guid]::NewGuid().ToString('N').Substring(0,8))
    New-Item -ItemType Directory -Path $path -ErrorAction Stop | Out-Null
    $lease = Open-RegistryWorkspaceLease $path -Create
    try {
        $state = [pscustomobject]@{Schema=1;Owner='registry-test-helper';Source=[IO.Path]::GetFullPath($Source);Workspace=$path;RunId=[guid]::NewGuid().ToString('N');Check=$Check;Outcome='running';Keep=[bool]$Keep;StartedUtc=[DateTime]::UtcNow.ToString('o');FinishedUtc=$null}
        Write-RegistryWorkspaceState $path $state
        return [pscustomobject]@{Path=$path;State=$state;Lease=$lease}
    } catch { $lease.Dispose(); throw }
}

function Complete-RegistryWorkspace {
    param($Run, [ValidateSet('passed','failed','prepared')][string]$Outcome)
    try {
        $Run.State.Outcome = $Outcome
        $Run.State.FinishedUtc = [DateTime]::UtcNow.ToString('o')
        Write-RegistryWorkspaceState $Run.Path $Run.State
    } finally { $Run.Lease.Dispose() }
}

function Complete-RegistryPreparedWorkspace {
    param([string]$Workspace,[string]$CacheRoot,[string]$Source,[ValidateSet('passed','failed')][string]$Outcome='passed')
    $state = Get-RegistryWorkspaceState $Workspace $CacheRoot $Source
    $lease = Open-RegistryWorkspaceLease $Workspace
    try {
        $state = Get-RegistryWorkspaceState $Workspace $CacheRoot $Source
        if ($state.Outcome -ne 'prepared') { throw 'Only a prepared workspace can be explicitly completed.' }
        $state.Outcome=$Outcome; $state.FinishedUtc=[DateTime]::UtcNow.ToString('o')
        Write-RegistryWorkspaceState $Workspace $state
    } finally { $lease.Dispose() }
}

function Invoke-RegistryWorkspaceRetention {
    param([string]$CacheRoot,[string]$Source,[string]$ExcludeWorkspace='', [switch]$Preview)
    $result = [ordered]@{Deleted=@();WouldDelete=@();Protected=0;Unmanaged=0;Warnings=@();Busy=$false}
    $root = Get-RegistryWorkspaceRoot $CacheRoot
    if (-not (Test-Path -LiteralPath $root)) { return [pscustomobject]$result }
    [void](Assert-RegistryPlainPath $root)
    $mutexPath=Join-Path $CacheRoot '.registry-retention.lock'
    [void](Assert-RegistryPlainPath $mutexPath)
    try { $mutex=[IO.FileStream]::new($mutexPath,[IO.FileMode]::OpenOrCreate,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None) }
    catch { $result.Busy=$true; return [pscustomobject]$result }
    try {
        $eligible=@()
        foreach ($folder in Get-ChildItem -LiteralPath $root -Directory -Force) {
            try { $state=Get-RegistryWorkspaceState $folder.FullName $CacheRoot $Source }
            catch { $result.Unmanaged++; continue }
            if ($state.Outcome -in @('running','prepared') -or $state.Keep -or $folder.FullName -ieq $ExcludeWorkspace -or (Test-Path -LiteralPath (Join-Path $folder.FullName '.keep-workspace'))) { $result.Protected++; continue }
            $finished=ConvertTo-RegistryUtc $state.FinishedUtc
            if ($finished -gt [DateTimeOffset]::UtcNow) { $result.Protected++; continue }
            $eligible += [pscustomobject]@{Path=$folder.FullName;State=$state;Finished=$finished;MarkerHash=(Get-FileHash -LiteralPath (Join-Path $folder.FullName '.registry-workspace.json') -Algorithm SHA256).Hash}
        }
        $candidates=@()
        foreach ($check in @('python','browser','worker','prepare')) {
            $passed=@($eligible | Where-Object {$_.State.Check -eq $check -and $_.State.Outcome -eq 'passed'} | Sort-Object Finished -Descending)
            $failed=@($eligible | Where-Object {$_.State.Check -eq $check -and $_.State.Outcome -eq 'failed'} | Sort-Object Finished -Descending)
            $candidates += @($passed | Select-Object -Skip 2)
            for($i=0;$i -lt $failed.Count;$i++) { if ($i -ge 3 -or $failed[$i].Finished -lt [DateTimeOffset]::UtcNow.AddDays(-7)) { $candidates += $failed[$i] } }
        }
        # Failure to inspect live processes defers cleanup; it never fails the test run.
        try { $processArguments=@(Get-CimInstance Win32_Process -ErrorAction Stop | Where-Object {$_.CommandLine} | ForEach-Object {$_.CommandLine}) }
        catch { $result.Warnings += 'Process inspection unavailable; cleanup deferred.'; return [pscustomobject]$result }
        foreach ($candidate in $candidates) {
            $lease=$null
            try {
                $path=Assert-RegistryPlainPath $candidate.Path
                if (@($processArguments | Where-Object {$_.IndexOf($path,[StringComparison]::OrdinalIgnoreCase) -ge 0}).Count) { $result.Protected++; continue }
                $lease=Open-RegistryWorkspaceLease $path
                $state=Get-RegistryWorkspaceState $path $CacheRoot $Source
                if ($state.Outcome -notin @('passed','failed') -or $state.Keep -or (Test-Path -LiteralPath (Join-Path $path '.keep-workspace')) -or (Get-FileHash -LiteralPath (Join-Path $path '.registry-workspace.json') -Algorithm SHA256).Hash -ne $candidate.MarkerHash) { $result.Protected++; continue }
                # Inspect without following directory links; never change attributes/ACLs to get through one.
                $pending=[Collections.Generic.Stack[string]]::new(); $pending.Push($path)
                while($pending.Count) {
                    foreach($entry in Get-ChildItem -LiteralPath $pending.Pop() -Force -ErrorAction Stop) {
                        if($entry.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Linked entry: cleanup deferred.' }
                        if($entry.PSIsContainer) {$pending.Push($entry.FullName)}
                    }
                }
                $result.WouldDelete += $path
                if($Preview) { continue }
                # Keep the lease locked while removing the payload. Only then close and remove the marker/lease shell.
                foreach($entry in Get-ChildItem -LiteralPath $path -Force -ErrorAction Stop) {
                    if($entry.Name -in @('.registry-workspace.lock','.registry-workspace.json')) {continue}
                    $full=[IO.Path]::GetFullPath($entry.FullName)
                    if([IO.Path]::GetDirectoryName($full) -ine $path -or -not $full.StartsWith($root+'\',[StringComparison]::OrdinalIgnoreCase)) {throw 'Deletion escaped owned workspace.'}
                    Remove-Item -LiteralPath $full -Recurse -Force -ErrorAction Stop
                }
                Remove-Item -LiteralPath (Join-Path $path '.registry-workspace.json') -Force -ErrorAction Stop
                $lease.Dispose();$lease=$null
                Remove-Item -LiteralPath (Join-Path $path '.registry-workspace.lock') -Force -ErrorAction Stop
                # Nonrecursive removal fails safely if another writer added anything.
                [IO.Directory]::Delete($path,$false)
                $result.Deleted += $path
            } catch { $result.Warnings += ('Deferred '+[IO.Path]::GetFileName($candidate.Path)+': '+$_.Exception.Message) }
            finally { if($null -ne $lease) {$lease.Dispose()} }
        }
        return [pscustomobject]$result
    } finally {$mutex.Dispose()}
}

