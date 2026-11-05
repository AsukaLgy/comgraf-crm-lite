import './Brand.css'

export default function Brand({ size = 'navigation' }) {
  return <span className={`comgraf-brand comgraf-brand--${size}`}>
    <span className="comgraf-brand-image"><img src="/branding/comgraf-logo.png" width="640" height="611" alt="Emblema de Comgraf" /></span>
    <span className="comgraf-brand-wordmark">COMGRAF{size !== 'compact' && <small>COMUNICACIÓN GRÁFICA</small>}</span>
  </span>
}
