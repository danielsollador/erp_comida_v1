# -*- coding: utf-8 -*-
"""Tasas de cambio reales del dia.

Portado del modulo cambiario de Vertigo Flanco y recortado a lo que necesita un
restaurante. Fuentes, en orden de autoridad:

- bcv.org.ve: USD y EUR oficiales, leidos de la fuente que los publica.
- Binance P2P: mercado USDT/VES real, mediana de ambos lados del libro. Es la
  referencia de "dolar de la calle" con la que la gente compara precios.
- DolarAPI: respaldo del USD oficial si el BCV no responde.

Cada fuente falla por separado: si se cae una, las demas siguen. Sin ninguna,
el sistema sigue operando con la ultima tasa conocida o con la que el dueno
cargue a mano, que siempre manda sobre lo automatico.
"""

import logging
import os
import re
import ssl
import threading
from datetime import datetime, timedelta

import certifi
import httpx

log = logging.getLogger("erp.rates")

BCV = "https://www.bcv.org.ve/"
BINANCE_P2P = "https://p2p.binance.com/bapi/c2c/v2/friendly/c2c/adv/search"
DOLARAPI = "https://ve.dolarapi.com/v1/dolares"
TTL = timedelta(minutes=10)

_INTERMEDIO = os.path.join(os.path.dirname(__file__), "certs", "sectigo_bcv_intermediate.pem")

_lock = threading.Lock()
_cache = {"at": None, "anclas": None}


def _contexto_bcv():
    """Contexto TLS con el intermedio que el BCV omite enviar.

    El servidor manda un intermedio que no corresponde a su emisor, asi que
    OpenSSL no puede cerrar la cadena y falla con 'unable to get local issuer'.
    curl no lo nota porque el almacen del sistema descarga el correcto via AIA.
    Aportamos ese intermedio y la cadena valida hasta la raiz, que si esta en
    certifi: la verificacion sigue activa, no se debilita nada.
    """
    ctx = ssl.create_default_context(cafile=certifi.where())
    try:
        ctx.load_verify_locations(cafile=_INTERMEDIO)
    except Exception as e:
        log.warning("No se pudo cargar el intermedio del BCV: %s", e)
    return ctx


def _num_ve(txt: str) -> float:
    """'840,85744397' -> 840.85744397 (formato es-VE, coma decimal)."""
    return float(txt.replace(".", "").replace(",", "."))


def _fetch_bcv() -> dict:
    """USD y EUR oficiales del sitio del BCV, con la cadena TLS completa."""
    with httpx.Client(
        timeout=20, verify=_contexto_bcv(), headers={"User-Agent": "Mozilla/5.0"}
    ) as client:
        r = client.get(BCV)
        r.raise_for_status()
        html = r.text

    out = {}
    for clave, div in (("bcv", "dolar"), ("eur", "euro")):
        mm = re.search(r'id="%s".{0,600}?([0-9]{1,4},[0-9]{2,10})' % div, html, re.S)
        if mm:
            out[clave] = _num_ve(mm.group(1))
    mm = re.search(r"Fecha Valor.{0,300}?(\d{1,2}\s+\w+\s+\d{4})", html, re.S)
    if mm:
        out["actualizado"] = re.sub(r"\s+", " ", mm.group(1))
    return out


def _mediana(xs):
    xs = sorted(xs)
    return xs[len(xs) // 2] if xs else None


def _fetch_binance(client: httpx.Client) -> float:
    """Mediana del libro P2P USDT/VES, promediando ambos lados.

    tradeType SELL = anuncios de quien vende USDT (tu compras).
    tradeType BUY  = anuncios de quien compra USDT (tu vendes).
    El punto medio evita quedarse con un solo lado del diferencial.
    """
    lados = []
    for tipo in ("SELL", "BUY"):
        r = client.post(
            BINANCE_P2P,
            json={
                "asset": "USDT",
                "fiat": "VES",
                "tradeType": tipo,
                "page": 1,
                "rows": 20,
                "payTypes": [],
            },
            timeout=15,
        )
        r.raise_for_status()
        precios = [float(a["adv"]["price"]) for a in (r.json().get("data") or [])]
        med = _mediana(precios)
        if med:
            lados.append(med)
    if not lados:
        raise ValueError("libro P2P vacio")
    return round(sum(lados) / len(lados), 2)


def _fetch_dolarapi(client: httpx.Client) -> float:
    r = client.get(DOLARAPI, timeout=10)
    r.raise_for_status()
    por_fuente = {d.get("fuente"): d for d in r.json()}
    return float(por_fuente["oficial"]["promedio"])


def _fetch():
    anclas = {"bcv": None, "eur": None, "paralelo": None, "actualizado": None}
    try:
        bcv = _fetch_bcv()
        anclas["bcv"] = bcv.get("bcv")
        anclas["eur"] = bcv.get("eur")
        anclas["actualizado"] = bcv.get("actualizado")
    except Exception as e:
        log.warning("BCV no respondio: %s", e)

    with httpx.Client(timeout=20, headers={"User-Agent": "Mozilla/5.0"}) as client:
        if not anclas["bcv"]:  # respaldo solo para el oficial
            try:
                anclas["bcv"] = _fetch_dolarapi(client)
                log.info("USD oficial tomado de DolarAPI (respaldo)")
            except Exception as e:
                log.warning("DolarAPI tampoco respondio: %s", e)

        try:
            anclas["paralelo"] = _fetch_binance(client)
        except Exception as e:
            log.warning("Binance P2P no respondio: %s", e)

    return anclas if anclas["bcv"] else None


def obtener_anclas(forzar: bool = False):
    """Tasas reales con cache de 10 min. None si nunca hubo conexion."""
    ahora = datetime.now()
    with _lock:
        fresco = _cache["at"] is not None and ahora - _cache["at"] < TTL
        if fresco and not forzar:
            return _cache["anclas"]
    try:
        anclas = _fetch()
    except Exception as e:
        log.warning("No se pudo obtener tasas reales: %s", e)
        anclas = None
    with _lock:
        # un fallo transitorio no borra un valor bueno anterior
        if anclas or not _cache["anclas"]:
            _cache["anclas"] = anclas
        _cache["at"] = ahora
        return _cache["anclas"]


def hay_conexion() -> bool:
    return obtener_anclas() is not None
