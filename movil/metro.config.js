// https://docs.expo.dev/guides/customizing-metro/
const path = require('path')
const { getDefaultConfig } = require('expo/metro-config')

const config = getDefaultConfig(__dirname)

// LO COMPARTIDO CON LA WEB. La app lee DATOS de frontend/src/lib (los trazos
// de los iconos, los tipos de la API): se escriben una vez y los usan las
// dos. Solo esa carpeta, y solo archivos sin pantalla: nada de la web que
// toque el navegador entra a la app.
config.watchFolders = [path.resolve(__dirname, '../frontend/src/lib')]

module.exports = config
