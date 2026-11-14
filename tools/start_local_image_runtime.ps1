[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$envFile = Join-Path $projectRoot '.env'
if (Test-Path -LiteralPath $envFile) {
    foreach ($line in Get-Content -LiteralPath $envFile) {
        if ($line -match '^\s*(PYTHON_RUNTIME|COMFYUI_DIR|MINIMAX_TEXT_ENCODER_DIR)\s*=\s*(.*?)\s*$') {
            $name = $Matches[1]
            $value = $Matches[2].Trim('"').Trim("'")
            if (-not [Environment]::GetEnvironmentVariable($name, 'Process')) {
                [Environment]::SetEnvironmentVariable($name, $value, 'Process')
            }
        }
    }
}
if (-not $env:PYTHON_RUNTIME -or -not (Test-Path -LiteralPath $env:PYTHON_RUNTIME -PathType Leaf)) {
    throw 'Set PYTHON_RUNTIME to an existing Python executable with ComfyUI dependencies.'
}
if (-not $env:COMFYUI_DIR -or -not (Test-Path -LiteralPath (Join-Path $env:COMFYUI_DIR 'main.py'))) {
    throw 'Set COMFYUI_DIR to the isolated ComfyUI checkout.'
}
if (-not $env:MINIMAX_TEXT_ENCODER_DIR -or -not (Test-Path -LiteralPath $env:MINIMAX_TEXT_ENCODER_DIR -PathType Container)) {
    throw 'Set MINIMAX_TEXT_ENCODER_DIR to the existing text_encoders folder.'
}
try {
    $null = Invoke-RestMethod 'http://127.0.0.1:8188/system_stats' -TimeoutSec 2
    Write-Output 'ComfyUI is already reachable at http://127.0.0.1:8188; no process started.'
    exit 0
}
catch [System.Net.Http.HttpRequestException] {}
catch [System.Threading.Tasks.TaskCanceledException] {}

$runtime = [IO.Path]::GetFullPath($env:COMFYUI_DIR)
$models = [IO.Path]::GetFullPath((Join-Path $projectRoot '.models/ComfyUI')).Replace('\', '/')
$encoder = [IO.Path]::GetFullPath($env:MINIMAX_TEXT_ENCODER_DIR).Replace('\', '/')
$modelPaths = @"
threadline_image:
  base_path: $models
  diffusion_models: diffusion_models
  vae: vae
threadline_existing_encoder:
  text_encoders: $encoder
"@
$extraPaths = Join-Path $runtime 'threadline_model_paths.yaml'
[IO.File]::WriteAllText($extraPaths, $modelPaths)
$arguments = @(
    'main.py', '--listen', '127.0.0.1', '--port', '8188',
    '--disable-auto-launch', '--disable-smart-memory', '--reserve-vram', '2',
    '--disable-fast-disk', '--disable-pinned-memory',
    '--extra-model-paths-config', ('"{0}"' -f $extraPaths)
)
$process = Start-Process -FilePath $env:PYTHON_RUNTIME -ArgumentList $arguments `
    -WorkingDirectory $runtime -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $runtime 'threadline.stdout.log') `
    -RedirectStandardError (Join-Path $runtime 'threadline.stderr.log') -PassThru
[IO.File]::WriteAllText((Join-Path $runtime 'threadline.pid'), [string]$process.Id)
Write-Output "Started local ComfyUI launcher PID $($process.Id). API: http://127.0.0.1:8188"
