import NavBar from '../components/NavBar'
import { entraA } from '../components/Rail'
import { useSeccion, type Seccion } from '../components/Secciones'
import { Pagina } from '../components/ui'
import { useAcceso } from '../lib/acceso'
import { Apariencia, MiCuenta } from './MiUsuario'
import PagoMovil from './partes/configuracion/PagoMovil'
import Lenguaje from './partes/configuracion/Lenguaje'
import { PanelUsuarios } from './Usuarios'

/**
 * Configuracion: todo lo que se ajusta una vez y se deja, en un solo sitio.
 *
 *   MI CUENTA     mi nombre, mi contraseña y --si mi rol autoriza-- mi PIN.
 *   LENGUAJE      palabras sencillas o tecnicas en todo el sistema.
 *   APARIENCIA    el tema y como se escribe en esta tablet.
 *   USUARIOS      quien entra al local, y con que rol.        (administra)
 *   ROLES         que abre cada rol.                          (administra)
 *   PAGO MOVIL    la conexion con Pabilo y la cuenta del banco. (administra)
 *
 * Antes eran dos modulos --"Usuarios" para el dueño y "Mi usuario" para todos--
 * y no habia donde poner lo demas que un local configura (la cuenta del
 * banco, la apariencia). Ahora hay UN modulo y cada quien ve las pestañas que
 * le tocan: cualquiera entra a las dos primeras; el resto solo quien
 * administra, y el backend responde 403 a los demas de todos modos.
 */
const TODAS: Seccion[] = [
  { id: 'cuenta', texto: 'Mi cuenta' },
  { id: 'lenguaje', texto: 'Lenguaje' },
  { id: 'apariencia', texto: 'Apariencia' },
  { id: 'usuarios', texto: 'Usuarios' },
  { id: 'roles', texto: 'Roles' },
  { id: 'pago-movil', texto: 'Pago móvil' },
]

export default function Configuracion() {
  const { estado } = useAcceso()
  const gestionaUsuarios = entraA(estado.puede, 'usuarios')
  const administra = estado.puede.administrar
  const secciones = TODAS.filter((s) =>
    s.id === 'usuarios' || s.id === 'roles' ? gestionaUsuarios : s.id === 'pago-movil' ? administra : true,
  )
  const [seccion, irA] = useSeccion(secciones)
  const ancha = seccion === 'usuarios' || seccion === 'roles'

  return (
    <div className="min-h-screen bg-neutral-50">
      <NavBar titulo="Configuración" moneda={false} secciones={secciones} seccion={seccion} alCambiarSeccion={irA} />
      <Pagina ancho={ancha ? 'media' : 'angosta'}>
        {seccion === 'cuenta' && <MiCuenta />}
        {seccion === 'lenguaje' && <Lenguaje />}
        {seccion === 'apariencia' && <Apariencia />}
        {ancha && <PanelUsuarios seccion={seccion as 'usuarios' | 'roles'} />}
        {seccion === 'pago-movil' && <PagoMovil />}
      </Pagina>
    </div>
  )
}
