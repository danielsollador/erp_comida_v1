"""Conciliar el banco (22-oct). Estados de cuenta inventados, con el formato
del Provincial (texto del PDF) y un CSV genérico."""
import datetime

from app import conciliacion as c, models
from app.timeutils import ahora
from tests.test_cierre_resumen import vender

TASA = 200.0


def _cobrar(client, db, variante, metodo, referencia="", bs=None):
    p = vender(client, variante, metodo)  # $5
    pedido = db.get(models.Pedido, p["id"])
    pedido.tasa_bcv = TASA
    pago = pedido.pagos[0]
    pago.referencia = referencia
    pago.monto_bs = bs
    db.commit()
    return p


def _provincial(renglones, saldo=10000.0):
    """Texto como el que saca pypdf: ref, concepto, fecha, monto sin signo, fecha, saldo."""
    lineas = ["DETALLE DE MOVIMIENTOS", f"SALDO ANTERIOR {saldo:,.2f}"]
    for i, (fecha, concepto, monto) in enumerate(renglones):
        saldo += monto
        f = fecha.strftime("%d-%m-%Y")
        lineas.append(f"{138000 + i} {concepto}{f} {abs(monto):,.2f}{f} {saldo:,.2f}")
    return "\n".join(lineas)


def test_el_pdf_del_provincial_saca_el_signo_del_saldo():
    hoy = datetime.date(2026, 4, 1)
    l = c.leer_provincial(_provincial([(hoy, "CR.I/REC 0105 J000 1234", 1500.0), (hoy, "COMIS. CR.I OB", -4.5)]))
    assert [m.monto for m in l.movimientos] == [1500.0, -4.5]
    assert l.descuadres == 0


def test_un_renglon_perdido_se_nota():
    hoy = datetime.date(2026, 4, 1)
    texto = _provincial([(hoy, "A", 100.0), (hoy, "B", 50.0), (hoy, "C", 25.0)])
    sin_b = "\n".join(l for l in texto.splitlines() if not l.startswith("138001 "))
    assert c.leer_provincial(sin_b).descuadres == 1


def test_numeros_en_los_dos_formatos():
    assert c.numero("1,234.56") == 1234.56
    assert c.numero("1.234,56") == 1234.56
    assert c.numero("-12,5") == -12.5
    assert c.numero("(30.00)") == -30.0


def test_cruza_pago_movil_punto_y_deja_a_la_vista_lo_que_falta(client, db, variante):
    hoy = ahora().date()
    llego = _cobrar(client, db, variante, "Pago movil", referencia="884512")      # Bs 1.000
    no_llego = _cobrar(client, db, variante, "Pago movil", referencia="11223344")  # Bs 1.000, no esta en el banco...
    no_llego_pedido = db.get(models.Pedido, no_llego["id"])
    no_llego_pedido.pagos[0].monto_bs = 1200.0  # ...por otro monto: no se confunde con el primero
    db.commit()
    _cobrar(client, db, variante, "Punto de venta")
    _cobrar(client, db, variante, "Punto de venta")  # Bs 2.000 en el punto
    l = c.leer_provincial(_provincial([
        (hoy, "CR.I/REC 0105 J000 009988884512", 1000.0),
        (hoy, "CR.I/OB 4637 DESCONOCIDO 0134", 750.0),  # nadie lo cobro
        (hoy + datetime.timedelta(days=1), "TD POS J000111", 1500.0),
        (hoy + datetime.timedelta(days=1), "TC POS J000111", 499.5),
        (hoy, "COMIS. CR.I OB", -3.0),
    ]))
    r = c.conciliar(db, l)
    [par] = r.conciliados
    assert par.cobro.numero == llego["numero"] and par.por_referencia
    assert [x.numero for x in r.sin_banco] == [no_llego["numero"]]
    assert [m.monto for m in r.sin_sistema] == [750.0]
    [dia] = r.puntos
    assert (dia.sistema_bs, dia.banco_bs, dia.lotes) == (2000.0, 1999.5, 2)
    assert dia.fecha_banco == hoy + datetime.timedelta(days=1), "el lote se abona al día siguiente"
    assert r.comisiones_bs == 3.0


def test_la_referencia_desempata_entre_dos_del_mismo_monto(client, db, variante):
    hoy = ahora().date()
    a = _cobrar(client, db, variante, "Transferencia", referencia="5555")
    b = _cobrar(client, db, variante, "Transferencia", referencia="7777")
    l = c.leer_provincial(_provincial([(hoy, "CR.I/OB 00117777 X 0102", 1000.0), (hoy, "CR.I/OB 00115555 Y 0102", 1000.0)]))
    r = c.conciliar(db, l)
    por = {p.cobro.numero: p.movimiento.concepto for p in r.conciliados}
    assert "5555" in por[a["numero"]] and "7777" in por[b["numero"]]


def test_un_csv_cualquiera(client, db, variante):
    hoy = ahora().date()
    p = _cobrar(client, db, variante, "Pago movil", bs=1003.0)
    csv = (
        "Banco X - movimientos\n"
        "Fecha;Descripción;Referencia;Débito;Crédito;Saldo\n"
        f"{hoy:%d/%m/%Y};PAGO MOVIL RECIBIDO;9911;;1.003,00;5.000,00\n"
        f"{hoy:%d/%m/%Y};COMISION;;2,00;;4.998,00\n"
    ).encode("utf-8")
    r = c.conciliar(db, c.leer("movimientos.csv", csv))
    assert [x.cobro.numero for x in r.conciliados] == [p["numero"]]
    assert r.comisiones_bs == 2.0


def test_la_ruta_lee_y_no_guarda(client, db, variante):
    hoy = ahora().date()
    _cobrar(client, db, variante, "Pago movil")
    archivo = f"Fecha,Concepto,Monto\n{hoy:%Y-%m-%d},PAGO MOVIL,1000.00\n".encode()
    r = client.post("/api/caja/conciliar", files={"archivo": ("edo.csv", archivo, "text/csv")})
    assert r.status_code == 200, r.text
    assert len(r.json()["conciliados"]) == 1
    malo = client.post("/api/caja/conciliar", files={"archivo": ("edo.csv", b"hola\nmundo\n", "text/csv")})
    assert malo.status_code == 422 and "columnas" in malo.json()["detail"]
