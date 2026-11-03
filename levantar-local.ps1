# Levanta Vertigo Pro en local, sin Docker, cada servicio en su ventana.
#   ERP (Savora):   http://localhost:5181
#   Sitio publico:  http://localhost:5181/sitio/
#   Hub:            http://localhost:5182/inicio.html
#   App movil:      http://localhost:8081 (la app de Expo en el navegador, contra el backend local)
# Datos de prueba en .dev-data (SQLite, no se versiona). Para empezar de cero, borrar esa carpeta.
# La primera vez:
#   cd backend;  py -m venv .venv; .venv\Scripts\python -m pip install -r requirements.txt pytest
#   cd frontend; npm ci
#   cd movil;    npm ci

$raiz = $PSScriptRoot
$backend = Join-Path $raiz "backend"
$frontend = Join-Path $raiz "frontend"
$movil = Join-Path $raiz "movil"
$datos = Join-Path $raiz ".dev-data"
foreach ($d in @("local", "hub", "compartido")) {
    New-Item -ItemType Directory -Force (Join-Path $datos $d) | Out-Null
}

$comunes = "`$env:ERP_SHARED_DIR='$datos\compartido'; `$env:ERP_BACKUP_ON_STARTUP='0'; `$env:TZ='America/Caracas';"
$uvicorn = ".venv\Scripts\python -m uvicorn app.main:app --host 127.0.0.1 --reload --reload-dir app"

$servicios = @(
    @{ dir = $backend;  cmd = "$comunes `$env:ERP_DATA_DIR='$datos\local'; `$env:ERP_SEMBRAR_DEMO='1'; `$env:ERP_LECTOR_FACTURAS='prueba'; $uvicorn --port 8011" },
    @{ dir = $backend;  cmd = "$comunes `$env:ERP_ES_HUB='1'; `$env:ERP_DATA_DIR='$datos\hub'; $uvicorn --port 8012" },
    @{ dir = $frontend; cmd = "`$env:VITE_API_PROXY_TARGET='http://127.0.0.1:8011'; `$env:VITE_PORT='5181'; npx vite" },
    @{ dir = $frontend; cmd = "`$env:VITE_API_PROXY_TARGET='http://127.0.0.1:8012'; `$env:VITE_PORT='5182'; npx vite" },
    @{ dir = $movil;    cmd = "`$env:EXPO_PUBLIC_API_BASE='http://localhost:8011'; npx expo start --web --port 8081" }
)

foreach ($s in $servicios) {
    Start-Process powershell -WorkingDirectory $s.dir -ArgumentList "-NoExit", "-Command", $s.cmd
}

Write-Output "ERP:   http://localhost:5181"
Write-Output "Sitio: http://localhost:5181/sitio/"
Write-Output "Hub:   http://localhost:5182/inicio.html"
Write-Output "App:   http://localhost:8081"
