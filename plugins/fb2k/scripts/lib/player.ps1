# Never invoke foobar2000.exe directly from a script. Over SSH that starts a stray session-0 instance which
# intercepts the single-instance IPC, so the next /exit hangs. Everything goes through here instead.
#
# Dot-source it:  . "$PSScriptRoot\lib\player.ps1"

# Runs foobar2000.exe with arguments in the logged-on session, via a throwaway scheduled task.
# schtasks /run is fire-and-forget, so $SettleSeconds is all there is to wait on.
function Invoke-PlayerCommand {
    param(
        [Parameter(Mandatory = $true)][string]$Foobar2000Dir,
        [Parameter(Mandatory = $true)][string[]]$Arguments,
        [string]$TaskName = 'foo_jean_oneshot',
        [int]$SettleSeconds = 5
    )

    $exe = Join-Path $Foobar2000Dir 'foobar2000.exe'
    if (-not (Test-Path $exe)) { throw "No foobar2000.exe in $Foobar2000Dir" }

    $quoted = ($Arguments | ForEach-Object { "`"$_`"" }) -join ' '
    $command = "`"$exe`" $quoted".Trim()

    # /it puts the task in the logged-on session; the date is far enough out that only /run ever fires it.
    schtasks /create /tn $TaskName /tr $command /sc ONCE /st 00:00 /sd 01/01/2030 /it /f | Out-Null
    try {
        schtasks /run /tn $TaskName | Out-Null
        Start-Sleep -Seconds $SettleSeconds
    }
    finally {
        schtasks /delete /tn $TaskName /f | Out-Null
    }
}

# Asks the player to exit and waits for it to go.
# /exit is a request rather than a kill: it lets foobar2000 write its configuration, playlists and media database out.
function Stop-Player {
    param(
        [Parameter(Mandatory = $true)][string]$Foobar2000Dir,
        [int]$TimeoutSeconds = 30
    )

    if (-not (Get-Process foobar2000 -EA SilentlyContinue)) { return }

    Invoke-PlayerCommand -Foobar2000Dir $Foobar2000Dir -Arguments @('/exit') `
        -TaskName 'foo_jean_exit_oneshot' -SettleSeconds 1

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while (Get-Process foobar2000 -EA SilentlyContinue) {
        if ((Get-Date) -gt $deadline) {
            throw "foobar2000 did not exit within ${TimeoutSeconds}s. Close it by hand rather than forcing it."
        }
        Start-Sleep -Milliseconds 500
    }
}
