"""Memoria por proveedor: que es de lo nuestro cada renglon de su factura.

Se aprende de lo que la persona dejo al guardar, y se propone en la proxima
foto de ese mismo proveedor. Lo delicado es distinguir una conversion de
unidad (el bulto son 20 kg) de una mala lectura corregida (decia 20, la IA
leyo 2): la primera se recuerda, la segunda no.
"""
import pytest

from app import equivalencias, models

RIF = "J-40123456-7"


@pytest.fixture()
def harina(db):
    h = models.Ingrediente(nombre="Harina", unidad="kg", costo_unitario=1.2)
    db.add(h)
    db.commit()
    return h


def aprender(client, *renglones, rif=RIF):
    r = client.post("/api/compras/equivalencias/aprender", json={
        "proveedor_rif": rif, "proveedor_nombre": "Distribuidora La Montaña", "renglones": list(renglones),
    })
    assert r.status_code == 200, r.text
    return r.json()["aprendidas"]


def buscar(client, *descripciones, rif=RIF):
    r = client.post("/api/compras/equivalencias/buscar", json={
        "proveedor_rif": rif, "renglones": [{"descripcion": d} for d in descripciones],
    })
    assert r.status_code == 200, r.text
    return r.json()


def renglon(ingrediente, descripcion="HARINA PAN BULTO", unidad="BULTO",
            cantidad_papel=2, precio_papel=30.0, cantidad=40, costo=1.5):
    return {
        "descripcion": descripcion, "unidad": unidad,
        "cantidad_papel": cantidad_papel, "precio_papel": precio_papel,
        "ingrediente_id": ingrediente.id, "cantidad": cantidad, "costo_unitario": costo,
    }


def test_la_clave_ignora_espacios_tildes_signos_y_la_marca_de_exento():
    assert equivalencias.clave("Harina P.A.N. 1 kg (E)") == equivalencias.clave("HARINA PAN 1KG")
    assert equivalencias.clave("Azúcar") == "AZUCAR"


def test_una_conversion_se_recuerda_con_su_factor(client, harina):
    """2 BULTO a $30 guardados como 40 kg a $1.50: un bulto son 20 kg."""
    assert aprender(client, renglon(harina)) == 1
    [s] = buscar(client, "HARINA PAN BULTO")
    assert s["ingrediente_id"] == harina.id and s["unidad"] == "kg"
    assert s["factor"] == 20 and s["unidad_papel"] == "BULTO"
    assert s["exacta"] is True and s["veces"] == 1


def test_sin_conversion_el_factor_es_uno(client, harina):
    aprender(client, renglon(harina, "HARINA PAN 1KG", "UND", 20, 1.1, 20, 1.1))
    assert buscar(client, "HARINA PAN 1KG")[0]["factor"] == 1


def test_una_mala_lectura_corregida_no_se_confunde_con_conversion(client, harina):
    """El papel decia 20 y la IA leyo 2; el precio estaba bien. Si esto se
    recordara como 'factor 10', las facturas siguientes de ese proveedor
    entrarian con diez veces la mercancia."""
    aprender(client, renglon(harina, "HARINA PAN 1KG", "UND", 2, 1.1, 20, 1.1))
    [s] = buscar(client, "HARINA PAN 1KG")
    assert s["ingrediente_id"] == harina.id, "la mercancia si se aprende"
    assert s["factor"] == 1


def test_una_correccion_despues_no_pisa_la_conversion_ya_aprendida(client, harina):
    aprender(client, renglon(harina))
    aprender(client, renglon(harina, cantidad_papel=3, precio_papel=30.0, cantidad=40, costo=1.5))
    [s] = buscar(client, "HARINA PAN BULTO")
    assert s["factor"] == 20 and s["veces"] == 2


def test_la_ia_no_lee_igual_dos_veces_y_aun_asi_se_encuentra(client, harina):
    aprender(client, renglon(harina, "HARINA PAN MAIZ BLANCO 1KG"))
    [s] = buscar(client, "HARINA PAN MAIS BLANCO 1KG")  # una S por una Z
    assert s["ingrediente_id"] == harina.id and s["exacta"] is False
    assert buscar(client, "QUESO BLANCO DURO") == []


def test_otra_presentacion_no_se_confunde_aunque_se_parezca(client, harina):
    """La de 2 kg tiene otra conversion: proponer la de 1 kg metia la mitad."""
    aprender(client, renglon(harina, "HARINA PAN 1KG", "UND", 20, 1.1, 20, 1.1))
    assert buscar(client, "HARINA PAN 2KG") == []


def test_es_de_ese_proveedor_y_no_de_otro(client, harina):
    aprender(client, renglon(harina))
    assert buscar(client, "HARINA PAN BULTO", rif="J-99999999-9") == []
    assert buscar(client, "HARINA PAN BULTO", rif="") == []


def test_cambiar_de_mercancia_empieza_de_cero(client, harina, db):
    maiz = models.Ingrediente(nombre="Harina de maíz", unidad="kg")
    db.add(maiz)
    db.commit()
    aprender(client, renglon(harina))
    aprender(client, renglon(harina))
    aprender(client, renglon(maiz, cantidad=2, costo=30.0))
    [s] = buscar(client, "HARINA PAN BULTO")
    assert s["ingrediente_id"] == maiz.id
    assert s["factor"] == 1 and s["veces"] == 1


def test_una_mercancia_archivada_no_se_propone(client, harina, db):
    aprender(client, renglon(harina))
    harina.activo = False
    db.commit()
    assert buscar(client, "HARINA PAN BULTO") == []


def test_dos_renglones_iguales_en_la_misma_factura_son_una_sola_fila(client, harina, db):
    aprender(client, renglon(harina), renglon(harina))
    assert db.query(models.EquivalenciaProveedor).count() == 1
    assert buscar(client, "HARINA PAN BULTO")[0]["veces"] == 2


def test_rif_invalido_o_mercancia_inexistente_no_aprende(client, harina):
    assert aprender(client, renglon(harina), rif="V123") == 0
    malo = renglon(harina)
    malo["ingrediente_id"] = 9999
    assert aprender(client, malo) == 0


def test_se_lista_y_se_olvida(client, harina):
    aprender(client, renglon(harina))
    [e] = client.get("/api/compras/equivalencias").json()
    assert e["proveedor_rif"] == "J401234567"
    assert e["proveedor_nombre"] == "Distribuidora La Montaña", "sin ficha, el nombre de la factura"
    assert e["descripcion"] == "HARINA PAN BULTO" and e["ingrediente_nombre"] == "Harina"
    assert client.delete(f"/api/compras/equivalencias/{e['id']}").status_code == 200
    assert buscar(client, "HARINA PAN BULTO") == []
    assert client.delete(f"/api/compras/equivalencias/{e['id']}").status_code == 404
