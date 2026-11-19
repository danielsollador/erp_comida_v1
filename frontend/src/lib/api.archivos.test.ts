import { afterEach, expect, test, vi } from 'vitest'
import { api } from './api'

afterEach(() => vi.unstubAllGlobals())

test('la foto llega como multipart con archivo y no como JSON', async () => {
  const enviar = vi.fn(async (_url: unknown, opciones: RequestInit) => {
    const request = new Request('http://localhost/api/compras/lectura', opciones)
    expect(request.headers.get('Content-Type')).toContain('multipart/form-data; boundary=')
    const datos = await request.formData()
    const archivo = datos.get('archivo') as File
    expect(archivo.name).toBe('factura.jpg')
    expect(await archivo.text()).toBe('foto-de-prueba')
    return new Response('{}', { status: 200 })
  })
  vi.stubGlobal('fetch', enviar)
  await api.leerFacturaCompra(new Blob(['foto-de-prueba'], { type: 'image/jpeg' }))
  expect(enviar).toHaveBeenCalledOnce()
})
