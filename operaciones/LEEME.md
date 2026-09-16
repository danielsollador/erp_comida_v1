# Operación

Cosas que no corren dentro de la app pero sin las cuales la app no está a salvo.

## `bajar-respaldos.ps1` — la copia que vive fuera del servidor

El ERP ya se respalda solo cada 6 horas (`backup.py`), pero esos archivos
quedan en el **mismo disco** que la base. Si el VPS se pierde —lo borran, se
corrompe, se vence la cuenta— se pierden la base y sus respaldos juntos. Un
respaldo que muere con el original no es un respaldo.

Este script baja los respaldos del VPS a otra máquina. Trae solo lo que falta,
conserva 60 días y deja constancia en `bitacora.txt`, incluidos los fallos:
un respaldo que dejó de correr en silencio es peor que no tener ninguno,
porque da confianza falsa.

Necesita llave SSH ya instalada en el servidor (`ssh root@<ip>` sin
contraseña). Los respaldos están dentro de un volumen de Docker, que no se lee
desde el host: por eso el script pasa por un contenedor de un solo uso para
sacarlos a `/tmp` y de ahí los copia.

Instalado en la PC de Daniel como tarea programada cada 6 horas, con
"ejecutar en cuanto se pueda" para que recupere las veces que la PC estuvo
apagada:

```powershell
$a = New-ScheduledTaskAction -Execute "powershell.exe" -Argument '-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "C:\Users\lgomez\RespaldosSavora\bajar-respaldos.ps1"'
$t = New-ScheduledTaskTrigger -Once -At (Get-Date).Date.AddHours(9) -RepetitionInterval (New-TimeSpan -Hours 6)
$s = New-ScheduledTaskSettingsSet -StartWhenAvailable -RunOnlyIfNetworkAvailable
Register-ScheduledTask -TaskName "Respaldos Savora fuera del servidor" -Action $a -Trigger $t -Settings $s -Force
```

Es la solución de hoy, no la definitiva: depende de que esa PC se encienda.
Cuando haya presupuesto, el destino correcto es almacenamiento de objetos
(Backblaze B2 o Cloudflare R2, centavos al mes) con el mismo script cambiando
`scp` por `rclone`.
