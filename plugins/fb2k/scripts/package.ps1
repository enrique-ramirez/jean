# Packages the built DLL as a .fb2k-component, which is a zip under another name.
#
# x64 payloads go in an x64\ subfolder. The top level of the archive is where foobar2000 looks for a legacy x86 DLL:
# put an x64 DLL there and a modern player installs the component, reports no error, and loads nothing.
#
# Entry names are written by hand because zip entry paths are separated by forward slashes and the Windows helpers have disagreed about that.
param(
  [string]$Configuration = 'Release',
  [string]$Platform = 'x64'
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot

$dll = Join-Path $root "bin\$Platform\$Configuration\foo_jean.dll"
if (-not (Test-Path $dll)) {
  throw "No DLL at $dll -- run scripts/build.ps1 -Project src\foo_jean.vcxproj first."
}

$dist = Join-Path $root 'dist'
New-Item -ItemType Directory -Force -Path $dist | Out-Null
$out = Join-Path $dist 'foo_jean.fb2k-component'
if (Test-Path $out) { Remove-Item $out }

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$zip = [System.IO.Compression.ZipFile]::Open($out, 'Create')
try {
  $entryName = if ($Platform -eq 'Win32') { 'foo_jean.dll' } else { "$Platform/foo_jean.dll" }
  [void][System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $dll, $entryName)
}
finally { $zip.Dispose() }

# Printed back because the failure this guards against is a component that installs and does nothing.
$check = [System.IO.Compression.ZipFile]::OpenRead($out)
try { $check.Entries | ForEach-Object { "  $($_.FullName)  $($_.Length) bytes" } }
finally { $check.Dispose() }

Write-Output "Packaged $out"
