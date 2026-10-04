import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { activarModoLigeroSiHaceFalta } from './lib/ligero'
import { prepararApp } from './lib/nativo'

// Antes del primer pintado: si es una tablet, ni un fotograma con desenfoques.
activarModoLigeroSiHaceFalta()
// Si corre como app (Android / iOS), el acabado nativo; en la web, nada.
void prepararApp()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
