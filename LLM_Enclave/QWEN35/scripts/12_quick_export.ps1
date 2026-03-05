#Requires -Version 5.1
<#
.SYNOPSIS
    Quick-export files from D:\ProjectsHome into the workspace bridge inbox.

.DESCRIPTION
    Simplified wrapper around 04_export_to_bridge.ps1 for common use cases.
    Makes it easy to feed project files to the local AI.

.EXAMPLE
    .\12_quick_export.ps1 -Path "D:\ProjectsHome\MyProject\src\main.py"
    .\12_quick_export.ps1 -Path "D:\ProjectsHome\MyProject\src" -Recursive
    .\12_quick_export.ps1 -Path "D:\ProjectsHome\MyProject" -Pattern "*.py" -Recursive
#>

param(
    [Parameter(Mandatory=$true)]
    [string]$Path,

    [string]$ProjectLabel = "",

    [switch]$Recursive,

    [string]$Pattern = "*"
)

$EnclaveRoot = "D:\ProjectsHome\LLM_Enclave\QWEN35"
$InboxRoot = "$EnclaveRoot\workspace_bridge\inbox"
$ExportScript = "$EnclaveRoot\scripts\04_export_to_bridge.ps1"

# Auto-detect project label from path
if ($ProjectLabel -eq "") {
    $resolvedPath = Resolve-Path $Path -ErrorAction SilentlyContinue
    if ($resolvedPath) {
        $pathStr = $resolvedPath.Path
        if ($pathStr -match "D:\\ProjectsHome\\([^\\]+)") {
            $ProjectLabel = $matches[1]
        } else {
            $ProjectLabel = Split-Path $pathStr -Leaf
        }
    } else {
        $ProjectLabel = "default"
    }
}

Write-Host "Exporting to inbox as project: $ProjectLabel" -ForegroundColor Cyan

# If the full export script exists, use it
if (Test-Path $ExportScript) {
    $exportArgs = @{
        SourcePath = $Path
        ProjectLabel = $ProjectLabel
    }
    if ($Recursive) { $exportArgs.Recursive = $true }
    & $ExportScript @exportArgs
} else {
    # Simple fallback: direct copy
    $destDir = "$InboxRoot\$ProjectLabel"

    if (Test-Path $Path -PathType Container) {
        # Directory
        if ($Recursive) {
            $files = Get-ChildItem -Path $Path -Filter $Pattern -Recurse -File
        } else {
            $files = Get-ChildItem -Path $Path -Filter $Pattern -File
        }

        $count = 0
        foreach ($file in $files) {
            $relativePath = $file.FullName.Substring((Resolve-Path $Path).Path.Length)
            $dest = Join-Path $destDir $relativePath
            $destParent = Split-Path $dest -Parent
            if (-not (Test-Path $destParent)) {
                New-Item -ItemType Directory -Path $destParent -Force | Out-Null
            }
            Copy-Item -Path $file.FullName -Destination $dest -Force
            $count++
        }
        Write-Host "Exported $count files to inbox\$ProjectLabel" -ForegroundColor Green
    } else {
        # Single file
        $fileName = Split-Path $Path -Leaf
        $dest = "$destDir\$fileName"
        $destParent = Split-Path $dest -Parent
        if (-not (Test-Path $destParent)) {
            New-Item -ItemType Directory -Path $destParent -Force | Out-Null
        }
        Copy-Item -Path $Path -Destination $dest -Force
        Write-Host "Exported: $fileName -> inbox\$ProjectLabel\$fileName" -ForegroundColor Green
    }
}

Write-Host ""
Write-Host "Now start chatting:" -ForegroundColor Cyan
Write-Host "  .\11_chat.ps1 -Project $ProjectLabel" -ForegroundColor White
Write-Host "  Then type: /include $ProjectLabel\<filename>" -ForegroundColor White
