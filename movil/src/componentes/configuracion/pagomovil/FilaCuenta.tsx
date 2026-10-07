import { useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { apiPagos } from '../../../lib/api-pagos'
import { LETRA, useTema } from '../../../lib/tema'
import type { ConfigPabilo, CuentaPabilo } from '../../../lib/tipos'
import { Hoja, OpcionHoja } from '../../Hoja'
import Icono from '../../Icono'
import { Boton, Campo } from '../../ui'
import { mensajeDe, nombreBanco, Pastilla } from './comun'

/**
 * Una cuenta conectada. En la web las acciones van en fila a la derecha
 * (Hacer principal, Clave del banco, Quitar); en el telefono no caben, asi
 * que se tocan la cuenta y suben en una hoja. El circulo de la principal se
 * queda a la vista: es lo que mas se cambia.
 */
export default function FilaCuenta({
  c,
  varias,
  ultima,
  alElegir,
  alQuitar,
  alCambiarClave,
}: {
  c: CuentaPabilo
  varias: boolean
  ultima: boolean
  alElegir: () => void
  alQuitar: () => void
  alCambiarClave: (nuevo: ConfigPabilo) => void
}) {
  const t = useTema()
  const [menu, setMenu] = useState(false)
  const [cambiandoClave, setCambiandoClave] = useState(false)
  const [clave, setClave] = useState('')
  const [guardando, setGuardando] = useState(false)
  // El rechazo del banco se dice bajo el campo: arriba de la seccion no se
  // veria con el teclado abierto.
  const [error, setError] = useState('')

  const nombre = c.descripcion || nombreBanco(c.banco)
  const fueraDeServicio = c.bloqueada || c.deshabilitada
  const puedeSerPrincipal = varias && !c.activa && !fueraDeServicio

  async function guardarClave() {
    if (!clave || guardando) return
    const secreto = clave
    setGuardando(true)
    setError('')
    // Fuera del campo apenas sale: la clave del banco no se queda en memoria
    // de la pantalla, ni aunque el banco la rechace.
    setClave('')
    try {
      const nuevo = await apiPagos.cambiarClaveCuentaPabilo(c.id, secreto)
      setCambiandoClave(false)
      alCambiarClave(nuevo)
    } catch (e) {
      setError(mensajeDe(e, 'No se pudo cambiar la clave.'))
    } finally {
      setGuardando(false)
    }
  }

  function cancelarClave() {
    setClave('')
    setError('')
    setCambiandoClave(false)
  }

  // La hoja se cierra antes de actuar: un Alert o un campo nuevo encima de
  // un Modal que se esta yendo se ve mal (y en iOS el Alert puede perderse).
  function desdeMenu(accion: () => void) {
    setMenu(false)
    setTimeout(accion, 250)
  }

  const detalle = [
    nombreBanco(c.banco),
    c.numero ? `cuenta ${c.numero}` : '',
    c.telefono,
    c.moneda && c.moneda !== 'VEF' ? c.moneda : '',
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <View style={[estilos.fila, !ultima && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.gris200 }]}>
      <View style={estilos.renglon}>
        {/* Con una sola cuenta no hay nada que elegir y el circulo sobra. */}
        {varias && (
          <Pressable
            onPress={alElegir}
            disabled={c.activa || fueraDeServicio}
            accessibilityRole="radio"
            accessibilityState={{ checked: c.activa, disabled: c.activa || fueraDeServicio }}
            accessibilityLabel={c.activa ? 'Es la cuenta principal' : 'Hacerla la principal'}
            style={estilos.radioCaja}
          >
            <View
              style={[
                estilos.radio,
                { borderColor: c.activa ? t.tinta : t.barra, opacity: fueraDeServicio && !c.activa ? 0.45 : 1 },
              ]}
            >
              {c.activa && <View style={[estilos.radioPunto, { backgroundColor: t.tinta }]} />}
            </View>
          </Pressable>
        )}

        <Pressable
          onPress={() => setMenu(true)}
          accessibilityRole="button"
          accessibilityLabel={`${nombre}: opciones de la cuenta`}
          style={({ pressed }) => [estilos.cuerpo, { opacity: pressed ? 0.7 : 1 }]}
        >
          <View style={{ flex: 1, gap: 4 }}>
            <Text style={[estilos.nombre, { color: t.tinta }]} numberOfLines={2}>
              {nombre}
            </Text>
            {c.bloqueada ? (
              <Pastilla texto="bloqueada por el banco" tono="mal" />
            ) : c.deshabilitada ? (
              <Pastilla texto="fuera de servicio" tono="ojo" />
            ) : c.activa && varias ? (
              <Pastilla texto="principal" tono="bien" />
            ) : null}
            <Text style={[estilos.detalle, { color: t.suave }]}>{detalle}</Text>
          </View>
          <Icono nombre="chevron" size={18} color={t.tenue} />
        </Pressable>
      </View>

      {cambiandoClave && (
        <View style={{ gap: 10, marginTop: 10 }}>
          <Campo
            rotulo="Clave nueva del banco"
            ayuda="Se prueba con el banco antes de guardarse."
            error={error || undefined}
            value={clave}
            onChangeText={setClave}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            spellCheck={false}
            autoComplete="off"
            importantForAutofill="no"
            textContentType="none"
            autoFocus
            returnKeyType="done"
            onSubmitEditing={() => void guardarClave()}
          />
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <View style={{ flex: 1 }}>
              <Boton texto="Cancelar" tono="neutro" alTocar={cancelarClave} />
            </View>
            <View style={{ flex: 1 }}>
              <Boton
                texto={guardando ? 'Probando…' : 'Guardar'}
                alTocar={() => void guardarClave()}
                ocupado={guardando}
                deshabilitado={!clave}
              />
            </View>
          </View>
        </View>
      )}

      <Hoja visible={menu} alCerrar={() => setMenu(false)} titulo={nombre}>
        {puedeSerPrincipal && <OpcionHoja texto="Hacer principal" icono="ok" alTocar={() => desdeMenu(alElegir)} />}
        <OpcionHoja
          texto="Clave del banco"
          detalle="Cambiarla si la cambiaste en el banco"
          icono="cuenta"
          alTocar={() => desdeMenu(() => setCambiandoClave(true))}
        />
        <OpcionHoja texto="Quitar" icono="salir" peligro alTocar={() => desdeMenu(alQuitar)} />
      </Hoja>
    </View>
  )
}

const estilos = StyleSheet.create({
  fila: { paddingVertical: 10 },
  renglon: { flexDirection: 'row', alignItems: 'center' },
  radioCaja: { width: 44, height: 44, alignItems: 'flex-start', justifyContent: 'center', marginLeft: -2 },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  radioPunto: { width: 10, height: 10, borderRadius: 5 },
  cuerpo: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44 },
  nombre: { fontFamily: LETRA.textoFuerte, fontSize: 15.5 },
  detalle: { fontFamily: LETRA.cifra, fontSize: 12.5 },
})
