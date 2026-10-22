/**
 * El glosario de la pantalla, en JSON para el asistente (spike de IA).
 *
 * El asistente responde "¿qué significa Ticket promedio?" con LA MISMA
 * definición que sale al pasar el cursor sobre la columna. Para no tener dos
 * glosarios, se genera desde `lib/glosario.ts`:
 *
 *   npm run glosario:json   ->  backend/app/asistente/glosario.json
 *
 * Correrlo cada vez que cambie el glosario (el backend no lee TypeScript).
 */
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import ts from 'typescript'

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..')
const tmp = mkdtempSync(join(tmpdir(), 'glosario-'))

function aJs(origen, destino, cambios = []) {
  let js = ts.transpileModule(readFileSync(join(raiz, origen), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText
  for (const [de, a] of cambios) js = js.replace(de, a)
  writeFileSync(join(tmp, destino), js)
}

// `palabras` usa React y localStorage solo dentro de funciones: importarlo en
// Node no los toca. React se resuelve desde node_modules del frontend.
aJs('src/lib/palabras.ts', 'palabras.mjs', [["from 'react'", `from '${pathToFileURL(join(raiz, 'node_modules/react/index.js'))}'`]])
aJs('src/lib/glosario.ts', 'glosario.mjs', [["from './palabras'", "from './palabras.mjs'"]])

const { GLOSARIO } = await import(pathToFileURL(join(tmp, 'glosario.mjs')).href)
const salida = Object.fromEntries(
  Object.entries(GLOSARIO).map(([clave, e]) => [clave, { que: e.que, origen: e.origen, calculo: e.calculo, ejemplo: e.ejemplo }]),
)
const destino = join(raiz, '..', 'backend', 'app', 'asistente', 'glosario.json')
writeFileSync(destino, JSON.stringify(salida, null, 1) + '\n')
console.log(`${Object.keys(salida).length} definiciones -> ${destino}`)
