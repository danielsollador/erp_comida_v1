import { useState } from 'react'
import { Alert, View } from 'react-native'
import { apiUsuarios } from '../../../lib/api-usuarios'
import type { Modulo, RolInfo } from '../../../lib/tipos'
import { Aviso, Boton, Campo, Etiqueta, Ficha, Nota } from '../../ui'
import { CasillaAutoriza, CasillaKpis, ElegirModulos, Encabezado, Volver } from './piezas'

/**
 * Devolver un rol de fabrica a los modulos con los que viene, con su
 * confirmacion. Se usa desde la lista y desde la edicion: es la salida
 * cuando un recorte dejo a alguien sin poder trabajar.
 */
export function restaurarRol(
  r: RolInfo,
  { alOk, alError }: { alOk: (texto: string) => void; alError: (texto: string) => void },
) {
  Alert.alert(`¿Devolver «${r.nombre}» a como viene?`, 'Recupera los módulos de fábrica y se pierde el recorte que le hiciste.', [
    { text: 'Cancelar', style: 'cancel' },
    {
      text: 'Restaurar',
      onPress: async () => {
        try {
          await apiUsuarios.restaurarRol(r.rol)
          alOk(`«${r.nombre}» quedó como viene de fábrica.`)
        } catch (err) {
          alError((err as Error).message)
        }
      },
    },
  ])
}

/**
 * Crear un rol (sin `rol`) o editar uno (con `rol`). En la web la edicion se
 * abre dentro de la fila; en el telefono es una vista en su lugar, porque la
 * lista de modulos ocupa la pantalla entera y dentro de la fila empujaria
 * todo lo demas fuera de la vista.
 *
 * A uno de fabrica no se le reescribe el nombre: se le recorta la lista de
 * modulos, y ese recorte es de ESTE local. Por eso lleva "Restaurar".
 */
export default function FormRol({
  rol: r,
  catalogo,
  error,
  alVolver,
  alListo,
  alError,
}: {
  rol?: RolInfo
  /** Los modulos que se pueden marcar. */
  catalogo: Modulo[]
  error: string
  alVolver: () => void
  /** Guardado (o restaurado): el texto del aviso. */
  alListo: (texto: string) => void
  alError: (texto: string) => void
}) {
  const [nombre, setNombre] = useState(r?.nombre ?? '')
  const [descripcion, setDescripcion] = useState(r?.descripcion ?? '')
  const [elegidos, setElegidos] = useState<string[]>(r?.modulos.map((m) => m.id) ?? [])
  const [autoriza, setAutoriza] = useState(r?.autoriza ?? false)
  const [veKpis, setVeKpis] = useState(r?.ve_kpis ?? false)
  const [guardando, setGuardando] = useState(false)

  async function guardar() {
    setGuardando(true)
    try {
      const datos = { nombre, descripcion, modulos: elegidos, autoriza, ve_kpis: veKpis }
      if (r) {
        await apiUsuarios.editarRol(r.rol, datos)
        alListo(`«${nombre || r.nombre}» actualizado. Quien lo tenga lo nota al recargar.`)
      } else {
        await apiUsuarios.crearRol(datos)
        alListo(`Rol «${nombre.trim()}» creado. Ya se puede asignar a un usuario.`)
      }
    } catch (err) {
      alError((err as Error).message)
    } finally {
      setGuardando(false)
    }
  }

  const aMedida = !r || r.a_medida

  return (
    <>
      <Volver texto="Volver a los roles" alTocar={alVolver} />
      <Ficha style={{ gap: 16 }}>
        {r ? (
          <Encabezado titulo={`Editar «${r.nombre}»`} ayuda={r.descripcion || undefined} />
        ) : (
          <Encabezado
            titulo="Crear un rol"
            ayuda="Para cuando los roles de fábrica no encajan: un mesonero que solo toma pedidos, un encargado sin acceso a la contabilidad."
          />
        )}

        {aMedida ? (
          <>
            <Campo
              rotulo="Nombre del rol"
              value={nombre}
              onChangeText={setNombre}
              autoCapitalize="sentences"
              placeholder={r ? undefined : 'ej. Mesonero'}
            />
            <Campo
              rotulo={r ? 'Para qué es' : 'Para qué es (opcional)'}
              value={descripcion}
              onChangeText={setDescripcion}
              placeholder={r ? undefined : 'Toma pedidos en mesa y los manda a cocina'}
            />
          </>
        ) : (
          <Nota>Es un rol de fábrica: el nombre no cambia, pero sí a qué entra en «este» local.</Nota>
        )}

        <View style={{ gap: 10 }}>
          <Etiqueta>A qué módulos entra</Etiqueta>
          <ElegirModulos catalogo={catalogo} elegidos={elegidos} alCambiar={setElegidos} />
          {!r && (
            <Nota style={{ marginTop: 2 }}>
              Lo que no marques, el sistema se lo niega: no es que la pantalla se esconda, es que el servidor responde que no.
              Crear usuarios no está en la lista a propósito: eso se queda contigo.
            </Nota>
          )}
        </View>

        <View style={{ gap: 8 }}>
          <CasillaAutoriza marcada={autoriza} fija={r?.autoriza_fijo ?? false} alCambiar={setAutoriza} />
          <CasillaKpis marcada={veKpis} fija={r?.ve_kpis_fijo ?? false} alCambiar={setVeKpis} />
        </View>

        {/* El error va junto al boton: arriba, con el teclado abierto, no se ve. */}
        {error ? <Aviso texto={error} tono="peligro" /> : null}
        <View style={{ gap: 10 }}>
          {r ? (
            <>
              <Boton
                texto={guardando ? 'Guardando…' : 'Guardar'}
                alTocar={() => void guardar()}
                deshabilitado={guardando || elegidos.length === 0}
              />
              <Boton texto="Cancelar" tono="neutro" alTocar={alVolver} />
              {r.ajustado && (
                <Boton
                  texto="Restaurar el de fábrica"
                  tono="neutro"
                  alTocar={() => restaurarRol(r, { alOk: alListo, alError })}
                />
              )}
            </>
          ) : (
            <Boton
              texto={guardando ? 'Creando…' : 'Crear rol'}
              alTocar={() => void guardar()}
              deshabilitado={guardando || elegidos.length === 0 || !nombre.trim()}
            />
          )}
        </View>
      </Ficha>
    </>
  )
}
