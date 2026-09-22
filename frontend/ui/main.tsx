import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { CustomCursor } from './components/CustomCursor'
import './styles/zzz.css'

const container = document.getElementById('root')
if (container === null) throw new Error('Missing #root element')

createRoot(container).render(
  <StrictMode>
    {/* Mounted alongside App, not inside it: App has several early returns
        (booting, needs-login, sidecar-failed, ready) and the cursor has to
        survive all of them, not just the last one. */}
    <CustomCursor />
    <App />
  </StrictMode>
)
