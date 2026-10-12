import { useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { apiImpuestos, descargasImpuestos } from '../../lib/api-impuestos'
import { useCarga } from '../../lib/carga'
import { bolivares } from '../../lib/formato'
import { LETRA, useTema } from '../../lib/tema'
import { useElegir } from '../contabilidad/dialogos'
import { bajar, BotonChico, fechaVE, hoyISO, mensajeDe, useRefrescoDeSeccion } from '../contabilidad/piezas'
import Icono from '../Icono'
import { ListaFicha, Pastilla, Renglon } from '../kit'
import { Aviso, Boton, Cargando, Fila, Ficha, Nota, Problema } from '../ui'
import { bs } from './piezas'

/** La quincena de hoy: la 1ra va del 1 al 15, la 2da del 16 al fin de mes. */
function quincenaDeHoy() {
  const [a, m, d] = hoyISO().split('-').map(Number)
  return { anio: a, mes: m, quincena: (d <= 15 ? 1 : 2) as 1 | 2 }
}

/**
 * LAS RETENCIONES DE IVA DE UNA QUINCENA: lo que se le retuvo a cada
 * proveedor, el TXT para el portal del SENIAT y el registro del pago. Se
 * pasa de quincena en quincena con las flechas, como en la web.
 */
export default function Retenciones({ agente }: { agente: boolean }) {
  const t = useTema()
  const [q, setQ] = useState(quincenaDeHoy)
  const clave = `${q.anio}-${q.mes}-${q.quincena}`
  const { datos, error, refrescando, refrescar } = useCarga(() => apiImpuestos.retencionesIva(q.anio, q.mes, q.quincena), 300, clave)
  useRefrescoDeSeccion(refrescando, refrescar)
  const { elegir, hoja } = useElegir()
  const [errorAccion, setErrorAccion] = useState('')
  const [bajando, setBajando] = useState(false)
  // Lo que llego es de ESTA quincena (al mover las flechas, lo anterior no cuenta).
  const vigente = datos && datos.anio === q.anio && datos.mes === q.mes && datos.quincena === q.quincena ? datos : null

  function mover(paso: number) {
    // De quincena en quincena: 2da de un mes -> 1ra del siguiente.
    let quincena = q.quincena + paso
    let mes = q.mes
    let anio = q.anio
    if (quincena > 2) {
      quincena = 1
      mes += 1
    } else if (quincena < 1) {
      quincena = 2
      mes -= 1
    }
    if (mes > 12) {
      mes = 1
      anio += 1
    } else if (mes < 1) {
      mes = 12
      anio -= 1
    }
    setErrorAccion('')
    setQ({ anio, mes, quincena: quincena as 1 | 2 })
  }

  async function descargarTxt() {
    setBajando(true)
    setErrorAccion('')
    try {
      await bajar(
        descargasImpuestos.retencionesTxt(q.anio, q.mes, q.quincena),
        `retenciones-iva-${q.anio}${String(q.mes).padStart(2, '0')}-q${q.quincena}.txt`,
      )
    } catch (e) {
      setErrorAccion(mensajeDe(e, 'No se pudo descargar el TXT'))
    } finally {
      setBajando(false)
    }
  }

  async function enterar() {
    if (!vigente) return
    const forma = await elegir(
      `Enterar las retenciones de la ${vigente.etiqueta}`,
      [
        { valor: 'Banco', texto: 'Por banco' },
        { valor: 'Efectivo', texto: 'En efectivo', detalle: 'Sale de la gaveta.' },
      ],
      `Son ${bolivares(vigente.total_retenido_bs)} para el SENIAT. ¿De dónde sale?`,
    )
    if (!forma) return
    try {
      await apiImpuestos.enterarRetenciones(q.anio, q.mes, q.quincena, forma)
      refrescar()
    } catch (e) {
      setErrorAccion(mensajeDe(e, 'No se pudo registrar'))
    }
  }

  return (
    <>
      {!agente ? (
        <Aviso
          tono="aviso"
          texto="Para retener IVA, marca «Somos agente de retención» en Datos fiscales. Hasta entonces las facturas no retienen."
        />
      ) : null}

      <Ficha style={{ gap: 12, padding: 16 }}>
        <View style={estilos.navegador}>
          <Flecha atras alTocar={() => mover(-1)} />
          <Text style={[estilos.etiqueta, { color: t.tinta }]} numberOfLines={2}>
            {vigente?.etiqueta ?? '…'}
          </Text>
          <Flecha alTocar={() => mover(1)} />
        </View>
        <Boton texto="Descargar TXT para el SENIAT" icono="factura" alTocar={descargarTxt} ocupado={bajando} />
        {vigente && vigente.retenciones.length > 0 && !vigente.enterada ? (
          <BotonChico texto="Registrar pago al SENIAT" alTocar={enterar} />
        ) : null}
        {vigente?.enterada ? (
          <View style={{ alignItems: 'center' }}>
            <Pastilla texto={`enterada ${vigente.fecha_enterada ? fechaVE(vigente.fecha_enterada) : ''}`} tono="bien" />
          </View>
        ) : null}
      </Ficha>

      {errorAccion ? <Problema mensaje={errorAccion} /> : null}
      {vigente && vigente.sin_tasa > 0 ? (
        <Aviso
          tono="aviso"
          texto={`${vigente.sin_tasa} retención(es) sin tasa de cambio: cárgala en el Libro de compras para poder sacar el TXT.`}
        />
      ) : null}
      {error && !datos ? <Problema mensaje={error} alReintentar={refrescar} /> : null}
      {!vigente && !error ? <Cargando /> : null}
      {vigente ? (
        <ListaFicha>
          {vigente.retenciones.map((r, i) => (
            <Renglon
              key={r.factura_id}
              titulo={r.proveedor_nombre}
              detalle={
                <View>
                  <Text style={[estilos.detalle, { color: t.suave }]}>
                    {r.proveedor_rif} · factura {r.numero_factura}
                    {r.numero_control ? ` · control ${r.numero_control}` : ''}
                  </Text>
                  <Text style={[estilos.comprobante, { color: t.suave }]}>
                    {r.comprobante} · {fechaVE(r.fecha_retencion)}
                  </Text>
                </View>
              }
              valor={`Bs ${bs(r.retenido_bs)}`}
              subvalor={`${r.porcentaje} % de ${bs(r.iva_bs)}`}
              ultima={i === vigente.retenciones.length - 1}
            />
          ))}
          {vigente.retenciones.length === 0 ? (
            <Nota style={{ padding: 16 }}>Sin retenciones en esta quincena. El TXT sale vacío: es la declaración en cero.</Nota>
          ) : (
            <View style={{ paddingHorizontal: 16 }}>
              <Fila nombre="Total a enterar" valor={`Bs ${bs(vigente.total_retenido_bs)}`} fuerte ultima />
            </View>
          )}
        </ListaFicha>
      ) : null}
      {hoja}
    </>
  )
}

function Flecha({ atras = false, alTocar }: { atras?: boolean; alTocar: () => void }) {
  const t = useTema()
  return (
    <Pressable
      onPress={alTocar}
      accessibilityLabel={atras ? 'Quincena anterior' : 'Quincena siguiente'}
      style={({ pressed }) => [estilos.flecha, { borderColor: t.gris200, backgroundColor: pressed ? t.gris100 : t.superficie }]}
    >
      <View style={atras ? { transform: [{ rotate: '180deg' }] } : undefined}>
        <Icono nombre="chevron" size={16} color={t.suave} grosor={2.2} />
      </View>
    </Pressable>
  )
}

const estilos = StyleSheet.create({
  navegador: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  etiqueta: { flex: 1, fontFamily: LETRA.titulo, fontSize: 16, textAlign: 'center' },
  flecha: { width: 44, height: 44, borderRadius: 22, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  detalle: { fontFamily: LETRA.texto, fontSize: 13, marginTop: 2 },
  comprobante: { fontFamily: LETRA.cifra, fontSize: 13, marginTop: 2 },
})
