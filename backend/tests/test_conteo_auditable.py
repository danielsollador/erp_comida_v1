"""El conteo fisico como documento, y el extracto como algo auditable.

Los ajustes de un conteo ya dejaban rastro uno por uno (merma, sobrante,
movimiento de kardex), pero el CONTEO no existia: no habia como responder
"cuando fue el ultimo", "quien lo hizo" ni "cuanto falto ese dia" sin cruzar
tres tablas por fecha. Y el extracto de un insumo listaba movimientos sin
totalizar nada, asi que "de donde salieron los 3 kg que faltan" seguia
siendo sumar doscientas filas a ojo.
"""

import datetime

from app import kardex, models

from conftest import libros, libros_cuadrados  # noqa: F401


def contar(client, items, motivo="Conteo fisico", ciego=False):
    r = client.post("/api/inventario/conteo", json={
        "items": items, "motivo": motivo, "ciego": ciego,
    })
    assert r.status_code == 200, r.text
    return r.json()


# ── La planilla queda guardada ──────────────────────────────────────────────


def test_el_conteo_queda_como_documento(client, insumo):
    r = contar(client, [{"ingrediente_id": insumo.id, "stock_real": 8.0}])
    assert r["conteo_id"] is not None

    d = client.get(f"/api/inventario/conteos/{r['conteo_id']}").json()
    assert d["contados"] == 1
    assert len(d["lineas"]) == 1
    assert d["lineas"][0]["sistema"] == 10.0
    assert d["lineas"][0]["contado"] == 8.0
    assert d["lineas"][0]["diferencia"] == -2.0


def test_guarda_tambien_las_lineas_que_cuadraron(client, insumo):
    """Saber que un insumo se conto y dio exacto es informacion: sin ella, un
    conteo de 40 insumos con 1 diferencia se ve igual que uno de 1 insumo."""
    r = contar(client, [{"ingrediente_id": insumo.id, "stock_real": 10.0}])
    d = client.get(f"/api/inventario/conteos/{r['conteo_id']}").json()

    assert d["contados"] == 1
    assert d["cuadraron"] == 1
    assert len(d["lineas"]) == 1
    # Pero el resultado inmediato solo lista lo que cambio.
    assert r["ajustes"] == []


def test_el_historial_lista_los_conteos(client, insumo):
    contar(client, [{"ingrediente_id": insumo.id, "stock_real": 9.0}], motivo="Lunes")
    contar(client, [{"ingrediente_id": insumo.id, "stock_real": 9.0}], motivo="Martes")

    lista = client.get("/api/inventario/conteos").json()
    motivos = [c["motivo"] for c in lista]
    assert "Lunes" in motivos and "Martes" in motivos
    # Del mas reciente al mas viejo.
    assert lista[0]["fecha"] >= lista[-1]["fecha"]


def test_el_neto_es_sobrante_menos_faltante(client, db, insumo, variante):
    """Dos insumos: uno falta y el otro sobra."""
    otro = models.Ingrediente(nombre="Queso", unidad="kg", stock_actual=0,
                              costo_unitario=4.0, rendimiento_pct=100.0)
    db.add(otro)
    db.flush()
    kardex.anotar(db, otro, 10.0, kardex.AJUSTE, origen="apertura_kardex")
    db.commit()

    r = contar(client, [
        {"ingrediente_id": insumo.id, "stock_real": 9.0},   # falta 1 x $8  = -8
        {"ingrediente_id": otro.id, "stock_real": 12.0},    # sobran 2 x $4 = +8
    ])
    d = client.get(f"/api/inventario/conteos/{r['conteo_id']}").json()
    assert d["faltante_valor"] == 8.0
    assert d["sobrante_valor"] == 8.0
    assert d["neto"] == 0.0
    assert d["contados"] == 2 and d["cuadraron"] == 0


def test_el_conteo_ciego_queda_marcado(client, insumo):
    """Hay que poder distinguir despues una planilla ciega de una hecha
    mirando el numero esperado: solo la primera prueba algo."""
    r = contar(client, [{"ingrediente_id": insumo.id, "stock_real": 10.0}], ciego=True)
    assert client.get(f"/api/inventario/conteos/{r['conteo_id']}").json()["ciego"] is True

    r2 = contar(client, [{"ingrediente_id": insumo.id, "stock_real": 10.0}])
    assert client.get(f"/api/inventario/conteos/{r2['conteo_id']}").json()["ciego"] is False


def test_un_conteo_que_falla_no_deja_documento(client, insumo, db):
    """Todo o nada: si un id no existe no se toca el stock, y tampoco puede
    quedar una planilla a medias."""
    r = client.post("/api/inventario/conteo", json={
        "items": [
            {"ingrediente_id": insumo.id, "stock_real": 5.0},
            {"ingrediente_id": 99999, "stock_real": 1.0},
        ],
        "motivo": "roto",
    })
    assert r.status_code == 404
    assert db.query(models.Conteo).count() == 0
    db.expire_all()
    assert db.query(models.Ingrediente).filter_by(id=insumo.id).first().stock_actual == 10.0


def test_el_nombre_de_la_linea_queda_congelado(client, db, insumo):
    """Renombrar el insumo manana no puede reescribir la planilla que se
    firmo ayer."""
    r = contar(client, [{"ingrediente_id": insumo.id, "stock_real": 7.0}])
    ing = db.query(models.Ingrediente).filter_by(id=insumo.id).first()
    ing.nombre = "Carne molida premium"
    db.commit()

    d = client.get(f"/api/inventario/conteos/{r['conteo_id']}").json()
    assert d["lineas"][0]["nombre"] == "Carne molida"


def test_la_planilla_en_blanco_no_trae_lo_que_el_sistema_espera(client, insumo):
    """Contar con el numero esperado delante no prueba nada: el ojo acomoda
    la cifra. Por eso la planilla va sin esa columna."""
    r = client.get("/api/inventario/conteos/planilla")
    assert r.status_code == 200
    texto = r.content.decode("utf-8-sig")
    assert "Contado" in texto
    assert "Carne molida" in texto
    # El stock del sistema (10) no puede aparecer en la planilla en blanco.
    encabezado, primera = texto.splitlines()[0], texto.splitlines()[1]
    assert "Sistema" not in encabezado
    assert primera.endswith(",")  # la casilla de contado va vacia


def test_el_conteo_se_puede_exportar_ya_conciliado(client, insumo):
    r = contar(client, [{"ingrediente_id": insumo.id, "stock_real": 8.0}])
    exp = client.get(f"/api/inventario/conteos/{r['conteo_id']}/exportar")
    assert exp.status_code == 200
    texto = exp.content.decode("utf-8-sig")
    assert "Segun el sistema" in texto and "Diferencia" in texto
    assert "-2.0000" in texto


def test_el_conteo_sigue_dejando_los_libros_cuadrados(client, db, insumo, libros):
    contar(client, [{"ingrediente_id": insumo.id, "stock_real": 6.5}])
    libros_cuadrados(client, db)


# ── El extracto, ahora con totales ──────────────────────────────────────────


def test_el_extracto_separa_entradas_de_salidas_por_motivo(client, db, insumo):
    kardex.anotar(db, insumo, 5.0, kardex.COMPRA, origen="compra")
    kardex.anotar(db, insumo, -2.0, kardex.VENTA, origen="venta")
    kardex.anotar(db, insumo, -1.0, kardex.MERMA, origen="merma")
    db.commit()

    e = client.get(f"/api/inventario/ingredientes/{insumo.id}/movimientos").json()
    entradas = {f["tipo"]: f for f in e["entradas"]}
    salidas = {f["tipo"]: f for f in e["salidas"]}

    assert entradas["compra"]["cantidad"] == 5.0
    assert salidas["venta"]["cantidad"] == 2.0
    assert salidas["merma"]["cantidad"] == 1.0
    # La cantidad siempre positiva: el lado lo dice la lista en que va.
    assert all(f["cantidad"] > 0 for f in e["entradas"] + e["salidas"])


def test_un_tipo_que_va_en_los_dos_sentidos_no_se_netea(client, db, insumo):
    """Un ajuste de +5 y otro de -5 no pueden desaparecer del resumen: ese es
    justo el mes que hay que mirar."""
    kardex.anotar(db, insumo, 5.0, kardex.AJUSTE, origen="conteo")
    kardex.anotar(db, insumo, -5.0, kardex.AJUSTE, origen="conteo")
    db.commit()

    e = client.get(f"/api/inventario/ingredientes/{insumo.id}/movimientos").json()
    ajuste_entrada = [f for f in e["entradas"] if f["tipo"] == "ajuste"]
    ajuste_salida = [f for f in e["salidas"] if f["tipo"] == "ajuste"]
    # La fixture abre con un ajuste de +10, asi que la entrada suma 15.
    assert ajuste_entrada and ajuste_entrada[0]["cantidad"] == 15.0
    assert ajuste_salida and ajuste_salida[0]["cantidad"] == 5.0
    # Lo que importa: el -5 no se comio al +5 y el motivo sigue en las dos
    # listas. Neteando, "ajuste" habria desaparecido del resumen.
    assert ajuste_entrada[0]["movimientos"] == 2
    assert ajuste_salida[0]["movimientos"] == 1


def test_el_extracto_por_periodo_cuadra_inicial_mas_entradas_menos_salidas(client, db, insumo):
    """La comprobacion que hace auditable al extracto."""
    kardex.anotar(db, insumo, 4.0, kardex.COMPRA, origen="compra")
    kardex.anotar(db, insumo, -3.0, kardex.VENTA, origen="venta")
    db.commit()

    hoy = datetime.date.today()
    e = client.get(
        f"/api/inventario/ingredientes/{insumo.id}/movimientos?desde={hoy}T00:00:00"
    ).json()

    assert abs(
        e["saldo_inicial"] + e["total_entradas"] - e["total_salidas"] - e["saldo_final"]
    ) < 0.001
    assert abs(e["saldo_final"] - e["stock_actual"]) < 0.001


def test_el_periodo_deja_fuera_lo_de_antes(client, db, insumo):
    kardex.anotar(db, insumo, 7.0, kardex.COMPRA, origen="compra")
    db.commit()
    manana = datetime.date.today() + datetime.timedelta(days=1)

    e = client.get(
        f"/api/inventario/ingredientes/{insumo.id}/movimientos?desde={manana}T00:00:00"
    ).json()
    assert e["movimientos"] == []
    assert e["total_entradas"] == 0 and e["total_salidas"] == 0
    # Pero el saldo de apertura sí trae todo lo anterior: 10 de la fixture + 7.
    assert e["saldo_inicial"] == 17.0


def test_el_extracto_se_puede_exportar(client, db, insumo):
    kardex.anotar(db, insumo, -1.5, kardex.MERMA, origen="merma", nota="se quemo")
    db.commit()

    r = client.get(f"/api/inventario/ingredientes/{insumo.id}/movimientos/exportar")
    assert r.status_code == 200
    texto = r.content.decode("utf-8-sig")
    assert "Merma" in texto and "se quemo" in texto
    # Del mas viejo al mas nuevo: la apertura va antes que la merma.
    assert texto.index("Ajuste por conteo") < texto.index("Merma")
