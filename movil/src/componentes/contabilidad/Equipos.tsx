import { useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { apiContabilidad } from '../../lib/api-contabilidad'
import { useCarga } from '../../lib/carga'
import { avisar, confirmar } from '../../lib/dialogo'
import { miles } from '../../lib/formato'
import { useMoneda } from '../../lib/moneda'
import { LETRA, useTema } from '../../lib/tema'
import type { ActivoFijo } from '../../lib/tipos'
import { Pastilla } from '../kit'
import { Cargando, Ficha, Nota, Problema, Titulo } from '../ui'
import { usePedir } from './dialogos'
import { anioActual, BotonChico, mensajeDe, useRefrescoDeSeccion } from './piezas'

/**
 * EQUIPOS QUE SE GASTAN CON LOS AÑOS: nevera, horno, mesas. Cada uno se va
 * convirtiendo en gasto a lo largo de su vida util; la depreciacion se
 * asienta sola al abrir esta pantalla (o cualquier estado financiero). Las
 * mismas acciones de la web: dar de alta un equipo que ya se tenia, cambiar
 * su duracion, darlo de baja (y devolverlo si fue un error) y cerrar el
 * ejercicio del año pasado.
 */
export default function Equipos() {
  const t = useTema()
  const { fmt } = useMoneda()
  const { datos: activos, error, refrescando, refrescar } = useCarga(() => apiContabilidad.listarActivos(), 300)
  useRefrescoDeSeccion(refrescando, refrescar)
  const { pedir, hoja } = usePedir()
  const [errorAccion, setErrorAccion] = useState('')

  async function accion(fn: () => Promise<unknown>) {
    setErrorAccion('')
    try {
      await fn()
      refrescar()
    } catch (e) {
      setErrorAccion(mensajeDe(e, 'Ocurrió un error'))
    }
  }

  async function cambiarVida(a: ActivoFijo) {
    const r = await pedir({
      titulo: `Vida útil de ${a.nombre}`,
      texto: `A ${a.vida_util_meses} meses se gasta $${miles(a.cuota_mensual)} al mes.`,
      campos: [{ nombre: 'meses', etiqueta: 'Cuántos meses dura', tipo: 'entero', valor: a.vida_util_meses, min: 1 }],
    })
    if (!r) return
    void accion(() => apiContabilidad.actualizarActivo(a.id, { vida_util_meses: Number(r.meses) }))
  }

  async function reactivar(a: ActivoFijo) {
    // Marcar el equipo equivocado lo sacaba de los libros para siempre.
    if (
      !(await confirmar({
        titulo: `¿Devolver ${a.nombre} a los libros?`,
        texto: 'Vuelve con su valor y su depreciación acumulada tal como estaban, no como equipo nuevo.',
        aceptar: 'Devolver a los libros',
      }))
    )
      return
    void accion(() => apiContabilidad.reactivarActivo(a.id))
  }

  async function altaExistente() {
    // El horno que el dueño tenia desde antes de instalar el sistema tambien
    // se deprecia y cuenta en el balance.
    const r = await pedir({
      titulo: 'Equipo que ya tenías',
      texto: 'Lo que compraste antes de usar el sistema también se deprecia y cuenta en el balance.',
      campos: [
        { nombre: 'nombre', etiqueta: 'Qué equipo es', placeholder: 'Horno, nevera, moto...' },
        { nombre: 'valor', etiqueta: 'Cuánto vale hoy, aproximadamente', sufijo: '$', tipo: 'numero', min: 0.01 },
        { nombre: 'meses', etiqueta: 'En cuántos meses se gasta', tipo: 'entero', valor: 60, min: 1, ayuda: '60 = cinco años.' },
        { nombre: 'fecha', etiqueta: 'Cuándo lo compraste (aproximado)', tipo: 'fecha', opcional: true },
      ],
      aceptar: 'Dar de alta',
    })
    if (!r) return
    void accion(() =>
      apiContabilidad.registrarActivoExistente({
        nombre: r.nombre,
        valor: Number(r.valor),
        vida_util_meses: Number(r.meses) || 60,
        fecha_compra: r.fecha ? `${r.fecha}T00:00:00` : undefined,
      }),
    )
  }

  async function cerrarAnio() {
    const anio = anioActual() - 1
    if (
      !(await confirmar({
        titulo: `¿Cerrar el ejercicio ${anio}?`,
        texto:
          'Su resultado pasa a Utilidades retenidas y las cuentas de ingresos, costos y ' +
          'gastos de ese año quedan en cero. Sin esto, la utilidad acumulada del balance ' +
          'mezcla todos los años en un solo número.',
        aceptar: 'Cerrar ejercicio',
      }))
    )
      return
    try {
      const r = await apiContabilidad.cerrarEjercicio(anio)
      await avisar(`Ejercicio ${r.anio} cerrado`, `Resultado del año: $${miles(r.resultado)}`)
      refrescar()
    } catch (e) {
      setErrorAccion(mensajeDe(e, 'No se pudo cerrar el ejercicio'))
    }
  }

  async function darDeBaja(a: ActivoFijo) {
    const r = await pedir({
      titulo: `Dar de baja ${a.nombre}`,
      texto: `Le quedan $${miles(a.valor_en_libros)} sin depreciar, que se van a reconocer como pérdida de una vez.`,
      campos: [{ nombre: 'motivo', etiqueta: 'Qué pasó', valor: 'Se dañó' }],
      aceptar: 'Dar de baja',
      peligro: true,
    })
    if (!r) return
    void accion(() => apiContabilidad.darDeBajaActivo(a.id, r.motivo))
  }

  const lista = activos ?? []
  const enUso = lista.filter((a) => !a.dado_de_baja)
  const valorLibros = enUso.reduce((s, a) => s + a.valor_en_libros, 0)
  const cuotaMes = enUso.filter((a) => a.meses_depreciados < a.vida_util_meses).reduce((s, a) => s + a.cuota_mensual, 0)

  return (
    <>
      {errorAccion ? <Problema mensaje={errorAccion} /> : null}
      {error && !activos ? <Problema mensaje={error} alReintentar={refrescar} /> : null}
      {!activos && !error ? <Cargando /> : null}
      {activos ? (
        <Ficha style={{ gap: 12 }}>
          <View style={{ gap: 4 }}>
            <Titulo>Equipos y mobiliario</Titulo>
            <Text style={[estilos.valen, { color: t.suave }]}>
              valen hoy <Text style={[estilos.cifra, { color: t.tinta }]}>{fmt(valorLibros)}</Text>
              {cuotaMes > 0 ? (
                <>
                  {' '}
                  · se gastan <Text style={[estilos.cifra, { color: t.tinta }]}>{fmt(cuotaMes)}</Text> al mes
                </>
              ) : null}
            </Text>
            <Nota>
              Cada equipo se va convirtiendo en gasto a lo largo de su vida útil. Ese desgaste ya está descontado de la
              ganancia que ves en Reportes.
            </Nota>
          </View>
          <View style={estilos.acciones}>
            <BotonChico texto="ya lo tenía" icono="mas" tono="acento" alTocar={altaExistente} />
            <BotonChico texto="Cerrar ejercicio" alTocar={cerrarAnio} />
          </View>

          {lista.length === 0 ? (
            <Nota style={{ color: t.tenue }}>
              Sin equipos registrados. Se crean solos al cargar una factura de categoría Activos en Compras.
            </Nota>
          ) : null}

          {lista.map((a) => {
            const pct = a.valor > 0 ? (a.depreciacion_acumulada / a.valor) * 100 : 0
            const agotado = a.meses_depreciados >= a.vida_util_meses
            return (
              <View key={a.id} style={[estilos.equipo, { borderColor: t.gris200, opacity: a.dado_de_baja ? 0.6 : 1 }]}>
                <View style={estilos.cabeza}>
                  <Text style={[estilos.nombre, { color: t.tinta }]}>{a.nombre}</Text>
                  {!a.dado_de_baja && agotado ? <Pastilla texto="ya depreciado" tono="ojo" /> : null}
                  <View style={{ flex: 1 }} />
                  <Text style={[estilos.cifra, { color: t.tenue }]}>
                    {fmt(a.valor)} → <Text style={{ color: t.tinta }}>{fmt(a.valor_en_libros)}</Text>
                  </Text>
                </View>
                {a.dado_de_baja ? (
                  <>
                    <Nota>dado de baja{a.motivo_baja ? `: ${a.motivo_baja}` : ''}</Nota>
                    <View style={{ alignItems: 'flex-start' }}>
                      <BotonChico texto="Fue un error, devolverlo" tono="enlace" alTocar={() => reactivar(a)} />
                    </View>
                  </>
                ) : (
                  <>
                    <View style={[estilos.barra, { backgroundColor: t.gris100 }]}>
                      <View
                        style={{ height: '100%', width: `${Math.min(pct, 100)}%`, backgroundColor: agotado ? t.aviso : t.fuerte }}
                      />
                    </View>
                    <Nota>
                      {a.meses_depreciados} de {a.vida_util_meses} meses · {fmt(a.cuota_mensual)}/mes
                    </Nota>
                    <View style={estilos.acciones}>
                      <BotonChico texto="Cambiar duración" tono="enlace" alTocar={() => cambiarVida(a)} />
                      <BotonChico texto="Dar de baja" tono="enlacePeligro" alTocar={() => darDeBaja(a)} />
                    </View>
                  </>
                )}
              </View>
            )
          })}
        </Ficha>
      ) : null}
      {hoja}
    </>
  )
}

const estilos = StyleSheet.create({
  valen: { fontFamily: LETRA.texto, fontSize: 14.5, lineHeight: 21 },
  cifra: { fontFamily: LETRA.cifraFuerte, fontSize: 14 },
  acciones: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  equipo: { borderWidth: 1, borderRadius: 16, padding: 14, gap: 8 },
  cabeza: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
  nombre: { fontFamily: LETRA.textoFuerte, fontSize: 15 },
  barra: { height: 6, borderRadius: 3, overflow: 'hidden' },
})
