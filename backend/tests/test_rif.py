"""El RIF del proveedor deja de ser opcional en el Libro de Compras.

Sin RIF, la declaracion al SENIAT queda incompleta. No se valida el digito
verificador -eso es trabajo del SENIAT, no de este ERP- pero un campo vacio o
con formato claramente invalido ya no puede pasar.
"""

from app import impuestos


def factura(client, rif=None, **extra):
    cuerpo = {
        "numero_factura": "F-RIF-1", "proveedor_nombre": "Proveedor de prueba",
        "categoria": "Insumos", "forma_pago": "Efectivo",
        "base_imponible": 100.0, "iva": 16.0,
    }
    if rif is not None:
        cuerpo["proveedor_rif"] = rif
    cuerpo.update(extra)
    return client.post("/api/compras/facturas", json=cuerpo)


def test_sin_rif_no_se_puede_cargar(client):
    r = factura(client, rif="")
    assert r.status_code == 400
    assert "RIF" in r.json()["detail"]


def test_rif_demasiado_corto_no_pasa(client):
    r = factura(client, rif="V123")
    assert r.status_code == 400


def test_rif_con_letra_invalida_no_pasa(client):
    r = factura(client, rif="X12345678")
    assert r.status_code == 400


def test_rif_valido_con_guiones_se_acepta_y_se_normaliza(client):
    r = factura(client, rif="J-12345678-9")
    assert r.status_code == 200
    assert r.json()["proveedor_rif"] == "J123456789"


def test_rif_sin_guiones_tambien_se_acepta(client):
    r = factura(client, rif="V123456789")
    assert r.status_code == 200


def test_no_mandar_el_campo_tambien_se_rechaza(client):
    r = factura(client)  # sin la clave proveedor_rif en absoluto
    assert r.status_code in (400, 422)


def test_validador_reconoce_los_seis_tipos_de_contribuyente():
    for letra in "VEJGPC":
        assert impuestos.rif_valido(f"{letra}123456789")
    assert not impuestos.rif_valido("A123456789")


def test_normalizar_quita_espacios_y_guiones_y_pone_mayusculas():
    assert impuestos.normalizar_rif(" j - 12345678 - 9 ") == "J123456789"


# ------------------------------------------------- digito verificador (aviso)

from app import impuestos  # noqa: E402


def test_el_digito_verificador_cuadra_con_rif_reales():
    """Diez RIF de facturas reales de proveedores. Si el calculo estuviera mal,
    avisaria de mas sobre proveedores legitimos."""
    for rif in ["J-40223513-5", "J-50115655-7", "J-40909890-7", "J-31366229-1", "J-50269191-0",
                "J-41247314-0", "J-00020200-1", "J-41002396-1", "J-50484227-3", "J-00010791-2"]:
        assert impuestos.rif_digito_ok(rif) is True, rif


def test_un_digito_mal_leido_se_nota():
    """Los tres errores que cometio la lectura con IA en facturas reales."""
    assert impuestos.rif_digito_ok("J-41247314-8") is False
    assert impuestos.rif_digito_ok("J-40908990-7") is False


def test_cuando_no_se_puede_decir_no_se_dice():
    assert impuestos.rif_digito_ok("J-12345678") is None, "sin digito verificador"
    assert impuestos.rif_digito_ok("C-12345678-9") is None, "letra sin valor seguro"
    assert impuestos.rif_digito_ok("") is None
    assert impuestos.rif_digito_ok("V123") is None
