/**
 * Los tipos de la API son LOS MISMOS de la web: se importan de ahi, no se
 * copian. Si el backend cambia un campo, la web y la app lo ven a la vez al
 * revisar tipos. (Es el primer pedazo de `paquetes/nucleo`; cuando exista,
 * estos `export type` apuntaran ahi.)
 *
 * Solo tipos: al empaquetar la app desaparecen, no arrastran codigo de la web.
 */
export type {
  Aviso,
  BalanceGeneral,
  CuentaPorCobrar,
  EstadoAcceso,
  EstadoResultadosContable,
  EstadoTasa,
  FilaBalanceComprobacion,
  PasoRecorrido,
  PeriodoPendiente,
  Recorrido,
  ReporteResumen,
} from '../../../frontend/src/lib/types'
