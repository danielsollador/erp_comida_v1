from contextlib import asynccontextmanager

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from . import models  # noqa: F401  (registra las tablas en Base)
from .backup import crear_respaldo, iniciar_respaldos_automaticos
from .contabilidad import seed_plan_de_cuentas
from .database import Base, SessionLocal, engine
from .migrations import aplicar as aplicar_migraciones
from .routers import (
    caja,
    config,
    contabilidad as contabilidad_router,
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
    seed_if_empty()
    with SessionLocal() as db:
        seed_plan_de_cuentas(db)

    # Un respaldo apenas arranca (por si el servidor no lleva 6 horas prendido
    # desde el ultimo) y luego uno automatico cada pocas horas, en background.
    if BACKUP_ON_STARTUP:
        try:
            crear_respaldo()
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
