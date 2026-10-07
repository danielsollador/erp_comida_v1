import { useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { LETRA, useTema } from '../../../lib/tema'
import type { ListaUsuarios as Lista, Rol, Usuario } from '../../../lib/tipos'
import { Hoja, OpcionHoja } from '../../Hoja'
import Icono from '../../Icono'
import { Boton, Ficha, Nota } from '../../ui'
import { Encabezado, Pastilla, fechaCorta, nombreDeRol, sinAcentos } from './piezas'

type Clave = 'usuario' | 'rol' | 'acceso'

const COLUMNAS: { id: Clave; texto: string }[] = [
  { id: 'usuario', texto: 'Persona' },
  { id: 'rol', texto: 'Rol' },
  { id: 'acceso', texto: 'Último acceso' },
]

/**
 * Quien entra al local. En la web es una tabla con un selector de rol en
 * cada fila; en el telefono la fila entera se toca y abre una hoja con lo
 * que se le puede hacer a esa persona (editar, cambiar rol, borrar): un
 * selector de 30 px en cada renglon no se acierta con el pulgar.
 */
export default function ListaUsuarios({
  lista,
  nombreLocal,
  alCrear,
  alEditar,
  alCambiarRol,
  alBorrar,
}: {
  lista: Lista
  nombreLocal: string
  alCrear: () => void
  alEditar: (u: Usuario) => void
  alCambiarRol: (u: Usuario, rol: Rol) => void
  alBorrar: (u: Usuario) => void
}) {
  const t = useTema()
  const { roles } = lista
  // El orden de la tabla de la web: por persona al abrir, y tocar la misma
  // columna otra vez invierte.
  const [orden, setOrden] = useState<{ clave: Clave; dir: 1 | -1 }>({ clave: 'usuario', dir: 1 })
  const [elegido, setElegido] = useState<Usuario | null>(null)
  const [paso, setPaso] = useState<'acciones' | 'rol'>('acciones')

  const nombreDe = (u: Usuario) => `${u.nombre} ${u.apellido}`.trim()

  function valor(u: Usuario): string | number | null {
    if (orden.clave === 'rol') return sinAcentos(nombreDeRol(roles, u.rol, u.rol_nombre))
    // El que nunca ha entrado no tiene fecha: cae al final se ordene como se ordene.
    if (orden.clave === 'acceso') return u.ultimo_acceso
    return sinAcentos(nombreDe(u) || u.usuario)
  }

  // Lo vacio siempre al final, como en la web: una fila sin dato no es "la menor".
  const ordenados = [...lista.usuarios].sort((a, b) => {
    const va = valor(a)
    const vb = valor(b)
    if (va == null && vb == null) return 0
    if (va == null) return 1
    if (vb == null) return -1
    if (typeof va === 'number' && typeof vb === 'number') return orden.dir * (va - vb)
    return orden.dir * String(va).localeCompare(String(vb), undefined, { numeric: true })
  })

  function ordenarPor(clave: Clave) {
    setOrden((o) => ({ clave, dir: o.clave === clave && o.dir === 1 ? -1 : 1 }))
  }

  function abrir(u: Usuario) {
    setPaso('acciones')
    setElegido(u)
  }

  // Se cierra la hoja ANTES de actuar: lo que sigue (una alerta, otra vista)
  // no debe abrirse con la hoja todavia encima. Con `esperar`, la accion
  // espera a que la hoja termine de bajar: en iPhone una alerta lanzada
  // mientras un Modal se cierra se pierde sin mostrarse.
  function cerrarY(accion: () => void, esperar = false) {
    setElegido(null)
    if (esperar) setTimeout(accion, 350)
    else accion()
  }

  const soyYo = elegido?.usuario === lista.yo
  // Su rol puede no estar entre los que se reparten en este local (se lo puso
  // Vertigo). Se muestra igual, marcado: dejarlo fuera seria peor.
  const fueraDeLista = elegido && !roles.some((r) => r.rol === elegido.rol)

  return (
    <Ficha style={{ paddingHorizontal: 0, paddingBottom: 8 }}>
      <View style={{ paddingHorizontal: 20, gap: 12 }}>
        <Encabezado
          titulo={`Quién entra a ${nombreLocal}`}
          ayuda="Cada persona entra con su usuario: así el sistema sabe quién cobró, quién anuló y quién cerró la caja."
        />
        <View style={estilos.cabeza}>
          <Nota style={{ color: t.tenue }}>{`${lista.usuarios.length} usuarios`}</Nota>
          <View style={{ flexShrink: 0 }}>
            <Boton texto="Crear usuario" tono="neutro" alTocar={alCrear} />
          </View>
        </View>
        <View style={estilos.orden}>
          {COLUMNAS.map((c) => {
            const activa = orden.clave === c.id
            return (
              <Pressable
                key={c.id}
                onPress={() => ordenarPor(c.id)}
                hitSlop={{ top: 6, bottom: 6 }}
                accessibilityRole="button"
                accessibilityLabel={`Ordenar por ${c.texto}`}
                accessibilityState={{ selected: activa }}
                style={[estilos.chip, { borderColor: activa ? t.tinta : t.gris200, backgroundColor: activa ? t.gris100 : 'transparent' }]}
              >
                <Text style={[estilos.chipTexto, { color: activa ? t.tinta : t.suave }]}>
                  {c.texto}
                  {activa ? (orden.dir === 1 ? ' ↑' : ' ↓') : ''}
                </Text>
              </Pressable>
            )
          })}
        </View>
      </View>

      <View style={{ marginTop: 8 }}>
        {ordenados.map((u) => {
          const nombre = nombreDe(u)
          const autoriza = roles.find((r) => r.rol === u.rol)?.autoriza ?? false
          return (
            <Pressable
              key={u.usuario}
              onPress={() => abrir(u)}
              accessibilityRole="button"
              accessibilityLabel={`${nombre || u.usuario}, opciones`}
              style={({ pressed }) => [
                estilos.fila,
                { borderTopColor: t.gris200, borderTopWidth: StyleSheet.hairlineWidth },
                pressed && { backgroundColor: t.gris100 },
              ]}
            >
              <View style={{ flex: 1, gap: 3 }}>
                <Text style={[estilos.nombre, { color: t.tinta }]} numberOfLines={1}>
                  {nombre || u.usuario}
                  {u.usuario === lista.yo ? <Text style={[estilos.tu, { color: t.tenue }]}> (tú)</Text> : null}
                </Text>
                <Text style={[estilos.sub, { color: t.suave }]} numberOfLines={1}>
                  {nombre ? `@${u.usuario} · ` : ''}
                  {nombreDeRol(roles, u.rol, u.rol_nombre)}
                </Text>
                <View style={estilos.detalles}>
                  {/* Solo tiene sentido en quien autoriza: al resto no se le pide PIN. */}
                  {autoriza && (u.tiene_pin ? <Pastilla tono="bien">PIN listo</Pastilla> : <Pastilla tono="ojo">sin PIN</Pastilla>)}
                  <Text style={[estilos.acceso, { color: t.tenue }]}>
                    {u.ultimo_acceso ? `Último acceso ${fechaCorta(u.ultimo_acceso)}` : 'Todavía no ha entrado'}
                  </Text>
                </View>
              </View>
              <Icono nombre="chevron" size={18} color={t.tenue} />
            </Pressable>
          )
        })}
        {lista.usuarios.length === 0 && (
          <View style={estilos.vacio}>
            <View style={[estilos.vacioIcono, { backgroundColor: t.gris100 }]}>
              <Icono nombre="usuarios" size={24} color={t.tenue} />
            </View>
            <Text style={[estilos.vacioTexto, { color: t.tinta }]}>Sin usuarios todavía</Text>
          </View>
        )}
      </View>

      <Hoja
        visible={elegido !== null}
        alCerrar={() => setElegido(null)}
        titulo={elegido ? (paso === 'rol' ? `Rol de ${elegido.usuario}` : nombreDe(elegido) || elegido.usuario) : undefined}
      >
        {elegido && paso === 'acciones' && (
          <>
            <OpcionHoja
              icono="cuenta"
              texto="Editar"
              detalle={roles.find((r) => r.rol === elegido.rol)?.autoriza ? 'Nombre, contraseña y PIN' : 'Nombre y contraseña'}
              alTocar={() => cerrarY(() => alEditar(elegido))}
            />
            {/* Uno no se cambia su propio rol: en la web el selector esta apagado en su fila. */}
            {!soyYo && (
              <OpcionHoja
                icono="usuarios"
                texto="Cambiar rol"
                detalle={nombreDeRol(roles, elegido.rol, elegido.rol_nombre)}
                alTocar={() => setPaso('rol')}
              />
            )}
            {!soyYo && (
              <OpcionHoja icono="salir" texto="Borrar" peligro alTocar={() => cerrarY(() => alBorrar(elegido), true)} />
            )}
          </>
        )}
        {elegido && paso === 'rol' && (
          <>
            {fueraDeLista && <OpcionHoja texto={elegido.rol_nombre || elegido.rol} marcada alTocar={() => setElegido(null)} />}
            {roles.map((r) => (
              <OpcionHoja
                key={r.rol}
                texto={r.nombre}
                detalle={r.modulos.length ? r.modulos.map((m) => m.nombre).join(', ') : 'Ningún módulo.'}
                marcada={r.rol === elegido.rol}
                alTocar={() =>
                  cerrarY(() => {
                    if (r.rol !== elegido.rol) alCambiarRol(elegido, r.rol)
                  })
                }
              />
            ))}
          </>
        )}
      </Hoja>
    </Ficha>
  )
}

const estilos = StyleSheet.create({
  cabeza: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  orden: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 13, minHeight: 34, justifyContent: 'center' },
  chipTexto: { fontFamily: LETRA.textoFuerte, fontSize: 13 },
  fila: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingVertical: 12, minHeight: 64 },
  nombre: { fontFamily: LETRA.textoFuerte, fontSize: 15.5 },
  tu: { fontFamily: LETRA.texto, fontSize: 13 },
  sub: { fontFamily: LETRA.texto, fontSize: 13.5 },
  detalles: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginTop: 2 },
  acceso: { fontFamily: LETRA.texto, fontSize: 12.5 },
  vacio: { alignItems: 'center', paddingVertical: 40, paddingHorizontal: 24, gap: 12 },
  vacioIcono: { width: 56, height: 56, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  vacioTexto: { fontFamily: LETRA.titulo, fontSize: 17 },
})
