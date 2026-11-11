import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api, can } from './api'
import { ErrorBox, Field, FormDialog, Select } from './components'
import { validateRtn } from './rtn'
import ClientIdentityFields from './ClientIdentityFields'
import { CASE_PRIORITIES } from './domain'

const CASE_KINDS = ['Cotización', { value: 'Solicitud', label: 'Orden de producción' }, 'Reclamo']

export default function NewCase({
  onClose,
  clientId,
  client: initialClient,
  user,
  creationContext = 'pool',
}) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const prefill = initialClient || null

  function selectClient(setValue, client) {
    setValue('client_id', client.id)
    setValue('contact_id', '')
    queryClient.invalidateQueries({ queryKey: ['clients-search'] })
  }

  return (
    <FormDialog
      title="Nueva solicitud de atención"
      onClose={onClose}
      initial={{
        client_id: clientId || '',
        contact_id: '',
        subject: '',
        description: '',
        kind: '',
        priority: 'Normal',
      }}
      onSave={async (values) => {
        if (!values.client_id) throw new Error('Selecciona o crea un cliente antes de guardar.')
        if (!values.kind) throw new Error('Selecciona un tipo de atención antes de guardar.')

        const record = await api('/cases', {
          method: 'POST',
          body: {
            subject: values.subject,
            description: values.description,
            kind: values.kind,
            priority: values.priority,
            client_id: Number(values.client_id),
            contact_id: values.contact_id ? Number(values.contact_id) : null,
            creation_context: creationContext,
          },
        })

        await queryClient.invalidateQueries()
        const from = creationContext === 'pool' ? '/inbox/pool' : '/inbox/mine'
        navigate(
          `/cases/${record.id}?from=${encodeURIComponent(from)}&return=${encodeURIComponent(from)}`,
        )
      }}
      render={(values, setValue) => (
        <>
          <div className="form-grid">
            <ClientAutocomplete
              user={user}
              selectedId={values.client_id}
              initialClient={prefill}
              onSelect={(client) => selectClient(setValue, client)}
              onClear={() => {
                setValue('client_id', '')
                setValue('contact_id', '')
              }}
            />
            <ContactAutocomplete
              key={values.client_id || 'none'}
              user={user}
              clientId={values.client_id}
              value={values.contact_id}
              onChange={(value) => setValue('contact_id', value)}
            />
            <Field
              label="Asunto"
              className="full"
              required
              maxLength={240}
              value={values.subject}
              onChange={(event) => setValue('subject', event.target.value)}
            />
            <Select
              label="Tipo de atención"
              options={CASE_KINDS}
              empty="Seleccionar tipo de atención"
              required
              value={values.kind}
              onChange={(event) => setValue('kind', event.target.value)}
            />
            <Select
              label="Prioridad"
              options={CASE_PRIORITIES}
              value={values.priority}
              onChange={(event) => setValue('priority', event.target.value)}
            />
            <Field label="Descripción" className="full">
              <textarea
                rows={4}
                value={values.description}
                onChange={(event) => setValue('description', event.target.value)}
              />
            </Field>
          </div>
          <p className="muted">
            {creationContext === 'pool'
              ? 'Se creará sin asignar en Bandeja general.'
              : 'Se asignará a tu usuario.'}{' '}
            Puede cerrarse sin producir ningún trabajo.
          </p>
        </>
      )}
    />
  )
}

export function ClientAutocomplete({
  user,
  selectedId,
  initialClient,
  onSelect,
  onClear,
  id = 'case-client',
  searchEndpoint = '/clients',
}) {
  const [text, setText] = useState(
    initialClient?.id === Number(selectedId) ? initialClient.name : '',
  )
  const [term, setTerm] = useState('')
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const [createOpen, setCreateOpen] = useState(false)
  const [draft, setDraft] = useState({ name: '', company: '', rtn: '', phone: '', email: '' })
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState(null)
  const createLock = useRef(false)
  const root = useRef(null)
  const queryClient = useQueryClient()
  const search = useQuery({
    queryKey: ['new-case-client-search', searchEndpoint, term],
    queryFn: ({ signal }) => api(`${searchEndpoint}?q=${encodeURIComponent(term)}`, { signal }),
    enabled: term.length > 0,
  })

  useEffect(() => {
    if (!selectedId && text.trim()) {
      const timer = setTimeout(() => setTerm(text.trim()), 220)
      return () => clearTimeout(timer)
    }
  }, [text, selectedId])

  const results = term === text.trim() ? search.data || [] : []

  useOutsideDismiss(root, setOpen)

  async function createClient() {
    if (createLock.current) return
    createLock.current = true
    setCreating(true)
    setCreateError(null)

    try {
      validateRtn(draft.rtn)
      const client = await api('/clients', {
        method: 'POST',
        body: {
          name: draft.name.trim(),
          company: draft.company.trim(),
          rtn: draft.rtn,
          phones: draft.phone.trim() ? [draft.phone.trim()] : [],
          emails: draft.email.trim() ? [draft.email.trim()] : [],
          addresses: [],
          observations: '',
          provisional: true,
        },
      })
      onSelect(client)
      setText(client.name)
      setCreateOpen(false)
      void queryClient.invalidateQueries({ queryKey: ['new-case-client-search'] }).catch(() => {})
    } catch (error) {
      setCreateError(error)
    } finally {
      createLock.current = false
      setCreating(false)
    }
  }

  function selectResult(client) {
    onSelect(client)
    setText(client.name)
    setOpen(false)
  }

  function onKeyDown(event) {
    if (event.key === 'Escape') {
      event.preventDefault()
      setOpen(false)
      return
    }
    if (event.key === 'ArrowDown' && results.length) {
      event.preventDefault()
      setOpen(true)
      setActiveIndex((index) => Math.min(index + 1, results.length - 1))
      return
    }
    if (event.key === 'ArrowUp' && results.length) {
      event.preventDefault()
      setActiveIndex((index) => Math.max(index - 1, 0))
      return
    }
    if (event.key === 'Enter' && open && results[activeIndex]) {
      event.preventDefault()
      selectResult(results[activeIndex])
    }
  }

  return (
    <div className="field autocomplete" ref={root}>
      <label htmlFor={id}>
        Cliente{' '}
        <span className="required-mark" aria-hidden="true">
          *
        </span>
      </label>
      <input
        id={id}
        aria-required="true"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={`${id}-suggestions`}
        aria-activedescendant={
          open && results[activeIndex] ? `${id}-option-${results[activeIndex].id}` : undefined
        }
        autoComplete="off"
        value={text}
        placeholder="Buscar nombre, empresa, RTN, teléfono o correo"
        onFocus={() => setOpen(true)}
        onClick={() => setOpen(true)}
        onKeyDown={onKeyDown}
        onChange={(event) => {
          setText(event.target.value)
          onClear()
          setOpen(true)
          setActiveIndex(0)
        }}
      />
      <small>* Campo obligatorio: selecciona un cliente de la lista.</small>
      <ErrorBox error={search.error || createError} />
      {open && (
        <div className="suggestion-list" id={`${id}-suggestions`} role="listbox">
          {selectedId && <p role="status">Cliente seleccionado</p>}
          {!selectedId && text.trim() && search.isFetching && (
            <p role="status">Buscando clientes…</p>
          )}
          {!selectedId &&
            term === text.trim() &&
            text.trim() &&
            !search.isFetching &&
            !results.length && <p role="status">Sin coincidencias.</p>}
          {!selectedId &&
            results.map((client, index) => (
              <button
                type="button"
                role="option"
                id={`${id}-option-${client.id}`}
                aria-selected={index === activeIndex}
                key={client.id}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => selectResult(client)}
              >
                <strong>{client.name}</strong>
                <small>{clientDetails(client)}</small>
              </button>
            ))}
          {!selectedId && can(user, 'clients') && text.trim() && (
            <button
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                setDraft((current) => ({ ...current, name: text.trim() }))
                setCreateOpen(true)
                setOpen(false)
              }}
            >
              ＋ Crear cliente “{text.trim()}”
            </button>
          )}
        </div>
      )}
      {createOpen && (
        <div className="inline-create">
          <ClientIdentityFields
            values={draft}
            set={(key, value) => setDraft((current) => ({ ...current, [key]: value }))}
          />
          <Field
            label="Teléfono (opcional)"
            value={draft.phone}
            onChange={(event) => setDraft({ ...draft, phone: event.target.value })}
          />
          <Field
            label="Correo (opcional)"
            value={draft.email}
            onChange={(event) => setDraft({ ...draft, email: event.target.value })}
          />
          <button type="button" disabled={creating || !draft.name.trim()} onClick={createClient}>
            {creating ? 'Creando…' : 'Crear y seleccionar cliente'}
          </button>
          <button type="button" onClick={() => setCreateOpen(false)}>
            Cancelar
          </button>
        </div>
      )}
    </div>
  )
}

function ContactAutocomplete({ user, clientId, value, onChange }) {
  const [text, setText] = useState('')
  const [term, setTerm] = useState('')
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const [createOpen, setCreateOpen] = useState(false)
  const [name, setName] = useState('')
  const [createError, setCreateError] = useState(null)
  const [creating, setCreating] = useState(false)
  const createLock = useRef(false)
  const root = useRef(null)
  const inputId = `case-contact-${clientId || 'none'}`
  useOutsideDismiss(root, setOpen)
  const contacts = useQuery({
    queryKey: ['client-contacts', clientId],
    queryFn: () => api(`/clients/${clientId}/contacts`),
    enabled: !!clientId,
  })

  useEffect(() => {
    const timer = setTimeout(() => setTerm(text.trim().toLocaleLowerCase()), 180)
    return () => clearTimeout(timer)
  }, [text])

  const results = (contacts.data || []).filter((contact) =>
    `${contact.name} ${contact.phone} ${contact.email}`.toLocaleLowerCase().includes(term),
  )
  const selectedContact = contacts.data?.find((contact) => String(contact.id) === String(value))

  function selectContact(contact) {
    onChange(String(contact.id))
    setText(contact.name)
    setOpen(false)
  }

  function onKeyDown(event) {
    if (event.key === 'Escape') {
      event.preventDefault()
      setOpen(false)
      return
    }
    if (event.key === 'ArrowDown' && results.length) {
      event.preventDefault()
      setActiveIndex((index) => Math.min(index + 1, results.length - 1))
      return
    }
    if (event.key === 'ArrowUp' && results.length) {
      event.preventDefault()
      setActiveIndex((index) => Math.max(index - 1, 0))
      return
    }
    if (event.key === 'Enter' && open && results[activeIndex]) {
      event.preventDefault()
      selectContact(results[activeIndex])
    }
  }

  async function createContact() {
    if (createLock.current || !name.trim()) return
    createLock.current = true
    setCreating(true)
    setCreateError(null)
    try {
      const contact = await api(`/clients/${clientId}/contacts`, {
        method: 'POST',
        body: { name: name.trim() },
      })
      selectContact(contact)
      setCreateOpen(false)
      await contacts.refetch()
    } catch (error) {
      setCreateError(error)
    } finally {
      createLock.current = false
      setCreating(false)
    }
  }

  return (
    <div className="field autocomplete" ref={root}>
      <label htmlFor={inputId}>Contacto (opcional)</label>
      <input
        id={inputId}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={`${inputId}-suggestions`}
        aria-activedescendant={
          open && results[activeIndex] ? `${inputId}-option-${results[activeIndex].id}` : undefined
        }
        autoComplete="off"
        disabled={!clientId}
        value={text || selectedContact?.name || ''}
        placeholder={clientId ? 'Buscar contacto…' : 'Selecciona un cliente primero'}
        onFocus={() => setOpen(true)}
        onClick={() => setOpen(true)}
        onKeyDown={onKeyDown}
        onChange={(event) => {
          setText(event.target.value)
          onChange('')
          setOpen(true)
          setActiveIndex(0)
        }}
      />
      {value && (
        <button
          type="button"
          className="text-button"
          onClick={() => {
            setText('')
            onChange('')
          }}
        >
          Quitar contacto
        </button>
      )}
      <ErrorBox error={contacts.error || createError} />
      {open && clientId && (
        <div className="suggestion-list" id={`${inputId}-suggestions`} role="listbox">
          <button
            type="button"
            role="option"
            onClick={() => {
              setText('')
              onChange('')
              setOpen(false)
            }}
          >
            Sin contacto específico
          </button>
          {contacts.isPending ? (
            <p role="status">Cargando contactos…</p>
          ) : (
            results.map((contact, index) => (
              <button
                type="button"
                role="option"
                id={`${inputId}-option-${contact.id}`}
                aria-selected={index === activeIndex}
                key={contact.id}
                onClick={() => selectContact(contact)}
              >
                <strong>{contact.name}</strong>
                <small>
                  {[contact.position, contact.phone, contact.email].filter(Boolean).join(' · ')}
                </small>
              </button>
            ))
          )}
          {!results.length && !contacts.isPending && (
            <p role="status">No hay contactos coincidentes.</p>
          )}
          {can(user, 'clients') && (
            <button
              type="button"
              onClick={() => {
                setName(text.trim())
                setCreateOpen(true)
                setOpen(false)
              }}
            >
              ＋ Crear contacto
            </button>
          )}
        </div>
      )}
      {createOpen && (
        <div className="inline-create">
          <Field
            label="Nombre del contacto"
            required
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          <button type="button" disabled={creating || !name.trim()} onClick={createContact}>
            {creating ? 'Creando…' : 'Crear y seleccionar'}
          </button>
          <button type="button" onClick={() => setCreateOpen(false)}>
            Cancelar
          </button>
        </div>
      )}
    </div>
  )
}

function clientDetails(client) {
  return [
    client.company,
    client.rtn && `RTN ${client.rtn}`,
    client.phones?.join(', '),
    client.emails?.join(', '),
  ]
    .filter(Boolean)
    .join(' · ')
}

function useOutsideDismiss(root, setOpen) {
  useEffect(() => {
    const closeOutside = (event) => {
      if (!root.current?.contains(event.target)) setOpen(false)
    }
    document.addEventListener('pointerdown', closeOutside)
    return () => document.removeEventListener('pointerdown', closeOutside)
  }, [root, setOpen])
}
