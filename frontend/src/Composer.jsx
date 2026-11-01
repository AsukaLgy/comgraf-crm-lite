import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { api, uid } from './api'
import { ErrorBox, Field, Select } from './components'

const TEMPLATES = {
  'Resumen de interacción': [
    'Solicitud del cliente',
    'Persona consultada',
    'Acuerdo',
    'Fecha acordada',
    'Próximo paso',
  ],
  'Seguimiento de recogida': [
    'Medio de contacto',
    'Respuesta',
    'Acuerdo de recogida',
    'Próximo seguimiento',
  ],
  'Aprobación o cambios': [
    'Cotización o arte revisado',
    'Decisión',
    'Cambios solicitados',
    'Próximo paso',
  ],
  'Incidencia interna': ['Situación', 'Gestión realizada', 'Resultado o pendiente'],
  'Anulación excepcional': [
    'Solicitud o situación',
    'Etapa alcanzada',
    'Trabajo realizado',
    'Acuerdo',
    'Pendientes',
  ],
}

export default function Composer({ record, user }) {
  const qc = useQueryClient()
  const serverDraft = record.drafts.find((entry) => entry.channel === 'Nota')
  const storageKey = `comgraf.draft.${user.id}.${record.id}.Nota`
  const [draft, setDraft] = useState(
    () => localStorage.getItem(storageKey) ?? serverDraft?.body ?? '',
  )
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState('')
  const [template, setTemplate] = useState('')
  const [templateOpen, setTemplateOpen] = useState(false)
  const [templateValues, setTemplateValues] = useState({})
  const version = useRef(serverDraft?.version || 0)
  const key = useRef(uid())
  const timer = useRef()
  const locked = useRef(false)
  const queue = useRef(Promise.resolve())

  useEffect(() => () => clearTimeout(timer.current), [])

  function persist(body) {
    queue.current = queue.current
      .catch(() => {})
      .then(async () => {
        const result = await api(`/cases/${record.id}/drafts/Nota`, {
          method: 'PUT',
          body: { body, version: version.current },
        })
        version.current = result.version
        setSaved('Borrador guardado')
      })
      .catch((cause) => {
        setError(cause)
        setSaved('Borrador conservado en este navegador')
        throw cause
      })
    return queue.current
  }

  function edit(value) {
    setDraft(value)
    localStorage.setItem(storageKey, value)
    setSaved('Guardando borrador…')
    key.current = uid()
    clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      persist(value).catch(() => {})
    }, 650)
  }

  function addTemplate() {
    const text = (TEMPLATES[template] || [])
      .map((label) => [label, templateValues[label]?.trim()].filter(Boolean).join(': '))
      .filter(Boolean)
      .join('\n')
    if (!text) return
    edit(draft.trim() ? `${draft.trim()}\n\n${text}` : text)
    setTemplateOpen(false)
    setTemplate('')
    setTemplateValues({})
  }

  async function save(event) {
    event.preventDefault()
    if (locked.current) return
    locked.current = true
    setBusy(true)
    setError(null)
    clearTimeout(timer.current)
    try {
      await queue.current.catch(() => {})
      const body = draft.trim()
      if (!body) throw new Error('Escribe una nota antes de guardar.')
      await persist(body)
      await api(`/cases/${record.id}/events`, {
        method: 'POST',
        body: {
          version: record.version,
          key: key.current,
          kind: 'Nota interna',
          channel: 'Nota',
          body,
          direction: 'Interna',
        },
      })
      setDraft('')
      localStorage.removeItem(storageKey)
      await persist('')
      key.current = uid()
      setSaved('Nota guardada')
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['case', String(record.id)] }),
        qc.invalidateQueries({ queryKey: ['counts'] }),
      ])
    } catch (cause) {
      setError(cause)
      if (cause.status === 409) qc.invalidateQueries({ queryKey: ['case', String(record.id)] })
    } finally {
      locked.current = false
      setBusy(false)
    }
  }

  return (
    <form className="composer" onSubmit={save}>
      <div className="template-tools">
        <button
          type="button"
          className="text-button"
          onClick={() => setTemplateOpen((value) => !value)}
        >
          Usar plantilla
        </button>
        {templateOpen && (
          <div className="notice">
            <Select
              label="Plantilla"
              options={Object.keys(TEMPLATES)}
              empty="Seleccionar plantilla"
              value={template}
              onChange={(event) => setTemplate(event.target.value)}
            />
            {template && (
              <div className="form-grid">
                {TEMPLATES[template].map((label) => (
                  <Field
                    key={label}
                    label={label}
                    value={templateValues[label] || ''}
                    onChange={(event) =>
                      setTemplateValues((values) => ({ ...values, [label]: event.target.value }))
                    }
                  />
                ))}
              </div>
            )}
            <button
              type="button"
              disabled={!template || !Object.values(templateValues).some((value) => value.trim())}
              onClick={addTemplate}
            >
              Añadir a la nota
            </button>
          </div>
        )}
      </div>
      <textarea
        aria-label="Nota interna"
        placeholder="Registra una nota, llamada, conversación externa o visita para el equipo…"
        rows={4}
        required
        value={draft}
        onChange={(event) => edit(event.target.value)}
        disabled={busy}
      />
      <div className="composer-footer">
        <small role="status">{saved || 'Solo visible para el equipo'}</small>
        <button className="primary" disabled={busy || !draft.trim()}>
          {busy ? 'Guardando…' : 'Guardar nota'}
        </button>
      </div>
      <ErrorBox error={error} />
    </form>
  )
}
