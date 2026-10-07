import { useEffect, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View, type KeyboardTypeOptions, type TextInputProps } from 'react-native'
import { apiPagos } from '../../../lib/api-pagos'
import { LETRA, useTema } from '../../../lib/tema'
import type { CampoProveedor, ConfigPabilo, OpcionBanco } from '../../../lib/tipos'
import { Hoja, OpcionHoja } from '../../Hoja'
import Icono from '../../Icono'
import { Aviso, Boton, Campo, Nota } from '../../ui'
import { mensajeDe } from './comun'

/**
 * Conectar una cuenta nueva. Los campos NO estan escritos aqui: los manda el
 * servidor por proveedor (backend/app/pabilo.py, PROVEEDORES), igual que en la
 * web. BDV personas pide usuario y contraseña de BDV en linea; las de empresa,
 * sus IDs en `metadata.*`; la cuenta de notificaciones, telefono y cedula.
 * Asi un banco nuevo en el servidor aparece en la app sin publicarla otra vez.
 */
export default function ConectarCuenta({ alConectar }: { alConectar: (c: ConfigPabilo) => void }) {
  const t = useTema()
  const [opciones, setOpciones] = useState<OpcionBanco[] | null>(null)
  const [fallo, setFallo] = useState(false)
  const [intento, setIntento] = useState(0)
  const [proveedor, setProveedor] = useState('')
  const [valores, setValores] = useState<Record<string, string>>({})
  const [descripcion, setDescripcion] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [eligiendo, setEligiendo] = useState(false)
  // El error se dice aqui, junto al boton, y no arriba de la seccion: con el
  // formulario abierto, lo de arriba queda fuera de la pantalla del telefono.
  const [error, setError] = useState('')

  useEffect(() => {
    let vivo = true
    apiPagos
      .bancosPabilo()
      .then((lista) => {
        if (!vivo) return
        setOpciones(lista)
        setFallo(false)
        if (lista.length > 0) setProveedor((p) => p || lista[0].proveedor)
      })
      .catch((e: unknown) => {
        if (!vivo) return
        setFallo(true)
        setError(mensajeDe(e, 'No se pudieron consultar los bancos.'))
      })
    return () => {
      vivo = false
    }
  }, [intento])

  const opcion = opciones?.find((o) => o.proveedor === proveedor)
  const completo = Boolean(opcion) && (opcion?.campos ?? []).every((c) => !c.requerido || (valores[c.clave] ?? '').trim())

  function elegir(o: OpcionBanco) {
    setEligiendo(false)
    // Otro banco, otros campos: lo escrito para el anterior no aplica.
    if (o.proveedor !== proveedor) setValores({})
    setProveedor(o.proveedor)
  }

  async function conectar() {
    if (!opcion || !completo || guardando) return
    setGuardando(true)
    setError('')
    const metadata: Record<string, string> = {}
    for (const [k, v] of Object.entries(valores)) {
      if (k.startsWith('metadata.') && v.trim()) metadata[k.slice('metadata.'.length)] = v.trim()
    }
    const datos = {
      proveedor: opcion.proveedor,
      descripcion: descripcion.trim() || opcion.nombre,
      usuario: valores.usuario,
      clave: valores.clave,
      telefono: valores.telefono,
      cedula: valores.cedula,
      metadata,
    }
    // Los secretos salen del formulario apenas se mandan, salga bien o mal:
    // si el banco los rechaza se escriben otra vez; lo demas se conserva
    // para no repetirlo todo.
    const secretos = new Set((opcion.campos ?? []).filter((c) => c.secreto).map((c) => c.clave))
    setValores((v) => Object.fromEntries(Object.entries(v).filter(([k]) => !secretos.has(k))))
    try {
      const nuevo = await apiPagos.crearCuentaPabilo(datos)
      setValores({})
      setDescripcion('')
      alConectar(nuevo)
    } catch (e) {
      setError(mensajeDe(e, 'No se pudo conectar la cuenta.'))
    } finally {
      setGuardando(false)
    }
  }

  if (opciones === null) {
    return fallo ? (
      <View style={{ gap: 10, paddingVertical: 4 }}>
        <Aviso texto={error || 'No se pudieron consultar los bancos.'} tono="peligro" />
        <Boton
          texto="Reintentar"
          tono="neutro"
          alTocar={() => {
            setFallo(false)
            setError('')
            setIntento((n) => n + 1)
          }}
        />
      </View>
    ) : (
      <Nota style={{ paddingVertical: 6, color: t.tenue }}>Buscando los bancos disponibles…</Nota>
    )
  }

  return (
    <View style={[estilos.caja, { backgroundColor: t.gris100 }]}>
      {/* El <select> de la web: en el telefono, un campo que abre una hoja. */}
      <View style={{ gap: 6 }}>
        <Text style={[estilos.rotulo, { color: t.suave }]}>Banco</Text>
        <Pressable
          onPress={() => setEligiendo(true)}
          accessibilityRole="button"
          accessibilityLabel={`Banco: ${opcion?.nombre ?? 'elegir'}`}
          style={({ pressed }) => [
            estilos.selector,
            { backgroundColor: t.superficie, borderColor: t.gris200, opacity: pressed ? 0.8 : 1 },
          ]}
        >
          <Text style={[estilos.selectorTexto, { color: opcion ? t.tinta : t.tenue }]} numberOfLines={1}>
            {opcion?.nombre ?? 'Elige el banco'}
          </Text>
          <View style={{ transform: [{ rotate: '90deg' }] }}>
            <Icono nombre="chevron" size={18} color={t.tenue} />
          </View>
        </Pressable>
      </View>
      {opcion?.ayuda ? <Nota>{opcion.ayuda}</Nota> : null}

      {opcion?.campos.map((c) => (
        <Campo
          key={`${opcion.proveedor}:${c.clave}`}
          rotulo={c.rotulo + (c.requerido ? '' : ' (opcional)')}
          ayuda={c.ayuda || undefined}
          value={valores[c.clave] ?? ''}
          onChangeText={(texto) => setValores((v) => ({ ...v, [c.clave]: texto }))}
          {...teclado(c)}
        />
      ))}
      <Campo
        rotulo="Nombre para reconocerla"
        value={descripcion}
        onChangeText={setDescripcion}
        placeholder={opcion ? `Ej. ${opcion.nombre.split(' ·')[0]} del local` : ''}
        autoCapitalize="sentences"
        returnKeyType="done"
      />

      {error ? <Aviso texto={error} tono="peligro" /> : null}
      <Boton
        texto={guardando ? 'Conectando…' : 'Conectar'}
        alTocar={() => void conectar()}
        ocupado={guardando}
        deshabilitado={!completo}
      />
      <Nota style={{ color: t.tenue }}>
        La contraseña del banco viaja una sola vez, cifrada, al verificador de pagos. Aquí no se guarda.
      </Nota>

      <Hoja visible={eligiendo} alCerrar={() => setEligiendo(false)} titulo="Banco">
        {/* Con muchos bancos la hoja no debe pasar de la mitad de la pantalla. */}
        <ScrollView style={{ maxHeight: 440 }}>
          {opciones.map((o) => (
            <OpcionHoja key={o.proveedor} texto={o.nombre} marcada={o.proveedor === proveedor} alTocar={() => elegir(o)} />
          ))}
        </ScrollView>
      </Hoja>
    </View>
  )
}

/**
 * El teclado de cada campo. El servidor no dice el tipo, solo la clave y el
 * rotulo, asi que se deduce de ahi: el telefono con el teclado de telefono,
 * los numeros de cuenta con el numerico, y todo lo demas (usuarios, IDs,
 * claves) sin mayuscula ni autocorrector, que los cambiarian por debajo.
 *
 * La cedula va con teclado de letras a proposito: el servidor acepta el
 * prefijo (V, E, J, G, P) y con el numerico no se podria escribir un E- o J-.
 */
function teclado(c: CampoProveedor): TextInputProps {
  const base: TextInputProps = {
    autoCapitalize: 'none',
    autoCorrect: false,
    spellCheck: false,
    autoComplete: 'off',
    // Que el autocompletado del telefono no ofrezca guardar credenciales del banco.
    importantForAutofill: 'no',
    textContentType: 'none',
  }
  if (c.secreto) return { ...base, secureTextEntry: true }
  if (c.clave === 'telefono') return { ...base, keyboardType: 'phone-pad' }
  if (c.clave === 'cedula') return { ...base, autoCapitalize: 'characters' }
  let tipo: KeyboardTypeOptions = 'default'
  if (/n[uú]mero de cuenta/i.test(c.rotulo)) tipo = 'number-pad'
  else if (/\bIP\b/.test(c.rotulo)) tipo = 'numbers-and-punctuation'
  return { ...base, keyboardType: tipo }
}

const estilos = StyleSheet.create({
  caja: { borderRadius: 18, padding: 14, gap: 14 },
  rotulo: { fontFamily: LETRA.textoFuerte, fontSize: 13 },
  selector: {
    minHeight: 50,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 15,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  selectorTexto: { flex: 1, fontFamily: LETRA.texto, fontSize: 16 },
})
