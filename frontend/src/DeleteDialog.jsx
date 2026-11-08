import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from './api'
import { ErrorBox, Field, Loading, Modal } from './components'

const validClientWord = (value) => value.trim().toLocaleLowerCase() === 'comgraf'

export default function DeleteDialog({ kind, id, onClose, onDeleted }) {
  const qc = useQueryClient()
  const [confirmation, setConfirmation] = useState('')
  const [includeCases, setIncludeCases] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const locked = useRef(false)
  const confirmationInput = useRef(null)
  const base = kind === 'client' ? `/clients/${id}` : `/cases/${id}`
  const preview = useQuery({ queryKey: ['delete-preview', kind, id], queryFn: () => api(base + '/delete-preview'), staleTime: 0 })
  const data = preview.data
  const expected = data?.cases?.[0]?.number
  const confirmed = kind === 'client' ? validClientWord(confirmation) : confirmation === expected
  const scopeConfirmed = kind !== 'client' || !data?.cases?.length || includeCases

  useEffect(() => {
    if (data) confirmationInput.current?.focus()
  }, [data])

  function close() {
    if (locked.current) return
    setConfirmation('')
    setIncludeCases(false)
    onClose()
  }

  async function submit(event) {
    event.preventDefault()
    if (locked.current || !confirmed || !scopeConfirmed || !data) return
    locked.current = true
    setBusy(true)
    setError(null)
    try {
      await api(base + '/delete-definitively', { method: 'POST', body: { preview: data, confirmation, include_cases: includeCases } })
      qc.removeQueries({ queryKey: [kind === 'client' ? 'client' : 'case', String(id)] })
      await qc.invalidateQueries()
      onDeleted()
    } catch (failure) {
      setError(failure)
      if (failure.status === 409) {
        setConfirmation('')
        setIncludeCases(false)
        await preview.refetch()
        confirmationInput.current?.focus()
      }
    } finally {
      locked.current = false
      setBusy(false)
    }
  }

  return <Modal title={kind === 'client' ? 'Eliminar cliente' : 'Eliminar definitivamente'} onClose={close} busy={busy} wide>
    {preview.isPending ? <Loading/> : preview.error ? <div className="dialog-body"><ErrorBox error={preview.error}/><button type="button" onClick={() => preview.refetch()}>Reintentar</button></div> : <form onSubmit={submit}>
      <div className="dialog-body delete-dialog-body">
        {kind === 'client' ? <div className="delete-identity"><strong>{data.client.name}</strong>{data.client.rtn && <span>RTN {data.client.rtn}</span>}</div> : <p><strong>{data.cases[0].number} · {data.cases[0].subject}</strong></p>}
        <div className="delete-scope">
          {kind === 'client' && <>
            <p>{data.cases.length ? `${data.cases.length} solicitudes relacionadas` : 'Este cliente no tiene solicitudes'} · {data.contacts} contactos exclusivos.</p>
            {data.cases.length > 0 && <ul>{data.cases.map(c => <li key={c.id}>{c.number} · {c.subject}</li>)}</ul>}
          </>}
          <p>Se eliminarán {data.counts.productions || 0} órdenes, {data.counts.items || 0} productos, {data.counts.quotes || 0} cotizaciones, {data.counts.tasks || 0} tareas, {data.counts.attachments || 0} adjuntos, {data.counts.events || 0} eventos, {data.counts.deliveries || 0} entregas y {data.counts.ledger || 0} movimientos de cobro.</p>
          {(data.counts.deliveries > 0 || data.counts.ledger > 0) && <p>El alcance incluye entregas y movimientos de cobro registrados.</p>}
          {kind === 'client' && data.cases.length > 0 && <label className="delete-scope-check"><input type="checkbox" checked={includeCases} onChange={e => setIncludeCases(e.target.checked)}/> Eliminar cliente y sus solicitudes</label>}
        </div>
        {kind === 'client' && <p className="delete-warning">Esta acción es definitiva y no se puede deshacer desde la aplicación.</p>}
        <Field label={kind === 'client' ? 'Para confirmar la eliminación definitiva, escribe comgraf' : `Escribe ${expected} para confirmar`} required value={confirmation} onChange={e => setConfirmation(e.target.value)} ref={confirmationInput} />
        <ErrorBox error={error}/>
      </div>
      <footer><button type="button" onClick={close} disabled={busy}>Cancelar</button><button className="destructive-button" disabled={busy || !confirmed || !scopeConfirmed}>{busy ? 'Eliminando…' : 'Eliminar definitivamente'}</button></footer>
    </form>}
  </Modal>
}
