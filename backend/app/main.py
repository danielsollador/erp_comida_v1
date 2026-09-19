import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from . import models  # noqa: F401  (registra las tablas en Base)
from . import settings
from .acceso import auth, permisos, usuarios
from .backup import iniciar_respaldos_automaticos, respaldo_si_hace_falta
from .contabilidad import seed_plan_de_cuentas
from .database import Base, SessionLocal, engine, preparar_esquema
from .migrations import aplicar as aplicar_migraciones
from .migrations import renombrar_tablas
from .routers import (
    acceso as acceso_router,
    agencia,
    caja,
    compras,
    config,
    contabilidad as contabilidad_router,
    impuestos as impuestos_router,
    inventario,
    menu,
    operadores,
    pedidos,
    proveedores,
    reportes,
    respaldos,
    tasas,
    usuarios as usuarios_router,
    ventas,
)
from .seed import asegurar_categoria_envios, seed_if_empty
from .settings import BACKUP_ON_STARTUP, CORS_ORIGINS
from .tasas import iniciar_refresco_automatico
from .ws_manager import manager

# Sin esto los `log.info` del aplicativo (usuarios configurados, zona horaria
# del negocio, respaldos) no salen en `docker compose logs`: uvicorn configura
# sus propios loggers y deja los demas en WARNING.
logging.basicConfig(level=logging.INFO,
                    format="%(asctime)s %(levelname)s %(name)s %(message)s")
log = logging.getLogger("erp.main")


def _arrancar_acceso() -> None:
    """Se avisa en el log de arranque, no como un 500 tres pantallas despues.

    El try es ancho a proposito: ningun problema al sembrar el primer usuario
    justifica dejar el ERP caido -- siempre queda la pantalla de instalacion.
    """
    problema = usuarios.problema_almacen()
    if problema:
        log.error("acceso: %s", problema)
    try:
        if usuarios.sembrar_desde_entorno(settings.APP_USER, settings.APP_PASSWORD):
            log.info("acceso: primer usuario '%s' creado desde el entorno", settings.APP_USER)
    except Exception as exc:  # noqa: BLE001
        log.error("acceso: no se pudo sembrar el usuario del entorno: %s", exc)
    if usuarios.hay_usuarios():
        log.info("acceso: %d usuario(s) configurado(s)", len(usuarios.listar()))
    else:
        log.warning("acceso: SIN usuarios todavia. La primera visita pedira crear "
                    "el administrador (modo instalacion).")


def _avisar_zona_horaria() -> None:
    """La hora del negocio es la hora LOCAL del proceso (`timeutils.ahora()`).

    En la laptop del local eso era automatico; en la nube el host esta en UTC y
    el compose pone `TZ=America/Caracas` en el contenedor. Si por lo que sea el
    proceso amanece en UTC, el dia del negocio cerraria a las 8 pm y partiria
    las ventas de la noche en dos dias -- cierre de caja, reportes, numeracion
    de comandas y periodos de IVA quedarian mal fechados sin vuelta facil. Por
    eso se dice en el log de arranque, alto y claro.
    """
    import time

    nombre = "/".join(dict.fromkeys(time.tzname))
    desfase_h = -time.timezone / 3600
    if desfase_h == 0 and settings.ES_POSTGRES:
        log.error("ZONA HORARIA: el proceso corre en UTC (%s). El dia del negocio "
                  "cerraria a las 8 pm de Venezuela. Define TZ=America/Caracas en el "
                  "compose.", nombre)
    else:
        log.info("zona horaria del negocio: %s (UTC%+d)", nombre, int(desfase_h))


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Arranque: esquema y tablas, datos de ejemplo si la base esta vacia, y
    # respaldos. En PostgreSQL cada local vive en su propio esquema y hay que
    # crearlo antes de que `create_all` intente meter tablas en el.
    _avisar_zona_horaria()
    # El hub no toca la base: cuentas, locales y pases viven en JSON. Sin este
    # `if` le clonaba las 31 tablas del local, vacias, solo por compartir la
    # imagen.
    if not settings.ES_HUB:
        preparar_esquema()
        # Los nombres viejos se renombran ANTES de `create_all`; despues seria
        # tarde: crearia las tablas nuevas vacias y las viejas quedarian al
        # lado con los datos.
        renombrar_tablas()
        Base.metadata.create_all(bind=engine)
        aplicar_migraciones()
    _arrancar_acceso()

    # El hub no vende nada: no siembra menu, no respalda ni consulta la tasa.
    # Solo autentica y reparte pases. Todo lo demas es del panel de cada local.
    if not settings.ES_HUB:
        # El plan de cuentas va PRIMERO: el seed del inventario inicial genera
        # su asiento de apertura y necesita que las cuentas ya existan.
        with SessionLocal() as db:
            seed_plan_de_cuentas(db)
            asegurar_categoria_envios(db)
        # El menu de ejemplo solo en desarrollo. Un local real arranca vacio
        # y carga SU menu; sin esta bandera, limpiar la base para salir a
        # produccion la volvia a llenar de cafes y empanadas al reiniciar.
        if settings.SEMBRAR_DEMO:
            seed_if_empty()

        # Un respaldo al arrancar SOLO si el ultimo ya tiene sus horas encima.
        # Con un respaldo incondicional por arranque, cada corte de luz se
        # comia una copia de la retencion y la historia se evaporaba.
        if BACKUP_ON_STARTUP:
            try:
                respaldo_si_hace_falta()
            except Exception as e:
                print(f"[backup] fallo el respaldo inicial: {e}")
        iniciar_respaldos_automaticos()

        # Tasa de cambio: se refresca sola contra BCV y Binance. Si no hay
        # internet el local sigue vendiendo con la ultima tasa conocida.
        iniciar_refresco_automatico()
    yield


app = FastAPI(title="Vertigo Pro - ERP de locales de comida", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    # La cookie de sesion solo cruza origenes si se permite explicitamente, y
    # con `*` los navegadores no la mandan de todas formas. Detras de nginx el
    # front y la API comparten origen y nada de esto entra en juego.
    allow_credentials=CORS_ORIGINS != ["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Lo que se puede pedir sin sesion: las rutas del propio acceso --que son las
# que la crean-- y la salud, que la consulta Docker antes de que exista nadie.
SIN_SESION = ("/api/acceso/", "/api/health")
# Lo unico que el hub sirve. El resto ni existe ahi: el hub no tiene datos.
SOLO_HUB = ("/api/acceso/", "/api/usuarios", "/api/agencia", "/api/health")


@app.middleware("http")
async def exigir_sesion(request: Request, call_next):
    """La cerradura del backend, sobre TODAS las rutas.

    Va como middleware y no como dependencia de cada router a proposito: una
    dependencia hay que acordarse de ponerla, y el endpoint nuevo que se olvide
    queda abierto sin que nada avise. Aca la regla es al reves: todo cerrado
    salvo `SIN_SESION`, y abrir algo es una decision explicita.

    Es la segunda de dos cerraduras: nginx ya valida la cookie antes de servir
    el codigo del panel, pero nginx no es el unico camino hasta aqui (en
    desarrollo el puerto del backend esta publicado).
    """
    ruta = request.url.path
    if request.method == "OPTIONS" or ruta.startswith(SIN_SESION):
        return await call_next(request)
    if settings.ES_HUB and not ruta.startswith(SOLO_HUB):
        return JSONResponse({"detail": "No encontrado."}, status_code=404)

    galleta = request.cookies.get(auth.COOKIE_SESION)
    s = auth.datos_acceso(galleta)
    if not s:
        return JSONResponse({"detail": "Sesión requerida."}, status_code=401)
    # Con sesion valida, lo que decide es el ROL. Un cocinero no cobra.
    if not permisos.permitido(s["rol"], request.method, ruta):
        return JSONResponse({"detail": "Tu rol no tiene permiso para esto."},
                            status_code=403)
    # Para que los routers sepan quien es sin volver a leer la cookie: es lo
    # que se anota como operador en cada pedido, cierre, retiro y merma.
    request.state.sesion = s

    respuesta = await call_next(request)

    # Y SE RENUEVA AQUI, que es por donde pasa todo. El POS es una SPA: nadie
    # recarga la pagina en un turno, asi que renovar solo al cargar mandaba a
    # la cajera al login a media tarde. `conviene_renovar` acota el costo a una
    # cookie por hora y sesion, no una por peticion.
    nuevo = auth.conviene_renovar(galleta)
    if nuevo:
        auth.poner_cookie(respuesta, nuevo, request)
    return respuesta


app.include_router(acceso_router.router)
app.include_router(usuarios_router.router)
app.include_router(agencia.router)
app.include_router(menu.router)
app.include_router(operadores.router)
app.include_router(operadores.puntos)
app.include_router(pedidos.router)
app.include_router(inventario.router)
app.include_router(config.router)
app.include_router(caja.router)
app.include_router(reportes.router)
app.include_router(ventas.router)
app.include_router(respaldos.router)
app.include_router(tasas.router)
app.include_router(contabilidad_router.router)
app.include_router(compras.router)
app.include_router(proveedores.router)
app.include_router(impuestos_router.router)


@app.get("/api/health", tags=["infra"])
def health():
    """Usado por el HEALTHCHECK de Docker y por compose (depends_on)."""
    return {"status": "ok", "hub": settings.ES_HUB}


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    # El middleware HTTP no cubre los WebSockets: la cookie se comprueba aqui,
    # ANTES de aceptar. Sin esto, la cocina en tiempo real --cada comanda con
    # sus items-- se podia escuchar sin haber entrado.
    if not auth.acceso_ok(websocket.cookies.get(auth.COOKIE_SESION)):
        await websocket.close(code=1008)
        return
    await manager.connect(websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(websocket)
