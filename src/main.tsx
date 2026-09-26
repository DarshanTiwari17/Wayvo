import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import './index.css'

/**
 * Publish the branded hero photograph as a CSS custom property on <html> so the
 * auth shell and the signed-in chrome share one source. Overridable with
 * VITE_WAYVO_HERO_IMAGE; the CSS also carries the bundled default.
 */
const heroImage = import.meta.env.VITE_WAYVO_HERO_IMAGE?.trim() || '/images/wayvo-waterfall.jpg'
document.documentElement.style.setProperty('--wayvo-hero-image', `url("${heroImage}")`)

const container = document.getElementById('root')
if (!container) {
  throw new Error('Wayvo could not start: no #root element in index.html.')
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
