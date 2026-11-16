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

    async def connect(self, websocket: WebSocket, sesion: Optional[dict] = None, subprotocolo: Optional[str] = None):
        # Con el subprotocolo que eligio la app (`vp`); el navegador no manda ninguno.
        await websocket.accept(subprotocol=subprotocolo)
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
        # La cocina recibe las comandas sin montos (QA nov, permisos).
        sin_plata = None
        if event.startswith("pedido") and isinstance(data, dict) and "items" in data:
            from . import schemas
            sin_plata = json.dumps({"event": event, "data": schemas.comanda_sin_plata(data)}, default=str)
        stale = []
        for ws, sesion in list(self.active.items()):
            if filtro and not filtro(sesion):
                continue
            try:
                await ws.send_text(message if sin_plata is None or _vende(sesion) else sin_plata)
            except Exception:
                stale.append(ws)
        for ws in stale:
            self.disconnect(ws)


def _vende(sesion: dict) -> bool:
    """Sin sesion (pruebas, procesos internos) se manda completo."""
    if not sesion or not sesion.get("rol"):
        return True
    from .acceso import permisos
    return permisos.opera(sesion.get("rol"))


manager = ConnectionManager()
