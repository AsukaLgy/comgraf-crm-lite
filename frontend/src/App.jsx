import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import {
  Link,
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
  Bell,
  ChevronDown,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Menu,
  X,
} from 'lucide-react'
import { api, can, setTimezone, API_CONTRACT_VERSION, PRODUCT_VERSION } from './api'
import { ErrorBox, Loading, Field } from './components'
import Inbox from './Inbox'
import Clients from './Clients'
import { Calendar, Indicators } from './Reports'
import Settings from './Settings'
import PartialReleaseApprovals from './PartialReleaseApprovals'
import Brand from './Brand'
import Dashboard from './Dashboard'

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

function initialsFor(name = '') {
  return name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || 'CG'
}

function breadcrumbs(pathname) {
  if (pathname === '/') return ['Mi día']
  if (pathname.startsWith('/cases/')) return ['Solicitudes', 'Expediente']
  if (pathname.startsWith('/clients/')) return ['Clientes', 'Perfil del cliente']
  if (pathname === '/clients') return ['Clientes']
  if (pathname === '/calendar') return ['Gestión', 'Calendario']
  if (pathname === '/indicators') return ['Gestión', 'Indicadores']
  if (pathname === '/settings') return ['Sistema', 'Configuración']
  if (pathname === '/binding-releases') return ['Producción', 'Liberaciones parciales']
  if (pathname === '/search') return ['Búsqueda']
  const view = pathname.match(/^\/inbox\/([^/]+)/)?.[1]
  const labels = {
    pool: 'Bandeja general',
    action: 'Requieren acción',
    mine: 'Mis solicitudes',
    'mine-action': 'Requieren mi acción',
    production: 'Producción',
    ready: 'Entregas y cobros',
    late: 'Órdenes atrasadas',
    'delivered-period': 'Órdenes entregadas del período',
    'delivered-balances': 'Entregadas con saldo',
    'delivered-overdue': 'Entregadas con saldo vencido',
    balances: 'Saldos por cobrar',
    overdue: 'Cobros vencidos',
    refunds: 'Devoluciones pendientes',
    'cancellation-review': 'Anulaciones por resolver',
    finalized: 'Completados',
    history: 'Historial',
  }
  return view ? ['Operaciones', labels[view] || 'Solicitudes'] : ['Mi día']
}

export default function App() {
  const qc = useQueryClient(),
    nav = useNavigate(),
    currentLocation = useLocation(),
    searchInput = useRef(null),
    profileMenu = useRef(null),
    [search, setSearch] = useState(''),
    [logoutError, setLogoutError] = useState(null),
    [sidebarCollapsed, setSidebarCollapsed] = useState(
      () => window.localStorage.getItem('comgraf.sidebar-collapsed') === 'true',
    ),
    [mobileNavOpen, setMobileNavOpen] = useState(false),
    [profileOpen, setProfileOpen] = useState(false)
  const me = useQuery({ queryKey: ['me'], queryFn: () => api('/auth/me'), retry: false })
  const serverVersion = useQuery({
    queryKey: ['server-version'],
    queryFn: () => api('/version'),
    staleTime: 60000,
  })
  const counts = useQuery({
    queryKey: ['counts', me.data?.id],
    queryFn: () => api('/counts'),
    enabled: Boolean(me.data && !me.data.roles?.includes('Escáner de encuadernación')),
    refetchInterval: 30000,
  })
  useEffect(() => {
    if (me.data?.timezone) setTimezone(me.data.timezone)
  }, [me.data?.timezone])
  useEffect(() => {
    window.localStorage.setItem('comgraf.sidebar-collapsed', String(sidebarCollapsed))
  }, [sidebarCollapsed])
  useEffect(() => {
    function onShortcut(event) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        searchInput.current?.focus()
      }
      if (event.key === 'Escape') {
        setProfileOpen(false)
        setMobileNavOpen(false)
      }
    }
    function onOutsideClick(event) {
      if (!profileMenu.current?.contains(event.target)) setProfileOpen(false)
    }
    document.addEventListener('keydown', onShortcut)
    document.addEventListener('pointerdown', onOutsideClick)
    return () => {
      document.removeEventListener('keydown', onShortcut)
      document.removeEventListener('pointerdown', onOutsideClick)
    }
  }, [])
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
  const groups = [
    {
      label: 'TRABAJO',
      links: [
        { path: '/', label: 'Mi día', Icon: LayoutDashboard },
        { path: '/inbox/action', label: 'Requieren acción', Icon: Bell, badge: 'action', pulse: true },
        { path: '/inbox/pool', label: 'Bandeja general', Icon: InboxIcon, badge: 'pool' },
        { path: '/inbox/mine', label: 'Mis solicitudes', Icon: FolderOpen, badge: 'mine' },
        { path: '/inbox/production', label: 'Producción', Icon: Printer, badge: 'production_orders' },
        { path: '/inbox/ready', label: 'Entregas y cobros', Icon: Truck, badge: 'ready_orders' },
      ],
    },
    {
      label: 'GESTIÓN',
      links: [
        ...(can(user, 'clients') ? [{ path: '/clients', label: 'Clientes', Icon: Users }] : []),
        { path: '/calendar', label: 'Calendario', Icon: CalendarDays },
        { path: '/inbox/finalized', label: 'Completados', Icon: CheckCheck, badge: 'finalized' },
        { path: '/inbox/history', label: 'Historial', Icon: History },
        ...(can(user, 'partial_release_approve')
          ? [{ path: '/binding-releases', label: 'Liberaciones parciales', Icon: ClipboardCheck }]
          : []),
        ...(can(user, 'reports')
          ? [{ path: '/indicators', label: 'Indicadores', Icon: ChartNoAxesCombined }]
          : []),
      ],
    },
    { label: 'SISTEMA', links: [{ path: '/settings', label: 'Configuración', Icon: SettingsIcon }] },
  ]
  const links = groups.flatMap((group) => group.links)
  const detailContext = /^\/cases\/\d+/.test(currentLocation.pathname)
    ? new URLSearchParams(currentLocation.search).get('from')
    : null
  const activePath = links.some(({ path }) => path === detailContext)
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
      window.location.assign('/')
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
  const crumbs = breadcrumbs(currentLocation.pathname)
  const initials = initialsFor(user.name)
  const closeMobileNav = () => setMobileNavOpen(false)
  return (
    <div className={`app-shell${sidebarCollapsed ? ' is-collapsed' : ''}${mobileNavOpen ? ' mobile-nav-open' : ''}`}>
      {mobileNavOpen && (
        <button className="mobile-nav-backdrop" aria-label="Cerrar navegación" onClick={closeMobileNav} />
      )}
      <aside className="sidebar" aria-label="Navegación principal">
        <div className="sidebar-brand-row">
          <LinkBrand onNavigate={closeMobileNav} />
          <button className="mobile-sidebar-close" aria-label="Cerrar menú" onClick={closeMobileNav}>
            <X size={18} />
          </button>
        </div>
        <div className="sidebar-nav-scroll">
          <nav aria-label="Navegación principal">
            {groups.map((group) => (
              <section className="nav-group" key={group.label}>
                <p className="nav-label">{group.label}</p>
                {group.links.map(({ path, label, Icon, badge, pulse }) => {
                  const amount = badge ? counts.data?.[badge] || 0 : 0
                  return (
                    <NavLink
                      key={path}
                      to={path}
                      end={path === '/' || path === '/clients'}
                      title={sidebarCollapsed ? label : undefined}
                      className={({ isActive }) =>
                        activePath ? (path === activePath ? 'active' : '') : isActive ? 'active' : ''
                      }
                      aria-current={activePath === path ? 'page' : undefined}
                      onClick={closeMobileNav}
                    >
                      <Icon size={18} />
                      <span className="nav-link-label">{label}</span>
                      {pulse && amount > 0 && <i className="status-pulse-dot" aria-label="Hay solicitudes que requieren atención" />}
                      {badge && amount > 0 && <span className="nav-badge">{amount > 99 ? '99+' : amount}</span>}
                    </NavLink>
                  )
                })}
              </section>
            ))}
          </nav>
        </div>
        <div className="sidebar-footer">
          <button
            className="sidebar-collapse-button"
            onClick={() => setSidebarCollapsed((value) => !value)}
            aria-label={sidebarCollapsed ? 'Expandir navegación' : 'Contraer navegación'}
            title={sidebarCollapsed ? 'Expandir navegación' : 'Contraer navegación'}
          >
            {sidebarCollapsed ? <ChevronsRight size={17} /> : <><ChevronsLeft size={17} /><span>Contraer menú</span></>}
          </button>
          <small className="sidebar-version">Comgraf · v{PRODUCT_VERSION}</small>
        </div>
      </aside>
      <div className="workspace-main">
        <header className="topbar">
          <button className="mobile-menu-button" aria-label="Abrir menú" onClick={() => setMobileNavOpen(true)}>
            <Menu size={19} />
          </button>
          <form
            className="global-search"
            onSubmit={(e) => {
              e.preventDefault()
              if (search.trim()) nav('/search?q=' + encodeURIComponent(search.trim()))
            }}
          >
            <Search size={18} />
            <input
              ref={searchInput}
              aria-label="Búsqueda global"
              placeholder="Buscar cliente, RTN, teléfono, correo o solicitud…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <button type="submit" aria-label="Buscar">
              Buscar
            </button>
            <kbd>⌘K</kbd>
          </form>
          <div className="topbar-actions">
            <NavLink className="notification-button" to="/inbox/action" aria-label={`${counts.data?.action || 0} solicitudes requieren acción`} title="Solicitudes que requieren acción">
              <Bell size={18} />
              {(counts.data?.action || 0) > 0 && <i />}
            </NavLink>
            <div className="profile-menu" ref={profileMenu}>
              <button className="profile-menu-trigger" aria-expanded={profileOpen} onClick={() => setProfileOpen((value) => !value)}>
                <span className="profile-initials">{initials}</span>
                <span className="profile-menu-copy"><strong>{user.name}</strong><small>{user.roles.join(' · ')}</small></span>
                <ChevronDown size={15} />
              </button>
              {profileOpen && (
                <div className="profile-menu-popover">
                  <span className="profile-popover-name">{user.name}</span>
                  <small>{user.roles.join(' · ')}</small>
                  <button onClick={logout}><LogOut size={15} /> Cerrar sesión</button>
                </div>
              )}
            </div>
          </div>
        </header>
        <nav className="breadcrumb-bar" aria-label="Ruta de navegación">
          <Link to="/">Inicio</Link>
          {crumbs.map((crumb, index) => (
            <span className="breadcrumb-item" key={`${crumb}-${index}`}>
              <ChevronRight size={14} aria-hidden="true" />
              <span aria-current={index === crumbs.length - 1 ? 'page' : undefined}>{crumb}</span>
            </span>
          ))}
          <span className="breadcrumb-version">Web {PRODUCT_VERSION} · API {API_CONTRACT_VERSION} · servidor {serverVersion.data?.product_version || 'sin identificar'}</span>
        </nav>
        <div className="global-notices">
          <ErrorBox error={logoutError} />
          {serverVersion.error && (
            <ErrorBox error={serverVersion.error.status === 404 ? { ...serverVersion.error, code: 'CLIENT_CONTRACT_MISMATCH' } : serverVersion.error} />
          )}
          {serverVersion.data && String(serverVersion.data.contract_version) !== API_CONTRACT_VERSION && (
            <ErrorBox error={{ code: 'CLIENT_CONTRACT_MISMATCH', message: 'El contrato HTTP de interfaz y servidor no coincide.' }} />
          )}
        </div>
        <main className="main-content">
          <Routes>
            <Route path="/" element={<Dashboard user={user} />} />
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
function LinkBrand({ onNavigate }) {
  return (
    <NavLink className="brand" to="/" onClick={onNavigate}>
      <Brand />
    </NavLink>
  )
}
