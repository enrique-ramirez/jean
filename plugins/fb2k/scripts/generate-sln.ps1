# Generates an x64 solution over the SDK projects, whose own foo_sample.sln offers x86 configurations only.
#
# The per-project configuration below is the load-bearing part: pfc builds as "Release FB2K" and everything else as "Release".
# Forcing plain "Release" onto pfc fails at link with LNK2005 on pfc::crashHook, an error that says nothing about configurations.
$sdk = Join-Path (Split-Path -Parent $PSScriptRoot) 'sdk'
$projects = @(
  @{ n='foo_sample';                  p='foobar2000\foo_sample\foo_sample.vcxproj';                                   g='{85FBFD09-0099-4FE9-9DB6-78DB6F60F817}'; c='Release' }
  @{ n='foobar2000_SDK';              p='foobar2000\SDK\foobar2000_SDK.vcxproj';                                      g='{E8091321-D79D-4575-86EF-064EA1A4A20D}'; c='Release' }
  @{ n='pfc';                         p='pfc\pfc.vcxproj';                                                            g='{EBFFFB4E-261D-44D3-B89C-957B31A0BF9C}'; c='Release FB2K' }
  @{ n='foobar2000_sdk_helpers';      p='foobar2000\helpers\foobar2000_sdk_helpers.vcxproj';                          g='{EE47764E-A202-4F85-A767-ABDAB4AFF35F}'; c='Release' }
  @{ n='foobar2000_component_client'; p='foobar2000\foobar2000_component_client\foobar2000_component_client.vcxproj'; g='{71AD2674-065B-48F5-B8B0-E1F9D3892081}'; c='Release' }
  @{ n='libPPUI';                     p='libPPUI\libPPUI.vcxproj';                                                    g='{7729EB82-4069-4414-964B-AD399091A03F}'; c='Release' }
)
$sb = [System.Text.StringBuilder]::new()
[void]$sb.AppendLine('Microsoft Visual Studio Solution File, Format Version 12.00')
foreach ($x in $projects) {
  [void]$sb.AppendLine("Project(`"{8BC9CEB8-8B4A-11D0-8D11-00A0C91BC942}`") = `"$($x.n)`", `"$($x.p)`", `"$($x.g)`"")
  [void]$sb.AppendLine('EndProject')
}
[void]$sb.AppendLine('Global')
[void]$sb.AppendLine('	GlobalSection(SolutionConfigurationPlatforms) = preSolution')
[void]$sb.AppendLine('		Release|x64 = Release|x64')
[void]$sb.AppendLine('	EndGlobalSection')
[void]$sb.AppendLine('	GlobalSection(ProjectConfigurationPlatforms) = postSolution')
foreach ($x in $projects) {
  [void]$sb.AppendLine("		$($x.g).Release|x64.ActiveCfg = $($x.c)|x64")
  [void]$sb.AppendLine("		$($x.g).Release|x64.Build.0 = $($x.c)|x64")
}
[void]$sb.AppendLine('	EndGlobalSection')
[void]$sb.AppendLine('EndGlobal')
$out = "$sdk\spike-x64.sln"
Set-Content -Path $out -Value $sb.ToString() -Encoding UTF8
"wrote $out"
