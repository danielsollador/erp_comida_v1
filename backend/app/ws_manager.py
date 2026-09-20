import json
from typing import Callable, Dict, Optional

from fastapi import WebSocket


class ConnectionManager:
    """Las pestañas conectadas, cada una con la sesion de quien la abrio.

    La sesion viaja con la conexion para poder avisar SOLO a quien toca: una
    solicitud de autorizacion le llega al dueño y no a la pantalla de cocina.
    Lo demas (comandas nuevas, pedidos cobrados) sigue siendo para todos.
    """

    def __init__(self):
        self.active: Dict[WebSocket, dict] = {}

    async def connect(self, websocket: WebSocket, sesion: Optional[dict] = None):
        await websocket.accept()
        self.active[websocket] = sesion or {}

    def disconnect(self, websocket: WebSocket):
        self.active.pop(websocket, None)

    def cuantos(self, filtro: Optional[Callable[[dict], bool]] = None) -> int:
        """Cuantas conexiones cumplen `filtro`. Personas distintas, no
        pestañas: el dueño con dos pestañas abiertas es uno."""
        vistos = set()
        for sesion in self.active.values():
            if filtro and not filtro(sesion):
                continue
            vistos.add(sesion.get("usuario") or id(sesion))
        return len(vistos)

    async def broadcast(
        self, event: str, data: dict, filtro: Optional[Callable[[dict], bool]] = None
    ):
        message = json.dumps({"event": event, "data": data}, default=str)
        stale = []
        for ws, sesion in list(self.active.items()):
            if filtro and not filtro(sesion):
                continue
            try:
                await ws.send_text(message)
            except Exception:
                stale.append(ws)
        for ws in stale:
            self.disconnect(ws)


manager = ConnectionManager()
