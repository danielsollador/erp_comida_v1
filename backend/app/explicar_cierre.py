"""¿Por qué no cuadra la caja? (IA, 20-oct)

Al cerrar, el sistema dice CUÁNTO falta o sobra en cada forma de pago; lo que
el dueño pregunta después es POR QUÉ, y eso hoy se resuelve mirando cobro por
cobro. El 19-oct faltaban $10 en Zelle y sobraban $9,55 en el punto: casi
seguro un cobro de $10 anotado como Zelle que se pasó por el punto.

Dos capas, a propósito:
  1. `pistas`: reglas fijas sobre el desglose y los cobros del día. Son las
     que aciertan y se prueban con números exactos.
  2. `explicar`: la IA redacta esas pistas en palabras sencillas. Sin IA, se
     muestran las pistas tal cual.

SOLO EXPLICA. No cambia ningún cobro ni el cierre: señala qué pedido mirar,
y la corrección se hace donde siempre (Ventas › «Editar pago»).
"""

import logging
from typing import List, Optional

from . import lectura_facturas, schemas, settings

log = logging.getLogger("erp.cierre")

# Por debajo de esto es redondeo de la tasa, no un cobro mal puesto.
CENTIMOS = 0.10
# Cuánto se pueden parecer un faltante y un sobrante para pensar que son el
# mismo cobro en la forma equivocada: la tasa del cobro y la del cierre no son
# la misma, y $10 por el punto pueden contar $9,55.
PARECIDO_CRUCE = 0.12
# Un cobro "explica" un faltante si su monto se le parece así de cerca.
PARECIDO_COBRO = 0.06


def _d(monto: float, signo: bool = False) -> str:
    """Un monto como lo muestra el sistema: $2.685,50 (y +$0,03 con signo)."""
    texto = f"{abs(monto):,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")
    return (("+" if monto >= 0 else "-") if signo else ("-" if monto < 0 else "")) + "$" + texto


def _parecidos(a: float, b: float, tolerancia: float) -> bool:
    return abs(abs(a) - abs(b)) <= max(tolerancia * max(abs(a), abs(b)), 0.05)


def _pedidos(cobros: List[schemas.CobroDelDia]) -> List[int]:
    return sorted({c.numero for c in cobros if c.numero})


def pistas(resumen: schemas.ResumenCaja, cobros: List[schemas.CobroDelDia]) -> List[schemas.PistaCierre]:
    salida: List[schemas.PistaCierre] = []
    contadas = [l for l in resumen.desglose if l.se_cuadra and l.diferencia is not None]
    faltan = [l for l in contadas if l.diferencia <= -CENTIMOS]
    sobran = [l for l in contadas if l.diferencia >= CENTIMOS]
    por_metodo = {}
    for c in cobros:
        por_metodo.setdefault(c.metodo, []).append(c)

    if not resumen.cuadra_ventas:
        salida.append(schemas.PistaCierre(
            tipo="ventas",
            texto=f"Lo cobrado ({_d(resumen.cobrado)}) no coincide con lo que había que cobrar "
                  f"({_d(resumen.a_cobrar)}): hay un pago mal registrado en alguna venta.",
        ))

    explicados = set()
    # 1. Falta en una forma y sobra en otra casi lo mismo: un cobro en la
    #    forma equivocada.
    for f in faltan:
        for s in sobran:
            if s.metodo in explicados or not _parecidos(f.diferencia, s.diferencia, PARECIDO_CRUCE):
                continue
            candidatos = [c for c in por_metodo.get(f.metodo, []) if _parecidos(c.monto, f.diferencia, PARECIDO_COBRO)]
            texto = (
                f"Faltan {_d(-f.diferencia)} en {f.metodo} y sobran {_d(s.diferencia)} en {s.metodo}: "
                f"lo más probable es un cobro anotado como {f.metodo} que se pagó por {s.metodo}."
            )
            if candidatos:
                lista = ", ".join(f"#{c.numero} ({_d(c.monto)})" for c in candidatos[:3])
                texto += f" El candidato: {lista}. Se corrige en Ventas con «Editar pago»."
            salida.append(schemas.PistaCierre(tipo="cruce", texto=texto, pedidos=_pedidos(candidatos), monto=f.diferencia))
            explicados.update({f.metodo, s.metodo})
            break

    # 2. Un faltante sin pareja: un cobro de ese monto que pudo no entrar.
    for f in faltan:
        if f.metodo in explicados:
            continue
        candidatos = [c for c in por_metodo.get(f.metodo, []) if _parecidos(c.monto, f.diferencia, PARECIDO_COBRO)]
        if candidatos and not f.fisico:
            lista = ", ".join(f"#{c.numero} ({_d(c.monto)}{', ref. ' + c.referencia if c.referencia else ''})" for c in candidatos[:3])
            texto = (f"Faltan {_d(-f.diferencia)} en {f.metodo}, justo lo de {lista}: búscalo en el "
                     f"{'lote del punto' if f.metodo == 'Punto de venta' else 'banco'}; puede que no haya entrado.")
        elif f.fisico:
            texto = (f"Faltan {_d(-f.diferencia)} en {f.metodo}. En efectivo suele ser un vuelto que no se anotó, "
                     "un gasto o retiro sacado de la gaveta sin registrar, o billetes contados de menos.")
        else:
            texto = f"Faltan {_d(-f.diferencia)} en {f.metodo} y ningún cobro del día tiene ese monto: compara cobro por cobro con el banco."
        salida.append(schemas.PistaCierre(tipo="faltante", texto=texto, pedidos=_pedidos(candidatos), monto=f.diferencia))

    # 3. Un sobrante sin pareja.
    for s in sobran:
        if s.metodo in explicados:
            continue
        texto = (f"Sobran {_d(s.diferencia)} en {s.metodo}: puede ser un cobro de otro día, una propina "
                 "cobrada por ahí, o un pago anotado en otra forma de pago.")
        if resumen.propinas and _parecidos(resumen.propinas, s.diferencia, PARECIDO_COBRO):
            texto = f"Sobran {_d(s.diferencia)} en {s.metodo}, lo mismo que las propinas del día: quizá una propina cobrada por ahí y anotada en otra forma."
        salida.append(schemas.PistaCierre(tipo="sobrante", texto=texto, monto=s.diferencia))

    # 4. Céntimos.
    for l in contadas:
        if CENTIMOS > abs(l.diferencia) >= 0.01:
            salida.append(schemas.PistaCierre(
                tipo="centimos", monto=l.diferencia,
                texto=f"{l.metodo}: {_d(l.diferencia, True)} es redondeo de la tasa; no hay nada que buscar.",
            ))

    # 5. Referencias repetidas y cobros sin referencia, donde hay diferencia.
    con_diferencia = {l.metodo for l in faltan + sobran}
    for metodo in con_diferencia:
        repetidas = [c for c in por_metodo.get(metodo, []) if c.repetida]
        if repetidas:
            salida.append(schemas.PistaCierre(
                tipo="repetida", pedidos=_pedidos(repetidas),
                texto=f"En {metodo} hay una referencia anotada dos veces ({repetidas[0].referencia}): "
                      f"pedidos {', '.join('#' + str(c.numero) for c in repetidas)}. Uno puede ser el mismo pago dos veces.",
            ))
        sin_ref = [c for c in por_metodo.get(metodo, []) if not c.referencia and not metodo.startswith("Efectivo")]
        if sin_ref:
            salida.append(schemas.PistaCierre(
                tipo="sin_referencia", pedidos=_pedidos(sin_ref),
                texto=f"En {metodo} hay cobros sin número de referencia ({', '.join('#' + str(c.numero) for c in sin_ref[:5])}): son los primeros a revisar.",
            ))

    # 6. Lo que no se contó.
    for l in resumen.desglose:
        if l.se_cuadra and l.diferencia is None and abs(l.esperado) >= 0.01 and resumen.cerrada:
            salida.append(schemas.PistaCierre(
                tipo="sin_contar", monto=l.esperado,
                texto=f"{l.metodo} no se contó (el sistema dice {_d(l.esperado)}). Si nunca se ha contado, "
                      "arrastra el saldo de los libros: cuéntalo una vez y desde ahí arranca real.",
            ))
    return salida


INSTRUCCIONES = """Eres el asistente del cierre de caja de un negocio de comida en Venezuela.
El dueño cerró la caja y no le cuadra. Explícale en palabras sencillas qué pasó
y qué revisar, usando SOLO las pistas y los datos de abajo. Las pistas las sacó
el sistema con reglas exactas: no las contradigas ni agregues causas que no
estén ahí.

- Empieza por lo que más plata mueve.
- Nombra los pedidos por su número (#12) y los botones entre «».
- Dilo como probable, no como seguro.
- Máximo 6 líneas, de tú, sin saludo.

Desglose del día (forma de pago, debes tener, reportado, diferencia):
{desglose}

Pistas:
{pistas}"""


def explicar(resumen: schemas.ResumenCaja, cobros: List[schemas.CobroDelDia]) -> schemas.ExplicacionCierre:
    lista = pistas(resumen, cobros)
    pedidos = sorted({n for p in lista for n in p.pedidos})
    if not lista:
        return schemas.ExplicacionCierre(texto="El cierre cuadra: no hay nada que explicar.", pistas=[], pedidos=[])
    texto = None
    if lectura_facturas.lector_activo() == "gemini":
        texto = _redactar(resumen, lista)
    return schemas.ExplicacionCierre(
        texto=texto or "\n".join(p.texto for p in lista),
        con_ia=texto is not None,
        pistas=lista,
        pedidos=pedidos,
    )


def _redactar(resumen: schemas.ResumenCaja, lista: List[schemas.PistaCierre]) -> Optional[str]:
    desglose = "\n".join(
        f"- {l.metodo}: debe {_d(l.esperado)}, reportado "
        + ("sin contar" if l.contado is None else f"{_d(l.contado)}, diferencia {_d(l.diferencia, True)}")
        for l in resumen.desglose if l.se_cuadra and (abs(l.esperado) >= 0.01 or l.contado)
    )
    cuerpo = {
        "contents": [{"role": "user", "parts": [{"text": INSTRUCCIONES.format(
            desglose=desglose, pistas="\n".join(f"- {p.texto}" for p in lista),
        )}]}],
        "generationConfig": {"temperature": 0, "thinkingConfig": {"includeThoughts": True}},
    }
    modelo = settings.GEMINI_MODELO
    try:
        r = lectura_facturas._llamar(lectura_facturas.GEMINI_URL.format(modelo=modelo), cuerpo)
    except Exception as e:  # sin IA se muestran las pistas: no es un error para el dueño
        log.warning("No se pudo redactar la explicacion del cierre: %s", e)
        return None
    if r.status_code != 200:
        log.warning("Gemini %s respondio %s al explicar el cierre", modelo, r.status_code)
        return None
    partes = (r.datos.get("candidates") or [{}])[0].get("content", {}).get("parts", [])
    texto = "".join(p.get("text", "") for p in partes if not p.get("thought")).strip()
    return texto or None
