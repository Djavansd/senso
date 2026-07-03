$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$java = Get-ChildItem (Join-Path $root ".tools\java21") -Recurse -Filter java.exe |
    Select-Object -First 1

if (-not $java) {
    throw "Java portatil nao encontrado em .tools\java21."
}

$env:JAVA_HOME = Split-Path -Parent (Split-Path -Parent $java.FullName)
$env:Path = "$(Split-Path -Parent $java.FullName);$env:Path"

$dataPath = Join-Path $root ".emulator-data"
$publicPath = Join-Path $root "public"
$python = (Get-Command python -ErrorAction Stop).Source
$web = Start-Process -FilePath $python `
    -ArgumentList "-m", "http.server", "5500", "--bind", "127.0.0.1", "--directory", $publicPath `
    -WindowStyle Hidden -PassThru

Write-Host ""
Write-Host "Senso local:       http://127.0.0.1:5500" -ForegroundColor Green
Write-Host "Painel Emulator:   http://127.0.0.1:4000" -ForegroundColor Cyan
Write-Host "Firebase producao: NAO sera utilizado." -ForegroundColor Yellow
Write-Host "Para encerrar e salvar os testes, pressione Ctrl+C." -ForegroundColor DarkGray
Write-Host ""

try {
    $arguments = @("emulators:start", "--only", "auth,firestore,functions", "--project", "senso-6d92a", "--export-on-exit", $dataPath)
    if (Test-Path (Join-Path $dataPath "firebase-export-metadata.json")) {
        $arguments += @("--import", $dataPath)
    }
    & firebase.cmd @arguments
} finally {
    if ($web -and -not $web.HasExited) {
        Stop-Process -Id $web.Id -Force -ErrorAction SilentlyContinue
    }
}
