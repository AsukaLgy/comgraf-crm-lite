import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from './api'
import { ErrorBox, Loading } from './components'
import CasePrintSheet from './CasePrintSheet'

export async function printReady() {
  await document.fonts.ready
  const images = [...document.querySelectorAll('.print-sheet img')]
  if (document.querySelector('.qr-error, .qr-placeholder')) throw new Error('El QR no está listo. Reintenta cuando aparezca completo.')
  await Promise.all(images.map((img) => img.decode()))
  if (!images.some((img) => img.alt.includes('QR estable'))) throw new Error('Falta el QR de la orden.')
}

export default function PrintDocument() {
  const [mode,setMode]=useState('letter')
  const match = location.pathname.match(/^\/cases\/(\d+)\/print$/)
  const id = match?.[1]
  const productionId = new URLSearchParams(location.search).get('production_id')
  const query = useQuery({ queryKey: ['print-case', id, productionId], enabled: !!id && !!productionId, queryFn: () => api(`/cases/${id}?production_id=${encodeURIComponent(productionId)}`) })
  async function printOrder() {
    try { await printReady(); window.print() }
    catch (error) { window.alert(error.message) }
  }
  if (!id || !productionId) return <div className="error">Selecciona una orden de producción para imprimir.</div>
  if (query.isPending) return <Loading />
  if (query.error) return <><ErrorBox error={query.error}/><button onClick={() => query.refetch()}>Reintentar carga</button></>
  if (String(query.data.production?.id) !== productionId) return <div className="error">La orden seleccionada no está disponible.</div>
  return <main className={`print-document print-${mode}`}><div className="print-document-actions"><label>Formato de papel <select value={mode} onChange={e=>setMode(e.target.value)}><option value="letter">Carta: orden en la mitad superior</option><option value="half">Media carta: papel personalizado</option></select></label><button onClick={printOrder}>Imprimir / Guardar como PDF</button><button onClick={() => query.refetch()}>Recargar</button></div>{mode==='letter'&&<p className="print-instructions">Selecciona papel Carta, orientación vertical, escala 100 % y desactiva encabezados y pies del navegador. La orden ocupará la mitad superior.</p>}<CasePrintSheet id={id} record={query.data} preview /></main>
}
