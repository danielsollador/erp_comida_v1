import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { useDialogo } from '../dialogo'
import { VistaSoporte } from '../FacturaDesdeFoto'
import Icono from '../Icono'
import { api } from '../../lib/api'
import { achicarFoto, revisarFoto, TEXTO_PROBLEMA, type Problema } from '../../lib/foto'
import { unirFotosEnPdf } from '../../lib/pdfDeFotos'
import type { LecturaFactura } from '../../lib/types'

/**
 * La entrada de la factura por foto o PDF, y el visor que la deja a la vista
 * mientras se revisa. Es lo que estaba al pie de CargarFactura.tsx: la carga
 * se reescribio alrededor de los cuatro almacenes y estas piezas no cambian.
 */
/**
 * Donde entra la factura. No aparece si la lectura con IA no está activada.
 *
 * EN EL TELEFONO Y LA TABLET (el cliente, 6-oct: "que pueda escanear desde el
 * telefono... abrir camara o en su defecto cargar imagenes, no pdf"): dos
 * botones que dicen lo que hacen, "Tomar foto" (la camara trasera, directo) y
 * "Elegir de la galería". Antes era un solo boton que abria el selector de
 * archivos, y la camara habia que encontrarla adentro. El PDF queda para la
 * computadora, que es donde llegan las facturas por correo.
 *
 * EN LA COMPUTADORA: elegir foto o PDF, arrastrarla, o pegarla con Ctrl+V.
 *
 * Cada foto se REVISA al llegar (`lib/foto.ts`): movida, oscura o demasiado
 * chica se marca en su miniatura y se avisa antes de leer, para no gastar
 * una lectura de IA en una foto que va a salir mal. Igual se puede leer.
 */
// Paginas de una misma factura que se pueden juntar: una factura larga llega
// en dos o tres fotos. Achicadas pesan unos cientos de KB cada una.
const MAX_PAGINAS = 8

const esPdf = (f: File) => f.type === 'application/pdf'
const esFoto = (f: File) => f.type.startsWith('image/')
// Un dedo y no un mouse: telefono o tablet. Es lo mismo que mira el modo
// ligero (lib/ligero.ts) para saber que es una tablet.
const esTactil = () => typeof window !== 'undefined' && Boolean(window.matchMedia?.('(pointer: coarse)').matches)

type Pagina = { archivo: File; url: string; problemas: Problema[] | null }

export function ZonaDocumento({ onLeida }: { onLeida: (l: LecturaFactura, url: string, esPdf: boolean) => void }) {
  const dialogo = useDialogo()
  const [activo, setActivo] = useState(false)
  const [leyendo, setLeyendo] = useState(false)
  const [terminando, setTerminando] = useState(false)
  const [encima, setEncima] = useState(false)
  const [error, setError] = useState('')
  const [tactil] = useState(esTactil)
  // Las fotos de la factura, en orden, antes de leerlas: asi se puede sacar
  // la segunda foto con el telefono despues de la primera. `problemas` en
  // null mientras se revisa.
  const [paginas, setPaginas] = useState<Pagina[]>([])
  const entrada = useRef<HTMLInputElement>(null)
  const camara = useRef<HTMLInputElement>(null)
  const galeria = useRef<HTMLInputElement>(null)

  useEffect(() => {
    api
      .estadoLectorFacturas()
      .then((e) => setActivo(e.activo))
      .catch(() => setActivo(false))
  }, [])

  // Las miniaturas viven mientras esten en la bandeja.
  const urls = useRef<string[]>([])
  urls.current = paginas.map((p) => p.url)
  useEffect(() => () => urls.current.forEach((u) => URL.revokeObjectURL(u)), [])

  function recibir(lista: File[]) {
    if (leyendo || lista.length === 0) return
    setError('')
    const validos = lista.filter((f) => esFoto(f) || esPdf(f))
    if (validos.length < lista.length) return setError(tactil ? 'Tiene que ser una foto.' : 'Tiene que ser una foto o un PDF.')
    const pdfs = validos.filter(esPdf)
    if (pdfs.length > 0) {
      // Un PDF ya es el documento entero: no se mezcla con fotos.
      if (validos.length > 1 || paginas.length > 0) return setError('Un PDF se carga solo, sin fotos al lado.')
      return leer([pdfs[0]])
    }
    if (paginas.length + validos.length > MAX_PAGINAS) return setError(`Hasta ${MAX_PAGINAS} fotos por factura.`)
    const nuevas: Pagina[] = validos.map((archivo) => ({ archivo, url: URL.createObjectURL(archivo), problemas: null }))
    setPaginas((prev) => [...prev, ...nuevas])
    // La revision corre aparte: la miniatura aparece al instante y el aviso,
    // si lo hay, unos milisegundos despues.
    for (const p of nuevas) {
      revisarFoto(p.archivo).then((problemas) =>
        setPaginas((prev) => prev.map((x) => (x.url === p.url ? { ...x, problemas } : x))),
      )
    }
  }

  function quitar(i: number) {
    setPaginas((prev) => {
      URL.revokeObjectURL(prev[i].url)
      return prev.filter((_, j) => j !== i)
    })
  }

  async function leer(archivos: File[]) {
    if (archivos.length === 0 || leyendo) return
    setError('')
    setLeyendo(true)
    try {
      // Una foto se sube sola; varias se unen en un PDF de una pagina por
      // foto, y para el resto del sistema es un PDF como cualquier otro.
      const achicadas = await Promise.all(archivos.map((a) => achicarFoto(a)))
      const subido = achicadas.length === 1 ? achicadas[0] : await unirFotosEnPdf(achicadas)
      const lectura = await api.leerFacturaCompra(subido)
      // La barra llega al final antes de cambiar de pantalla: que se vea que
      // termino, no que se corto.
      setTerminando(true)
      await new Promise((r) => setTimeout(r, 350))
      paginas.forEach((p) => URL.revokeObjectURL(p.url))
      setPaginas([])
      onLeida(lectura, URL.createObjectURL(subido), subido.type === 'application/pdf')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo leer el archivo')
    } finally {
      setLeyendo(false)
      setTerminando(false)
      for (const r of [entrada, camara, galeria]) if (r.current) r.current.value = ''
    }
  }

  // Antes de leer: si alguna foto salio mal, se dice cual y por que. Repetirla
  // cuesta un toque; leerla mal cuesta una lectura y llenar a mano.
  async function leerRevisadas() {
    const malas = paginas
      .map((p, i) => ({ i, problemas: p.problemas ?? [] }))
      .filter((p) => p.problemas.length > 0)
    if (malas.length > 0) {
      const sola = paginas.length === 1
      const lineas = malas.map(
        (m) => `${sola ? 'La foto' : `La foto ${m.i + 1}`} ${m.problemas.map((x) => TEXTO_PROBLEMA[x]).join(' y ')}.`,
      )
      const seguir = await dialogo.confirmar({
        titulo: sola ? 'Esta foto puede leerse mal' : 'Hay fotos que pueden leerse mal',
        texto: `${lineas.join(' ')} La IA puede equivocarse o no leer nada. Si puedes, tómala de nuevo con buena luz y el teléfono quieto.`,
        aceptar: 'Leer igual',
        cancelar: 'Volver',
      })
      if (!seguir) return
    }
    return leer(paginas.map((p) => p.archivo))
  }

  // Pegar una captura o un PDF copiado (Ctrl+V), sin pasar por el disco.
  useEffect(() => {
    if (!activo) return
    const alPegar = (e: ClipboardEvent) => {
      const archivos = Array.from(e.clipboardData?.files ?? []).filter((f) => esFoto(f) || esPdf(f))
      if (archivos.length > 0) {
        e.preventDefault()
        recibir(archivos)
      }
    }
    window.addEventListener('paste', alPegar)
    return () => window.removeEventListener('paste', alPegar)
  })

  if (!activo) return null
  const alElegir = (e: ChangeEvent<HTMLInputElement>) => {
    recibir(Array.from(e.target.files ?? []))
    e.target.value = ''
  }
  const conProblemas = paginas.filter((p) => p.problemas && p.problemas.length > 0).length
  return (
    <div
      onDragOver={(e) => {
        e.preventDefault()
        setEncima(true)
      }}
      onDragLeave={() => setEncima(false)}
      onDrop={(e) => {
        e.preventDefault()
        setEncima(false)
        recibir(Array.from(e.dataTransfer.files ?? []))
      }}
      className={`rounded-2xl border-2 border-dashed p-6 text-center transition-colors ${
        encima ? 'border-acento-500 bg-acento-50' : 'border-neutral-300 bg-white'
      }`}
    >
      {/* Computadora: foto o PDF, varias a la vez. */}
      <input ref={entrada} type="file" multiple accept="image/*,application/pdf" className="hidden" onChange={alElegir} />
      {/* Telefono: la camara trasera directo (`capture`), una foto por vez. */}
      <input ref={camara} type="file" accept="image/*" capture="environment" className="hidden" onChange={alElegir} />
      {/* Telefono: la galeria, varias fotos, sin PDF. */}
      <input ref={galeria} type="file" multiple accept="image/*" className="hidden" onChange={alElegir} />
      {leyendo ? (
        <EsperaLectura terminando={terminando} />
      ) : paginas.length > 0 ? (
        <div className="space-y-3">
          <p className="text-sm font-semibold">
            {paginas.length === 1 ? '1 foto' : `${paginas.length} fotos`} de la misma factura
          </p>
          <div className="flex flex-wrap justify-center gap-2">
            {paginas.map((p, i) => {
              const mala = p.problemas !== null && p.problemas.length > 0
              return (
                <div key={p.url} className="relative">
                  <img
                    src={p.url}
                    alt={`Página ${i + 1}`}
                    className={`h-24 w-20 object-cover rounded-lg border ${mala ? 'border-2 border-aviso-500' : 'border-neutral-200'}`}
                  />
                  <span className="absolute left-1 top-1 rounded bg-neutral-900/80 px-1.5 text-[10px] font-semibold text-white">{i + 1}</span>
                  {mala && (
                    <span className="absolute inset-x-1 bottom-1 rounded bg-aviso-500 px-1 text-[10px] font-semibold text-white">
                      {p.problemas!.includes('movida') ? 'Movida' : p.problemas!.includes('pequena') ? 'Muy chica' : 'Oscura'}
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => quitar(i)}
                    aria-label={`Quitar la foto ${i + 1}`}
                    className="absolute -right-1.5 -top-1.5 h-6 w-6 rounded-full bg-white border border-neutral-300 text-xs leading-none shadow-sm"
                  >
                    ✕
                  </button>
                </div>
              )
            })}
            {paginas.length < MAX_PAGINAS && (
              <button
                type="button"
                onClick={() => (tactil ? camara : entrada).current?.click()}
                className="h-24 w-20 rounded-lg border-2 border-dashed border-neutral-300 text-xs text-neutral-500 hover:border-acento-500 inline-flex flex-col items-center justify-center gap-1"
              >
                {tactil && <Icono nombre="camara" size={18} />}
                Otra
                <br />
                página
              </button>
            )}
          </div>
          {conProblemas > 0 && (
            <p className="text-xs text-aviso-700">
              {conProblemas === 1 ? 'Una foto' : `${conProblemas} fotos`} pueden leerse mal: toca ✕ y tómala de nuevo.
            </p>
          )}
          <button
            onClick={() => void leerRevisadas()}
            className="inline-flex items-center gap-2 bg-neutral-900 text-white px-5 py-2.5 rounded-lg text-sm font-semibold"
          >
            <Icono nombre="chispa" size={16} />
            Leer factura
          </button>
          <p className="text-xs text-neutral-500">
            Si la factura sigue en otra hoja, agrega esa foto antes de leer. En orden: la IA junta los renglones de todas.
            {tactil && (
              <>
                {' '}
                <button type="button" onClick={() => galeria.current?.click()} className="underline">
                  Agregar desde la galería
                </button>
              </>
            )}
          </p>
        </div>
      ) : tactil ? (
        <>
          <div className="flex flex-col sm:flex-row items-stretch justify-center gap-2">
            <button
              onClick={() => camara.current?.click()}
              className="inline-flex items-center justify-center gap-2 bg-neutral-900 text-white px-5 py-3 rounded-lg text-sm font-semibold"
            >
              <Icono nombre="camara" size={18} />
              Tomar foto de la factura
            </button>
            <button
              onClick={() => galeria.current?.click()}
              className="inline-flex items-center justify-center gap-2 border border-neutral-300 bg-white px-5 py-3 rounded-lg text-sm font-semibold"
            >
              <Icono nombre="imagen" size={18} />
              Elegir de la galería
            </button>
          </div>
          <p className="text-xs text-neutral-500 mt-2">
            La factura entera, derecha, con buena luz y el teléfono quieto. ¿Varias hojas? Una foto por hoja. La IA
            llena el formulario y tú lo revisas antes de guardar.
          </p>
        </>
      ) : (
        <>
          <button onClick={() => entrada.current?.click()} className="inline-flex items-center gap-2 bg-neutral-900 text-white px-5 py-2.5 rounded-lg text-sm font-semibold">
            <Icono nombre="chispa" size={16} />
            Cargar factura desde foto o PDF
          </button>
          <p className="text-xs text-neutral-500 mt-2">
            O arrástrala aquí, o pégala con Ctrl+V. ¿Viene en varias hojas? Elige todas las fotos. La IA llena el formulario y tú lo revisas antes de guardar.
          </p>
        </>
      )}
      {error && <p className="text-peligro-600 text-sm mt-2">{error}</p>}
    </div>
  )
}

// Lo que se va diciendo mientras la IA lee. Es lo que de verdad pasa, en el
// orden en que pasa: primero lee, despues el sistema revisa, y si algo no
// cuadra un segundo modelo la relee (ver lectura_facturas.py). Una factura
// que cuadra a la primera tarda ~3 s y se ven dos o tres; una dificil, ~20 s.
const MENSAJES_LECTURA = [
  'Recibiendo la factura',
  'Enderezando el papel',
  'Buscando quién la emitió',
  'Leyendo el RIF dígito por dígito',
  'Copiando los renglones uno a uno',
  'Sumando los montos',
  'Comparando con el total impreso',
  'Dándole una segunda leída para ir a la segura',
  'Repasando los céntimos',
  'Afinando los últimos números',
]
const MENSAJES_TARDE = ['Este papel tiene sus detalles, un momento más', 'Ya casi está', 'Revisando renglón por renglón']
const MS_POR_MENSAJE = 1800
// Constante de la barra: a los 8 s va por el 63 %, a los 20 s por el 92 %.
// Nunca llega sola al final: eso lo hace la respuesta.
const TAU_BARRA_MS = 8000

/**
 * La espera mientras se lee: una barra que avanza rápido al principio y se
 * frena después (sin prometer un tiempo que no se sabe) y mensajes cortos de
 * lo que se está haciendo. Hace que unos segundos se sientan menos.
 */
export function EsperaLectura({ terminando }: { terminando: boolean }) {
  const [ms, setMs] = useState(0)
  useEffect(() => {
    const inicio = Date.now()
    const t = setInterval(() => setMs(Date.now() - inicio), 100)
    return () => clearInterval(t)
  }, [])
  const i = Math.floor(ms / MS_POR_MENSAJE)
  const mensaje = terminando
    ? 'Listo'
    : i < MENSAJES_LECTURA.length
      ? MENSAJES_LECTURA[i]
      : MENSAJES_TARDE[(i - MENSAJES_LECTURA.length) % MENSAJES_TARDE.length]
  const avance = terminando ? 100 : 95 * (1 - Math.exp(-ms / TAU_BARRA_MS))
  return (
    <div className="max-w-md mx-auto text-left" role="status" aria-live="polite">
      <div className="flex items-baseline justify-between gap-3 mb-2">
        <p key={mensaje} className="text-sm font-semibold" style={{ animation: 'vp-entrar 0.3s ease-out' }}>
          <Icono nombre="chispa" size={14} className="inline -mt-0.5 mr-1.5 text-acento-500" />
          {mensaje}
          {!terminando && '…'}
        </p>
        <span className="text-xs text-neutral-400 tabular-nums shrink-0">{Math.floor(ms / 1000)} s</span>
      </div>
      <div className="h-2 rounded-full bg-neutral-100 overflow-hidden">
        <div
          className="h-full rounded-full bg-acento-500 transition-[width] duration-300 ease-out"
          style={{ width: `${avance}%` }}
        />
      </div>
      <p className="text-xs text-neutral-500 mt-2">
        {ms < 30000
          ? 'La IA lee y el sistema revisa que todo cuadre.'
          : 'El servicio está lento hoy. Si prefieres, cárgala a mano abajo.'}
      </p>
    </div>
  )
}

/**
 * La factura a la vista mientras se revisa. En pantalla ancha queda fija al
 * lado del formulario; en el teléfono, arriba y plegable. Se puede girar:
 * muchas llegan escaneadas de lado.
 */
export function VisorDocumento({ url, esPdf }: { url: string; esPdf: boolean }) {
  const [giro, setGiro] = useState(0)
  const [cerca, setCerca] = useState(false)
  // En el telefono arranca plegada: abierta ocupaba media pantalla antes del
  // primer campo. Se abre de un toque para comparar.
  const [abierto, setAbierto] = useState(() => Boolean(window.matchMedia?.('(min-width: 1024px)').matches))
  return (
    <div className="mb-3 lg:mb-0 lg:sticky lg:top-4 bg-white rounded-2xl border border-neutral-200 overflow-hidden">
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-neutral-100">
        <button onClick={() => setAbierto((v) => !v)} className="text-sm font-semibold lg:pointer-events-none">
          {abierto ? 'Factura' : 'Ver la factura'} {esPdf ? '(PDF)' : ''} <span className="lg:hidden text-neutral-400">{abierto ? '▾' : '▸'}</span>
        </button>
        {!esPdf && abierto && (
          <div className="flex gap-1">
            <button onClick={() => setGiro((g) => (g + 90) % 360)} className="text-xs px-2 py-1 rounded-md border border-neutral-200" title="Girar">
              ↻ Girar
            </button>
            <button onClick={() => setCerca((v) => !v)} className="text-xs px-2 py-1 rounded-md border border-neutral-200">
              {cerca ? 'Ajustar' : 'Acercar'}
            </button>
          </div>
        )}
      </div>
      {abierto &&
        (esPdf ? (
          <div className="h-[50vh] lg:h-[calc(100vh-7rem)]">
            <VistaSoporte url={url} esPdf alto="h-full" />
          </div>
        ) : (
          <div className="h-[50vh] lg:h-[calc(100vh-7rem)] overflow-auto bg-neutral-100 flex items-start justify-center">
            <img
              src={url}
              alt="Factura del proveedor"
              style={{ transform: `rotate(${giro}deg)`, transformOrigin: 'center' }}
              className={`${cerca ? 'max-w-none w-[200%]' : giro % 180 ? 'max-h-full max-w-[75%] mt-16' : 'max-w-full'} transition-transform`}
            />
          </div>
        ))}
    </div>
  )
}
