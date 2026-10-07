import { router, useLocalSearchParams } from 'expo-router'
import Apariencia from '../../../componentes/configuracion/Apariencia'
import Lenguaje from '../../../componentes/configuracion/Lenguaje'
import MiCuenta from '../../../componentes/configuracion/MiCuenta'
import PagoMovil from '../../../componentes/configuracion/PagoMovil'
import Usuarios from '../../../componentes/configuracion/Usuarios'
import { Barra } from '../../../componentes/Encabezado'
import { Pantalla, Pestanas } from '../../../componentes/ui'
import { useSesion } from '../../../lib/sesion'

/**
 * CONFIGURACION, como pages/Configuracion.tsx de la web: las mismas seis
 * secciones, en el mismo orden y con los mismos permisos. Usuarios y Roles
 * solo para quien gestiona usuarios; Pago movil solo para quien administra
 * el local. La seccion va en la ruta (/configuracion/usuarios), igual que en
 * la web.
 */
type IdSeccion = 'cuenta' | 'lenguaje' | 'apariencia' | 'usuarios' | 'roles' | 'pago-movil'

const TODAS: { id: IdSeccion; texto: string }[] = [
  { id: 'cuenta', texto: 'Mi cuenta' },
  { id: 'lenguaje', texto: 'Lenguaje' },
  { id: 'apariencia', texto: 'Apariencia' },
  { id: 'usuarios', texto: 'Usuarios' },
  { id: 'roles', texto: 'Roles' },
  { id: 'pago-movil', texto: 'Pago móvil' },
]

export default function Configuracion() {
  const { acceso } = useSesion()
  const { seccion: pedida } = useLocalSearchParams<{ seccion: string }>()
  const gestionaUsuarios = acceso?.puede.modulos.includes('usuarios') ?? false
  const administra = acceso?.puede.administrar ?? false
  const secciones = TODAS.filter((s) =>
    s.id === 'usuarios' || s.id === 'roles' ? gestionaUsuarios : s.id === 'pago-movil' ? administra : true,
  )
  const seccion: IdSeccion = secciones.some((s) => s.id === pedida) ? (pedida as IdSeccion) : 'cuenta'

  return (
    <Pantalla arriba={<Barra titulo="Configuración" />}>
      <Pestanas opciones={secciones} valor={seccion} alCambiar={(id) => router.setParams({ seccion: id })} />
      {seccion === 'cuenta' && <MiCuenta />}
      {seccion === 'lenguaje' && <Lenguaje />}
      {seccion === 'apariencia' && <Apariencia />}
      {(seccion === 'usuarios' || seccion === 'roles') && <Usuarios seccion={seccion} />}
      {seccion === 'pago-movil' && <PagoMovil />}
    </Pantalla>
  )
}
