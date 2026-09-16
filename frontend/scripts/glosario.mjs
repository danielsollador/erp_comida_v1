/**
 * Ninguna columna sin explicación.
 *
 * Recorre las pantallas, ve qué sección del glosario declaró cada `<Tabla>` y
 * comprueba que cada `<Th clave="...">` de adentro tenga su entrada en
 * `lib/glosario.ts`. Agregar una columna sin explicarla rompe este chequeo, que
 * es justo cuando hay que escribirla: después nadie vuelve.
 *
 *   npm run glosario
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..', 'src')

const glosario = readFileSync(join(raiz, 'lib', 'glosario.ts'), 'utf8')
// Solo las claves entre comillas al principio de linea: los campos de cada
// explicacion (que, origen, calculo, ejemplo) van sin comillas y no cuentan.
const definidas = new Set([...glosario.matchAll(/^\s*'([\w.]+)':/gm)].map((m) => m[1]))
// Base, IVA y Total se generan con un helper para compras y para ventas.
for (const [, seccion] of glosario.matchAll(/\[`(\w+)\.\$\{k\}`/g)) {
  for (const c of ['base', 'iva', 'total']) definidas.add(`${seccion}.${c}`)
}

const faltan = []
const usadas = new Set()

for (const archivo of readdirSync(join(raiz, 'pages')).filter((f) => f.endsWith('.tsx'))) {
  const texto = readFileSync(join(raiz, 'pages', archivo), 'utf8')
  let seccion = null
  for (const linea of texto.split('\n')) {
    const tabla = linea.match(/<Tabla\b[^>]*?glosario="([\w.]+)"/)
    if (tabla) seccion = tabla[1]
    else if (/<Tabla\b/.test(linea)) seccion = null

    const explicita = linea.match(/<Th\b[^>]*?\bayuda="([\w.]+)"/)
    const porClave = linea.match(/<Th\b[^>]*?\bclave="(\w+)"/)
    const clave = explicita ? explicita[1] : porClave && seccion ? `${seccion}.${porClave[1]}` : null
    if (!clave) continue
    usadas.add(clave)
    if (!definidas.has(clave)) faltan.push(`${archivo}: ${clave}`)
  }
  for (const [, clave] of texto.matchAll(/\bayuda="(kpi\.[\w]+)"/g)) {
    usadas.add(clave)
    if (!definidas.has(clave)) faltan.push(`${archivo}: ${clave}`)
  }
}

const sobran = [...definidas].filter((c) => !usadas.has(c))

if (faltan.length) {
  console.error(`\nSin explicación en el glosario (${faltan.length}):`)
  for (const f of faltan) console.error(`  ${f}`)
}
if (sobran.length) {
  console.error(`\nExplicadas pero ya no se usan (${sobran.length}):`)
  for (const s of sobran) console.error(`  ${s}`)
}
if (faltan.length || sobran.length) process.exit(1)
console.log(`Glosario completo: ${usadas.size} columnas y cifras explicadas.`)
