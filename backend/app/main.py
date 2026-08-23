from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from . import models
from .database import Base, engine
from .routers import caja, config, inventario, menu, pedidos, reportes
from .seed import seed_if_empty
from .ws_manager import manager

Base.metadata.create_all(bind=engine)
seed_if_empty()

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


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(websocket)
