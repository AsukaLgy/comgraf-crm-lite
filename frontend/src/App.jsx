import { lazy, Suspense, useEffect, useState } from 'react'
import {
  NavLink,
  Routes,
  Route,
  useNavigate,
  useParams,
  useLocation,
  Navigate,
} from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  LayoutDashboard,
  Inbox as InboxIcon,
  FolderOpen,
  Users,
  Printer,
  Truck,
  CalendarDays,
  History,
  CheckCheck,
  Settings as SettingsIcon,
  ChartNoAxesCombined,
  Search,
  LogOut,
  ClipboardCheck,
} from 'lucide-react'
import { api, can, setTimezone, API_CONTRACT_VERSION, PRODUCT_VERSION } from './api'
import { ErrorBox, Loading, Field } from './components'
import Inbox from './Inbox'
import Clients from './Clients'
import { Calendar, Indicators } from './Reports'
import Settings from './Settings'
import PartialReleaseApprovals from './PartialReleaseApprovals'
import Brand from './Brand'

const BindingScanner = lazy(() => import('./BindingScanner'))
const CasePage = lazy(() => import('./CasePage'))
const PrintDocument = lazy(() => import('./PrintDocument'))

function Login({ sessionMessage = '' }) {
  const qc = useQueryClient(),
    [username, setUsername] = useState(''),
    [password, setPassword] = useState(''),
    [error, setError] = useState(() => (sessionMessage ? new Error(sessionMessage) : null)),
    [busy, setBusy] = useState(false)
  async function submit(e) {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await api('/auth/login', { method: 'POST', body: { username, password } })
      qc.invalidateQueries()
    } catch (err) {
      setError(err)
    } finally {
      setBusy(false)
    }
  }
  return (
    <main className="login-page">
      <div className="login-art">
        <div className="brand">
          <Brand size="login" />
        </div>
        <div>
          <p className="eyebrow">DEL PRIMER CONTACTO A LA ENTREGA</p>
          <h1>
            Todo tu taller.
            <br />
            Una misma solicitud.
          </h1>
          <p>
            Atención, producción y seguimiento conectados para que el equipo trabaje con claridad.
          </p>
        </div>
        <small>Consola de operaciones · Red local</small>
      </div>
      <div className="login-form">
        <form onSubmit={submit}>
          <div className="eyebrow">BIENVENIDO A COMGRAF</div>
          <h2>Entrar al espacio de trabajo</h2>
          <p>Usa tu cuenta del equipo.</p>
          <Field
            label="Usuario"
            required
            autoComplete="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
          <Field
            label="Contraseña"
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <ErrorBox error={error} />
          <button className="primary" disabled={busy}>
            {busy ? 'Ingresando…' : 'Iniciar sesión'}
          </button>
          <small>
            Primera instalación: el administrador se crea desde la consola del servidor siguiendo el
            README.
          </small>
        </form>
      </div>
    </main>
  )
}
function InboxRoute({ user }) {
  const { view } = useParams()
  return <Inbox key={view} view={view} user={user} />
}
function Guard({ user, permission, children }) {
  return can(user, permission) ? (
    children
  ) : (
    <div className="error">Tu rol no tiene permiso para acceder a este módulo.</div>
  )
}
export default function App() {
  const qc = useQueryClient(),
    nav = useNavigate(),
    currentLocation = useLocation(),
    [search, setSearch] = useState(''),
    [logoutError, setLogoutError] = useState(null)
  const me = useQuery({ queryKey: ['me'], queryFn: () => api('/auth/me'), retry: false })
  const serverVersion = useQuery({
    queryKey: ['server-version'],
    queryFn: () => api('/version'),
    staleTime: 60000,
  })
  useEffect(() => {
    if (me.data?.timezone) setTimezone(me.data.timezone)
  }, [me.data?.timezone])
  if (me.isPending) return <Loading />
  if (me.error) {
    if (me.error.status === 401)
      return (
        <Login
          sessionMessage={me.error.message.includes('servicio se reinició') ? me.error.message : ''}
        />
      )
    return (
      <>
        <ErrorBox error={me.error} />
        <button onClick={() => me.refetch()}>Reintentar conexión</button>
      </>
    )
  }
  const user = me.data
  const links = [
    ['/', 'Mi día', LayoutDashboard],
    ['/inbox/pool', 'Bandeja general', InboxIcon],
    ['/inbox/mine', 'Mis solicitudes', FolderOpen],
    ...(can(user, 'clients') ? [['/clients', 'Clientes', Users]] : []),
    ['/inbox/production', 'Producción', Printer],
    ['/inbox/ready', 'Entregas y cobros', Truck],
    ['/calendar', 'Calendario', CalendarDays],
    ['/inbox/finalized', 'Completados', CheckCheck],
    ['/inbox/history', 'Historial', History],
    ...(can(user, 'partial_release_approve')
      ? [['/binding-releases', 'Liberaciones parciales', ClipboardCheck]]
      : []),
    ...(can(user, 'reports') ? [['/indicators', 'Indicadores', ChartNoAxesCombined]] : []),
    ['/settings', 'Configuración', SettingsIcon],
  ]
  const detailContext = /^\/cases\/\d+/.test(currentLocation.pathname)
    ? new URLSearchParams(currentLocation.search).get('from')
    : null
  const activePath = links.some(([path]) => path === detailContext)
    ? detailContext
    : detailContext
      ? null
      : /^\/cases\/\d+/.test(currentLocation.pathname)
        ? '/inbox/mine'
        : null
  async function logout() {
    try {
      await api('/auth/logout', { method: 'POST' })
      qc.clear()
      location.assign('/')
    } catch (e) {
      setLogoutError(e)
    }
  }
  if (user.roles.length === 1 && user.roles[0] === 'Escáner de encuadernación') {
    return (
      <Suspense fallback={<Loading />}>
        <BindingScanner user={user} onLogout={logout} />
      </Suspense>
    )
  }
  if (/^\/cases\/\d+\/print$/.test(window.location.pathname))
    return (
      <Suspense fallback={<Loading />}>
        <PrintDocument />
      </Suspense>
    )
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <LinkBrand />
        <p className="nav-label">OPERACIONES</p>
        <nav aria-label="Navegación principal">
          {links.map(([path, label, Icon]) => (
            <NavLink
              key={path}
              to={path}
              end={path === '/' || path === '/clients'}
              className={({ isActive }) =>
                activePath ? (path === activePath ? 'active' : '') : isActive ? 'active' : ''
              }
              aria-current={activePath === path ? 'page' : undefined}
            >
              <Icon size={18} />
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <span className="online-dot" /> Entorno local <small>Comunicación Gráfica</small>
          <small className="sidebar-version">v{PRODUCT_VERSION}</small>
        </div>
      </aside>
      <div className="workspace-main">
        <header className="topbar">
          <form
            className="global-search"
            onSubmit={(e) => {
              e.preventDefault()
              if (search.trim()) nav('/search?q=' + encodeURIComponent(search.trim()))
            }}
          >
            <Search size={18} />
            <input
              aria-label="Búsqueda global"
              placeholder="Buscar cliente, RTN, teléfono, correo o solicitud…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <button type="submit" aria-label="Buscar">
              Buscar
            </button>
          </form>
          <div className="account">
            <div className="avatar">{user.name.slice(0, 2).toUpperCase()}</div>
            <div>
              <strong>{user.name}</strong>
              <small>{user.roles.join(' · ')}</small>
            </div>
            <button className="icon-button" aria-label="Cerrar sesión" onClick={logout}>
              <LogOut size={18} />
            </button>
          </div>
        </header>
        <ErrorBox error={logoutError} />
        {serverVersion.error && (
          <ErrorBox
            error={
              serverVersion.error.status === 404
                ? { ...serverVersion.error, code: 'CLIENT_CONTRACT_MISMATCH' }
                : serverVersion.error
            }
          />
        )}
        {serverVersion.data &&
          String(serverVersion.data.contract_version) !== API_CONTRACT_VERSION && (
            <ErrorBox
              error={{
                code: 'CLIENT_CONTRACT_MISMATCH',
                message: 'El contrato HTTP de interfaz y servidor no coincide.',
              }}
            />
          )}
        <p className="muted version-stamp" aria-label="Versiones del sistema">
          Web {PRODUCT_VERSION} · API {API_CONTRACT_VERSION} · servidor{' '}
          {serverVersion.data?.product_version || 'sin identificar'}
        </p>
        <main className="main-content">
          <Routes>
            <Route path="/" element={<Inbox key="home" home user={user} />} />
            <Route path="/inbox/:view" element={<InboxRoute user={user} />} />
            <Route path="/search" element={<Inbox key="search" search user={user} />} />
            <Route
              path="/cases/:id"
              element={
                <Suspense fallback={<Loading />}>
                  <CasePage user={user} />
                </Suspense>
              }
            />
            <Route
              path="/cases/:id/print"
              element={
                <Suspense fallback={<Loading />}>
                  <CasePage user={user} print />
                </Suspense>
              }
            />
            <Route
              path="/clients"
              element={
                <Guard user={user} permission="clients">
                  <Clients user={user} />
                </Guard>
              }
            />
            <Route
              path="/clients/:id"
              element={
                <Guard user={user} permission="clients">
                  <Clients user={user} />
                </Guard>
              }
            />
            <Route path="/calendar" element={<Calendar />} />
            <Route
              path="/binding-releases"
              element={
                <Guard user={user} permission="partial_release_approve">
                  <PartialReleaseApprovals />
                </Guard>
              }
            />
            <Route
              path="/indicators"
              element={
                <Guard user={user} permission="reports">
                  <Indicators />
                </Guard>
              }
            />
            <Route path="/settings" element={<Settings user={user} />} />
            <Route path="*" element={<Navigate to="/" />} />
          </Routes>
        </main>
      </div>
    </div>
  )
}
function LinkBrand() {
  return (
    <NavLink className="brand" to="/">
      <Brand />
    </NavLink>
  )
}
