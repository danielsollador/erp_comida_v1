import { beforeEach, describe, expect, it, vi } from 'vitest'

// La API de verdad hace fetch; aca se decide que contesta el servidor.
vi.mock('./api', () => {
  class ErrorApi extends Error {
    status: number
    constructor(mensaje: string, status: number) {
      super(mensaje)
      this.status = status
    }
  }
  return {
    ErrorApi,
    api: { completarFactura: vi.fn(), reconciliarCompras: vi.fn(), anotarAlGuardar: vi.fn() },
  }
})

const { api, ErrorApi } = await import('./api')
const { anotarAntesDeGuardar, completarDespuesDeGuardar, procesarPendientes, cuantosPendientes } = await import(
  './pendientesCompras'
)

const mock = api as unknown as Record<'completarFactura' | 'reconciliarCompras' | 'anotarAlGuardar', ReturnType<typeof vi.fn>>
const cuerpo = (soporte_id: number | null) => ({ soporte_id, proveedor_rif: 'J402235135', proveedor_nombre: 'X', renglones: [] })

function almacen(inicial: Record<string, string> = {}) {
  const datos = { ...inicial }
  vi.stubGlobal('window', {
    localStorage: {
      getItem: (k: string) => datos[k] ?? null,
      setItem: (k: string, v: string) => (datos[k] = v),
      removeItem: (k: string) => delete datos[k],
    },
  })
  return datos
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
  almacen()
})

describe('anotarAntesDeGuardar', () => {
  it('anota en el servidor lo de después, solo si hay foto', async () => {
    await anotarAntesDeGuardar('F-1', cuerpo(7))
    expect(mock.anotarAlGuardar).toHaveBeenCalledWith(7, expect.objectContaining({ numero_factura: 'F-1' }))
    await anotarAntesDeGuardar('F-2', cuerpo(null))
    expect(mock.anotarAlGuardar).toHaveBeenCalledTimes(1)
  })
})

describe('completarDespuesDeGuardar', () => {
  it('reintenta sin conexión y, si no llega, lo deja al servidor', async () => {
    mock.completarFactura.mockRejectedValue(new TypeError('Failed to fetch'))
    const p = completarDespuesDeGuardar(1, cuerpo(7))
    await vi.runAllTimersAsync()
    expect(await p).toEqual({ estado: 'pendiente' })
    expect(mock.completarFactura).toHaveBeenCalledTimes(3)
  })

  it('un 4xx no se reintenta: no se arregla solo', async () => {
    mock.completarFactura.mockRejectedValue(new ErrorApi('Esa foto ya respalda otra factura', 409))
    const r = await completarDespuesDeGuardar(1, cuerpo(7))
    expect(r).toEqual({ estado: 'fallo', mensaje: 'Esa foto ya respalda otra factura' })
    expect(mock.completarFactura).toHaveBeenCalledTimes(1)
  })

  it('cuando llega, dice si quedó la foto y las alertas', async () => {
    mock.completarFactura.mockResolvedValue({ foto: true, foto_perdida: false, aprendidas: 1, alertas: [] })
    expect(await completarDespuesDeGuardar(1, cuerpo(7))).toEqual({ estado: 'hecho', foto: true, fotoPerdida: false, alertas: [] })
  })
})

describe('procesarPendientes', () => {
  it('vacía la cola local de antes y pide al servidor que termine lo demás', async () => {
    const datos = almacen({
      'vp-compras-pendientes': JSON.stringify([{ factura_id: 4, numero: 'F-4', cuerpo: cuerpo(9), desde: '' }]),
    })
    mock.completarFactura.mockResolvedValue({ foto: true, foto_perdida: false, aprendidas: 0, alertas: [] })
    mock.reconciliarCompras.mockResolvedValue({ completadas: 2 })
    expect(cuantosPendientes()).toBe(1)
    expect(await procesarPendientes()).toBe(3)
    expect(datos['vp-compras-pendientes']).toBeUndefined()
    expect(cuantosPendientes()).toBe(0)
  })

  it('sin conexión no rompe: se intenta la próxima vez', async () => {
    mock.reconciliarCompras.mockRejectedValue(new TypeError('Failed to fetch'))
    expect(await procesarPendientes()).toBe(0)
  })
})
