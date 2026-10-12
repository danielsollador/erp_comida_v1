"""Un producto puede nacer sin precio (7-oct): primero la receta y el costo,
despues el precio con el margen que se quiera. Mientras no lo tenga no se
vende, que saldria regalado."""

from app import models


def test_no_se_vende_lo_que_no_tiene_precio(client, db, variante):
    v = db.get(models.Variante, variante.id)
    v.precio = 0
    db.commit()
    r = client.post("/api/pedidos", json={"items": [{"variante_id": v.id, "cantidad": 1}], "nota": ""})
    assert r.status_code == 400
    assert "todavía no tiene precio" in r.json()["detail"]

    v.precio = 3.5
    db.commit()
    r = client.post("/api/pedidos", json={"items": [{"variante_id": v.id, "cantidad": 1}], "nota": ""})
    assert r.status_code == 200, r.text
