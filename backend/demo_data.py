"""Genera ventas historicas de ejemplo para demostrar los reportes.

Uso:   py demo_data.py          (desde la carpeta backend)
       py demo_data.py --limpiar   borra las ventas y deja el menu intacto

Es solo para demos. En un local real nunca se corre.
"""

import datetime
import random
import sys

from app.database import SessionLocal
from app.models import Gasto, Pedido, PedidoItem, RecetaItem, Variante

random.seed(7)

METODOS = ["Efectivo", "Efectivo", "Efectivo", "Pago movil", "Tarjeta", "Transferencia"]
# Curva tipica de una venta de desayuno/merienda.
PESO_POR_HORA = {7: 3, 8: 6, 9: 5, 10: 4, 11: 3, 12: 5, 13: 4, 15: 3, 16: 4, 17: 3}


def limpiar(db):
    db.query(PedidoItem).delete()
    db.query(Pedido).delete()
    db.query(Gasto).delete()
    db.commit()
    print("Ventas y gastos borrados.")


def generar(db, dias=45):
    if db.query(Pedido).count() > 0:
        print("Ya hay pedidos cargados. Corre con --limpiar primero si quieres regenerar.")
        return

    variantes = db.query(Variante).all()
    if not variantes:
        print("No hay menu cargado. Arranca la app una vez para que se cree el menu demo.")
        return

    costos = {}
    for receta in db.query(RecetaItem).all():
        aporte = receta.cantidad_por_unidad * (receta.ingrediente.costo_unitario or 0)
        costos[receta.variante_id] = costos.get(receta.variante_id, 0) + aporte

    hoy = datetime.date.today()
    total_pedidos = 0

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
            pedido = Pedido(
                numero=numero,
                estado="pagado",
                metodo_pago=random.choice(METODOS),
                creado_en=momento,
                cerrado_en=momento + datetime.timedelta(minutes=random.randint(3, 12)),
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
            total_pedidos += 1

        # Gastos tipicos del dia a dia.
        if fecha.weekday() == 0:
            db.add(
                Gasto(
                    descripcion="Bombona de gas",
                    categoria="Servicios",
                    monto=12.0,
                    fecha=datetime.datetime(fecha.year, fecha.month, fecha.day, 8, 0),
                )
            )
        if fecha.day in (1, 15):
            db.add(
                Gasto(
                    descripcion="Pago ayudante",
                    categoria="Sueldos",
                    monto=60.0,
                    fecha=datetime.datetime(fecha.year, fecha.month, fecha.day, 18, 0),
                )
            )

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
