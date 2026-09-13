from contextlib import asynccontextmanager

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from . import models  # noqa: F401  (registra las tablas en Base)
from .backup import iniciar_respaldos_automaticos, respaldo_si_hace_falta
from .contabilidad import seed_plan_de_cuentas
from .database import Base, SessionLocal, engine
from .migrations import aplicar as aplicar_migraciones
from .routers import (
    caja,
    compras,
    config,
    contabilidad as contabilidad_router,
    impuestos as impuestos_router,
    inventario,
    menu,
    pedidos,
    reportes,
    respaldos,
    tasas,
)
from .seed import seed_if_empty
from .settings import BACKUP_ON_STARTUP, CORS_ORIGINS
from .tasas import iniciar_refresco_automatico
from .ws_manager import manager


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Arranque: tablas, datos de ejemplo si la base esta vacia, y respaldos.
    Base.metadata.create_all(bind=engine)
    aplicar_migraciones()
    # El plan de cuentas va PRIMERO: el seed del inventario inicial genera su
    # asiento de apertura y necesita que las cuentas ya existan.
    with SessionLocal() as db:
        seed_plan_de_cuentas(db)
    seed_if_empty()

    # Un respaldo al arrancar SOLO si el ultimo ya tiene sus horas encima. Con
    # un respaldo incondicional por arranque, cada corte de luz se comia una
    # copia de la retencion y la historia se evaporaba sin que nadie lo viera.
    if BACKUP_ON_STARTUP:
        try:
            respaldo_si_hace_falta()
        except Exception as e:
            print(f"[backup] fallo el respaldo inicial: {e}")
    iniciar_respaldos_automaticos()

    # Tasa de cambio: se refresca sola contra BCV y Binance. Si no hay internet
    # el local sigue vendiendo con la ultima tasa conocida o con la manual.
    iniciar_refresco_automatico()
    yield


app = FastAPI(title="ERP Venta de Comida - Nivel 1", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(menu.router)
app.include_router(pedidos.router)
app.include_router(inventario.router)
app.include_router(config.router)
app.include_router(caja.router)
app.include_router(reportes.router)
app.include_router(respaldos.router)
app.include_router(tasas.router)
app.include_router(contabilidad_router.router)
app.include_router(compras.router)
app.include_router(impuestos_router.router)


@app.get("/api/health", tags=["infra"])
def health():
    """Usado por el HEALTHCHECK de Docker y por compose (depends_on)."""
    return {"status": "ok"}


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(websocket)
