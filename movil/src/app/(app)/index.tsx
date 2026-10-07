import Feather from '@expo/vector-icons/Feather'
import { StyleSheet, Text, View } from 'react-native'
import { Cargando, Cifra, Etiqueta, Ficha, Nota, Pantalla, Problema, Titulo, type NombreIcono } from '../../componentes/ui'
import { api } from '../../lib/api'
import { parte, useCarga } from '../../lib/carga'
import { dolares, fechaDeHoy, inicialDelDia, saludo } from '../../lib/formato'
import { useSesion } from '../../lib/sesion'
import { LETRA, useTema, type Tema } from '../../lib/tema'
import type { Aviso, PasoRecorrido } from '../../lib/tipos'

/**
 * HOY: lo mismo que la portada de la web (pages/Inicio.tsx), en el orden en
 * que se pregunta al sacar el telefono: cuanto se vendio, que esta
 * esperando, que avisa el sistema, como va cada parte del negocio y la
 * semana. Las mismas llamadas a la API; ninguna cifra se calcula aqui.
 */
export default function Hoy() {
  const t = useTema()
  const { acceso } = useSesion()
  const veCifras = acceso?.puede.ve_kpis ?? false

  const { datos, error, refrescando, refrescar } = useCarga(async () => {
    const [resumen, pedidos, cocina, cobrar, avisos, recorrido] = await Promise.all([
      veCifras ? parte(api.resumenDeHoy()) : Promise.resolve(null),
      parte(api.pedidosDelDia()),
      parte(api.enCocina()),
      parte(api.porCobrar()),
      veCifras ? parte(api.avisos()) : Promise.resolve(null),
      veCifras ? parte(api.recorrido()) : Promise.resolve(null),
    ])
    // Si no llego nada, es un problema de conexion o de sesion: se dice.
    const todas = [resumen, pedidos, cocina, cobrar, avisos, recorrido].filter((p) => p !== null)
    const caida = todas.find((p) => !p.ok)
    if (caida && !caida.ok && todas.every((p) => !p.ok)) throw new Error(caida.error)
    return { resumen, pedidos, cocina, cobrar, avisos, recorrido }
  })

  const nombre = acceso?.nombre || acceso?.nombre_visible || acceso?.usuario || ''
  const ventas = datos?.resumen?.ok ? datos.resumen.valor.ventas : null
  const nPedidos = datos?.pedidos?.ok ? datos.pedidos.valor.length : null
  const enCocina = datos?.cocina?.ok ? datos.cocina.valor.length : null
  const porCobrar = datos?.cobrar?.ok ? datos.cobrar.valor.length : null
  const avisos = datos?.avisos?.ok ? datos.avisos.valor : []
  const recorrido = datos?.recorrido?.ok ? datos.recorrido.valor : null

  return (
    <Pantalla refrescando={refrescando} alRefrescar={refrescar}>
      <View style={{ marginTop: 6, marginBottom: 4 }}>
        <Etiqueta>{acceso?.local.nombre || 'Vertigo Pro'}</Etiqueta>
        <Text style={[estilos.saludo, { color: t.tinta }]}>
          {saludo()}
          {nombre ? `, ${nombre}` : ''}
        </Text>
        <Nota>{fechaDeHoy()}</Nota>
      </View>

      {error && !datos ? <Problema mensaje={error} alReintentar={refrescar} /> : null}
      {!datos && !error ? <Cargando /> : null}

      {datos && (
        <>
          <Ficha>
            <Etiqueta>Vendido hoy</Etiqueta>
            <View style={{ marginTop: 8 }}>
              <Cifra tamano="grande">{veCifras ? dolares(ventas) : '—'}</Cifra>
            </View>
            <Nota style={{ marginTop: 4 }}>
              {nPedidos === null ? ' ' : `${nPedidos} ${nPedidos === 1 ? 'pedido' : 'pedidos'}`}
              {veCifras && datos.resumen?.ok && datos.resumen.valor.pedidos > 0
                ? ` · ticket promedio ${dolares(datos.resumen.valor.ticket_promedio)}`
                : ''}
            </Nota>
          </Ficha>

          <View style={estilos.par}>
            <Espera titulo="En cocina" valor={enCocina} nota="comandas preparándose" />
            <Espera titulo="Por cobrar" valor={porCobrar} nota="listas, falta cobrar" />
          </View>

          {avisos.length > 0 && (
            <View style={{ gap: 10 }}>
              <Etiqueta style={{ marginTop: 6 }}>¿Sabías que…?</Etiqueta>
              {avisos.map((a) => (
                <TarjetaAviso key={a.id} aviso={a} t={t} />
              ))}
            </View>
          )}

          {recorrido && (
            <Ficha>
              <Titulo>Tu negocio hoy</Titulo>
              <View style={{ marginTop: 6 }}>
                {recorrido.pasos.map((p, i) => (
                  <Estacion key={p.id} paso={p} ultima={i === recorrido.pasos.length - 1} t={t} />
                ))}
              </View>
            </Ficha>
          )}

          {recorrido && recorrido.ultimos_7_dias.length > 0 && (
            <Ficha>
              <Etiqueta>Últimos 7 días</Etiqueta>
              <Semana dias={recorrido.ultimos_7_dias} t={t} />
            </Ficha>
          )}
        </>
      )}
    </Pantalla>
  )
}

/** En cero se queda callada; con algo dentro se enciende, como en la web. */
function Espera({ titulo, valor, nota }: { titulo: string; valor: number | null; nota: string }) {
  const t = useTema()
  const hay = (valor ?? 0) > 0
  return (
    <Ficha tono={hay ? 'aviso' : undefined} style={{ flex: 1, padding: 16 }}>
      <Text style={[estilos.esperaTitulo, { color: hay ? t.aviso : t.suave }]}>{titulo}</Text>
      <View style={{ marginTop: 6 }}>
        <Cifra tamano="media" color={hay ? t.aviso : t.tinta}>
          {valor === null ? '—' : String(valor)}
        </Cifra>
      </View>
      <Text style={[estilos.esperaNota, { color: hay ? t.aviso : t.tenue }]}>{nota}</Text>
    </Ficha>
  )
}

function TarjetaAviso({ aviso, t }: { aviso: Aviso; t: Tema }) {
  const punto = aviso.tono === 'ojo' ? t.aviso : aviso.tono === 'bien' ? t.exito : t.acento
  return (
    <Ficha style={{ flexDirection: 'row', gap: 12, padding: 16 }}>
      <View style={[estilos.punto, { backgroundColor: punto }]} />
      <View style={{ flex: 1 }}>
        <Text style={[estilos.avisoTitulo, { color: t.tinta }]}>{aviso.titulo}</Text>
        {!!aviso.detalle && <Nota style={{ marginTop: 3 }}>{aviso.detalle}</Nota>}
      </View>
    </Ficha>
  )
}

const ESTACION: Record<PasoRecorrido['id'], { nombre: string; icono: NombreIcono }> = {
  compras: { nombre: 'Compras', icono: 'file-text' },
  inventario: { nombre: 'Inventario', icono: 'package' },
  menu: { nombre: 'Menú', icono: 'book-open' },
  ventas: { nombre: 'Ventas', icono: 'clipboard' },
  caja: { nombre: 'Cierre de caja', icono: 'dollar-sign' },
}

function Estacion({ paso, ultima, t }: { paso: PasoRecorrido; ultima: boolean; t: Tema }) {
  const e = ESTACION[paso.id] ?? { nombre: paso.id, icono: 'circle' as NombreIcono }
  // La frase puede traer "{monto}": se escribe con el formato de la app.
  const frase = paso.frase.replace('{monto}', dolares(paso.monto))
  return (
    <View style={[estilos.estacion, !ultima && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.linea }]}>
      <View
        style={[
          estilos.estacionIcono,
          { backgroundColor: paso.pendiente ? t.avisoSuave : t.acentoSuave, borderColor: paso.pendiente ? t.avisoLinea : 'transparent' },
        ]}
      >
        <Feather name={e.icono} size={17} color={paso.pendiente ? t.aviso : t.acento} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[estilos.estacionNombre, { color: t.tinta }]}>{e.nombre}</Text>
        <Text style={[estilos.estacionFrase, { color: paso.pendiente ? t.aviso : t.suave }]}>{frase}</Text>
      </View>
      {paso.pendiente ? <Feather name="alert-circle" size={17} color={t.aviso} /> : <Feather name="check" size={17} color={t.exito} />}
    </View>
  )
}

function Semana({ dias, t }: { dias: { fecha: string; ventas: number }[]; t: Tema }) {
  const max = Math.max(...dias.map((d) => d.ventas), 0)
  return (
    <View style={estilos.semana}>
      {dias.map((d, i) => {
        const esHoy = i === dias.length - 1
        const alto = max > 0 ? Math.max((d.ventas / max) * 84, d.ventas > 0 ? 4 : 2) : 2
        return (
          <View key={d.fecha} style={estilos.semanaDia}>
            <View style={estilos.semanaPista}>
              <View style={{ height: alto, borderRadius: 5, backgroundColor: esHoy ? t.acento : t.barra }} />
            </View>
            <Text style={[estilos.semanaLetra, { color: esHoy ? t.acento : t.tenue }]}>{esHoy ? 'Hoy' : inicialDelDia(d.fecha)}</Text>
          </View>
        )
      })}
    </View>
  )
}

const estilos = StyleSheet.create({
  saludo: { fontFamily: LETRA.tituloFuerte, fontSize: 26, letterSpacing: -0.6, marginTop: 4 },
  par: { flexDirection: 'row', gap: 12 },
  esperaTitulo: { fontFamily: LETRA.textoFuerte, fontSize: 13.5 },
  esperaNota: { fontFamily: LETRA.texto, fontSize: 13, marginTop: 4 },
  punto: { width: 8, height: 8, borderRadius: 4, marginTop: 7 },
  avisoTitulo: { fontFamily: LETRA.textoFuerte, fontSize: 15, lineHeight: 21 },
  estacion: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
  estacionIcono: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  estacionNombre: { fontFamily: LETRA.textoFuerte, fontSize: 15 },
  estacionFrase: { fontFamily: LETRA.texto, fontSize: 13.5, marginTop: 2, lineHeight: 19 },
  semana: { flexDirection: 'row', gap: 8, marginTop: 14 },
  semanaDia: { flex: 1, alignItems: 'center', gap: 6 },
  semanaPista: { height: 84, width: '100%', justifyContent: 'flex-end' },
  semanaLetra: { fontFamily: LETRA.textoFuerte, fontSize: 12 },
})
