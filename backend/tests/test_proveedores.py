"""El directorio de proveedores.

Antes cada factura escribia el nombre del proveedor suelto, a mano: mismo
proveedor, un error de tecleo distinto en cada factura, y ninguna forma de
saber cuanto se le compro sin adivinar con cuantos nombres quedo escrito.

A proposito no es una llave foranea de la factura -eso se prueba aparte,
en test_rif.py, con el RIF de la factura tal cual se tecleo-, asi que aca
solo se prueba el directorio en si: crear, editar, archivar, y que el RIF
se valide igual que en una factura pero se acepte vacio.
"""


def test_crear_y_listar(client):
    r = client.post("/api/proveedores", json={"nombre": "Carnes SA", "rif": "J-12345678-9"})
    assert r.status_code == 200
    assert r.json()["rif"] == "J123456789", "se normaliza igual que en la factura"

    lista = client.get("/api/proveedores").json()
    assert any(p["nombre"] == "Carnes SA" for p in lista)


def test_sin_rif_se_permite(client):
    """No todo proveedor informal amerita una ficha completa."""
    r = client.post("/api/proveedores", json={"nombre": "Verduras del mercado"})
    assert r.status_code == 200
    assert r.json()["rif"] is None


def test_rif_invalido_se_rechaza_igual_que_en_una_factura(client):
    r = client.post("/api/proveedores", json={"nombre": "X", "rif": "123"})
    assert r.status_code == 400


def test_nombre_vacio_se_rechaza(client):
    r = client.post("/api/proveedores", json={"nombre": "   "})
    assert r.status_code == 400


def test_editar(client):
    p = client.post("/api/proveedores", json={"nombre": "Lacteos"}).json()
    r = client.put(f"/api/proveedores/{p['id']}", json={
        "nombre": "Lacteos del Valle", "rif": "J-99999999-0", "telefono": "0412-1234567",
    })
    assert r.status_code == 200
    assert r.json()["nombre"] == "Lacteos del Valle"
    assert r.json()["telefono"] == "0412-1234567"


def test_archivar_lo_saca_de_la_lista_de_activos(client):
    p = client.post("/api/proveedores", json={"nombre": "Temporal"}).json()
    client.post(f"/api/proveedores/{p['id']}/archivar")

    activos = client.get("/api/proveedores?activos=true").json()
    assert not any(x["id"] == p["id"] for x in activos)

    todos = client.get("/api/proveedores").json()
    assert any(x["id"] == p["id"] and not x["activo"] for x in todos)


def test_reactivar(client):
    p = client.post("/api/proveedores", json={"nombre": "Temporal2"}).json()
    client.post(f"/api/proveedores/{p['id']}/archivar")
    r = client.post(f"/api/proveedores/{p['id']}/archivar?activo=true")
    assert r.json()["activo"] is True


def test_editar_uno_que_no_existe_da_404(client):
    assert client.put("/api/proveedores/99999", json={"nombre": "X"}).status_code == 404
