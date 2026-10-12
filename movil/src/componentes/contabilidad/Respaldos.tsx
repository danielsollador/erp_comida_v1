import * as DocumentPicker from 'expo-document-picker'
import { useState } from 'react'
import { Text, View } from 'react-native'
import { apiContabilidad } from '../../lib/api-contabilidad'
import { formularioConArchivo } from '../../lib/archivos'
import { useCarga } from '../../lib/carga'
import { confirmar } from '../../lib/dialogo'
import { miles } from '../../lib/formato'
import { useTema } from '../../lib/tema'
import type { PrevisualizacionRestauracion, Respaldo, Restauracion } from '../../lib/tipos'
import { Hoja, OpcionHoja } from '../Hoja'
import { FilaFiltros, HojaFormulario, ListaFicha, Renglon, Selector } from '../kit'
import { Boton, Cargando, Nota, Problema, Titulo } from '../ui'
import { bajar, Caja, fechaHoraVE, fechaVE, horasDesde, mensajeDe, p, useRefrescoDeSeccion, useTintaDe } from './piezas'

/** Respaldo elegido para restaurar, con lo que se pierde ya calculado. */
type Candidato = { respaldo: Respaldo; previo: PrevisualizacionRestauracion }

type OrdenRespaldos = '-fecha' | 'fecha' | '-tamano' | 'tamano'

const ORDENES: { valor: OrdenRespaldos; texto: string }[] = [
  { valor: '-fecha', texto: 'Fecha, el más reciente primero' },
  { valor: 'fecha', texto: 'Fecha, el más viejo primero' },
  { valor: '-tamano', texto: 'Tamaño, el más grande primero' },
  { valor: 'tamano', texto: 'Tamaño, el más chico primero' },
]

/**
 * LOS RESPALDOS DE LA BASE: generarlos, bajarlos y restaurar (la
 * pages/partes/Respaldos.tsx de la web). La copia automatica corre en el
 * servidor; restaurar es la palanca de emergencia el dia que algo se rompe,
 * con las mismas confirmaciones que la web: antes de restaurar se ve cuantos
 * pedidos y cuanta plata se pierden, y el servidor no lo hace sin
 * `confirmar: true`.
 */
export default function Respaldos() {
  const t = useTema()
  const { datos, error, refrescando, refrescar } = useCarga(async () => {
    const [respaldos, estado] = await Promise.all([
      apiContabilidad.listarRespaldos(),
      apiContabilidad.estadoRespaldos().catch(() => null),
    ])
    return { respaldos, estado }
  }, 120)
  useRefrescoDeSeccion(refrescando, refrescar)
  const [orden, setOrden] = useState<OrdenRespaldos>('-fecha')
  const [creando, setCreando] = useState(false)
  const [elegido, setElegido] = useState<Respaldo | null>(null)
  const [candidato, setCandidato] = useState<Candidato | null>(null)
  const [restaurando, setRestaurando] = useState(false)
  const [bajando, setBajando] = useState(false)
  const [hecho, setHecho] = useState<Restauracion | null>(null)
  const [errorAccion, setErrorAccion] = useState('')

  const respaldos = datos?.respaldos ?? []
  const estado = datos?.estado ?? null
  // El mas reciente es el que se restaura en el 99 % de los casos.
  const ordenados = [...respaldos].sort((a, b) => {
    switch (orden) {
      case 'fecha':
        return a.creado_en.localeCompare(b.creado_en)
      case '-tamano':
        return b.tamano_kb - a.tamano_kb
      case 'tamano':
        return a.tamano_kb - b.tamano_kb
      default:
        return b.creado_en.localeCompare(a.creado_en)
    }
  })
  const ultimo = [...respaldos].sort((a, b) => b.creado_en.localeCompare(a.creado_en))[0]
  const horasDesdeUltimo = ultimo ? horasDesde(ultimo.creado_en) : null
  const descargaVencida = estado != null && (estado.dias_sin_descargar == null || estado.dias_sin_descargar >= 7)
  const tonoEstado = estado?.ultimo_fallo ? 'peligro' : horasDesdeUltimo !== null && horasDesdeUltimo <= 8 ? 'exito' : 'aviso'
  const tintaEstado = useTintaDe(tonoEstado)
  const tintaAcento = useTintaDe('acento')

  async function crearAhora() {
    setCreando(true)
    setErrorAccion('')
    try {
      await apiContabilidad.crearRespaldo()
      refrescar()
    } catch (e) {
      setErrorAccion(mensajeDe(e, 'No se pudo respaldar'))
    } finally {
      setCreando(false)
    }
  }

  async function descargar(r: Respaldo) {
    setElegido(null)
    setBajando(true)
    setErrorAccion('')
    try {
      await bajar(apiContabilidad.rutaDescargaRespaldo(r.nombre), r.nombre)
      // El servidor anota la descarga: "Bajaste una copia hoy".
      refrescar()
    } catch (e) {
      setErrorAccion(mensajeDe(e, 'No se pudo descargar el respaldo'))
    } finally {
      setBajando(false)
    }
  }

  async function elegirParaRestaurar(r: Respaldo) {
    setElegido(null)
    setErrorAccion('')
    try {
      const previo = await apiContabilidad.previsualizarRestauracion(r.nombre)
      setCandidato({ respaldo: r, previo })
    } catch (e) {
      setErrorAccion(mensajeDe(e, 'No se pudo revisar ese respaldo'))
    }
  }

  async function restaurar() {
    if (!candidato) return
    setRestaurando(true)
    setErrorAccion('')
    try {
      const resultado = await apiContabilidad.restaurarRespaldo(candidato.respaldo.nombre)
      setCandidato(null)
      setHecho(resultado)
      refrescar()
    } catch (e) {
      setErrorAccion(mensajeDe(e, 'No se pudo restaurar'))
    } finally {
      setRestaurando(false)
    }
  }

  // Si murio el disco, la lista esta vacia y el unico respaldo que existe es
  // el que alguien se llevo en el telefono.
  async function desdeArchivo() {
    const r = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: true })
    if (r.canceled || !r.assets?.[0]) return
    const archivo = r.assets[0]
    if (
      !(await confirmar({
        titulo: `¿Restaurar desde ${archivo.name}?`,
        texto: 'La base actual se reemplaza. Lo vendido después de ese respaldo se pierde.',
        aceptar: 'Restaurar',
        peligro: true,
      }))
    )
      return
    setRestaurando(true)
    setErrorAccion('')
    try {
      const datosArchivo = await formularioConArchivo('archivo', {
        uri: archivo.uri,
        nombre: archivo.name,
        tipo: archivo.mimeType ?? 'application/octet-stream',
      })
      setHecho(await apiContabilidad.restaurarDesdeArchivo(datosArchivo))
      refrescar()
    } catch (e) {
      setErrorAccion(mensajeDe(e, 'No se pudo restaurar'))
    } finally {
      setRestaurando(false)
    }
  }

  if (error && !datos) return <Problema mensaje={error} alReintentar={refrescar} />
  if (!datos) return <Cargando />

  const restauracion = hecho ?? estado?.restauracion_reciente ?? null

  return (
    <>
      {/* Restaurar deja la caja del dia descuadrada: la plata fisica es la de
          ahora, la base volvio a hace unas horas. Se dice, no se esconde. */}
      {restauracion ? (
        <Caja tono="acento">
          <Text style={[p.textoFuerte, { color: tintaAcento }]}>Se restauró un respaldo</Text>
          <Text style={[p.nota, { color: tintaAcento }]}>
            {fechaHoraVE(restauracion.fecha)} · desde {restauracion.restaurado_desde}
          </Text>
          <Text style={[p.nota, { color: tintaAcento }]}>
            {restauracion.pedidos_perdidos == null
              ? 'No se pudo medir cuánto se perdió.'
              : `Se perdieron ${restauracion.pedidos_perdidos} pedido(s) por $${miles(restauracion.monto_perdido ?? 0)}.`}{' '}
            Vuelve a cargar las ventas que se hicieron después, o el cierre de caja de hoy va a dar un faltante que no es
            faltante.
          </Text>
          <Text style={[p.nota, { color: tintaAcento }]}>La base que había antes quedó guardada como {restauracion.respaldo_previo}.</Text>
        </Caja>
      ) : null}

      {errorAccion ? <Problema mensaje={errorAccion} /> : null}

      <Caja tono={tonoEstado}>
        <Text style={[p.textoFuerte, { color: t.tinta }]}>Respaldo de la base de datos</Text>
        {/* Un respaldo roto solo se veia en el log del servidor: aqui se dice
            desde cuando y por que. */}
        {estado?.ultimo_fallo ? (
          <>
            <Text style={[p.nota, { color: tintaEstado, fontWeight: '600' }]}>
              El respaldo automático está fallando desde el {fechaHoraVE(estado.ultimo_fallo.fecha)}. La base no tiene copia
              nueva desde entonces.
            </Text>
            <Text style={[p.nota, { color: tintaEstado }]}>{estado.ultimo_fallo.error}</Text>
          </>
        ) : null}
        <Text style={[p.texto, { color: t.fuerte }]}>
          {ultimo ? `Último respaldo hace ${horasDesdeUltimo} hora(s), automático.` : 'Todavía no hay respaldos generados.'}
        </Text>
        {estado?.dia_mas_viejo ? (
          <Text style={[p.texto, { color: t.fuerte }]}>
            {estado.cantidad} copias guardadas. Puedes volver atras hasta el {fechaVE(estado.dia_mas_viejo)}.
          </Text>
        ) : null}
        <Nota>
          El sistema guarda una copia sola cada pocas horas y conserva la última de cada día del último mes. Eso protege
          contra corrupción o borrado accidental en esta misma máquina.
        </Nota>
      </Caja>

      {/* La copia dentro de la maquina no salva de perder la maquina. */}
      <Caja tono={descargaVencida ? 'peligro' : 'neutro'}>
        <Text style={[p.textoFuerte, { color: t.tinta }]}>Copia fuera de esta maquina</Text>
        <Text style={[p.texto, { color: t.fuerte }]}>
          {estado?.dias_sin_descargar == null
            ? 'Nunca se ha bajado un respaldo de aqui.'
            : estado.dias_sin_descargar === 0
              ? 'Bajaste una copia hoy.'
              : `Hace ${estado.dias_sin_descargar} día(s) que no bajas una copia.`}
        </Text>
        <Nota>
          Si la laptop se pierde, se moja o se la roban, los respaldos de arriba se pierden con ella. Baja el último
          respaldo una vez por semana y guárdalo en un USB, tu correo o tu teléfono.
          {estado?.copia_externa ? ` Además se copia solo a ${estado.copia_externa}.` : ''}
        </Nota>
      </Caja>

      <Boton texto={creando ? 'Generando...' : 'Generar respaldo ahora'} alTocar={crearAhora} ocupado={creando} />

      <FilaFiltros>
        <Selector<OrdenRespaldos> etiqueta="Ordenar" titulo="Ordenar los respaldos" opciones={ORDENES} valor={orden} alCambiar={setOrden} />
      </FilaFiltros>
      {bajando ? <Nota>Descargando el respaldo…</Nota> : null}
      <ListaFicha titulo="Respaldos guardados">
        {ordenados.map((r, i) => (
          <Renglon
            key={r.nombre}
            titulo={fechaHoraVE(r.creado_en)}
            detalle={r.nombre}
            valor={`${miles(r.tamano_kb, 0)} KB`}
            alTocar={() => setElegido(r)}
            ultima={i === ordenados.length - 1}
          />
        ))}
        {respaldos.length === 0 ? <Nota style={{ padding: 16 }}>Sin respaldos todavía.</Nota> : null}
      </ListaFicha>

      <Caja tono="neutro" style={{ gap: 10 }}>
        <Titulo>Restaurar desde un archivo</Titulo>
        <Nota>
          Si esta máquina es nueva o se formateó, busca aquí el respaldo que tengas guardado en el USB, el correo o el
          teléfono.
        </Nota>
        <Boton texto="Elegir el archivo" tono="neutro" icono="factura" alTocar={desdeArchivo} ocupado={restaurando && !candidato} />
      </Caja>

      {/* Lo que se hace con un respaldo de la lista: bajarlo o restaurarlo. */}
      <Hoja visible={elegido !== null} alCerrar={() => setElegido(null)} titulo={elegido ? fechaHoraVE(elegido.creado_en) : undefined}>
        <OpcionHoja texto="Descargar" detalle="Guárdalo en el USB, el correo o el teléfono." alTocar={() => elegido && descargar(elegido)} />
        <OpcionHoja
          texto="Restaurar"
          detalle="Antes se ve cuántos pedidos y cuánta plata se pierden."
          peligro
          alTocar={() => elegido && elegirParaRestaurar(elegido)}
        />
      </Hoja>

      <Restaurar candidato={candidato} restaurando={restaurando} alCancelar={() => setCandidato(null)} alConfirmar={restaurar} />
    </>
  )
}

/** El dueño no decide viendo un nombre de archivo: decide viendo cuantos pedidos y cuanta plata desaparecen. */
function Restaurar({
  candidato,
  restaurando,
  alCancelar,
  alConfirmar,
}: {
  candidato: Candidato | null
  restaurando: boolean
  alCancelar: () => void
  alConfirmar: () => void
}) {
  const t = useTema()
  const tinta = useTintaDe('aviso')
  const previo = candidato?.previo
  return (
    <HojaFormulario
      visible={candidato !== null}
      alCerrar={() => (restaurando ? null : alCancelar())}
      titulo="Restaurar este respaldo"
      subtitulo={candidato ? `Del ${fechaHoraVE(candidato.respaldo.creado_en)}` : undefined}
      pie={
        <>
          <View style={{ flex: 1 }}>
            <Boton texto="Cancelar" tono="neutro" alTocar={alCancelar} deshabilitado={restaurando} />
          </View>
          <View style={{ flex: 1 }}>
            <Boton texto={restaurando ? 'Restaurando...' : 'Si, restaurar'} tono="peligro" alTocar={alConfirmar} ocupado={restaurando} />
          </View>
        </>
      }
    >
      {previo ? (
        <Caja tono="aviso">
          {previo.pedidos_que_se_pierden == null ? (
            <Text style={[p.textoFuerte, { color: tinta }]}>
              No se pudo calcular cuánto se pierde. Puede ser mucho: revisa las ventas de hoy antes de restaurar.
            </Text>
          ) : previo.pedidos_que_se_pierden > 0 ? (
            <>
              <Text style={[p.textoFuerte, { color: tinta }]}>
                Vas a perder {previo.pedidos_que_se_pierden} pedido(s) por ${miles(previo.monto_que_se_pierde ?? 0)}.
              </Text>
              <Text style={[p.nota, { color: tinta }]}>
                Es todo lo cobrado después de {previo.corte ? fechaHoraVE(previo.corte) : 'el inicio'}. También se pierden
                las compras, gastos y mermas de ese rato.
              </Text>
            </>
          ) : (
            <Text style={[p.texto, { color: tinta }]}>No hay ventas posteriores a este respaldo: no se pierden pedidos.</Text>
          )}
        </Caja>
      ) : null}
      <Nota style={{ color: t.suave }}>
        Antes de reemplazar, el sistema guarda una copia de la base actual. Si restaurar fue el error, se puede volver desde
        esa copia.
      </Nota>
    </HojaFormulario>
  )
}
