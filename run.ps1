param(
    [ValidateRange(1, 2147483647)]
    [int]$Iterations = 1000000
)

$ErrorActionPreference = 'Stop'
$sourceDirectory = Join-Path $PSScriptRoot 'src'
[xml]$project = Get-Content -LiteralPath (Join-Path $sourceDirectory 'main.csproj') -Raw
$frameworks = @($project.Project.PropertyGroup.TargetFrameworks) -join ';'
$frameworks = @($frameworks.Split(';') | ForEach-Object { $_.Trim() } | Where-Object { $_ })
if ($frameworks.Count -eq 0) {
    throw 'No TargetFrameworks found in main.csproj.'
}

# Check all outputs before starting. This script never builds the project.
foreach ($framework in $frameworks) {
    $dll = Join-Path $sourceDirectory "bin\Release\$framework\main.dll"
    if (-not (Test-Path -LiteralPath $dll -PathType Leaf)) {
        throw "Build output missing: $dll. Run .\build.ps1 first."
    }
}

$resultsDirectory = Join-Path $PSScriptRoot 'results'
New-Item -ItemType Directory -Path $resultsDirectory -Force | Out-Null
. (Join-Path $PSScriptRoot 'environment.ps1')
$environment = Get-BenchmarkEnvironment -Iterations $Iterations -Frameworks $frameworks
$environmentFile = Join-Path $resultsDirectory 'environment.json'
$environment | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $environmentFile -Encoding UTF8
$failedFrameworks = @()
foreach ($framework in $frameworks) {
    $dll = Join-Path $sourceDirectory "bin\Release\$framework\main.dll"
    $resultFile = Join-Path $resultsDirectory "$framework.txt"
    Write-Host "`n=== $framework -> $resultFile ==="

    # Capture stderr as well, and show the same output in the console.
    # Continue through all frameworks even if one executable fails.
    $previousErrorActionPreference = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        & dotnet $dll $Iterations 2>&1 |
            ForEach-Object { $_.ToString() } |
            Tee-Object -Variable capturedOutput
        $runExitCode = $LASTEXITCODE
    }
    finally {
        $ErrorActionPreference = $previousErrorActionPreference
    }
    @("Environment ID: $($environment.run_id)") + @($capturedOutput) |
        Set-Content -LiteralPath $resultFile -Encoding UTF8
    if ($runExitCode -ne 0) {
        Add-Content -LiteralPath $resultFile -Value "Exit code: $runExitCode" -Encoding UTF8
        $failedFrameworks += $framework
    }
    $environment.result_files["$framework.txt"] = (Get-FileHash -LiteralPath $resultFile -Algorithm SHA256).Hash
}

$environment.finished_at = [DateTimeOffset]::Now.ToString('o')
$environment | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $environmentFile -Encoding UTF8
if ($failedFrameworks.Count -gt 0) {
    throw "Execution failed: $($failedFrameworks -join ', '). See $resultsDirectory."
}
Write-Host "`nResults saved to $resultsDirectory (existing files are replaced)."
