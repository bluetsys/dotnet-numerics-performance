function Get-BenchmarkEnvironment {
    param([int]$Iterations, [string[]]$Frameworks)
    $warnings = [System.Collections.Generic.List[string]]::new()

    function Read-CimData {
        param([string]$ClassName, [string]$Namespace = 'root/cimv2')
        try {
            Get-CimInstance -ClassName $ClassName -Namespace $Namespace -ErrorAction Stop
        }
        catch {
            $warnings.Add("Could not collect $ClassName.")
        }
    }

    $processors = @(Read-CimData 'Win32_Processor')
    $memoryModules = @(Read-CimData 'Win32_PhysicalMemory')
    $operatingSystem = Read-CimData 'Win32_OperatingSystem'
    $computerSystem = Read-CimData 'Win32_ComputerSystem'
    $powerPlan = Read-CimData 'Win32_PowerPlan' 'root/cimv2/power' |
        Where-Object { $_.IsActive } | Select-Object -First 1

    $runtimeVariables = [ordered]@{}
    foreach ($name in @(
        'DOTNET_TieredCompilation', 'DOTNET_TieredPGO', 'DOTNET_ReadyToRun',
        'DOTNET_gcServer', 'DOTNET_GCHeapCount',
        'COMPlus_TieredCompilation', 'COMPlus_TieredPGO', 'COMPlus_ReadyToRun',
        'COMPlus_gcServer', 'COMPlus_GCHeapCount'
    )) {
        $value = [Environment]::GetEnvironmentVariable($name)
        if ($null -ne $value) { $runtimeVariables[$name] = $value }
    }

    $sdkVersion = & dotnet --version
    if ($LASTEXITCODE -ne 0) { throw 'Could not read the .NET SDK version.' }
    $runtimes = @(& dotnet --list-runtimes) | ForEach-Object {
        # Store versions and architectures without machine-specific install paths.
        ($_ -split ' \[')[0]
    }
    if ($LASTEXITCODE -ne 0) { throw 'Could not list installed .NET runtimes.' }

    [ordered]@{
        schema_version = 1
        run_id = [Guid]::NewGuid().ToString()
        started_at = [DateTimeOffset]::Now.ToString('o')
        finished_at = $null
        timezone = [TimeZoneInfo]::Local.Id
        os = [ordered]@{
            name = $operatingSystem.Caption
            version = $operatingSystem.Version
            build = $operatingSystem.BuildNumber
            architecture = $operatingSystem.OSArchitecture
        }
        hardware = [ordered]@{
            manufacturer = $computerSystem.Manufacturer
            model = $computerSystem.Model
        }
        cpu = @($processors | ForEach-Object {
            [ordered]@{
                name = $_.Name.Trim()
                physical_cores = $_.NumberOfCores
                logical_processors = $_.NumberOfLogicalProcessors
                max_clock_mhz = $_.MaxClockSpeed
            }
        })
        memory = [ordered]@{
            total_bytes = $computerSystem.TotalPhysicalMemory
            available_bytes_at_start = if ($null -ne $operatingSystem) {
                [long]$operatingSystem.FreePhysicalMemory * 1024
            } else { $null }
            modules = @($memoryModules | ForEach-Object {
                [ordered]@{
                    capacity_bytes = $_.Capacity
                    speed_mhz = $_.Speed
                    configured_speed_mhz = $_.ConfiguredClockSpeed
                }
            })
        }
        power_plan = $powerPlan.ElementName
        dotnet = [ordered]@{
            sdk_version = ($sdkVersion -join '').Trim()
            installed_runtimes = @($runtimes)
            environment_variables = $runtimeVariables
        }
        runner = [ordered]@{
            powershell_version = $PSVersionTable.PSVersion.ToString()
        }
        benchmark = [ordered]@{
            configuration = 'Release'
            compilation = 'JIT (PublishAot=false)'
            iterations = $Iterations
            frameworks = @($Frameworks)
        }
        result_files = [ordered]@{}
        collection_warnings = @($warnings.ToArray())
    }
}
