from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from . import models
from .backup import crear_respaldo, iniciar_respaldos_automaticos
from .database import Base, engine
from .routers import caja, config, inventario, menu, pedidos, reportes, respaldos
from .seed import seed_if_empty
from .ws_manager import manager

Base.metadata.create_all(bind=engine)
seed_if_empty()

# Un respaldo apenas arranca (por si el servidor no lleva 6 horas prendido
# desde el ultimo) y luego uno automatico cada pocas horas, en segundo plano.
try:
    crear_respaldo()
except Exception as e:
    print(f"[backup] fallo el respaldo inicial: {e}")
iniciar_respaldos_automaticos()

app = FastAPI(title="ERP Venta de Comida - Nivel 1")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
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


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(websocket)
