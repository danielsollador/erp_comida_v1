"""Genera ventas historicas de ejemplo para demostrar los reportes.

Uso:   py demo_data.py          (desde la carpeta backend)
       py demo_data.py --limpiar   borra las ventas y deja el menu intacto

Es solo para demos. En un local real nunca se corre.
"""

import datetime
import random
import sys

from app import contabilidad, costeo, impuestos, schemas, tasas
from app.database import SessionLocal
from app.models import (
    ActivoFijo,
    AsientoContable,
    CambioPrecio,
    CierreCaja,
    CompraSuelta,
    DeclaracionIva,
    FacturaCompra,
    FacturaCompraItem,
    Gasto,
    Ingrediente,
    Merma,
    MovimientoContable,
    Pedido,
    PedidoItem,
    RecetaItem,
    Variante,
)
from app.seed import INGREDIENTES_DEMO

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
    ("Fruteria La Guacamaya", "J-30077788-9"),
]
# Que insumos vende tipicamente cada proveedor, para que la factura de ejemplo
# tenga sentido (el de carnes no te vende harina). Entre los cuatro tienen que
# cubrir TODO el inventario: desde que las ventas descuentan stock, un insumo
# que nadie surte se va a negativo solo.
SURTIDO_POR_PROVEEDOR = {
    "Distribuidora Cafe y Mas C.A.": ["Cafe molido", "Azucar", "Refresco concentrado"],
    "Panaderia El Trigo": ["Harina", "Queso"],
    "Carnes La Fresca": ["Carne molida", "Pollo"],
    "Fruteria La Guacamaya": ["Naranja"],
}

# Equipos comprados antes del periodo que genera el demo: se deprecian solos y
# muestran el modulo funcionando con historia, no recien estrenado.
# (numero, proveedor, descripcion, base, iva, vida_util_meses, dias_atras)
EQUIPOS_DEMO = [
    ("EQ-001", "Refrigeracion Caracas", "Nevera exhibidora 2 puertas", 800.0, 128.0, 60, 243),
    ("EQ-002", "Equipos Gastronomicos CA", "Horno industrial 4 bandejas", 450.0, 72.0, 84, 500),
]


def limpiar(db):
    db.query(MovimientoContable).delete()
    db.query(AsientoContable).delete()
    db.query(PedidoItem).delete()
    db.query(Pedido).delete()
    db.query(Gasto).delete()
    db.query(Merma).delete()
    db.query(CierreCaja).delete()
    db.query(ActivoFijo).delete()
    db.query(CompraSuelta).delete()
    db.query(CambioPrecio).delete()
    db.query(DeclaracionIva).delete()
    # Los renglones primero: un DELETE masivo no dispara el cascade de SQLAlchemy.
    db.query(FacturaCompraItem).delete()
    db.query(FacturaCompra).delete()

    # El stock vuelve al de la semilla: ahora las ventas descuentan inventario,
    # asi que sin resetearlo cada regeneracion arrancaria del stock que dejo la
    # corrida anterior y el historico no seria reproducible.
    por_nombre = {i.nombre: i for i in db.query(Ingrediente).all()}
    for nombre, _unidad, actual, _min, _obj, costo, _rend in INGREDIENTES_DEMO:
        ingrediente = por_nombre.get(nombre)
        if ingrediente:
            ingrediente.stock_actual = actual
            ingrediente.costo_unitario = costo
    db.commit()

    # Y se vuelve a abrir la contabilidad con ese inventario inicial.
    contabilidad.asiento_de_apertura(db)
    print("Ventas, gastos, facturas y asientos borrados; inventario y apertura restablecidos.")


def _declarar_meses_cerrados(db, dejar_pendiente=1):
    """Presenta las declaraciones de IVA de los meses ya cerrados.

    Usa los mismos endpoints que usaria el dueno, para que el historico del
    demo sea el que produce el flujo real y no datos inventados aparte.
    """
    from app.routers import impuestos as router_impuestos

    pendientes = router_impuestos.periodos_pendientes(db)
    if dejar_pendiente:
        pendientes = pendientes[:-dejar_pendiente]
    for p in pendientes:
        router_impuestos.declarar_iva(
            schemas.DeclararIvaRequest(anio=p.anio, mes=p.mes), db
        )
    return len(pendientes)


def generar(db, dias=45):
    if db.query(Pedido).count() > 0:
        print("Ya hay pedidos cargados. Corre con --limpiar primero si quieres regenerar.")
        return

    variantes = db.query(Variante).all()
    if not variantes:
        print("No hay menu cargado. Arranca la app una vez para que se cree el menu demo.")
        return

    ingredientes = {i.nombre: i for i in db.query(Ingrediente).all()}

    recetas_por_variante = {}
    for receta in db.query(RecetaItem).all():
        recetas_por_variante.setdefault(receta.variante_id, []).append(receta)

    def costo_actual(variante_id):
        """Costo con los precios VIGENTES en este punto del historico.

        Se recalcula en cada venta a proposito: antes se computaba una sola vez
        antes del loop y las 45 dias de ventas quedaban con el mismo costo,
        justo lo contrario de lo que el costeo promedio existe para mostrar.
        """
        return sum(
            r.cantidad_por_unidad * (r.ingrediente.costo_efectivo or 0)
            for r in recetas_por_variante.get(variante_id, [])
        )

    # Cuanto se consumio de cada insumo desde la ultima compra a proveedor:
    # es lo que determina cuanto se repone, para que el demo no termine con
    # stock negativo ni con una montana de inventario sin sentido.
    consumo_pendiente = {}

    def consumir(variante_id, unidades):
        """Descuenta del inventario lo que se gasto en producir esas unidades."""
        for r in recetas_por_variante.get(variante_id, []):
            bruto = costeo.consumo_bruto(r, unidades)
            r.ingrediente.stock_actual = (r.ingrediente.stock_actual or 0) - bruto
            consumo_pendiente[r.ingrediente.nombre] = (
                consumo_pendiente.get(r.ingrediente.nombre, 0) + bruto
            )

    hoy = datetime.date.today()

    # Los equipos se cargan primero, con fecha anterior al historico de ventas:
    # asi llegan al presente con varios meses ya depreciados.
    for numero, proveedor, desc, base, iva, meses, dias_atras in EQUIPOS_DEMO:
        fecha_compra = datetime.datetime.now() - datetime.timedelta(days=dias_atras)
        factura = FacturaCompra(
            numero_factura=numero,
            proveedor_nombre=proveedor,
            fecha=fecha_compra,
            categoria="Activos",
            forma_pago="Banco",
            descripcion=desc,
            base_imponible=base,
            iva=iva,
            pagada=True,
            fecha_pago=fecha_compra,
        )
        db.add(factura)
        db.flush()
        contabilidad.registrar_factura_compra(db, factura)
        db.add(
            ActivoFijo(
                nombre=desc,
                valor=base,
                fecha_compra=fecha_compra,
                vida_util_meses=meses,
                factura_id=factura.id,
            )
        )
    db.commit()

    total_pedidos = 0
    numero_factura = 100
    # Contador aparte para las compras semanales: numero_factura tambien lo
    # usan las ventas facturadas (linea de abajo), y sus saltos no son
    # predecibles semana a semana - con un contador propio, "una de cada
    # tres compras a credito" sale siempre igual de parejo.
    compra_num = 0
    tasa_iva_actual = impuestos.tasa_iva(db)

    vigente = tasas.tasa_vigente(db)
    tasa_hoy = vigente.bcv if vigente and vigente.bcv else 840.0

    def tasa_del_dia(dias_atras):
        """Tasa BCV plausible para una fecha pasada (~0.4% diario de deslizamiento).

        Las ventas del historico tienen que quedar con la tasa de SU dia: es lo
        que hace que el reporte en bolivares del mes pasado no se mueva cuando
        sube el dolar hoy.
        """
        return round(tasa_hoy / (1.004**dias_atras), 4)

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
                tasa_bcv=tasa_del_dia(delta),
            )
            db.add(pedido)
            db.flush()

            for variante in random.sample(variantes, random.randint(1, 3)):
                nombre = variante.producto.nombre
                if variante.nombre.lower() != "regular":
                    nombre = f"{nombre} - {variante.nombre}"
                unidades = random.randint(1, 4)
                db.add(
                    PedidoItem(
                        pedido_id=pedido.id,
                        variante_id=variante.id,
                        nombre=nombre,
                        precio_unitario=variante.precio,
                        costo_unitario=round(costo_actual(variante.id), 4),
                        cantidad=unidades,
                        preparado=True,
                    )
                )
                # Vender gasta inventario: sin esto el stock del demo nunca
                # bajaba y la cuenta 1040 se iba a negativo sola.
                consumir(variante.id, unidades)
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
        # Se le compra a cada proveedor que tenga algo que reponer: desde que
        # las ventas descuentan stock, surtir a uno solo por semana dejaria a
        # los demas insumos en negativo.
        for proveedor, rif in PROVEEDORES if fecha.weekday() == 2 else []:
            if not any(consumo_pendiente.get(n, 0) > 0 for n in SURTIDO_POR_PROVEEDOR[proveedor]):
                continue
            numero_factura += 1
            compra_num += 1
            # De cada tres compras, una queda a credito - asi la demo tiene
            # con que mostrar la pantalla de cuentas por pagar, no solo
            # facturas que se pagan de contado el mismo dia.
            a_credito = compra_num % 3 == 0
            fecha_compra = datetime.datetime(fecha.year, fecha.month, fecha.day, 9, 30)
            factura = FacturaCompra(
                numero_factura=f"F-{numero_factura}",
                proveedor_nombre=proveedor,
                proveedor_rif=rif,
                fecha=fecha_compra,
                categoria="Insumos",
                forma_pago="Credito" if a_credito else "Efectivo",
                base_imponible=0,  # se calcula abajo, sumando los renglones reales
                iva=0,
                pagada=not a_credito,
                fecha_vencimiento=fecha_compra + datetime.timedelta(days=15) if a_credito else None,
                fecha_pago=None if a_credito else fecha_compra,
            )
            db.add(factura)
            db.flush()

            base_total = 0.0
            for nombre_insumo in SURTIDO_POR_PROVEEDOR[proveedor]:
                ingrediente = ingredientes.get(nombre_insumo)
                if not ingrediente:
                    continue
                # Se repone lo que se gasto desde la ultima compra, con algo de
                # colchon: es como compra un local de verdad, y ademas mantiene
                # el stock del demo en numeros creibles.
                gastado = consumo_pendiente.pop(nombre_insumo, 0)
                cantidad = round(max(gastado * random.uniform(1.1, 1.35), 1.0), 2)
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

            # Simula que las deudas viejas ya se pagaron, pero deja las mas
            # recientes pendientes - asi la pantalla de cuentas por pagar
            # muestra tanto historico saldado como pendientes reales, alguna
            # ya vencida.
            if a_credito and factura.fecha_vencimiento.date() < hoy - datetime.timedelta(days=10):
                contabilidad.registrar_pago_factura(db, factura, "Efectivo")
                factura.pagada = True
                factura.fecha_pago = datetime.datetime(fecha.year, fecha.month, fecha.day, 17, 0)
                db.flush()

    db.commit()
    cuotas = contabilidad.asentar_depreciacion_pendiente(db)

    # Se declaran los meses cerrados salvo el ultimo, para que la pantalla de
    # impuestos muestre las dos mitades: historial presentado y un periodo
    # todavia pendiente de declarar.
    declaradas = _declarar_meses_cerrados(db, dejar_pendiente=1)

    print(f"Listo: {total_pedidos} pedidos generados en los ultimos {dias} dias.")
    print(f"       {len(EQUIPOS_DEMO)} equipos con {cuotas} cuotas de depreciacion asentadas.")
    print(f"       {declaradas} declaraciones de IVA presentadas.")


if __name__ == "__main__":
    db = SessionLocal()
    try:
        if "--limpiar" in sys.argv:
            limpiar(db)
        else:
            generar(db)
    finally:
        db.close()
