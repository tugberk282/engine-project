$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$version = '20250613'
$expectedSha256 = '45145C035D9246E1DE16F1873AA9AFA863D93909F4A8F363E2EB38A04031D3C3'
$archiveName = "llvm-mingw-$version-ucrt-x86_64.zip"
$uri = "https://github.com/mstorsjo/llvm-mingw/releases/download/$version/$archiveName"
$toolRoot = Join-Path $env:RUNNER_TOOL_CACHE "tugberk-llvm-mingw-$version"
$archive = Join-Path $env:RUNNER_TEMP $archiveName

Invoke-WebRequest -Uri $uri -OutFile $archive
$actualSha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $archive).Hash
if ($actualSha256 -ne $expectedSha256) {
  throw "LLVM-MinGW archive digest mismatch: expected $expectedSha256, received $actualSha256"
}
New-Item -ItemType Directory -Force -Path $toolRoot | Out-Null
Expand-Archive -LiteralPath $archive -DestinationPath $toolRoot -Force
$compiler = Get-ChildItem -LiteralPath $toolRoot -Filter clang.exe -Recurse -File | Select-Object -First 1
if (-not $compiler) { throw 'Pinned LLVM-MinGW archive did not contain clang.exe' }
"TUGBERK_MINGW_CC=$($compiler.FullName)" | Out-File -FilePath $env:GITHUB_ENV -Append -Encoding utf8
& $compiler.FullName --version
