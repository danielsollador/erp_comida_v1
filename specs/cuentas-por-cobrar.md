# Spec: cuentas por cobrar

Cuentas por cobrar · bloque sin asignar · **Borrador**

## Qué resuelve

Saber quién debe lo vendido a crédito y cobrarlo sin crear clientes antes. Lo usan el dueño y la caja.

## Hoy

Comprobado el 4-nov en local, con pantalla y pruebas. **No comprobado:** PostgreSQL, producción, fiar en la pantalla del punto de venta (sí el mismo cobro por detrás) y teléfono.

- **Lista:** una fila por venta, con buscador. Se marcan ventas y se paga, abona o da de baja. No se exporta. Ninguna pantalla crea fichas ni muestra estado de cuenta o vencidas.
- **Paga menos:** "Quedan debiendo" abona de la venta más vieja a la más nueva; "No se cobran" deja lo que falta como comisión. **Paga de más:** pregunta, y es otro ingreso.
- **Bolívares:** convierte a la tasa BCV de hoy y solo guarda dólares. La pantalla no deja elegir la fecha del cobro.
- **Nombres y permisos:** "José Pérez" y "JOSE-PEREZ" son 2 clientes en la lista, pero una ficha los une. La cajera puede cobrar, anular, dar de baja y recuperar, y el cobro no guarda quién lo hizo.
- **Dos a la vez:** en la rama `fix-2026-11-04-cobros-cxc`, sin desplegar, la venta se bloquea y pasa solo uno, probado en PostgreSQL 16. Un reintento cuenta una sola vez.
- **Período cerrado:** con el ejercicio cerrado no se anula ni se recupera. Con la caja cerrada o el IVA declarado, cobrar y anular se aceptan sin aviso. En la rama, un día cerrado muestra lo guardado en su cierre.
- **Sin conexión:** no cobra y lo dice, pero "Cobros hechos" muestra "Todavía no hay cobros", que es falso. La app móvil no tiene esta pantalla.

**Arreglado en la rama, sin desplegar:**
- Con retención, pagar menos sin decir por qué se rechaza y dice qué hacer; si se marca como comisión, se acepta. Medida temporal.
- La pantalla usa la retención que calcula el sistema, sobre toda la factura: ya no nace "otro ingreso" falso.
- Por pago móvil, punto y transferencia, el cuadre, Cobros del día y la conciliación esperan lo que entró. Efectivo y Zelle ya cuadraban.

**Errores encontrados, sin arreglar:**
- Anular borra también una retención que la venta ya tenía antes de ese cobro. Tras dos bajas y recuperar, la lista dice que debe $10 y los libros, $5.

## Qué tiene que pasar

"(hoy: no)" es lo que falta; "(en la rama)" está hecho, sin desplegar; lo demás ya se cumple.

- ¿Se fía sin ficha, solo con el nombre, y sin nombre se rechaza? ¿Un abono parcial va de la venta más vieja a la más nueva, sin tocar las no marcadas ni pasar de lo marcado?
- ¿El cobro con comisión baja toda la deuda, suma lo que entró y deja la diferencia como gasto?
- ¿El cuadre del día espera lo que entró, con comisión, con retención y con pago de más, en todas las formas de pago? ¿Y un día cerrado muestra lo guardado en su cierre? (en la rama)
- ¿La retención solo acepta ventas facturadas, de 75 % o 100 %, y queda como crédito de IVA?
- ¿Con retención, pagar menos se rechaza salvo que se marque como comisión? (en la rama; medida temporal) **Validar con el contador.**
- ¿La retención se calcula sobre toda la factura, igual en pantalla y en el sistema? (en la rama) **Validar con el contador.**
- ¿Un cobro en Bs usa la tasa BCV de la fecha del cobro, no la del día en que se registra, y guarda la tasa y los Bs? (hoy: no)
- ¿Anular deja ventas y libros como antes, sin tocar lo que no vino de ese cobro, y se rechaza dos veces o en un ejercicio cerrado? (hoy: no)
- ¿Dar por perdida pasa solo el saldo a gasto y pide motivo? ¿Recuperar deja lista y libros iguales, también tras dos bajas? (hoy: no)
- ¿Anular, dar de baja y recuperar son del dueño o con su PIN, y todo guarda quién lo hizo? (hoy: no)
- ¿Un reintento cuenta una sola vez, y una referencia repetida avisa y deja seguir? (reintento: en la rama; referencia: hoy no)
- ¿Con la caja cerrada, un cobro en efectivo o una anulación piden reabrirla y por banco se acepta? (hoy: no)
- ¿En un mes de IVA declarado la retención se registra en el mes abierto y no se deja anular? (hoy: no) **Validar con el contador.**
- ¿Sin conexión no cobra, dice "no se pudo cargar" y el punto de venta fía a cualquier nombre? (hoy: no)

## Por decidir

Sin ID del plan hasta entrar en él. Daniel eligió las cuatro primeras el 4-nov; falta aprobar la spec.

- **Abono de ventas sin ficha, ¿puede mezclar deudores?** Sí, con aviso, y el cobro y su asiento nombran a todos.
- **Dos clientes con el mismo nombre:** con ficha, entra directo aunque se escriba distinto. Sin ficha y con deuda, avisa y deja agregar teléfono o apodo o seguir. Nunca obliga a crear ficha.
- **Dos personas cobrando la misma venta:** pasa solo uno, el otro ve "ya no debe nada" y la deuda nunca baja de cero. No esperó al 1.4: hecho en la rama, con su prueba en PostgreSQL.
- **App móvil:** después de arreglar la web, como tarea propia.
- **Fichas:** hoy ninguna pantalla crea fichas, y la excepción de PedidosYa depende de tener una. El aviso de nombre repetido permitirá guardar ese nombre como cliente fijo con un toque, con el dato en el nombre, como "José Pérez (del 5to)", para que no vuelva a preguntar. Esa pantalla no se hace ahora; queda para después.
- **Contador (abierto):** las tres reglas marcadas arriba. Recomiendo no programarlas sin su respuesta.
- **Tasa de otra fecha (abierto):** recomiendo un campo "Fecha" que por defecto sea hoy y, si no hay tasa de ese día, pedirla en vez de suponerla.

## Cómo se valida

En http://localhost:5181, con la caja abierta. Los pasos dicen cómo funciona hoy; al aprobar, se ajustan a las reglas.

1. **Fiar y abonar:** en el punto de venta, cobra "A crédito" dos ventas a Ana y una a Luis. En Cuentas por cobrar, busca "ana", marca una y paga menos con "Quedan debiendo": la fila dice "abonó".
2. **Comisión:** marca la de Luis, paga menos y elige "No se cobran". El aviso dice cuánto es comisión.
3. **Bolívares y retención:** con "Efectivo Bs" el campo pide Bs y dice la tasa. En una venta facturada, "Retuvo el 75 %" y paga todo: el aviso dice cuánto se retuvo.
4. **Anular, dar de baja y recuperar:** en "Cobros hechos", anula uno; da de baja otra venta y recupérala. Las dos vuelven a la lista.
5. **Dos pestañas y sin conexión:** cobra la misma venta en dos pestañas: la segunda dice que ya no debe nada. Corta el wifi e intenta pagar: dice "Sin conexión" y no cobra.
