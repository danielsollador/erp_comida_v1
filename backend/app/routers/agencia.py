"""La cartera de Vertigo: todos los locales, de un vistazo.

Solo lo sirve el hub y solo a Vertigo. No lee los datos de ningun local --el
hub no tiene esquema de ventas--: le pregunta a cada backend si esta vivo y
cuenta, en el archivo compartido de usuarios, quien tiene acceso a cada uno.
"""
from __future__ import annotations

import httpx
from fastapi import APIRouter, Request

from .. import locales
from ..acceso import auth, permisos, usuarios

router = APIRouter(prefix="/api/agencia", tags=["agencia"])


def _salud(interno: str) -> dict:
    """Si el backend del local responde. Dos segundos y medio de espera: la
    pantalla no puede quedarse colgada porque un local este caido."""
    if not interno:
        return {"estado": "sin_direccion", "detalle": "La ficha no declara `interno`."}
    try:
        r = httpx.get(f"{interno.rstrip('/')}/api/health", timeout=2.5)
        if r.status_code == 200:
            return {"estado": "ok", "detalle": ""}
        return {"estado": "error", "detalle": f"HTTP {r.status_code}"}
    except httpx.HTTPError as e:
        return {"estado": "caido", "detalle": type(e).__name__}


@router.get("")
def cartera(request: Request) -> dict:
    auth.exigir_vertigo(request)
    gente = usuarios.listar()
    salida = []
    for m in locales.disponibles():
        del_local = [u for u in gente
                     if not permisos.es_vertigo(u["rol"]) and m["slug"] in (u.get("locales") or [])]
        salida.append({
            **{k: m[k] for k in ("slug", "nombre", "descripcion", "color", "url",
                                 "dominio", "logo", "favicon")},
            "salud": _salud(m.get("interno", "")),
            "usuarios": len(del_local),
            "duenos": [u["usuario"] for u in del_local if u["rol"] == "dueno"],
            "por_rol": {r: sum(1 for u in del_local if u["rol"] == r)
                        for r in ("dueno", "caja", "cocina")},
        })
    return {
        "locales": salida,
        "vertigo": [u["usuario"] for u in gente if permisos.es_vertigo(u["rol"])],
        "total_usuarios": len(gente),
    }
