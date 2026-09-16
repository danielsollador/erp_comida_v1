# Baja los respaldos de Savora del VPS a esta PC.
#
# Por que existe: los respaldos del servidor viven en el MISMO disco que la
# base. Si ese VPS se pierde, se pierden los dos juntos, y un respaldo que
# muere con el original no es un respaldo. Esta PC es la copia de afuera.
#
# Se puede correr a mano cuando sea; solo trae lo que falta.

$ErrorActionPreference = "Stop"
$Servidor = "root@2.25.223.224"
$Destino  = "C:\Users\lgomez\RespaldosSavora\archivos"
$Bitacora = "C:\Users\lgomez\RespaldosSavora\bitacora.txt"

function Anotar($texto) {
    $linea = "{0}  {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm"), $texto
    Add-Content -Path $Bitacora -Value $linea -Encoding utf8
}

if (-not (Test-Path $Destino)) { New-Item -ItemType Directory -Path $Destino | Out-Null }

try {
    # El volumen de Docker no se lee desde el host: hay que pasar por un
    # contenedor de un solo uso que lo monte.
    $listar = 'docker run --rm -v erp_comida_data:/d alpine ls /d/backups'
    $remotos = & ssh -o BatchMode=yes -o ConnectTimeout=20 $Servidor $listar 2>$null
    if ($LASTEXITCODE -ne 0) { throw "no se pudo conectar al servidor" }

    $locales = @(Get-ChildItem -Path $Destino -File -ErrorAction SilentlyContinue | ForEach-Object { $_.Name })
    $faltan  = @($remotos | Where-Object { $_ -and ($locales -notcontains $_) })

    if ($faltan.Count -eq 0) { Anotar "sin novedad: $($locales.Count) archivo(s) ya estaban"; exit 0 }

    # Se copian a una carpeta temporal del servidor porque scp no puede leer
    # dentro de un volumen de Docker.
    $lista = $faltan -join ' '
    $sacar = "rm -rf /tmp/salida_respaldos && mkdir -p /tmp/salida_respaldos && " +
             "docker run --rm -v erp_comida_data:/d -v /tmp/salida_respaldos:/s alpine " +
             "sh -c 'for f in $lista; do cp /d/backups/`$f /s/; done'"
    & ssh -o BatchMode=yes $Servidor $sacar
    if ($LASTEXITCODE -ne 0) { throw "no se pudieron extraer los respaldos del volumen" }

    & scp -o BatchMode=yes -q "${Servidor}:/tmp/salida_respaldos/*" $Destino
    if ($LASTEXITCODE -ne 0) { throw "fallo la copia" }

    & ssh -o BatchMode=yes $Servidor "rm -rf /tmp/salida_respaldos" | Out-Null

    # Se conservan 60 dias aca. El servidor ya rota los suyos por su cuenta.
    Get-ChildItem -Path $Destino -File |
        Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-60) } |
        Remove-Item -Force -ErrorAction SilentlyContinue

    Anotar "bajados $($faltan.Count) archivo(s): $($faltan -join ', ')"
}
catch {
    # Que falle se tiene que poder ver despues. Un respaldo que dejo de correr
    # en silencio es peor que no tenerlo, porque da confianza falsa.
    Anotar "FALLO: $($_.Exception.Message)"
    exit 1
}
