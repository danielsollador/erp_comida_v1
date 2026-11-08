"""Alertas que se explican (21-oct): merma rara, precio que sube, referencia
repetida. Cada una tiene que decir el por qué con los números del caso."""
import datetime

from app import alertas_explicadas as alertas, models
from app.timeutils import ahora
from tests.test_cierre_resumen import vender


def merma(db, insumo, cantidad, dias, motivo=""):
    db.add(models.Merma(ingrediente_id=insumo.id, cantidad=cantidad, motivo=motivo,
                        fecha=ahora() - datetime.timedelta(days=dias)))
    db.commit()


def compra(db, insumo, costo, dias, proveedor="Carnes SA", cantidad=10):
    f = models.FacturaCompra(numero_factura=f"F-{dias}", proveedor_nombre=proveedor, base_imponible=costo * cantidad,
                             fecha=ahora() - datetime.timedelta(days=dias))
    db.add(f)
    db.flush()
    db.add(models.FacturaCompraItem(factura_id=f.id, ingrediente_id=insumo.id, cantidad=cantidad, costo_unitario=costo))
    db.commit()


def test_una_merma_muy_por_encima_de_lo_normal_se_explica(db, insumo):
    for dias in (20, 30, 40):
        merma(db, insumo, 0.5, dias)
    merma(db, insumo, 5, 1, motivo="se quemó")  # 10 veces lo normal, $40
    a = alertas.merma_rara(db)
    assert a is not None
    assert "10 veces" in a.titulo and "Carne molida" in a.titulo
    assert "«se quemó»" in a.por_que and "0,5 kg" in a.por_que
    assert "Revertir" in a.que_hacer
    assert a.a == "/inventario/control"


def test_sin_historia_o_dentro_de_lo_normal_no_se_avisa(db, insumo):
    merma(db, insumo, 5, 1)
    assert alertas.merma_rara(db) is None, "sin historia no hay 'lo normal'"
    for dias in (20, 30, 40):
        merma(db, insumo, 4, dias)
    assert alertas.merma_rara(db) is None, "5 kg cuando siempre son 4 es normal"


def test_el_precio_que_sube_dice_cuanto_quien_y_que_productos_toca(db, insumo, variante):
    compra(db, insumo, 8.0, 40)
    compra(db, insumo, 8.2, 20)
    compra(db, insumo, 10.0, 2, proveedor="Carnes Nuevas")
    a = alertas.precio_que_sube(db)
    assert a is not None
    assert a.titulo == "Carne molida subió 23 % con Carnes Nuevas"
    assert "$8,10" in a.por_que and "$10,00" in a.por_que
    assert "Empanada" in a.por_que, "dice qué productos lo llevan"
    assert "Recetas" in a.que_hacer


def test_una_subida_chica_o_vieja_no_se_avisa(db, insumo):
    compra(db, insumo, 8.0, 40)
    compra(db, insumo, 8.0, 30)
    compra(db, insumo, 8.5, 2)  # +6 %
    assert alertas.precio_que_sube(db) is None
    compra(db, insumo, 12.0, 10)  # subio, pero hace 10 dias: ya se vio
    compra(db, insumo, 12.0, 9)
    assert alertas.precio_que_sube(db) is None


def test_la_misma_referencia_en_dos_ventas_se_avisa(client, db, variante):
    a = vender(client, variante, "Pago movil")
    b = vender(client, variante, "Pago movil")
    for p in (a, b):
        db.query(models.PagoPedido).filter_by(pedido_id=p["id"]).update({"referencia": "884512"})
    db.commit()
    aviso = alertas.cobro_repetido(db)
    assert aviso is not None
    assert f"#{a['numero']}" in aviso.detalle and f"#{b['numero']}" in aviso.detalle
    assert "884512" in aviso.que_hacer and "Editar pago" in aviso.que_hacer
    # Y llega a la portada.
    assert any(x["id"].startswith("ref-repetida") and x["por_que"] for x in client.get("/api/reportes/avisos").json())


def test_referencias_de_relleno_no_cuentan(client, db, variante):
    for _ in range(2):
        p = vender(client, variante, "Pago movil")
        db.query(models.PagoPedido).filter_by(pedido_id=p["id"]).update({"referencia": "0000"})
    db.commit()
    assert alertas.cobro_repetido(db) is None
