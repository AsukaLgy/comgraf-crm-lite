import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import { api } from './api'
import { ErrorBox, Loading } from './components'
import CasePrintSheet from './CasePrintSheet'
import { PrintOrderPicker } from './OrderNavigation'

export async function printReady() {
  await document.fonts.ready
  const deadline = Date.now() + 10000
  while (true) {
    const sheet = document.querySelector('.print-sheet')
    if (!sheet) throw new Error('La orden seleccionada todavía no está disponible.')
    if (sheet.dataset.layoutOverflow === 'true')
      throw new Error(
        'Una especificación supera el área imprimible. Revisá el contenido antes de imprimir.',
      )
    if (document.querySelector('.qr-error'))
      throw new Error('El QR no está listo. Reintenta cuando aparezca completo.')
    if (sheet.dataset.layoutReady === 'true' && !document.querySelector('.qr-placeholder')) break
    if (Date.now() >= deadline)
      throw new Error('La vista previa aún se está preparando. Reintenta en unos segundos.')
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  const images = [...document.querySelectorAll('.print-sheet img')]
  await Promise.all(images.map((img) => img.decode()))
  if (!images.some((img) => img.alt.includes('QR estable')))
    throw new Error('Falta el QR de la orden.')
}

export default function PrintDocument() {
  const [mode, setMode] = useState('letter')
  const [printing, setPrinting] = useState(false)
  const [searchParams, setSearchParams] = useSearchParams()
  const queryClient = useQueryClient()
  const match = location.pathname.match(/^\/cases\/(\d+)\/print$/)
  const id = match?.[1]
  const productionId = searchParams.get('production_id')
  const query = useQuery({
    queryKey: ['print-case', id, productionId],
    enabled: !!id,
    queryFn: () =>
      api(
        `/cases/${id}${productionId ? `?production_id=${encodeURIComponent(productionId)}` : ''}`,
      ),
  })
  useEffect(() => {
    if (productionId || !query.data?.production?.id) return
    const params = new URLSearchParams(searchParams)
    params.set('production_id', String(query.data.production.id))
    setSearchParams(params, { replace: true })
  }, [productionId, query.data?.production?.id, searchParams, setSearchParams])
  const orders =
    query.data?.productions ||
    queryClient
      .getQueriesData({ queryKey: ['print-case', id] })
      .find(([, cached]) => cached?.productions)?.[1]?.productions ||
    []
  const ready =
    Boolean(productionId) &&
    !query.isPending &&
    !query.error &&
    String(query.data?.production?.id) === productionId
  async function printOrder() {
    if (!ready || printing) return
    setPrinting(true)
    try {
      await printReady()
      window.print()
    } catch (error) {
      window.alert(error.message)
    } finally {
      setPrinting(false)
    }
  }
  if (!id) return <ErrorBox error="Solicitud no encontrada." />
  return (
    <main className={`print-document print-${mode}`}>
      <div className="print-document-actions">
        <PrintOrderPicker
          orders={orders}
          selectedId={productionId}
          disabled={!orders.length}
          onSelect={(value) => {
            const params = new URLSearchParams(searchParams)
            params.set('production_id', value)
            setSearchParams(params)
          }}
        />
        <label>
          Formato de papel{' '}
          <select value={mode} onChange={(e) => setMode(e.target.value)}>
            <option value="letter">Carta: orden en la mitad superior</option>
            <option value="half">Media carta: papel personalizado</option>
          </select>
        </label>
        <button disabled={!ready || printing} onClick={printOrder}>
          {printing ? 'Preparando…' : 'Imprimir / Guardar como PDF'}
        </button>
        <button disabled={query.isPending} onClick={() => query.refetch()}>
          Recargar
        </button>
      </div>
      {mode === 'letter' && (
        <p className="print-instructions">
          Selecciona papel Carta, orientación vertical, escala 100 % y desactiva encabezados y pies
          del navegador. La orden ocupará la mitad superior.
        </p>
      )}
      {query.isPending ? (
        <Loading />
      ) : query.error ? (
        <ErrorBox error={query.error} />
      ) : !productionId && query.data?.production?.id ? (
        <Loading />
      ) : !productionId ? (
        <ErrorBox error="Esta solicitud no tiene órdenes de producción para imprimir." />
      ) : !ready ? (
        <ErrorBox error="La orden seleccionada no pertenece a esta solicitud." />
      ) : (
        <CasePrintSheet record={query.data} />
      )}
    </main>
  )
}
