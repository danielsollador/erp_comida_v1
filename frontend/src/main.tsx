import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { activarModoLigeroSiHaceFalta } from './lib/ligero'

// Antes del primer pintado: si es una tablet, ni un fotograma con desenfoques.
activarModoLigeroSiHaceFalta()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
