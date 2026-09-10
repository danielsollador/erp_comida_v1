"""Genera ventas historicas de ejemplo para demostrar los reportes.

Uso:   py demo_data.py          (desde la carpeta backend)
       py demo_data.py --limpiar   borra las ventas y deja el menu intacto

Es solo para demos. En un local real nunca se corre.
"""

import datetime
import random
import sys

from app import contabilidad, costeo, impuestos
from app.database import SessionLocal
from app.models import (
    AsientoContable,
    FacturaCompra,
    FacturaCompraItem,
    Gasto,
    Ingrediente,
    MovimientoContable,
    Pedido,
    PedidoItem,
    RecetaItem,
    Variante,
)

random.seed(7)

METODOS = ["Efectivo", "Efectivo", "Efectivo", "Pago movil", "Tarjeta", "Transferencia"]
# Curva tipica de una venta de desayuno/merienda.
PESO_POR_HORA = {7: 3, 8: 6, 9: 5, 10: 4, 11: 3, 12: 5, 13: 4, 15: 3, 16: 4, 17: 3}
# No todo el que compra pide factura - asi es el negocio real que describio el
# dueno. Se simula esa misma mezcla en el historico.
PROB_FACTURADO = 0.35
PROVEEDORES = [
    ("Distribuidora Cafe y Mas C.A.", "J-30012345-6"),
    ("Panaderia El Trigo", "J-30098765-4"),
    ("Carnes La Fresca", "J-30011122-3"),
]
# Que insumos vende tipicamente cada proveedor, para que la factura de ejemplo
# tenga sentido (el de carnes no te vende harina).
SURTIDO_POR_PROVEEDOR = {
    "Distribuidora Cafe y Mas C.A.": ["Cafe molido", "Azucar"],
    "Panaderia El Trigo": ["Harina"],
    "Carnes La Fresca": ["Carne molida", "Pollo"],
}


def limpiar(db):
    db.query(MovimientoContable).delete()
    db.query(AsientoContable).delete()
    db.query(PedidoItem).delete()
    db.query(Pedido).delete()
    db.query(Gasto).delete()
    # Los renglones primero: un DELETE masivo no dispara el cascade de SQLAlchemy.
    db.query(FacturaCompraItem).delete()
    db.query(FacturaCompra).delete()
    db.commit()
    print("Ventas, gastos, facturas y asientos contables borrados (el plan de cuentas queda intacto).")


def generar(db, dias=45):
    if db.query(Pedido).count() > 0:
        print("Ya hay pedidos cargados. Corre con --limpiar primero si quieres regenerar.")
        return

    variantes = db.query(Variante).all()
    if not variantes:
        print("No hay menu cargado. Arranca la app una vez para que se cree el menu demo.")
        return

    ingredientes = {i.nombre: i for i in db.query(Ingrediente).all()}

    costos = {}
    for receta in db.query(RecetaItem).all():
        aporte = receta.cantidad_por_unidad * (receta.ingrediente.costo_efectivo or 0)
        costos[receta.variante_id] = costos.get(receta.variante_id, 0) + aporte

    hoy = datetime.date.today()
    total_pedidos = 0
    numero_factura = 100
    tasa_iva_actual = impuestos.tasa_iva(db)

    for delta in range(dias, -1, -1):
        fecha = hoy - datetime.timedelta(days=delta)
        # Domingo cerrado, salvo hoy: la demo necesita numeros en la vista "Hoy".
        if fecha.weekday() == 6 and delta != 0:
            continue

        # Fin de semana mas movido; ademas una tendencia leve de crecimiento.
        base = 14 if fecha.weekday() >= 4 else 9
        crecimiento = 1 + (dias - delta) / dias * 0.25
        cantidad_pedidos = max(1, int(random.gauss(base * crecimiento, 3)))

        horas = list(PESO_POR_HORA.keys())
        pesos = list(PESO_POR_HORA.values())
        if delta == 0:
            # Nada de ventas "del futuro" en el dia en curso.
            hora_actual = datetime.datetime.now().hour
            filtrado = [(h, p) for h, p in zip(horas, pesos) if h <= hora_actual]
            if filtrado:
                horas, pesos = [h for h, _ in filtrado], [p for _, p in filtrado]

        for numero in range(1, cantidad_pedidos + 1):
            hora = random.choices(horas, weights=pesos)[0]
            momento = datetime.datetime(
                fecha.year, fecha.month, fecha.day, hora, random.randint(0, 59)
            )
            facturado = random.random() < PROB_FACTURADO
            if facturado:
                numero_factura += 1

            pedido = Pedido(
                numero=numero,
                estado="pagado",
                metodo_pago=random.choice(METODOS),
                creado_en=momento,
                cerrado_en=momento + datetime.timedelta(minutes=random.randint(3, 12)),
                facturado=facturado,
                numero_factura=f"00-{numero_factura}" if facturado else None,
                tasa_iva=tasa_iva_actual if facturado else None,
            )
            db.add(pedido)
            db.flush()

            for variante in random.sample(variantes, random.randint(1, 3)):
                nombre = variante.producto.nombre
                if variante.nombre.lower() != "regular":
                    nombre = f"{nombre} - {variante.nombre}"
                db.add(
                    PedidoItem(
                        pedido_id=pedido.id,
                        variante_id=variante.id,
                        nombre=nombre,
                        precio_unitario=variante.precio,
                        costo_unitario=round(costos.get(variante.id, 0), 4),
                        cantidad=random.randint(1, 4),
                        preparado=True,
                    )
                )
            db.flush()
            db.refresh(pedido)
            contabilidad.registrar_venta(db, pedido)
            total_pedidos += 1

        # Gastos tipicos del dia a dia.
        if fecha.weekday() == 0:
            gasto = Gasto(
                descripcion="Bombona de gas",
                categoria="Servicios",
                monto=12.0,
                fecha=datetime.datetime(fecha.year, fecha.month, fecha.day, 8, 0),
            )
            db.add(gasto)
            db.flush()
            contabilidad.registrar_gasto(db, gasto)
        # Pago semanal al ayudante (sabado), como se acostumbra en un local chico.
        # Se reparte por semana a proposito: un pago quincenal grande distorsiona
        # la vista "Esta semana" apenas arranca el mes.
        if fecha.weekday() == 5:
            gasto = Gasto(
                descripcion="Pago ayudante",
                categoria="Sueldos",
                monto=30.0,
                fecha=datetime.datetime(fecha.year, fecha.month, fecha.day, 18, 0),
            )
            db.add(gasto)
            db.flush()
            contabilidad.registrar_gasto(db, gasto)

        # Compra de insumos a proveedor con factura, cada semana (surtido tipico).
        # Con renglones por insumo: la misma factura reabastece el stock real
        # y recalcula el costo promedio de cada uno - el flujo unificado, no
        # el atajo de antes de cargar solo un monto suelto.
        if fecha.weekday() == 2:
            proveedor, rif = random.choice(PROVEEDORES)
            numero_factura += 1
            factura = FacturaCompra(
                numero_factura=f"F-{numero_factura}",
                proveedor_nombre=proveedor,
                proveedor_rif=rif,
                fecha=datetime.datetime(fecha.year, fecha.month, fecha.day, 9, 30),
                categoria="Insumos",
                forma_pago="Efectivo",
                base_imponible=0,  # se calcula abajo, sumando los renglones reales
                iva=0,
            )
            db.add(factura)
            db.flush()

            base_total = 0.0
            for nombre_insumo in SURTIDO_POR_PROVEEDOR[proveedor]:
                ingrediente = ingredientes.get(nombre_insumo)
                if not ingrediente:
                    continue
                cantidad = round(random.uniform(3, 8), 2)
                # Variacion natural de precio compra a compra, para que el
                # costo promedio ponderado tenga algo real que promediar.
                costo_compra = round(ingrediente.costo_unitario * random.uniform(0.95, 1.08), 4)
                db.add(
                    FacturaCompraItem(
                        factura_id=factura.id,
                        ingrediente_id=ingrediente.id,
                        cantidad=cantidad,
                        costo_unitario=costo_compra,
                    )
                )
                costeo.registrar_entrada(ingrediente, cantidad, costo_compra)
                base_total += round(cantidad * costo_compra, 2)

            factura.base_imponible = round(base_total, 2)
            factura.iva = round(base_total * tasa_iva_actual / 100, 2)
            db.flush()
            contabilidad.registrar_factura_compra(db, factura)

    db.commit()
    print(f"Listo: {total_pedidos} pedidos generados en los ultimos {dias} dias.")


if __name__ == "__main__":
    db = SessionLocal()
    try:
        if "--limpiar" in sys.argv:
            limpiar(db)
        else:
            generar(db)
    finally:
        db.close()
