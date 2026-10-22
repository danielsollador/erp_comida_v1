import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { conversion } from '../../../../frontend/src/lib/compras'
import { palabrasDe } from '../../../../frontend/src/lib/parecidos'
import { apiCompras } from '../../lib/api-compras'
import { fechaDe, soloRif } from '../../lib/compras-app'
import { confirmar } from '../../lib/dialogo'
import { useMoneda } from '../../lib/moneda'
import { LETRA, useTema } from '../../lib/tema'
import type { Equivalencia, Proveedor, ProveedorResumen } from '../../lib/tipos'
import { Buscador, HojaFormulario, Kpi, ListaFicha, Pastilla, Renglon, Vacio } from '../kit'
import { Boton, Campo, Cargando, Ficha, Pantalla } from '../ui'
import { BotonTexto, Cabecera, mensajeDe, NotaTono } from './piezas'

/*
 * COMPRAS > PROVEEDORES (pages/Compras.tsx, seccion "proveedores"): el
 * directorio, la ficha de cada uno (cuanto se le compro, cuanto se le debe y
 * sus ultimas facturas) y lo que el sistema recuerda de sus facturas.
 */
export default function Proveedores({
  pestanas,
  proveedores,
  alCambiar,
  refrescando,
  alRefrescar,
}: {
  /** Las pestañas de Compras: van al principio de lo que se desplaza. */
  pestanas: ReactNode
  proveedores: Proveedor[] | null
  /** Se creo, edito o archivo uno: la lista se vuelve a pedir. */
  alCambiar: () => void
  refrescando: boolean
  alRefrescar: () => void
}) {
  const t = useTema()
  const [texto, setTexto] = useState('')
  const [ficha, setFicha] = useState<Proveedor | 'nuevo' | null>(null)
  const [error, setError] = useState('')

  const visibles = useMemo(() => {
    const palabras = palabrasDe(texto)
    const lista = proveedores ?? []
    if (!palabras.length) return lista
    return lista.filter((p) => {
      const todo = palabrasDe([p.nombre, p.rif, p.telefono, p.contacto].filter(Boolean).join(' ')).join(' ')
      return palabras.every((x) => todo.includes(x))
    })
  }, [proveedores, texto])

  async function archivar(p: Proveedor) {
    setError('')
    // En la web se archiva al instante con unos segundos para deshacer; la
    // app no tiene Deshacer, asi que se pregunta antes.
    if (
      p.activo &&
      !(await confirmar({ titulo: `¿Archivar a ${p.nombre}?`, texto: 'Deja de ofrecerse al cargar facturas. Sus facturas no cambian; se puede reactivar.', aceptar: 'Archivar' }))
    )
      return
    try {
      await apiCompras.archivarProveedor(p.id, !p.activo)
      setFicha(null)
      alCambiar()
    } catch (e) {
      setError(mensajeDe(e, 'No se pudo'))
    }
  }

  return (
    <Pantalla refrescando={refrescando} alRefrescar={alRefrescar}>
      {pestanas}
      <Ficha>
        <Cabecera titulo="Proveedores" ayuda="Elegir uno al cargar una factura completa su nombre y su RIF solos." />
        <Boton texto="Nuevo proveedor" icono="mas" alTocar={() => setFicha('nuevo')} />
      </Ficha>
      {error ? <NotaTono tono="mal">{error}</NotaTono> : null}
      {proveedores === null ? (
        <Cargando />
      ) : proveedores.length === 0 ? (
        <Vacio icono="usuarios" titulo="Sin proveedores registrados" detalle="Se pueden seguir cargando facturas igual, tipeando el nombre." />
      ) : (
        <>
          <Buscador valor={texto} alCambiar={setTexto} placeholder="Buscar por nombre, RIF o teléfono" />
          <ListaFicha>
            {visibles.map((p, i) => (
              <Renglon
                key={p.id}
                titulo={p.nombre}
                detalle={[p.rif || 'Sin RIF', p.telefono, p.contacto].filter(Boolean).join(' · ')}
                // Archivado NO apaga toda la fila: lo dice la pastilla.
                derecha={!p.activo ? <Pastilla texto="archivado" /> : undefined}
                alTocar={() => setFicha(p)}
                ultima={i === visibles.length - 1}
              />
            ))}
            {visibles.length === 0 ? <Text style={[s.nota, { color: t.tenue, padding: 16 }]}>Ningún proveedor coincide.</Text> : null}
          </ListaFicha>
        </>
      )}
      <MemoriaProveedores proveedores={proveedores ?? []} />
      <FichaProveedor
        ficha={ficha}
        alCerrar={() => setFicha(null)}
        alGuardar={() => {
          setFicha(null)
          alCambiar()
        }}
        alArchivar={(p) => void archivar(p)}
      />
    </Pantalla>
  )
}

function FichaProveedor({
  ficha,
  alCerrar,
  alGuardar,
  alArchivar,
}: {
  ficha: Proveedor | 'nuevo' | null
  alCerrar: () => void
  alGuardar: () => void
  alArchivar: (p: Proveedor) => void
}) {
  if (!ficha) return null
  return <FichaAbierta proveedor={ficha === 'nuevo' ? null : ficha} alCerrar={alCerrar} alGuardar={alGuardar} alArchivar={alArchivar} />
}

function FichaAbierta({
  proveedor,
  alCerrar,
  alGuardar,
  alArchivar,
}: {
  proveedor: Proveedor | null
  alCerrar: () => void
  alGuardar: () => void
  alArchivar: (p: Proveedor) => void
}) {
  const t = useTema()
  const { fmt } = useMoneda()
  const [nombre, setNombre] = useState(proveedor?.nombre ?? '')
  const [rif, setRif] = useState(proveedor?.rif ?? '')
  const [telefono, setTelefono] = useState(proveedor?.telefono ?? '')
  const [direccion, setDireccion] = useState(proveedor?.direccion ?? '')
  const [contacto, setContacto] = useState(proveedor?.contacto ?? '')
  const [nota, setNota] = useState(proveedor?.nota ?? '')
  const [error, setError] = useState('')
  const [guardando, setGuardando] = useState(false)
  // La ficha de verdad: cuanto se le compro, cuanto se le debe y sus
  // ultimas facturas.
  const [resumen, setResumen] = useState<ProveedorResumen | null>(null)
  useEffect(() => {
    if (!proveedor) return
    apiCompras
      .resumenProveedor(proveedor.id)
      .then(setResumen)
      .catch(() => setResumen(null))
  }, [proveedor])

  async function guardar() {
    if (!nombre.trim()) return setError('El nombre es obligatorio')
    setError('')
    setGuardando(true)
    try {
      const datos = { nombre: nombre.trim(), rif: rif.trim() || null, telefono, direccion, contacto, nota }
      if (proveedor) await apiCompras.editarProveedor(proveedor.id, datos)
      else await apiCompras.crearProveedor(datos)
      alGuardar()
    } catch (e) {
      setError(mensajeDe(e, 'No se pudo guardar'))
    } finally {
      setGuardando(false)
    }
  }

  return (
    <HojaFormulario
      visible
      alCerrar={alCerrar}
      titulo={proveedor ? proveedor.nombre : 'Nuevo proveedor'}
      pie={
        <>
          <View style={{ flex: 1 }}>
            <Boton texto="Cancelar" tono="neutro" alTocar={alCerrar} />
          </View>
          <View style={{ flex: 1 }}>
            <Boton texto="Guardar" alTocar={() => void guardar()} ocupado={guardando} />
          </View>
        </>
      }
    >
      {error ? <NotaTono tono="mal">{error}</NotaTono> : null}
      {proveedor && resumen ? (
        <View style={{ gap: 10 }}>
          <View style={s.kpis}>
            <Kpi etiqueta="Comprado" cifra={fmt(resumen.comprado)} nota={`${resumen.facturas} factura${resumen.facturas === 1 ? '' : 's'} · sin IVA`} />
            <Kpi
              etiqueta="Se le debe"
              cifra={fmt(resumen.deuda)}
              nota={resumen.vencidas > 0 ? `${resumen.vencidas} vencida${resumen.vencidas === 1 ? '' : 's'}` : resumen.deuda > 0 ? 'a crédito' : 'Nada pendiente'}
              tono={resumen.vencidas > 0 ? 'aviso' : undefined}
              color={resumen.vencidas > 0 ? t.avisoFuerte : resumen.deuda > 0 ? undefined : t.exito}
            />
            <Kpi
              etiqueta="Última compra"
              cifra={resumen.ultima_compra ? fechaDe(resumen.ultima_compra) : '—'}
              nota={
                resumen.alertas_pendientes > 0
                  ? `${resumen.alertas_pendientes} alerta${resumen.alertas_pendientes === 1 ? '' : 's'} de precio sin ver`
                  : 'Sin alertas de precio'
              }
              tono={resumen.alertas_pendientes > 0 ? 'aviso' : undefined}
            />
          </View>
          {resumen.ultimas.length > 0 ? (
            <ListaFicha titulo="Últimas facturas">
              {resumen.ultimas.map((u, i) => (
                <Renglon
                  key={u.id}
                  titulo={u.numero_factura}
                  detalle={fechaDe(u.fecha)}
                  valor={fmt(u.total)}
                  subvalor={
                    u.forma_pago === 'Credito' ? (
                      <Pastilla texto={u.pagada ? 'Pagada' : `Debe ${fmt(u.saldo)}`} tono={u.pagada ? 'bien' : 'ojo'} />
                    ) : (
                      u.forma_pago
                    )
                  }
                  ultima={i === resumen.ultimas.length - 1}
                />
              ))}
            </ListaFicha>
          ) : null}
        </View>
      ) : null}
      <Campo rotulo="Nombre" value={nombre} onChangeText={setNombre} />
      <Campo rotulo="RIF" value={rif} onChangeText={setRif} placeholder="J-12345678-9 (opcional)" autoCapitalize="characters" autoCorrect={false} />
      <Campo rotulo="Teléfono" value={telefono} onChangeText={setTelefono} keyboardType="phone-pad" />
      <Campo rotulo="Dirección" value={direccion} onChangeText={setDireccion} />
      <Campo rotulo="Persona de contacto" value={contacto} onChangeText={setContacto} />
      <Campo rotulo="Nota" value={nota} onChangeText={setNota} />
      {proveedor ? (
        // Lo que saca de la lista va aparte, lejos de Guardar.
        <View style={{ alignItems: 'flex-start', marginTop: 8 }}>
          <BotonTexto texto={proveedor.activo ? 'Archivar' : 'Reactivar'} tono={proveedor.activo ? 'peligro' : 'acento'} alTocar={() => alArchivar(proveedor)} />
        </View>
      ) : null}
    </HojaFormulario>
  )
}

/**
 * Lo que el sistema recuerda de las facturas de cada proveedor. Olvidar una
 * asociacion mal aprendida es seguro: la proxima factura la vuelve a
 * aprender de lo que quede guardado.
 */
function MemoriaProveedores({ proveedores }: { proveedores: Proveedor[] }) {
  const t = useTema()
  const [filas, setFilas] = useState<Equivalencia[] | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    apiCompras
      .equivalencias()
      .then(setFilas)
      .catch((e: unknown) => setError(mensajeDe(e, 'No se pudo cargar')))
  }, [])

  // La ficha manda; sin ficha, como venia en la ultima factura.
  const nombreDe = (e: Equivalencia) =>
    proveedores.find((p) => p.rif && soloRif(p.rif) === soloRif(e.proveedor_rif))?.nombre || e.proveedor_nombre || e.proveedor_rif

  async function olvidar(e: Equivalencia) {
    setError('')
    try {
      await apiCompras.olvidarEquivalencia(e.id)
      setFilas((prev) => (prev ?? []).filter((x) => x.id !== e.id))
    } catch (err) {
      setError(mensajeDe(err, 'No se pudo olvidar'))
    }
  }

  return (
    <Ficha>
      <Cabecera
        titulo="Lo que se recuerda de sus facturas"
        ayuda="Se aprende al guardar una factura cargada desde foto: qué mercancía es cada renglón y cómo se convierte su unidad. La próxima factura de ese proveedor llega con esos renglones ya asociados."
      />
      {error ? <NotaTono tono="mal">{error}</NotaTono> : null}
      {filas === null ? null : filas.length === 0 ? (
        <Text style={[s.nota, { color: t.tenue }]}>Todavía no se recuerda nada. Carga una factura desde foto y guárdala.</Text>
      ) : (
        filas.map((e, i) => (
          <View key={e.id} style={[s.memoria, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.gris200 }]}>
            <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
              <Text style={[s.papel, { color: t.tinta }]} numberOfLines={2}>
                {e.descripcion}
              </Text>
              <Text style={[s.nota, { color: t.suave }]}>
                Es <Text style={{ fontFamily: LETRA.textoFuerte, color: t.fuerte }}>{e.ingrediente_nombre}</Text> ({e.unidad})
                {conversion(e.factor, e.unidad_papel, e.unidad) ? ` · ${conversion(e.factor, e.unidad_papel, e.unidad)}` : ''}
              </Text>
              <Text style={[s.nota, { color: t.tenue }]}>
                {nombreDe(e)} · {e.veces === 1 ? '1 factura' : `${e.veces} facturas`}
              </Text>
            </View>
            {/* Olvidar borra lo aprendido: se ve como lo que es. */}
            <BotonTexto texto="Olvidar" tono="peligro" alTocar={() => void olvidar(e)} />
          </View>
        ))
      )}
    </Ficha>
  )
}

const s = StyleSheet.create({
  nota: { fontFamily: LETRA.texto, fontSize: 13.5, lineHeight: 19 },
  kpis: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  memoria: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 10 },
  papel: { fontFamily: LETRA.cifra, fontSize: 13.5 },
})
