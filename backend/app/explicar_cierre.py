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
            accion="Busca en Ventas la venta cuyo cobro no suma lo que vale y corrígela con «Editar pago».",
            peso=abs(resumen.cobrado - resumen.a_cobrar),
        ))

    explicados = set()

    # 0. Lo que delata la causa sin buscar cobro por cobro (23-oct, el cierre
    #    con $2.500 de fondo y $50 contados: la explicacion repetia la tabla).
    reportado = sum((l.contado or 0) for l in contadas)
    if resumen.cantidad_pedidos == 0 and reportado >= CENTIMOS:
        salida.append(schemas.PistaCierre(
            tipo="sin_ventas", monto=reportado, peso=reportado,
            texto=f"Ese día no hay ninguna venta registrada en el sistema, pero se reportaron {_d(reportado)} al cerrar: "
                  "lo que se cobró no pasó por el punto de venta del sistema, o se registró en otro día.",
            accion="Confirma con quien estuvo en caja si se vendió sin registrar; si fue así, carga esas ventas con su fecha.",
        ))
    for l in contadas:
        # El faltante de la noche es lo mismo que sobro al abrir (o al reves):
        # el error fue el fondo tecleado en la mañana, no plata que se fue.
        # El 9-oct se abrio con $2.500 cuando habia $130 y en la noche
        # faltaron $2.369,92; la explicacion decia "un vuelto sin anotar".
        hubo_movimiento = abs(l.ventas) >= CENTIMOS or abs(l.salidas) >= CENTIMOS or abs(l.otros) >= CENTIMOS
        if (l.fisico and hubo_movimiento and abs(l.diferencia) >= 1 and abs(l.diferencia_apertura) >= 1
                and l.diferencia * l.diferencia_apertura < 0
                and abs(abs(l.diferencia) - abs(l.diferencia_apertura)) <= max(5.0, abs(l.diferencia) * 0.02)):
            salida.append(schemas.PistaCierre(
                tipo="fondo", monto=l.diferencia, peso=abs(l.diferencia) * 2,
                texto=(f"En {l.metodo} se abrió con {_d(l.diferencia_apertura, signo=True)} respecto a lo que quedó en el "
                       f"último cierre, y al cerrar {'faltan' if l.diferencia < 0 else 'sobran'} {_d(abs(l.diferencia))}: "
                       "casi el mismo monto. Lo más probable es que el fondo se tecleara mal al abrir, no que falte la plata."),
                accion="Pregunta con cuánto se abrió de verdad. Si fue el fondo, aprueba la diferencia de la apertura y la del "
                       "cierre juntas con ese motivo: se anulan entre sí y los libros no cambian.",
            ))
            explicados.add(l.metodo)
            continue
        # Contado casi en cero contra una gaveta con plata: no se conto.
        if l.fisico and l.diferencia <= -CENTIMOS and (l.contado or 0) <= 0.05 and l.esperado >= 1:
            salida.append(schemas.PistaCierre(
                tipo="casi_nada", monto=l.diferencia, peso=abs(l.diferencia) * 0.5,
                texto=f"En {l.metodo} se reportó {_d(l.contado or 0)} contra {_d(l.esperado)} que debería haber: "
                      "parece que esa gaveta no se contó, no que falte la plata.",
                accion=f"Cuenta {l.metodo} y usa «Corregir el conteo» con lo que haya de verdad.",
            ))
            explicados.add(l.metodo)
            continue
        # Falta casi todo el fondo con que se abrio, sin ventas ni salidas:
        # el fondo se anoto mal al abrir (o salio sin registrarse).
        if (l.fisico and l.fondo_declarado and l.fondo >= 1 and l.diferencia <= -CENTIMOS
                and abs(l.ventas) < CENTIMOS and abs(l.salidas) < CENTIMOS and abs(l.otros) < CENTIMOS
                and abs(-l.diferencia - (l.fondo - (l.contado or 0))) <= 0.05):
            contado = l.contado or 0
            razon = contado and l.fondo / contado
            coma = razon and any(abs(razon - p) <= p * 0.02 for p in (10, 100, 1000))
            salida.append(schemas.PistaCierre(
                tipo="fondo", monto=l.diferencia, peso=abs(l.diferencia),
                texto=(f"En {l.metodo} se abrió con {_d(l.fondo)} y al cerrar se contaron {_d(contado)}, sin ventas ni salidas "
                       "en el medio. " + (f"Es justo {razon:,.0f} veces: casi seguro la coma o un cero de más al teclear el fondo."
                                          if coma else
                                          "Lo más probable es que el fondo se tecleara mal al abrir, no que hayan sacado esa plata.")),
                accion=f"Pregunta con cuánto se abrió de verdad {l.metodo}. Si el fondo estaba mal, corrige la apertura; "
                       f"si el error fue al contar, usa «Corregir el conteo».",
            ))
            explicados.add(l.metodo)
            continue
        # Se reporto plata en el banco o el punto sin ningun cobro por ahi.
        if not l.fisico and l.diferencia >= CENTIMOS and abs(l.ventas) < CENTIMOS and abs(l.otros) < CENTIMOS:
            salida.append(schemas.PistaCierre(
                tipo="sobra_sin_cobros", monto=l.diferencia, peso=l.diferencia,
                texto=f"Se reportaron {_d(l.contado or 0)} en {l.metodo}, pero el sistema no tiene ningún cobro por {l.metodo} "
                      "ese día: o se cobró sin registrar la venta, o ese monto es de otro día (el lote de ayer).",
                accion=f"Compara con el lote o el banco de {l.metodo}: si son ventas sin registrar, cárgalas; "
                       "si es de otro día, corrige el conteo a lo de este día.",
            ))
            explicados.add(l.metodo)
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
            salida.append(schemas.PistaCierre(
                tipo="cruce", texto=texto, pedidos=_pedidos(candidatos), monto=f.diferencia, peso=abs(f.diferencia) * 1.5,
                accion=(f"Abre en Ventas el pedido {', '.join('#' + str(c.numero) for c in candidatos[:3])} y cambia la forma de pago "
                        f"con «Editar pago»." if candidatos else
                        f"Busca en Ventas un cobro de {f.metodo} por {_d(-f.diferencia)} y cámbialo a {s.metodo} con «Editar pago»."),
            ))
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
        accion = ("Busca ese cobro en el banco o el lote; si no entró, cóbralo de nuevo o anótalo como pendiente."
                  if candidatos and not f.fisico else
                  "Revisa si hubo un vuelto, un pago menor o un retiro sin anotar (Caja › «Retiros de caja») y vuelve a contar."
                  if f.fisico else "Compara cobro por cobro contra el movimiento del banco.")
        salida.append(schemas.PistaCierre(tipo="faltante", texto=texto, pedidos=_pedidos(candidatos), monto=f.diferencia,
                                          peso=abs(f.diferencia), accion=accion))

    # 3. Un sobrante sin pareja.
    for s in sobran:
        if s.metodo in explicados:
            continue
        texto = (f"Sobran {_d(s.diferencia)} en {s.metodo}: puede ser un cobro de otro día, una propina "
                 "cobrada por ahí, o un pago anotado en otra forma de pago.")
        if resumen.propinas and _parecidos(resumen.propinas, s.diferencia, PARECIDO_COBRO):
            texto = f"Sobran {_d(s.diferencia)} en {s.metodo}, lo mismo que las propinas del día: quizá una propina cobrada por ahí y anotada en otra forma."
        salida.append(schemas.PistaCierre(tipo="sobrante", texto=texto, monto=s.diferencia, peso=abs(s.diferencia),
                                          accion="Revisa si entró un cobro de otro día o una propina sin anotar."))

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
                tipo="sin_contar", monto=l.esperado, peso=0.1,
                accion=f"La próxima vez cuenta {l.metodo} al cerrar.",
                texto=f"{l.metodo} no se contó (el sistema dice {_d(l.esperado)}). Si nunca se ha contado, "
                      "arrastra el saldo de los libros: cuéntalo una vez y desde ahí arranca real.",
            ))
    salida.sort(key=lambda p: -p.peso)
    return salida


INSTRUCCIONES = """Eres quien le revisa el cierre de caja al dueño de un negocio de comida en
Venezuela: un colega que sabe de caja y va al grano. El cierre no cuadra y él ya
ve la tabla; NO se la repitas forma de pago por forma de pago. Lo que no ve es
la causa ni qué hacer.

Escribe exactamente esto, en markdown:

**Lo más probable:** una o dos frases con la causa que más plata explica y el
dato que la delata (por qué lo crees). Si dos diferencias tienen la misma causa,
júntalas.

**Qué hacer ahora:**
1. La acción más importante, concreta, con el botón entre «» (y el número de
   pedido solo si una pista lo trae; nunca inventes uno).
2. La siguiente.
(2 a 4 pasos, en orden.)

Reglas: usa SOLO las pistas de abajo (las sacó el sistema con reglas exactas;
no inventes causas ni números). Lo de céntimos o redondeo de la tasa, en media
línea al final o nada. Dilo como probable, no como seguro. De tú, sin saludo.

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
        texto=texto or _sin_ia(lista),
        con_ia=texto is not None,
        pistas=lista,
        pedidos=pedidos,
    )


def _sin_ia(lista: List[schemas.PistaCierre]) -> str:
    acciones = list(dict.fromkeys(p.accion for p in lista if p.accion))[:4]
    partes = ["**Lo más probable:** " + lista[0].texto]
    partes += [p.texto for p in lista[1:3]]
    if acciones:
        partes.append("**Qué hacer ahora:**\n" + "\n".join(f"{i}. {a}" for i, a in enumerate(acciones, 1)))
    return "\n\n".join(partes)


def _redactar(resumen: schemas.ResumenCaja, lista: List[schemas.PistaCierre]) -> Optional[str]:
    desglose = "\n".join(
        f"- {l.metodo}: debe {_d(l.esperado)}, reportado "
        + ("sin contar" if l.contado is None else f"{_d(l.contado)}, diferencia {_d(l.diferencia, True)}")
        for l in resumen.desglose if l.se_cuadra and (abs(l.esperado) >= 0.01 or l.contado)
    )
    cuerpo = {
        "contents": [{"role": "user", "parts": [{"text": INSTRUCCIONES.format(
            desglose=desglose, pistas="\n".join(f"- {p.texto}" + (f" Qué hacer: {p.accion}" if p.accion else "") for p in lista),
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
