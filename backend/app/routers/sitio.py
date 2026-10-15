"""El formulario "Pide una demo" del sitio publico (vertigopro.tech).

Es la UNICA ruta que escribe sin sesion, asi que va con tres cuidados:

  * limite por IP (5 por hora) y un campo trampa (`sitio_web`) que una persona
    nunca ve y un robot llena: a ese se le contesta "listo" y no se manda nada;
  * cada solicitud se anota PRIMERO en `solicitudes-demo.jsonl` (en DATA_DIR),
    y solo despues se manda el correo: si Gmail falla, el contacto no se pierde;
  * el correo sale por SMTP con una clave de aplicacion (`SMTP_USUARIO`,
    `SMTP_CLAVE`); `Reply-To` es el correo de quien pide, para responderle con
    un clic. Sin clave configurada, responde 503 y el sitio ofrece WhatsApp.
"""
from __future__ import annotations

import json
import logging
import os
import re
import smtplib
import ssl
import threading
import time
from datetime import datetime
from email.message import EmailMessage
from email.utils import formataddr

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field, field_validator

from .. import settings
from ..acceso import auth

log = logging.getLogger(__name__)
router = APIRouter(prefix="/api/sitio", tags=["sitio"])

EMPLEADOS = ("1 a 5", "6 a 15", "16 a 50", "Más de 50")
TIPOS = (
    "Restaurante o comida rápida",
    "Panadería, pastelería o café",
    "Licorería o bodega",
    "Tienda o retail",
    "Producción o distribución",
    "Otro",
)
_CORREO = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]{2,}$")
_ARCHIVO = os.path.join(settings.DATA_DIR, "solicitudes-demo.jsonl")
_lock = threading.Lock()
_envios: dict[str, list[float]] = {}  # IP -> horas de sus envios, ultima hora
LIMITE, VENTANA = 5, 3600


def _limpio(v: str) -> str:
    # Una sola linea: nada de saltos que se cuelen en el asunto del correo.
    return re.sub(r"\s+", " ", v or "").strip()


class SolicitudDemo(BaseModel):
    nombre: str = Field(max_length=80)
    negocio: str = Field(max_length=120)
    telefono: str = Field(max_length=30)
    correo: str = Field(max_length=120)
    empleados: str
    tipo: str
    mensaje: str = Field(default="", max_length=1500)
    sitio_web: str = Field(default="", max_length=200)  # la trampa

    @field_validator("nombre", "negocio")
    @classmethod
    def _requerido(cls, v: str) -> str:
        v = _limpio(v)
        if len(v) < 2:
            raise ValueError("Escribe al menos dos letras.")
        return v

    @field_validator("telefono")
    @classmethod
    def _telefono(cls, v: str) -> str:
        v = _limpio(v)
        if not 10 <= len(re.sub(r"\D", "", v)) <= 15:
            raise ValueError("Escribe el número con su código de área.")
        return v

    @field_validator("correo")
    @classmethod
    def _correo(cls, v: str) -> str:
        v = _limpio(v).lower()
        if not _CORREO.match(v):
            raise ValueError("Ese correo no parece válido.")
        return v

    @field_validator("empleados")
    @classmethod
    def _empleados(cls, v: str) -> str:
        if v not in EMPLEADOS:
            raise ValueError("Elige un rango.")
        return v

    @field_validator("tipo")
    @classmethod
    def _tipo(cls, v: str) -> str:
        if v not in TIPOS:
            raise ValueError("Elige el tipo de negocio.")
        return v

    @field_validator("mensaje")
    @classmethod
    def _mensaje(cls, v: str) -> str:
        return (v or "").strip()


def _limitar(ip: str) -> None:
    # Cubo propio: el de `auth.rate_limit` es el del login y se mezclarian.
    ahora = time.time()
    with _lock:
        recientes = [t for t in _envios.get(ip, []) if ahora - t < VENTANA]
        if len(recientes) >= LIMITE:
            raise HTTPException(429, "Ya recibimos varias solicitudes desde aquí en la última hora.")
        recientes.append(ahora)
        _envios[ip] = recientes
        if len(_envios) > 2000:
            for k in [k for k, v in _envios.items() if not v or ahora - v[-1] > VENTANA]:
                _envios.pop(k, None)


def _anotar(datos: dict) -> None:
    with _lock, open(_ARCHIVO, "a", encoding="utf-8") as f:
        f.write(json.dumps(datos, ensure_ascii=False) + "\n")


def _enviar(s: SolicitudDemo) -> None:
    usuario = os.getenv("SMTP_USUARIO", "").strip()
    clave = os.getenv("SMTP_CLAVE", "").replace(" ", "").strip()
    if not usuario or not clave:
        raise RuntimeError("SMTP sin configurar (SMTP_USUARIO / SMTP_CLAVE)")
    destino = os.getenv("DEMO_DESTINO", "").strip() or "leideriverson@gmail.com"

    m = EmailMessage()
    m["Subject"] = f"Demo de Vertigo Pro: {s.negocio} ({s.nombre})"
    m["From"] = formataddr(("Vertigo Pro · sitio", usuario))
    m["To"] = destino
    m["Reply-To"] = formataddr((s.nombre, s.correo))
    wa = re.sub(r"\D", "", s.telefono)
    m.set_content(
        "Nueva solicitud de demo desde vertigopro.tech\n\n"
        f"Nombre:     {s.nombre}\n"
        f"Negocio:    {s.negocio}\n"
        f"Tipo:       {s.tipo}\n"
        f"Empleados:  {s.empleados}\n"
        f"Teléfono:   {s.telefono}  (WhatsApp: https://wa.me/{wa})\n"
        f"Correo:     {s.correo}\n\n"
        f"Mensaje:\n{s.mensaje or '(sin mensaje)'}\n\n"
        "Responde a este correo y le llega a quien lo pidió.\n"
    )
    host = os.getenv("SMTP_HOST", "smtp.gmail.com")
    puerto = int(os.getenv("SMTP_PUERTO", "465"))
    with smtplib.SMTP_SSL(host, puerto, context=ssl.create_default_context(), timeout=20) as c:
        c.login(usuario, clave)
        c.send_message(m)


@router.post("/demo")
def pedir_demo(body: SolicitudDemo, request: Request):
    ip = auth._ip_cliente(request)
    _limitar(ip)
    if body.sitio_web:
        return {"ok": True}
    datos = body.model_dump(exclude={"sitio_web"})
    datos["fecha"] = datetime.now().isoformat(timespec="seconds")
    datos["ip"] = ip
    try:
        _anotar(datos)
    except OSError:
        log.exception("No se pudo anotar la solicitud de demo")
    try:
        _enviar(body)
    except Exception:
        log.exception("No se pudo mandar el correo de la solicitud de demo")
        raise HTTPException(503, "No pudimos enviar tu solicitud.")
    return {"ok": True}
