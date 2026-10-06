-- Lo que tiene que dar IGUAL en Hostinger y en la VM despues de restaurar.
-- Se corre con: psql -U vertigo -d vertigo -At < conteos.sql
select 'pedidos' as que, count(*) from "SAVORA"."TRX110_VEN_PEDIDO"
union all select 'ultimo_pedido_id', max(id) from "SAVORA"."TRX110_VEN_PEDIDO"
union all select 'pagos', count(*) from "SAVORA"."TRX120_VEN_PAGO"
union all select 'facturas_compra', count(*) from "SAVORA"."TRX410_COM_FACTURA"
union all select 'notas_credito', count(*) from "SAVORA"."TRX420_COM_NOTA_CREDITO"
union all select 'cierres_caja', count(*) from "SAVORA"."TRX510_CAJ_CIERRE"
union all select 'asientos', count(*) from "SAVORA"."TRX610_CON_ASIENTO"
union all select 'productos', count(*) from "SAVORA"."DIM220_MEN_PRODUCTO"
union all select 'ingredientes', count(*) from "SAVORA"."DIM310_INV_INGREDIENTE"
union all select 'tablas_savora', count(*) from pg_tables where schemaname = 'SAVORA';
