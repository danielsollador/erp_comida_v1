"""Los locales que este despliegue conoce.

Cada local es un JSON en `locales/<slug>.json` con su nombre, su marca (logo y
favicon, servidos por nginx sin sesion) y sus direcciones: la de desarrollo
(`url`, localhost), la de produccion (`dominio`, el subdominio) y la interna
(`interno`, como llega el hub a su backend dentro de Docker). Se lee del disco
en cada llamada: son archivos pequeños, y asi agregar un local es dejar caer
un JSON sin reiniciar nada.

Fuera de Docker, si no hay carpeta, el panel sigue andando con una ficha
minima: el ERP de un solo local no puede depender de esto para arrancar.
"""
from __future__ import annotations

import json
from pathlib import Path

from . import settings


def _normalizar(m: dict, slug_por_defecto: str) -> dict:
    return {
        "slug": m.get("slug", slug_por_defecto),
        "nombre": m.get("nombre", slug_por_defecto),
        "descripcion": m.get("descripcion", ""),
        "color": m.get("color", "#171717"),
        "url": m.get("url", ""),
        "dominio": m.get("dominio", ""),
        "interno": m.get("interno", ""),
        "logo": m.get("logo", ""),
        "favicon": m.get("favicon", ""),
    }


def disponibles() -> list[dict]:
    carpeta = Path(settings.LOCALES_DIR)
    salida = []
    if not carpeta.is_dir():
        return salida
    for ruta in sorted(carpeta.glob("*.json")):
        try:
            m = json.loads(ruta.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        salida.append(_normalizar(m, ruta.stem))
    return salida


def actual() -> dict:
    """La ficha del local que sirve ESTE panel."""
    slug = settings.LOCAL_SLUG
    for m in disponibles():
        if m["slug"] == slug:
            return m
    return _normalizar({"slug": slug, "nombre": slug.replace("-", " ").title()}, slug)


def por_slug(slug: str) -> dict | None:
    return next((m for m in disponibles() if m["slug"] == slug), None)


def base_para(local: dict, host: str) -> str:
    """A que direccion mandar a alguien hacia este local, segun desde donde
    llega. Viendo el hub en localhost se va a la `url` de desarrollo; en
    produccion, al `dominio`. Sin dominio se cae a la url antes que dejar el
    enlace muerto."""
    host = (host or "").split(":")[0].lower()
    en_local = host in ("localhost", "127.0.0.1", "[::1]", "")
    base = (local.get("url") if en_local else (local.get("dominio") or local.get("url"))) or ""
    return base.rstrip("/")
