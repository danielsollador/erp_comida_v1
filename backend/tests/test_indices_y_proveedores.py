"""Que la base no se quede sin los indices que necesita, y que el directorio
de proveedores no se duplique a si mismo."""
import sqlalchemy as sa

from app import migrations, models  # noqa: F401
from app.database import Base


def _indices(motor, tabla):
    return {i["name"] for i in sa.inspect(motor).get_indexes(tabla)}


def test_toda_clave_foranea_termina_con_indice(db):
    """PostgreSQL indexa sola la clave primaria, nunca las foraneas. Sin
    indice, cada JOIN y cada borrado del padre recorren la tabla hija
    entera."""
    motor = db.get_bind()
    migrations.indexar_claves_foraneas(motor)

    inspector = sa.inspect(motor)
    sin_indice = []
    for nombre, tabla in Base.metadata.tables.items():
        cubiertas = {i["column_names"][0] for i in inspector.get_indexes(nombre)
                     if i.get("column_names")}
        pk = inspector.get_pk_constraint(nombre).get("constrained_columns") or []
        if pk:
            cubiertas.add(pk[0])
        for fk in tabla.foreign_key_constraints:
            cols = [c.name for c in fk.columns]
            if len(cols) == 1 and cols[0] not in cubiertas:
                sin_indice.append(f"{nombre}.{cols[0]}")
    assert sin_indice == [], f"claves foraneas sin indice: {sin_indice}"


def test_indexar_claves_foraneas_es_idempotente(db):
    motor = db.get_bind()
    primera = migrations.indexar_claves_foraneas(motor)
    assert primera, "en una base recien creada hay claves foraneas que cubrir"
    assert migrations.indexar_claves_foraneas(motor) == [], "no puede crear dos veces lo mismo"
    # Y siguen la norma de nombres.
    assert all(i.startswith("IX_") for i in primera), primera


def test_los_indices_declarados_saben_a_que_tabla_pertenecen():
    """Antes la lista se saltaba entera si faltaba la tabla de pedidos, sin
    importar de que tabla fuera cada indice."""
    for fila in migrations.INDICES:
        assert len(fila) == 3, f"{fila}: falta la tabla"
        tabla, nombre, sql = fila
        assert tabla in Base.metadata.tables, tabla
        assert f'"{tabla}"' in sql, f"{nombre} no toca la tabla que dice"


# ------------------------------------------------------ proveedores repetidos

def _crear(client, nombre, rif=None):
    return client.post("/api/proveedores", json={
        "nombre": nombre, "rif": rif, "telefono": "", "direccion": "",
        "contacto": "", "nota": "",
    })


def test_no_deja_crear_dos_proveedores_con_el_mismo_nombre(client):
    """Es el problema que el directorio existe para resolver: si desde la
    propia pantalla se puede cargar "Carnes SA" dos veces, el directorio pasa
    a ser otra fuente del enredo en vez del arreglo."""
    assert _crear(client, "Carnes del Sur").status_code == 200
    r = _crear(client, "  carnes del sur ")  # mismo nombre, otro tecleo
    assert r.status_code == 409, r.text
    assert "Carnes del Sur" in r.json()["detail"]


def test_no_deja_dos_proveedores_con_el_mismo_rif(client):
    """El RIF es la identidad legal: dos proveedores con el mismo RIF son el
    mismo, se escriban como se escriban."""
    assert _crear(client, "Distribuidora A", "J-12345678").status_code == 200
    r = _crear(client, "Distribuidora A, C.A.", "J123456-78")  # mismo RIF, otro formato
    assert r.status_code == 409, r.text
    assert "Distribuidora A" in r.json()["detail"]


def test_varios_proveedores_pueden_no_tener_rif(client):
    """El RIF es opcional: el unico del indice no puede estorbar a los que aun
    no lo tienen cargado."""
    assert _crear(client, "Verduras Maria").status_code == 200
    assert _crear(client, "Panaderia Luis").status_code == 200


def test_editar_un_proveedor_no_choca_consigo_mismo(client):
    r = _crear(client, "Quesos Andinos", "J-87654321")
    pid = r.json()["id"]
    r = client.put(f"/api/proveedores/{pid}", json={
        "nombre": "Quesos Andinos", "rif": "J-87654321", "telefono": "0412",
        "direccion": "", "contacto": "", "nota": "",
    })
    assert r.status_code == 200, r.text
    assert r.json()["telefono"] == "0412"


def test_editar_hacia_un_nombre_ya_tomado_se_rechaza(client):
    _crear(client, "Pollos Centro")
    pid = _crear(client, "Pollos Norte").json()["id"]
    r = client.put(f"/api/proveedores/{pid}", json={
        "nombre": "Pollos Centro", "rif": None, "telefono": "",
        "direccion": "", "contacto": "", "nota": "",
    })
    assert r.status_code == 409, r.text


def test_el_archivado_tambien_cuenta_y_lo_dice(client):
    """Si el repetido esta archivado, crear otro igual no arregla nada: lo que
    hace falta es reactivarlo, y el mensaje tiene que decirlo."""
    pid = _crear(client, "Cafe La Montana").json()["id"]
    client.post(f"/api/proveedores/{pid}/archivar?activo=false")
    r = _crear(client, "Cafe La Montana")
    assert r.status_code == 409
    assert "archivado" in r.json()["detail"].lower(), r.json()["detail"]
