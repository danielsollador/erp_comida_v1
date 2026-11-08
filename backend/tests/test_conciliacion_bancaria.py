"""Conciliacion bancaria en Contabilidad (23-oct), estilo Odoo: el estado de
cuenta se guarda, los cobros se reconocen solos, las reglas proponen la
cuenta de lo que se repite y «Registrar» lo asienta a la tasa del dia."""
import pytest

from app import models, settings
from app.acceso import usuarios
from app.timeutils import ahora
from tests.conftest import entrar, saldo
from tests.test_cierre_resumen import vender

TASA = 200.0
CAJERA = ("cajera-conciliacion", "clave-de-cajera-larga")


@pytest.fixture(scope="module", autouse=True)
def _cajera():
    try:
        usuarios.crear(*CAJERA, rol="caja", locales=[settings.LOCAL_SLUG])
    except usuarios.ErrorUsuarios:
        pass


@pytest.fixture()
def tasa_de_hoy(db):
    hoy = ahora().date()
    if db.get(models.TasaCambio, hoy) is None:
        db.add(models.TasaCambio(fecha=hoy, bcv=TASA))
        db.commit()
    return hoy


def _csv(hoy, filas):
    texto = "Fecha;Concepto;Referencia;Monto\n" + "".join(f"{hoy:%d/%m/%Y};{c};{r};{m}\n" for c, r, m in filas)
    return texto.encode("utf-8")


ESTADO = [
    ("PAGO MOVIL RECIBIDO 009988884512", "884512", "1000,00"),
    ("COMIS. CR.I OB", "", "-3,00"),
    ("COMIS. CR.I OB", "", "-3,00"),
    ("COMIS. CR.I OB", "", "-4,00"),
    ("TRASP. DESCONOCIDO", "", "750,00"),
]


def _subir(cliente, contenido, nombre="edo.csv"):
    return cliente.post("/api/contabilidad/conciliacion/extractos", files={"archivo": (nombre, contenido, "text/csv")})


def _vender_pago_movil(client, db, variante, referencia):
    p = vender(client, variante, "Pago movil")  # $5
    pedido = db.get(models.Pedido, p["id"])
    pedido.tasa_bcv = TASA
    pedido.pagos[0].referencia = referencia
    db.commit()
    return p


def test_sube_cruza_los_cobros_y_sugiere_reglas(client, db, variante, tasa_de_hoy):
    p = _vender_pago_movil(client, db, variante, "884512")
    r = _subir(client, _csv(tasa_de_hoy, ESTADO))
    assert r.status_code == 200, r.text
    d = r.json()
    por_estado = {e["estado"]: e["movimientos"] for e in d["resumen"]}
    assert por_estado["cobro"] == 1 and por_estado["pendiente"] == 4
    cobro = next(l for l in d["lineas"] if l["estado"] == "cobro")
    assert cobro["pedidos"] == [p["numero"]]
    [s] = d["sugerencias"]
    assert (s["contiene"], s["sentido"], s["veces"], s["cuenta"]) == ("COMIS", "cargo", 3, "6070")


def test_la_regla_propone_y_registrar_asienta_a_la_tasa_del_dia(client, db, tasa_de_hoy):
    d = _subir(client, _csv(tasa_de_hoy, ESTADO)).json()
    banco_antes = saldo(db, "1020")
    r = client.post("/api/contabilidad/conciliacion/reglas",
                    json={"nombre": "Comisiones", "contiene": "comis", "sentido": "cargo", "cuenta": "6070"})
    assert r.status_code == 200, r.text
    d = client.get(f"/api/contabilidad/conciliacion/extractos/{d['id']}").json()
    propuestas = [l for l in d["lineas"] if l["estado"] == "propuesta"]
    assert len(propuestas) == 3 and all(l["cuenta"] == "6070" for l in propuestas)

    d = client.post(f"/api/contabilidad/conciliacion/extractos/{d['id']}/registrar", json={}).json()
    registradas = [l for l in d["lineas"] if l["estado"] == "registrado"]
    assert len(registradas) == 3
    # Cada movimiento a su centavo: Bs 3 a 200 son $0,015 -> $0,01 o $0,02.
    usd = round(sum(l["monto_usd"] for l in registradas), 2)
    assert 0.04 <= usd <= 0.06
    assert saldo(db, "1020") == pytest.approx(banco_antes - usd, abs=0.001), "lo registrado sale del banco"
    assert saldo(db, "6070") == pytest.approx(usd, abs=0.001)


def test_el_mismo_estado_dos_veces_no_duplica(client, tasa_de_hoy):
    assert _subir(client, _csv(tasa_de_hoy, ESTADO)).status_code == 200
    r = _subir(client, _csv(tasa_de_hoy, ESTADO))
    assert r.status_code == 422 and "ya estaba cargado" in r.json()["detail"]


def test_a_mano_a_una_cuenta_o_ignorado_y_la_regla_borrada_devuelve_lo_propuesto(client, db, tasa_de_hoy):
    d = _subir(client, _csv(tasa_de_hoy, ESTADO)).json()
    trasp = next(l for l in d["lineas"] if "DESCONOCIDO" in l["concepto"])
    d = client.post(f"/api/contabilidad/conciliacion/lineas/{trasp['id']}", json={"accion": "cuenta", "cuenta": "3010"}).json()
    assert next(l for l in d["lineas"] if l["id"] == trasp["id"])["estado"] == "propuesta"
    d = client.post(f"/api/contabilidad/conciliacion/lineas/{trasp['id']}", json={"accion": "ignorar"}).json()
    assert next(l for l in d["lineas"] if l["id"] == trasp["id"])["estado"] == "ignorado"

    regla = client.post("/api/contabilidad/conciliacion/reglas",
                        json={"contiene": "COMIS", "sentido": "cargo", "cuenta": "6070"}).json()
    client.delete(f"/api/contabilidad/conciliacion/reglas/{regla['id']}")
    d = client.get(f"/api/contabilidad/conciliacion/extractos/{d['id']}").json()
    assert all(l["estado"] == "pendiente" for l in d["lineas"] if "COMIS" in l["concepto"])


def test_no_se_quita_un_estado_con_asientos(client, tasa_de_hoy):
    d = _subir(client, _csv(tasa_de_hoy, ESTADO)).json()
    client.post("/api/contabilidad/conciliacion/reglas", json={"contiene": "COMIS", "sentido": "cargo", "cuenta": "6070"})
    client.post(f"/api/contabilidad/conciliacion/extractos/{d['id']}/registrar", json={})
    r = client.delete(f"/api/contabilidad/conciliacion/extractos/{d['id']}")
    assert r.status_code == 422


def test_sin_tasa_del_dia_no_registra(client, db):
    viejo = "Fecha;Concepto;Monto\n01/01/2020;COMIS. CR.I OB;-3,00\n".encode()
    d = _subir(client, viejo).json()
    client.post("/api/contabilidad/conciliacion/reglas", json={"contiene": "COMIS", "sentido": "cargo", "cuenta": "6070"})
    r = client.post(f"/api/contabilidad/conciliacion/extractos/{d['id']}/registrar", json={})
    assert r.status_code == 422 and "tasa" in r.json()["detail"]


def test_la_cajera_no_entra(fuera, tasa_de_hoy):
    cajera = entrar(fuera, *CAJERA)
    assert cajera.get("/api/contabilidad/conciliacion").status_code == 403
