import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from './api'
import { ErrorBox, Field, Loading, Modal } from './components'

export default function DeleteDialog({ kind, id, onClose, onDeleted }) {
  const qc = useQueryClient()
  const [confirmation, setConfirmation] = useState('')
  const [includeCases, setIncludeCases] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const base = kind === 'client' ? `/clients/${id}` : `/cases/${id}`
  const preview = useQuery({ queryKey: ['delete-preview', kind, id], queryFn: () => api(base + '/delete-preview'), staleTime: 0 })
  const data = preview.data
  const expected = kind === 'client' ? `CLIENTE-${id}` : data?.cases?.[0]?.number
  async function submit(event) {
    event.preventDefault()
    if (busy || confirmation !== expected || (kind === 'client' && data.cases.length && !includeCases)) return
    setBusy(true); setError(null)
    try {
      await api(base + '/delete-definitively', { method: 'POST', body: { preview: data, confirmation, include_cases: includeCases } })
      await qc.invalidateQueries()
      onDeleted()
    } catch (failure) {
      setError(failure)
      if (failure.status === 409) { setConfirmation(''); setIncludeCases(false); await preview.refetch() }
    } finally { setBusy(false) }
  }
  return <Modal title="Eliminar definitivamente" onClose={onClose} busy={busy} wide>
    {preview.isPending ? <Loading/> : preview.error ? <ErrorBox error={preview.error}/> : <form onSubmit={submit}>
      <div className="dialog-body">
        <p><strong>{kind === 'client' ? data.client.name : `${data.cases[0].number} · ${data.cases[0].subject}`}</strong></p>
        {kind === 'client' && <p>{data.cases.length} solicitudes relacionadas; {data.contacts} contactos exclusivos.</p>}
        {kind === 'client' && data.cases.length > 0 && <ul>{data.cases.map(c => <li key={c.id}>{c.number} · {c.subject}</li>)}</ul>}
        <p>Se eliminarán {data.counts.productions || 0} órdenes, {data.counts.items || 0} productos, {data.counts.quotes || 0} cotizaciones, {data.counts.tasks || 0} tareas, {data.counts.attachments || 0} adjuntos, {data.counts.events || 0} eventos, {data.counts.deliveries || 0} entregas y {data.counts.ledger || 0} movimientos de cobro.</p>
        {(data.counts.deliveries > 0 || data.counts.ledger > 0) && <p className="notice">Esta eliminación incluye entregas y movimientos de cobro registrados.</p>}
        {kind === 'client' && data.cases.length > 0 && <label className="field"><input type="checkbox" checked={includeCases} onChange={e => setIncludeCases(e.target.checked)}/> Eliminar cliente y sus solicitudes</label>}
        <Field label={`Escribe ${expected} para confirmar`} value={confirmation} onChange={e => setConfirmation(e.target.value)} required />
        <ErrorBox error={error}/>
      </div>
      <footer><button type="button" onClick={onClose}>Cancelar</button><button className="danger" disabled={busy || confirmation !== expected || (kind === 'client' && data.cases.length > 0 && !includeCases)}>Eliminar definitivamente</button></footer>
    </form>}
  </Modal>
}
