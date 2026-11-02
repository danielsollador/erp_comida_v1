/**
 * Los tipos de la API son LOS MISMOS de la web: se importan de ahi, no se
 * copian. Si el backend cambia un campo, la web y la app lo ven a la vez al
 * revisar tipos. (Es el primer pedazo de `paquetes/nucleo`; cuando exista,
 * esto apuntara ahi.)
 *
 * Solo tipos: al empaquetar la app desaparecen, no arrastran codigo de la web.
 */
export type * from '../../../frontend/src/lib/types'
