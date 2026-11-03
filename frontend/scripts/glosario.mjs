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

/** Todos los archivos .tsx de una carpeta, incluidas sus subcarpetas. */
function pantallas(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? pantallas(join(dir, e.name)) : e.name.endsWith('.tsx') ? [join(dir, e.name)] : [],
  )
}

function usar(archivo, clave) {
  usadas.add(clave)
  if (!definidas.has(clave)) faltan.push(`${archivo}: ${clave}`)
}

for (const archivo of pantallas(join(raiz, 'pages'))) {
  const texto = readFileSync(archivo, 'utf8')
  let seccion = null
  // `<Tabla` con sus atributos en varias lineas: el glosario puede venir abajo.
  let abierta = false
  for (const linea of texto.split('\n')) {
    if (/<Tabla\b/.test(linea)) {
      seccion = null
      abierta = !/<Tabla\b[^>]*>/.test(linea)
    }
    const tabla = linea.match(/<Tabla\b[^>]*?glosario="([\w.]+)"/) ?? (abierta ? linea.match(/\bglosario="([\w.]+)"/) : null)
    if (tabla) seccion = tabla[1]
    if (abierta && /^\s*\/?>/.test(linea)) abierta = false

    const explicita = linea.match(/<Th\b[^>]*?\bayuda="([\w.]+)"/)
    const porClave = linea.match(/<Th\b[^>]*?\bclave="(\w+)"/)
    const clave = explicita ? explicita[1] : porClave && seccion ? `${seccion}.${porClave[1]}` : null
    if (clave) usar(archivo, clave)
  }
}

// Fuera de las tablas: `ayuda="kpi.x"` en las cifras y `explicar('x')` donde
// sea. La app movil tiene su propia copia (movil/src/componentes/reportes/glosario.ts).
for (const archivo of pantallas(raiz)) {
  const texto = readFileSync(archivo, 'utf8')
  for (const [, clave] of texto.matchAll(/\bayuda="(kpi\.[\w]+)"/g)) usar(archivo, clave)
  for (const [, clave] of texto.matchAll(/\bexplicar\('([\w.]+)'\)/g)) usar(archivo, clave)
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
