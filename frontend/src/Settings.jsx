import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api, can, PRODUCT_VERSION } from './api'
import { Badge, ErrorBox, Field, FormDialog, Loading, Panel } from './components'
import { permissionInfo } from './permissionCatalog'
import { PASSWORD_MIN_LENGTH, PASSWORD_MAX_LENGTH } from './domain'
import './Settings.css'

const ROLES = [
  'Administrador',
  'Coordinador',
  'Atención',
  'Producción',
  'Cobranza',
  'Escáner de encuadernación',
]

const TECHNOLOGIES = [
  ['Aplicación', 'Comgraf', PRODUCT_VERSION],
  ['Runtime', 'Node.js', '24.11.1'],
  ['Runtime', 'Python', '3.14'],
  ['Base de datos', 'MySQL (Compose)', '8.4.11'],
  ['Base de datos', 'MySQL (perfil ligero)', '8.4.13-1debian12'],
  ['Proxy', 'Caddy', '2.11.7'],
  ['Frontend', '@fontsource/inter', '5.3.0'],
  ['Frontend', '@fontsource/jetbrains-mono', '5.3.0'],
  ['Frontend', '@tanstack/react-query', '5.90.21'],
  ['Frontend', '@zxing/browser', '0.2.1'],
  ['Frontend', 'lucide-react', '0.577.0'],
  ['Frontend', 'qrcode', '1.5.4'],
  ['Frontend', 'React', '19.2.4'],
  ['Frontend', 'React DOM', '19.2.4'],
  ['Frontend', 'React Router', '7.18.4'],
  ['Frontend · desarrollo', '@eslint/js', '9.39.5'],
  ['Frontend · desarrollo', '@playwright/test', '1.58.2'],
  ['Frontend · desarrollo', '@vitejs/plugin-react', '5.1.4'],
  ['Frontend · desarrollo', 'ESLint', '9.39.5'],
  ['Frontend · desarrollo', 'eslint-plugin-react', '7.37.5'],
  ['Frontend · desarrollo', 'eslint-plugin-react-hooks', '7.1.1'],
  ['Frontend · desarrollo', 'globals', '17.13.0'],
  ['Frontend · desarrollo', 'Prettier', '3.9.10'],
  ['Frontend · desarrollo', 'Vite', '7.3.7'],
  ['Backend', 'FastAPI', '0.135.1'],
  ['Backend', 'Uvicorn', '0.41.0'],
  ['Backend', 'SQLAlchemy', '2.0.48'],
  ['Backend', 'Alembic', '1.18.4'],
  ['Backend', 'PyMySQL', '1.1.2'],
  ['Backend', 'pwdlib', '0.3.0'],
  ['Backend', 'python-multipart', '0.0.22'],
  ['Backend', 'pydantic-settings', '2.13.1'],
  ['Backend', 'Pydantic', '2.14.1'],
  ['Backend', 'cryptography', '50.0.2'],
  ['Backend', 'tzdata', '2025.3'],
  ['Backend · desarrollo', 'HTTPX', '0.28.1'],
  ['Backend · desarrollo', 'pytest', '9.0.2'],
  ['Backend · desarrollo', 'Ruff', '0.17.1'],
]

export default function Settings({ user }) {
  const qc = useQueryClient()
  const [modal, setModal] = useState(null)
  const users = useQuery({
    queryKey: ['users'],
    queryFn: () => api('/users'),
    enabled: can(user, '*'),
  })
  const roles = useQuery({
    queryKey: ['roles'],
    queryFn: () => api('/roles'),
    enabled: can(user, '*'),
  })

  function updateUserRoles(value, set, role, checked) {
    if (role === 'Escáner de encuadernación' && checked) return set('roles', [role])
    if (value.roles.includes(role) && role === 'Escáner de encuadernación' && !checked)
      return set('roles', ['Atención'])
    if (value.roles.includes('Escáner de encuadernación')) return set('roles', [role])
    set('roles', checked ? [...value.roles, role] : value.roles.filter((item) => item !== role))
  }

  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">ADMINISTRACIÓN LOCAL</div>
          <h1>Configuración</h1>
          <p>Equipo y permisos.</p>
        </div>
      </div>
      <Panel
        title="Mi cuenta"
        action={<button onClick={() => setModal({ type: 'password' })}>Cambiar contraseña</button>}
      >
        <p>
          {user.name} · {user.roles.join(', ')}
        </p>
      </Panel>
      {can(user, '*') && (
        <>
          <Panel
            title="Usuarios y roles"
            action={
              <button className="primary" onClick={() => setModal({ type: 'user' })}>
                Crear usuario
              </button>
            }
          >
            <ErrorBox error={users.error} />
            {users.isPending ? (
              <Loading />
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Nombre</th>
                      <th>Usuario</th>
                      <th>Roles</th>
                      <th>Capacidad</th>
                      <th>Estado</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {users.data?.map((entry) => (
                      <tr key={entry.id}>
                        <td>{entry.name}</td>
                        <td>{entry.username}</td>
                        <td>{entry.roles.join(', ')}</td>
                        <td>{entry.capacity} solicitudes</td>
                        <td>
                          <Badge tone={entry.active ? 'teal' : ''}>
                            {entry.active ? 'Activo' : 'Desactivado'}
                          </Badge>
                        </td>
                        <td>
                          <button onClick={() => setModal({ type: 'user', user: entry })}>
                            Editar
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
          <Panel title="Permisos por rol">
            <p className="muted">
              El rol de escaneo es exclusivo. Sus cuentas solo pueden escanear, consultar el
              resultado y solicitar excepciones.
            </p>
            <ErrorBox error={roles.error} />
            {roles.data?.roles.map((role) => (
              <div className="role-row" key={role.name}>
                <strong>{role.name}</strong>
                <span>
                  {role.permissions
                    .map((permission) => permissionInfo(permission).label)
                    .join(', ')}
                </span>
                {role.name !== 'Administrador' && role.name !== 'Escáner de encuadernación' && (
                  <button onClick={() => setModal({ type: 'role', role })}>Configurar</button>
                )}
              </div>
            ))}
          </Panel>
        </>
      )}
      <Panel title="Instalación">
        <p>
          Zona horaria: <strong>{user.timezone}</strong>
        </p>
        <p>
          Datos compartidos en MySQL. Adjuntos almacenados en el servidor. Los respaldos deben
          incluir ambos.
        </p>
      </Panel>
      <Panel title="Versiones de tecnologías y herramientas">
        <p className="muted">
          Solo referencia. Dependencias según los archivos de bloqueo y runtimes según la
          configuración de construcción y despliegue.
        </p>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Área</th>
                <th>Tecnología o herramienta</th>
                <th>Versión</th>
              </tr>
            </thead>
            <tbody>
              {TECHNOLOGIES.map(([area, name, version]) => (
                <tr key={`${area}-${name}`}>
                  <td>{area}</td>
                  <td>{name}</td>
                  <td>{version}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      {modal?.type === 'user' && (
        <FormDialog
          title={modal.user ? 'Editar usuario' : 'Crear usuario'}
          initial={
            modal.user
              ? {
                  name: modal.user.name,
                  roles: modal.user.roles,
                  active: modal.user.active,
                  capacity: modal.user.capacity,
                  password: '',
                }
              : { username: '', name: '', password: '', roles: ['Atención'], capacity: 20 }
          }
          onClose={() => setModal(null)}
          onSave={async (value) => {
            const body = { ...value, capacity: Number(value.capacity) }
            if (modal.user && !body.password) body.password = null
            await api('/users' + (modal.user ? '/' + modal.user.id : ''), {
              method: modal.user ? 'PUT' : 'POST',
              body,
            })
            qc.invalidateQueries({ queryKey: ['users'] })
          }}
          render={(value, set) => (
            <>
              <div className="form-grid">
                {!modal.user && (
                  <Field
                    label="Usuario"
                    required
                    pattern="[a-zA-Z0-9_.-]+"
                    minLength={3}
                    value={value.username}
                    onChange={(event) => set('username', event.target.value)}
                  />
                )}
                <Field
                  label="Nombre"
                  required
                  value={value.name}
                  onChange={(event) => set('name', event.target.value)}
                />
                <Field
                  label={modal.user ? 'Nueva contraseña (opcional)' : 'Contraseña inicial'}
                  type="password"
                  autoComplete="new-password"
                  minLength={PASSWORD_MIN_LENGTH}
                  maxLength={PASSWORD_MAX_LENGTH}
                  required={!modal.user}
                  value={value.password}
                  onChange={(event) => set('password', event.target.value)}
                />
                <small>
                  Usa entre {PASSWORD_MIN_LENGTH} y {PASSWORD_MAX_LENGTH} caracteres.
                </small>
                <Field
                  label="Capacidad de solicitudes abiertas"
                  type="number"
                  min="1"
                  max="500"
                  required
                  value={value.capacity}
                  onChange={(event) => set('capacity', event.target.value)}
                />
                {modal.user && (
                  <Field
                    label="Cuenta activa"
                    type="checkbox"
                    checked={value.active}
                    onChange={(event) => set('active', event.target.checked)}
                  />
                )}
              </div>
              <fieldset>
                <legend>Roles</legend>
                {ROLES.map((role) => (
                  <label className="check-label" key={role}>
                    <input
                      type="checkbox"
                      checked={value.roles.includes(role)}
                      onChange={(event) => updateUserRoles(value, set, role, event.target.checked)}
                    />
                    {role}
                  </label>
                ))}
                {value.roles.includes('Escáner de encuadernación') && (
                  <p className="muted">
                    Esta cuenta no tendrá acceso a clientes, órdenes completas, cobros, entregas ni
                    administración.
                  </p>
                )}
              </fieldset>
            </>
          )}
        />
      )}
      {modal?.type === 'role' && (
        <FormDialog
          title={'Permisos · ' + modal.role.name}
          initial={{ permissions: modal.role.permissions }}
          onClose={() => setModal(null)}
          onSave={async (value) => {
            const unchanged =
              value.permissions.length === modal.role.permissions.length &&
              value.permissions.every((permission) => modal.role.permissions.includes(permission))
            if (unchanged) return
            await api('/roles/' + encodeURIComponent(modal.role.name), {
              method: 'PUT',
              body: value,
            })
            qc.invalidateQueries({ queryKey: ['roles'] })
            qc.invalidateQueries({ queryKey: ['users'] })
          }}
          render={(value, set) => (
            <fieldset>
              <legend>Capacidades del rol</legend>
              {roles.data.available
                .filter((permission) => permission !== '*')
                .map((permission) => (
                  <label className="check-label permission-option" key={permission}>
                    <input
                      type="checkbox"
                      checked={value.permissions.includes(permission)}
                      onChange={(event) =>
                        set(
                          'permissions',
                          event.target.checked
                            ? [...value.permissions, permission]
                            : value.permissions.filter((item) => item !== permission),
                        )
                      }
                    />
                    <span>
                      <strong>{permissionInfo(permission).label}</strong>
                      <small>{permissionInfo(permission).description}</small>
                    </span>
                  </label>
                ))}
            </fieldset>
          )}
        />
      )}
      {modal?.type === 'password' && (
        <FormDialog
          title="Cambiar contraseña"
          initial={{ current_password: '', new_password: '' }}
          onClose={() => setModal(null)}
          onSave={async (value) => {
            await api('/auth/password', { method: 'POST', body: value })
            qc.clear()
            location.assign('/')
          }}
          render={(value, set) => (
            <>
              <Field
                label="Contraseña actual"
                type="password"
                autoComplete="current-password"
                required
                value={value.current_password}
                onChange={(event) => set('current_password', event.target.value)}
              />
              <Field
                label="Nueva contraseña"
                type="password"
                autoComplete="new-password"
                minLength={PASSWORD_MIN_LENGTH}
                maxLength={PASSWORD_MAX_LENGTH}
                required
                value={value.new_password}
                onChange={(event) => set('new_password', event.target.value)}
              />
              <small>
                Usa entre {PASSWORD_MIN_LENGTH} y {PASSWORD_MAX_LENGTH} caracteres.
              </small>
            </>
          )}
        />
      )}
    </>
  )
}
