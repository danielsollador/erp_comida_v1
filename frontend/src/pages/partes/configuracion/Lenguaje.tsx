import { GLOSARIO } from '../../../lib/glosario'
import { TERMINOS, usePalabras, type ModoPalabras } from '../../../lib/palabras'

/**
 * Configuración › Lenguaje: con qué palabras habla el sistema.
 *
 * Dos modos para las mismas cifras (Leider, 30-sep): el SENCILLO, con las
 * palabras del negocio, y el TÉCNICO, como estaba antes. Aquí se explica qué
 * cambia en cada uno --el título que se ve y lo que dice la ayuda-- con una
 * muestra de verdad, y abajo va la lista completa de lo que tiene dos
 * nombres, para que nadie tenga que adivinar qué es qué.
 */
export default function Lenguaje() {
  const { modo, cambiar } = usePalabras()
  const ticket = GLOSARIO['kpi.ticket_promedio']

  return (
    <>
      <section className="vp-losa p-5 sm:p-6">
        <h2 className="font-display text-xl font-semibold tracking-tight">Cómo te habla el sistema</h2>
        <p className="mt-2 text-[15px] text-neutral-600 leading-relaxed">
          Los mismos números pueden llamarse de dos formas: como lo diría el dueño del negocio, o como lo diría un
          contador. Elige la que te resulte más clara. No cambia ninguna cifra ni se pierde ninguna explicación: solo
          cambia la palabra que ves en los títulos.
        </p>

        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <Modo
            marcado={modo === 'sencillo'}
            onElegir={() => cambiar('sencillo')}
            titulo="Sencillo"
            para="Para quien no viene de la contabilidad."
            puntos={[
              'Los títulos dicen literalmente qué es el número: «Gasta en promedio cada cliente», «Te quedó», «Hay».',
              'Al pasar el cursor (o dejar el dedo apretado en la tablet) sobre un título, la ayuda explica qué es y te dice cómo se le suele llamar: «A esto se le suele llamar ticket promedio».',
            ]}
          />
          <Modo
            marcado={modo === 'tecnico'}
            onElegir={() => cambiar('tecnico')}
            titulo="Técnico"
            para="Para quien viene de otro sistema o le pasa los números al contador."
            puntos={[
              'Los títulos usan las palabras de siempre: «Ticket promedio», «Ganancia neta», «Stock».',
              'La ayuda de cada título es la misma de antes: qué es, de dónde sale, cómo se calcula y para qué sirve.',
            ]}
          />
        </div>

        <p className="mt-4 text-sm text-neutral-500">
          Se cambia solo aquí, y vale para este equipo: cada tablet o teléfono guarda su elección.
        </p>
      </section>

      {/* La muestra: la misma cifra y su ayuda, en los dos modos, lado a lado. */}
      <section className="vp-losa p-5 sm:p-6">
        <h3 className="font-display text-lg font-semibold tracking-tight">Así se ve una cifra en cada modo</h3>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <Muestra
            modo="sencillo"
            activo={modo === 'sencillo'}
            titulo={TERMINOS['kpi.ticket_promedio'].sencillo}
            que={ticket?.que ?? ''}
            alias={`A esto se le suele llamar «${TERMINOS['kpi.ticket_promedio'].tecnico}».`}
          />
          <Muestra
            modo="tecnico"
            activo={modo === 'tecnico'}
            titulo={TERMINOS['kpi.ticket_promedio'].tecnico}
            que={ticket?.que ?? ''}
          />
        </div>
      </section>

      {/* La lista completa: todo lo que tiene dos nombres. */}
      <section className="vp-losa p-5 sm:p-6">
        <h3 className="font-display text-lg font-semibold tracking-tight">Todo lo que tiene dos nombres</h3>
        <p className="mt-1 text-sm text-neutral-500">En negrita, el que estás viendo ahora.</p>
        <ul className="mt-4 divide-y divide-[var(--vp-textura)]">
          {Object.entries(TERMINOS).map(([clave, t]) => {
            const que = (GLOSARIO[clave] ?? GLOSARIO[clave.replace('_agotadas', '')])?.que
            return (
              <li key={clave} className="py-3 first:pt-0 last:pb-0">
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-[15px]">
                  <span className={modo === 'sencillo' ? 'font-semibold text-neutral-900' : 'text-neutral-500'}>{t.sencillo}</span>
                  <span className="text-neutral-300" aria-hidden>
                    ·
                  </span>
                  <span className={modo === 'tecnico' ? 'font-semibold text-neutral-900' : 'text-neutral-500'}>{t.tecnico}</span>
                  <span className="ml-auto text-xs text-neutral-400">{t.donde}</span>
                </div>
                {que && <p className="mt-0.5 text-sm text-neutral-600 leading-snug">{que}</p>}
              </li>
            )
          })}
        </ul>
      </section>
    </>
  )
}

function Modo({
  marcado,
  onElegir,
  titulo,
  para,
  puntos,
}: {
  marcado: boolean
  onElegir: () => void
  titulo: string
  para: string
  puntos: string[]
}) {
  return (
    <button
      type="button"
      onClick={onElegir}
      aria-pressed={marcado}
      className={`vp-pulsable text-left rounded-2xl p-4 border-2 transition-colors ${
        marcado ? 'border-neutral-900 bg-neutral-50' : 'border-neutral-200 hover:border-neutral-300'
      }`}
    >
      <span className="flex items-center justify-between gap-2">
        <span className="font-display text-lg font-semibold">{titulo}</span>
        <span
          className={`w-5 h-5 rounded-full border-2 grid place-items-center ${marcado ? 'border-neutral-900' : 'border-neutral-300'}`}
          aria-hidden
        >
          {marcado && <span className="w-2.5 h-2.5 rounded-full bg-neutral-900" />}
        </span>
      </span>
      <span className="block mt-0.5 text-sm text-neutral-500">{para}</span>
      <ul className="mt-3 space-y-1.5">
        {puntos.map((p) => (
          <li key={p} className="text-sm text-neutral-700 leading-snug flex gap-2">
            <span className="mt-2 w-1 h-1 rounded-full bg-neutral-400 shrink-0" aria-hidden />
            <span>{p}</span>
          </li>
        ))}
      </ul>
    </button>
  )
}

/** Una tarjeta de cifra con su ayuda abierta debajo, como se vería de verdad. */
function Muestra({
  modo,
  activo,
  titulo,
  que,
  alias,
}: {
  modo: ModoPalabras
  activo: boolean
  titulo: string
  que: string
  alias?: string
}) {
  return (
    <div className={`rounded-2xl p-3 ${activo ? 'bg-neutral-100' : 'bg-neutral-50'}`}>
      <p className="text-xs font-semibold text-neutral-500 mb-2">
        {modo === 'sencillo' ? 'En sencillo' : 'En técnico'}
        {activo && <span className="ml-1.5 text-exito-700">· el tuyo</span>}
      </p>
      <div className="rounded-xl border border-neutral-200 bg-white p-3.5">
        <p className="text-xs font-medium text-neutral-500 underline decoration-dotted underline-offset-2">{titulo}</p>
        <p className="font-display text-2xl font-semibold tabular-nums mt-1 leading-none">$4.80</p>
      </div>
      <div className="mt-2 rounded-xl border border-neutral-200 bg-white p-3.5 shadow-sm">
        <p className="font-display font-semibold text-sm leading-tight">{titulo}</p>
        {alias && <p className="mt-1 text-[13px] font-medium text-acento-700">{alias}</p>}
        <p className="text-[13px] leading-relaxed text-neutral-700 mt-1.5">{que}</p>
        <p className="text-[12px] text-neutral-400 mt-1.5">…y de dónde sale, cómo se calcula y para qué sirve.</p>
      </div>
    </div>
  )
}
