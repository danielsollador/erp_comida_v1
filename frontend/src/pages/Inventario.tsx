import { useEffect, useState } from 'react'
import Icono from '../components/Icono'
import NavBar from '../components/NavBar'
import { Tabla, Th, useOrden } from '../components/Tabla'
import { Boton, Modal, Pagina } from '../components/ui'
import { api } from '../lib/api'
import type {
  CompraDeInsumo,
  ImpactoDeCompra,
  InflacionInsumos,
  Ingrediente,
  Merma,
  SobranteInventario,
  SugerenciaCompra,
} from '../lib/types'

type CompraConVariacion = CompraDeInsumo & { cambio: number | null }

/**
 * Cuanto subio o bajo el costo respecto a la compra ANTERIOR EN EL TIEMPO.
 *
 * Antes se calculaba contra la fila de al lado en la pantalla, que solo era la
 * compra anterior mientras la tabla estuviera en orden de fecha. Ahora que se
 * puede ordenar por costo o por cantidad, esa cuenta habria dado porcentajes
 * inventados: el cambio pertenece a la compra, no a la posicion en la lista.
 */
function conVariacion(compras: CompraDeInsumo[]): CompraConVariacion[] {
  const cronologico = [...compras].sort(
    (a, b) => new Date(a.fecha).getTime() - new Date(b.fecha).getTime(),
  )
  const cambios = new Map<CompraDeInsumo, number | null>()
  for (const [i, c] of cronologico.entries()) {
    const previa = cronologico[i - 1]
    cambios.set(
      c,
      previa && previa.costo_unitario ? (c.costo_unitario / previa.costo_unitario - 1) * 100 : null,
    )
  }
  return compras.map((c) => ({ ...c, cambio: cambios.get(c) ?? null }))
}

export default function Inventario() {
  const [ingredientes, setIngredientes] = useState<Ingrediente[]>([])
  // Abre por nombre, que es como se busca un insumo; pero el dueno entra aqui
  // a ver que se esta acabando y que subio de precio, y eso son dos clics en
  // "Stock" y en "Reponer".
  const orden = useOrden<Ingrediente>(
    {
      nombre: (i) => i.nombre,
      stock: (i) => i.stock_actual,
      minimo: (i) => i.stock_minimo,
      costo: (i) => i.costo_unitario,
      reponer: (i) => i.costo_reposicion,
      rendimiento: (i) => i.rendimiento_pct,
      real: (i) => i.costo_efectivo,
    },
    'nombre',
  )
  const ordenHistorial = useOrden<CompraConVariacion>(
    {
      fecha: (c) => new Date(c.fecha),
      cantidad: (c) => c.cantidad,
      costo: (c) => c.costo_unitario,
      cambio: (c) => c.cambio,
    },
    '-fecha',
  )
  const [sugerencias, setSugerencias] = useState<SugerenciaCompra[]>([])
  const [mermas, setMermas] = useState<Merma[]>([])
  const [sobrantes, setSobrantes] = useState<SobranteInventario[]>([])
  const [inflacion, setInflacion] = useState<InflacionInsumos | null>(null)
  // Lo que hay que ponerle delante al dueno cuando un insumo pega un salto.
  const [impacto, setImpacto] = useState<ImpactoDeCompra | null>(null)
  const [historial, setHistorial] = useState<{ ing: Ingrediente; compras: CompraDeInsumo[] } | null>(
    null,
  )
  const [error, setError] = useState('')

  useEffect(() => {
    cargar()
  }, [])

  function cargar() {
    api.listarIngredientes().then(setIngredientes)
    api.sugerenciasCompra().then(setSugerencias)
    api.listarMermas().then(setMermas)
    api.listarSobrantes().then(setSobrantes).catch(() => {})
    api.inflacionInsumos().then(setInflacion).catch(() => setInflacion(null))
  }

  async function verHistorial(ing: Ingrediente) {
    setError('')
    try {
      setHistorial({ ing, compras: await api.historialCostos(ing.id) })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ocurrio un error')
    }
  }

  async function revertirMerma(m: Merma) {
    const texto =
      `Revertir esta merma? Vuelven ${m.cantidad.toFixed(3)} ${m.unidad} de ` +
      `${m.ingrediente_nombre} al inventario.\n\n` +
      'La merma original no se borra: queda marcada como revertida con su asiento de reverso.'
    if (!window.confirm(texto)) return
    accion(() => api.revertirMerma(m.id))
  }

  async function accion(fn: () => Promise<unknown>) {
    setError('')
    try {
      await fn()
      cargar()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ocurrio un error')
    }
  }

  function comprar(ing: Ingrediente) {
    const texto = window.prompt(`Cuanto vas a comprar de ${ing.nombre} (${ing.unidad})?`)
    if (!texto) return
    const cantidad = Number(texto)
    if (!Number.isFinite(cantidad) || cantidad <= 0) return

    const textoCosto = window.prompt(
      `Cuanto pagaste en total por esos ${cantidad} ${ing.unidad}, SIN IVA? ` +
        `(deja vacio si no quieres actualizar el costo - el IVA no cuenta aqui, ya que no es parte ` +
        `del costo real del insumo)`,
    )
    const costoTotal = textoCosto ? Number(textoCosto) : undefined
    accion(async () => {
      const resultado = await api.registrarCompra(
        ing.id,
        cantidad,
        Number.isFinite(costoTotal as number) ? costoTotal : undefined,
      )
      // Si el proveedor pego un salto, se dice AHORA. El costo promedio tarda
      // semanas en reflejarlo, y para entonces ya vendiste con el margen viejo
      // en pantalla y el nuevo en la realidad.
      if (resultado.revisar_precios) setImpacto(resultado)
    })
  }

  async function revertirSobrante(sb: SobranteInventario) {
    const texto =
      `Revertir este conteo? Salen ${sb.cantidad.toFixed(3)} ${sb.unidad} de ` +
      `${sb.ingrediente_nombre} que habian entrado por un conteo hacia arriba.\n\n` +
      'El sobrante no se borra: queda marcado como revertido con su contra-asiento.'
    if (!window.confirm(texto)) return
    accion(() => api.revertirSobrante(sb.id))
  }

  function consumoPersonal(ing: Ingrediente) {
    // No es merma: una merma es plata perdida y sirve para detectar
    // desperdicio o robo. Esto es un costo laboral autorizado.
    const texto = window.prompt(`Cuanto de ${ing.nombre} se consumio el personal? (${ing.unidad})`)
    if (!texto) return
    const cantidad = Number(texto)
    if (!Number.isFinite(cantidad) || cantidad <= 0) return
    const motivo = window.prompt('Para quien / que turno?') ?? ''
    accion(() => api.consumoPersonal(ing.id, cantidad, motivo))
  }

  function merma(ing: Ingrediente) {
    const texto = window.prompt(`Cuanto se perdio de ${ing.nombre} (${ing.unidad})?`)
    if (!texto) return
    const cantidad = Number(texto)
    if (!Number.isFinite(cantidad) || cantidad <= 0) return
    const motivo = window.prompt('Motivo (se quemo, se daño, se cayo...)') ?? ''
    accion(() => api.registrarMerma(ing.id, cantidad, motivo))
  }

  function ajustar(ing: Ingrediente) {
    const texto = window.prompt(
      `Conteo fisico de ${ing.nombre}: cuanto hay realmente? (${ing.unidad})`,
      String(ing.stock_actual),
    )
    if (texto === null) return
    const real = Number(texto)
    if (!Number.isFinite(real) || real < 0) return
    accion(() => api.ajustarStock(ing.id, real))
  }

  function cambiarCosto(ing: Ingrediente) {
    const texto = window.prompt(
      `Cuanto te cuesta 1 ${ing.unidad} de ${ing.nombre} (sin IVA)?`,
      String(ing.costo_unitario),
    )
    if (texto === null) return
    const costo = Number(texto)
    if (!Number.isFinite(costo) || costo < 0) return
    accion(() => api.actualizarIngrediente(ing.id, { ...ing, costo_unitario: costo }))
  }

  function cambiarRendimiento(ing: Ingrediente) {
    const texto = window.prompt(
      `De cada ${ing.unidad} de ${ing.nombre} que compras, que % te queda utilizable ` +
        `despues de limpiar/cocinar? (100 = no se pierde nada)`,
      String(ing.rendimiento_pct),
    )
    if (texto === null) return
    const pct = Number(texto)
    if (!Number.isFinite(pct) || pct <= 0 || pct > 100) return
    accion(() => api.actualizarIngrediente(ing.id, { ...ing, rendimiento_pct: pct }))
  }

  const sinCosto = ingredientes.filter((i) => !i.costo_unitario)

  return (
    <div className="min-h-screen bg-neutral-50">
      <NavBar titulo="Inventario de insumos" />
      <Pagina>
        {error && (
          <p className="bg-peligro-50 border border-peligro-200 text-peligro-700 rounded-xl p-3 text-sm">
            {error}
          </p>
        )}

        <div className="bg-acento-50 border border-acento-200 rounded-2xl p-4">
          <h2 className="font-semibold text-acento-900 mb-2 flex items-center gap-2">
            <Icono nombre="chispa" size={17} /> Asistente de compras
          </h2>
          {sugerencias.length === 0 && (
            <p className="text-sm text-acento-700">
              Todo el inventario esta por encima del minimo. Nada que comprar por ahora.
            </p>
          )}
          <ul className="space-y-2">
            {sugerencias.map((s) => (
              <li
                key={s.ingrediente_id}
                className="bg-white rounded-xl p-3 flex justify-between items-center gap-3"
              >
                <div>
                  <div className="font-medium">{s.ingrediente_nombre}</div>
                  <div className="text-sm text-neutral-500">{s.razon}</div>
                </div>
                <div className="font-semibold whitespace-nowrap">
                  +{s.cantidad_sugerida} {s.unidad}
                </div>
              </li>
            ))}
          </ul>
        </div>

        {/* El numero que dice si tus precios se estan quedando atras. El costo
            promedio no lo muestra: mezcla lo caro nuevo con lo barato viejo. */}
        {inflacion && inflacion.cambio_pct >= 15 && (
          <div className="bg-aviso-50 border border-aviso-200 rounded-2xl p-4">
            <h2 className="font-semibold text-aviso-900">
              Tus insumos subieron {inflacion.cambio_pct.toFixed(0)}% en {inflacion.dias} dias
            </h2>
            <ul className="mt-2 space-y-1 text-sm text-aviso-900">
              {inflacion.insumos.slice(0, 5).map((i) => (
                <li key={i.ingrediente_id} className="flex justify-between gap-3">
                  <span>{i.nombre}</span>
                  <span className="tabular-nums whitespace-nowrap">
                    ${i.costo_inicial.toFixed(2)} → ${i.costo_actual.toFixed(2)}{' '}
                    <b>+{i.cambio_pct.toFixed(0)}%</b>
                  </span>
                </li>
              ))}
            </ul>
            <p className="text-xs text-aviso-700 mt-2">
              Si tus precios no subieron parecido, cada venta te deja menos de lo que necesitas
              para reponer. En Menu esta el precio sugerido de cada producto.
            </p>
          </div>
        )}

        {sinCosto.length > 0 && (
          <div className="bg-aviso-50 border border-aviso-200 rounded-2xl p-4 text-sm text-aviso-900">
            <span className="font-semibold">
              {sinCosto.length} insumo(s) sin costo cargado.
            </span>{' '}
            Sin eso los reportes no pueden calcular tu ganancia real. Toca el costo en la tabla para
            cargarlo.
          </div>
        )}

        <Tabla orden={orden} className="bg-white rounded-2xl border border-neutral-200">
          <table className="w-full text-sm">
            <thead className="bg-neutral-50 text-neutral-500 text-xs uppercase">
              <tr>
                <Th clave="nombre">Insumo</Th>
                <Th clave="stock" alinear="derecha">Stock</Th>
                <Th clave="minimo" alinear="derecha">Minimo</Th>
                <Th clave="costo" alinear="derecha">Costo compra</Th>
                {/* El promedio ponderado no dice cuanto cuesta comprar mas: esa
                    es la cuenta que importa para poner precios. */}
                <Th clave="reponer" alinear="derecha">Reponer</Th>
                <Th clave="rendimiento" alinear="derecha">Rendimiento</Th>
                <Th clave="real" alinear="derecha">Costo real</Th>
                <Th alinear="derecha">Acciones</Th>
              </tr>
            </thead>
            <tbody>
              {orden.ordenar(ingredientes).map((ing) => (
                <tr key={ing.id} className="border-t border-neutral-100">
                  <td className="p-3 font-medium">{ing.nombre}</td>
                  <td
                    className={`text-right p-3 tabular-nums ${
                      ing.stock_actual <= ing.stock_minimo ? 'text-peligro-600 font-semibold' : ''
                    }`}
                  >
                    {Number(ing.stock_actual.toFixed(3))} {ing.unidad}
                  </td>
                  <td className="text-right p-3 text-neutral-500 tabular-nums">
                    {ing.stock_minimo} {ing.unidad}
                  </td>
                  <td className="text-right p-3">
                    <button
                      onClick={() => cambiarCosto(ing)}
                      className={`tabular-nums ${
                        ing.costo_unitario ? 'text-neutral-700' : 'text-aviso-600 font-semibold'
                      }`}
                    >
                      {ing.costo_unitario ? `$${ing.costo_unitario.toFixed(2)}` : 'cargar'}
                    </button>
                  </td>
                  <td className="text-right p-3">
                    {ing.costo_reposicion != null ? (
                      <button
                        onClick={() => verHistorial(ing)}
                        className="tabular-nums"
                        title="Ultimo precio pagado. Toca para ver como ha cambiado."
                      >
                        <span
                          className={
                            ing.variacion_pct != null && ing.variacion_pct >= 15
                              ? 'text-aviso-600 font-semibold'
                              : 'text-neutral-700'
                          }
                        >
                          ${ing.costo_reposicion.toFixed(2)}
                        </span>
                        {ing.variacion_pct != null && ing.variacion_pct >= 15 && (
                          <span className="block text-[11px] text-aviso-600">
                            +{ing.variacion_pct.toFixed(0)}%
                          </span>
                        )}
                      </button>
                    ) : (
                      <span className="text-neutral-300">—</span>
                    )}
                  </td>
                  <td className="text-right p-3">
                    <button
                      onClick={() => cambiarRendimiento(ing)}
                      className={`tabular-nums ${
                        ing.rendimiento_pct < 100 ? 'text-aviso-600 font-medium' : 'text-neutral-400'
                      }`}
                      title="% utilizable despues de preparar (limpiar, pelar, cocinar)"
                    >
                      {ing.rendimiento_pct}%
                    </button>
                  </td>
                  <td className="text-right p-3 tabular-nums font-semibold">
                    ${ing.costo_efectivo.toFixed(2)}
                  </td>
                  <td className="p-3">
                    <div className="flex gap-2 xl:gap-3 justify-end whitespace-nowrap text-xs xl:text-sm">
                      <button onClick={() => comprar(ing)} className="text-acento-600 font-medium">
                        Compra
                      </button>
                      <button onClick={() => merma(ing)} className="text-peligro-500 font-medium">
                        Merma
                      </button>
                      <button
                        onClick={() => consumoPersonal(ing)}
                        className="text-acento-600 font-medium"
                        title="Se lo comio el personal: costo laboral, no perdida"
                      >
                        Personal
                      </button>
                      <button onClick={() => ajustar(ing)} className="text-neutral-500 font-medium">
                        Contar
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Tabla>

        {/* Sin esta lista el dueno no podia ver cuanto se perdia ni corregir
            una merma duplicada: era la unica perdida del sistema sin historial. */}
        <div className="bg-white rounded-2xl border border-neutral-200 p-4">
          <div className="flex justify-between items-baseline mb-1">
            <h2 className="font-semibold">Perdidas registradas</h2>
            <span className="text-sm text-neutral-500">
              ultimos 30 dias:{' '}
              <span className="font-semibold text-neutral-800">
                ${mermas.filter((m) => !m.revertida).reduce((s, m) => s + m.valor, 0).toFixed(2)}
              </span>
            </span>
          </div>
          <p className="text-xs text-neutral-500 mb-3">
            Todo lo que se boto, se daño o falto en un conteo. Si registraste una por error,
            revertila: no se borra, queda el reverso asentado.
          </p>
          {mermas.length === 0 && (
            <p className="text-sm text-neutral-400">Sin perdidas registradas. Bien ahi.</p>
          )}
          <div className="space-y-1">
            {mermas.map((m) => (
              <div
                key={m.id}
                className={`flex flex-wrap items-center gap-2 text-sm rounded-lg px-2 py-1.5 ${
                  m.revertida ? 'opacity-50' : 'hover:bg-neutral-50'
                }`}
              >
                <span className="text-xs text-neutral-400 w-20 shrink-0">
                  {new Date(m.fecha).toLocaleDateString('es-VE')}
                </span>
                <span className="flex-1 min-w-[140px]">
                  {m.cantidad.toFixed(3)} {m.unidad} de {m.ingrediente_nombre}
                  {m.motivo && <span className="text-neutral-400"> · {m.motivo}</span>}
                </span>
                <span className="tabular-nums font-medium text-peligro-600 w-16 text-right">
                  ${m.valor.toFixed(2)}
                </span>
                {m.revertida ? (
                  <span className="text-xs text-neutral-500 w-20 text-right">revertida</span>
                ) : (
                  <button
                    onClick={() => revertirMerma(m)}
                    className="text-xs text-acento-600 font-medium w-20 text-right"
                  >
                    Revertir
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* El faltante siempre tuvo vuelta atras (queda como merma); el
            sobrante no, aunque es el mismo dedo en el mismo formulario. */}
        {sobrantes.length > 0 && (
          <div className="bg-white rounded-2xl border border-neutral-200 p-4">
            <h2 className="font-semibold mb-1">Conteos que sumaron stock</h2>
            <p className="text-xs text-neutral-500 mb-3">
              Entraron al inventario por un conteo fisico hacia arriba. Si fue un error de
              tecleo, se puede revertir.
            </p>
            <div className="space-y-2 text-sm">
              {sobrantes.map((sb) => (
                <div key={sb.id} className="flex items-center justify-between gap-2">
                  <span className={sb.revertido ? 'text-neutral-400 line-through' : ''}>
                    {sb.ingrediente_nombre}
                    <span className="ml-1 text-xs text-neutral-400">
                      +{sb.cantidad.toFixed(3)} {sb.unidad} ·{' '}
                      {new Date(sb.fecha).toLocaleDateString('es-VE')}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    <span className="tabular-nums">${sb.valor.toFixed(2)}</span>
                    {!sb.revertido && (
                      <button
                        onClick={() => revertirSobrante(sb)}
                        className="text-xs font-medium text-acento-600"
                      >
                        Revertir
                      </button>
                    )}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        <p className="text-xs text-neutral-500">
          <span className="font-semibold">Compra:</span> entra mercancia.{' '}
          <span className="font-semibold">Merma:</span> se daño o se boto.{' '}
          <span className="font-semibold">Personal:</span> se lo comio un empleado (es costo
          laboral, no perdida: no ensucia el indicador de merma).{' '}
          <span className="font-semibold">Contar:</span> ajusta el sistema a lo que hay de verdad.
          <br />
          <span className="font-semibold">Costo compra:</span> lo que pagas por 1 unidad.{' '}
          <span className="font-semibold">Rendimiento:</span> cuanto de eso queda utilizable despues
          de preparar (100% si no se pierde nada, ej. harina o queso).{' '}
          <span className="font-semibold">Costo real:</span> lo que de verdad cuesta 1 unidad
          utilizable - el numero que usan las recetas y los margenes.
          <br />
          <span className="font-semibold">Reponer:</span> lo que pagaste la ultima vez. Es lo que
          te va a costar comprar mas, y por eso es el numero para poner precios: el costo de
          compra es un promedio que todavia arrastra lo que compraste barato.
        </p>
      </Pagina>

      {/* El aviso llega en el momento de la compra, no cuando el promedio por
          fin se mueva - para entonces ya vendiste semanas al precio viejo. */}
      {impacto && (
        <Modal
          titulo={`${impacto.ingrediente.nombre} subio ${impacto.salto_pct?.toFixed(0)}%`}
          onCerrar={() => setImpacto(null)}
          pie={<Boton onClick={() => setImpacto(null)}>Entendido</Boton>}
        >
          <p className="text-sm text-neutral-600 mt-1">
            Pagaste ${impacto.costo_pagado.toFixed(2)} por {impacto.ingrediente.unidad}; la
            compra anterior fue a ${impacto.costo_anterior.toFixed(2)}.
          </p>
          {/* Un salto de 200% o mas casi nunca es inflacion: es un saco
              tecleado como 1, y deja el costo 50x inflado. */}
          {impacto.posible_error_de_unidad && (
            <div className="mt-3 rounded-xl border border-peligro-300 bg-peligro-50 p-3 text-sm text-peligro-800">
              <b>Revisa la cantidad.</b> {impacto.posible_error_de_unidad}
            </div>
          )}
          <p className="text-xs text-neutral-500 mt-2">
            El costo promedio quedo en ${impacto.ingrediente.costo_unitario.toFixed(2)} porque
            mezcla lo que ya tenias. Los margenes de abajo son los de verdad: los que te quedan
            si tienes que reponer a este precio.
          </p>

          {impacto.productos.length > 0 ? (
            <div className="mt-4 space-y-2">
              {impacto.productos.map((p) => (
                <div
                  key={p.variante_id}
                  className={`rounded-xl border p-3 text-sm ${
                    p.a_perdida
                      ? 'bg-peligro-50 border-peligro-200'
                      : p.margen_flaco
                        ? 'bg-aviso-50 border-aviso-200'
                        : 'bg-neutral-50 border-neutral-200'
                  }`}
                >
                  <div className="flex justify-between gap-2 font-medium">
                    <span>{p.nombre}</span>
                    <span className="tabular-nums whitespace-nowrap">
                      ${p.precio.toFixed(2)}
                    </span>
                  </div>
                  <div className="text-neutral-600 mt-1">
                    margen {p.margen_antes_pct?.toFixed(0)}% →{' '}
                    <b className={p.a_perdida ? 'text-peligro-700' : ''}>
                      {p.margen_despues_pct?.toFixed(0)}%
                    </b>
                    {p.a_perdida && ' · lo vendes a perdida'}
                  </div>
                  {p.precio_sugerido != null && (
                    <div className="text-neutral-700 mt-1">
                      Para mantener tu margen:{' '}
                      <b className="tabular-nums">${p.precio_sugerido.toFixed(2)}</b>
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-4 text-sm text-neutral-600">
              Ningun producto del menu usa este insumo todavia.
            </p>
          )}

        </Modal>
      )}

      {/* La curva de inflacion de cada insumo estaba en las facturas desde el
          primer dia; no habia por donde verla. */}
      {historial && (
        <Modal
          titulo={`Costo de ${historial.ing.nombre}`}
          ayuda={`Lo que has pagado por ${historial.ing.unidad}, compra por compra.`}
          onCerrar={() => setHistorial(null)}
          ancho="sm"
          pie={<Boton tono="suave" onClick={() => setHistorial(null)}>Cerrar</Boton>}
        >
          {historial.compras.length === 0 ? (
            <p className="text-sm text-neutral-500">Todavia no hay compras registradas.</p>
          ) : (
            <Tabla orden={ordenHistorial}>
              <table className="w-full text-sm">
                <thead className="text-neutral-500 text-xs uppercase">
                  <tr>
                    <Th clave="fecha" className="py-1 px-0">Fecha</Th>
                    <Th clave="cantidad" alinear="derecha" className="py-1 px-0">Cantidad</Th>
                    <Th clave="costo" alinear="derecha" className="py-1 px-0">Costo</Th>
                    <Th clave="cambio" alinear="derecha" className="py-1 px-0">Cambio</Th>
                  </tr>
                </thead>
                <tbody>
                  {ordenHistorial.ordenar(conVariacion(historial.compras)).map((c, i) => (
                    <tr key={`${c.fecha}-${i}`} className="border-t border-neutral-100">
                      <td className="py-2">
                        {new Date(c.fecha).toLocaleDateString('es-VE')}
                        <span className="block text-[11px] text-neutral-400">{c.origen}</span>
                      </td>
                      <td className="py-2 text-right text-neutral-500 tabular-nums">
                        {Number(c.cantidad.toFixed(3))} {historial.ing.unidad}
                      </td>
                      <td className="py-2 text-right tabular-nums font-medium">
                        ${c.costo_unitario.toFixed(2)}
                      </td>
                      <td className="py-2 text-right tabular-nums w-16">
                        {c.cambio != null && Math.abs(c.cambio) >= 1 && (
                          <span className={c.cambio > 0 ? 'text-aviso-600' : 'text-exito-600'}>
                            {c.cambio > 0 ? '+' : ''}
                            {c.cambio.toFixed(0)}%
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Tabla>
          )}
        </Modal>
      )}
    </div>
  )
}
