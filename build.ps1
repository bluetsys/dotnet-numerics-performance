$ErrorActionPreference = 'Stop'

# Build every framework listed in TargetFrameworks, using the normal JIT runtime.
dotnet build (Join-Path $PSScriptRoot 'src\main.csproj') -c Release
if ($LASTEXITCODE -ne 0) {
    throw "dotnet build failed (exit code $LASTEXITCODE)."
}
