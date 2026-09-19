"""Subir la planilla llena: la otra mitad del conteo fisico.

Se descarga la planilla en blanco, el trabajador la llena en el deposito y el
archivo vuelve al ERP. Leerlo NO guarda nada: solo dice que se entendio, y el
conteo se aplica despues por el camino de siempre (`POST /conteo`), que es el
que sabe dejar cada diferencia como merma o sobrante con su asiento. Dos
caminos que escriban el conteo terminarian diciendo cosas distintas.
"""

from app import models


def subir(client, contenido: str, nombre="planilla.csv"):
    return client.post(
        "/api/inventario/conteos/leer-planilla",
        files={"archivo": (nombre, contenido.encode("utf-8-sig"), "text/csv")},
    )


def test_la_planilla_que_salio_del_erp_vuelve_a_entrar(client, insumo):
    """El viaje completo: se descarga en blanco, se llena y se sube."""
    blanco = client.get("/api/inventario/conteos/planilla").content.decode("utf-8-sig")
    lleno = blanco.replace(f"{insumo.id},Carne molida,kg,", f"{insumo.id},Carne molida,kg,7.5")

    r = subir(client, lleno)
    assert r.status_code == 200, r.text
    datos = r.json()
    assert datos["filas"] == [
        {"ingrediente_id": insumo.id, "nombre": "Carne molida", "unidad": "kg", "contado": 7.5}
    ]
    assert datos["errores"] == []


def test_leer_la_planilla_no_toca_el_stock(client, db, insumo):
    """Un archivo que entra solo dice que se entendio."""
    subir(client, f"ID,Insumo,Unidad,Contado\n{insumo.id},Carne molida,kg,3\n")
    db.expire_all()
    assert db.query(models.Ingrediente).filter_by(id=insumo.id).first().stock_actual == 10.0
    assert db.query(models.Conteo).count() == 0


def test_lo_leido_se_puede_aplicar_por_el_camino_de_siempre(client, insumo):
    """Lo que devuelve la lectura entra tal cual en `POST /conteo`."""
    leido = subir(client, f"ID,Insumo,Unidad,Contado\n{insumo.id},Carne molida,kg,6\n").json()
    r = client.post("/api/inventario/conteo", json={
        "items": [{"ingrediente_id": f["ingrediente_id"], "stock_real": f["contado"]} for f in leido["filas"]],
        "motivo": "Conteo por planilla",
        "ciego": True,
    })
    assert r.status_code == 200, r.text
    assert r.json()["ajustes"][0]["diferencia"] == -4.0


def test_ubica_el_insumo_por_nombre_si_no_viene_el_id(client, insumo):
    """Una planilla tecleada de cero no trae los ids."""
    r = subir(client, "Insumo,Contado\ncarne  MOLIDA ,4\n")
    assert r.status_code == 200, r.text
    assert r.json()["filas"][0]["ingrediente_id"] == insumo.id


def test_lee_la_coma_decimal_y_el_separador_de_miles(client, db, insumo):
    otro = models.Ingrediente(nombre="Harina", unidad="kg", stock_actual=0, costo_unitario=1.0)
    db.add(otro)
    db.commit()
    r = subir(client, f"ID,Insumo,Contado\n{insumo.id},Carne molida,\"12,5\"\n{otro.id},Harina,\"1.234,50\"\n")
    assert r.status_code == 200, r.text
    contados = {f["nombre"]: f["contado"] for f in r.json()["filas"]}
    assert contados["Carne molida"] == 12.5
    assert contados["Harina"] == 1234.5


def test_acepta_el_punto_y_coma_del_excel_en_espanol(client, insumo):
    """El mismo Excel cambia el separador segun el idioma del sistema."""
    r = subir(client, f"ID;Insumo;Unidad;Contado\n{insumo.id};Carne molida;kg;9\n")
    assert r.status_code == 200, r.text
    assert r.json()["filas"][0]["contado"] == 9.0


def test_lo_que_quedo_en_blanco_se_ignora(client, insumo):
    """Igual que en pantalla: lo que no se conto no se toca."""
    r = subir(client, f"ID,Insumo,Contado\n{insumo.id},Carne molida,\n999,Otra cosa,\n")
    assert r.status_code == 200, r.text
    assert r.json()["filas"] == []
    assert r.json()["en_blanco"] == 2


def test_un_renglon_roto_no_bota_la_planilla_entera(client, db, insumo):
    """Lo demas sirve igual; el error se dice para arreglarlo y volver."""
    otro = models.Ingrediente(nombre="Harina", unidad="kg", stock_actual=0, costo_unitario=1.0)
    db.add(otro)
    db.commit()
    r = subir(
        client,
        f"ID,Insumo,Contado\n{insumo.id},Carne molida,5\n777,Fantasma,3\n{otro.id},Harina,dos kilos\n",
    )
    assert r.status_code == 200, r.text
    datos = r.json()
    assert len(datos["filas"]) == 1 and datos["filas"][0]["contado"] == 5.0
    assert len(datos["errores"]) == 2
    assert any("Fantasma" in e for e in datos["errores"])
    assert any("no es un número" in e for e in datos["errores"])


def test_un_insumo_repetido_se_avisa_y_no_se_cuenta_dos_veces(client, insumo):
    """`POST /conteo` lo rechazaria entero; mejor decirlo aca."""
    r = subir(client, f"ID,Insumo,Contado\n{insumo.id},Carne molida,5\n{insumo.id},Carne molida,8\n")
    assert r.status_code == 200, r.text
    assert len(r.json()["filas"]) == 1
    assert any("dos veces" in e for e in r.json()["errores"])


def test_una_cantidad_negativa_se_rechaza(client, insumo):
    r = subir(client, f"ID,Insumo,Contado\n{insumo.id},Carne molida,-3\n")
    assert r.json()["filas"] == []
    assert any("negativa" in e for e in r.json()["errores"])


def test_un_archivo_sin_columna_contado_se_rechaza_con_instrucciones(client):
    r = subir(client, "Insumo,Unidad\nCarne molida,kg\n")
    assert r.status_code == 400
    assert "Contado" in r.json()["detail"]


def test_un_archivo_vacio_se_rechaza(client):
    assert subir(client, "").status_code == 400
