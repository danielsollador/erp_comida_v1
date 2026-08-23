import { useEffect, useState } from 'react'
import NavBar from '../components/NavBar'
import { api } from '../lib/api'
import type { Respaldo } from '../lib/types'

export default function Sistema() {
  const [respaldos, setRespaldos] = useState<Respaldo[]>([])
  const [creando, setCreando] = useState(false)

  useEffect(() => {
    cargar()
  }, [])

  function cargar() {
    api.listarRespaldos().then(setRespaldos)
  }

  async function crearAhora() {
    setCreando(true)
    try {
      await api.crearRespaldo()
      cargar()
    } finally {
      setCreando(false)
    }
  }

  const ultimo = respaldos[0]
  const horasDesdeUltimo = ultimo
    ? Math.floor((Date.now() - new Date(ultimo.creado_en).getTime()) / 3600000)
    : null

  return (
    <div className="min-h-screen bg-neutral-50">
      <NavBar titulo="Sistema" />
      <div className="p-4 max-w-2xl mx-auto space-y-5">
        <div
          className={`rounded-2xl border p-4 ${
            horasDesdeUltimo !== null && horasDesdeUltimo <= 8
              ? 'bg-emerald-50 border-emerald-200'
              : 'bg-amber-50 border-amber-200'
          }`}
        >
          <h2 className="font-semibold mb-1">Respaldo de la base de datos</h2>
          <p className="text-sm text-neutral-700">
            {ultimo
              ? `Ultimo respaldo hace ${horasDesdeUltimo} hora(s), automatico.`
              : 'Todavia no hay respaldos generados.'}
          </p>
          <p className="text-xs text-neutral-500 mt-1">
            El sistema guarda una copia cada 6 horas sola. Eso protege contra corrupcion o
            borrado accidental en esta misma maquina - pero si la laptop se pierde, se moja o
            se la roban, esos respaldos se pierden con ella. Baja el ultimo respaldo aqui una
            vez por semana y guardalo en un USB, tu correo o tu telefono.
          </p>
        </div>

        <button
          onClick={crearAhora}
          disabled={creando}
          className="w-full bg-neutral-900 text-white rounded-2xl py-3 font-medium disabled:opacity-50"
        >
          {creando ? 'Generando...' : 'Generar respaldo ahora'}
        </button>

        <div className="bg-white rounded-2xl border border-neutral-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-neutral-50 text-neutral-500 text-xs uppercase">
              <tr>
                <th className="text-left p-3">Fecha</th>
                <th className="text-right p-3">Tamano</th>
                <th className="p-3" />
              </tr>
            </thead>
            <tbody>
              {respaldos.map((r) => (
                <tr key={r.nombre} className="border-t border-neutral-100">
                  <td className="p-3">{new Date(r.creado_en).toLocaleString('es-VE')}</td>
                  <td className="text-right p-3 tabular-nums">{r.tamano_kb} KB</td>
                  <td className="p-3 text-right">
                    <a
                      href={`/api/respaldos/${r.nombre}/descargar`}
                      className="text-blue-600 font-medium"
                    >
                      Descargar
                    </a>
                  </td>
                </tr>
              ))}
              {respaldos.length === 0 && (
                <tr>
                  <td colSpan={3} className="p-4 text-center text-neutral-400">
                    Sin respaldos todavia.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
