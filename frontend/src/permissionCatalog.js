// Etiquetas de interfaz. Las claves son el contrato de permisos del servidor.
export const PERMISSION_CATALOG = Object.freeze({
  '*': {
    label: 'Acceso completo',
    description:
      'Acceso administrativo y operativo general. La terminal QR exige el rol exclusivo de escáner.',
  },
  read_all: {
    label: 'Consultar todas las solicitudes',
    description:
      'Permite ver expedientes de cualquier responsable; no concede permisos de edición.',
  },
  attention: {
    label: 'Gestionar atención de solicitudes',
    description:
      'Permite crear, tomar y atender solicitudes, cotizaciones y seguimientos. La atención de solicitudes ajenas requiere además Asignar.',
  },
  assign: {
    label: 'Asignar solicitudes',
    description:
      'Permite cambiar el responsable principal y, junto con Atención, gestionar solicitudes de otros responsables.',
  },
  reopen: {
    label: 'Permiso reservado de reapertura',
    description: 'Se conserva por compatibilidad; ninguna operación actual del CRM lo consulta.',
  },
  production: {
    label: 'Gestionar producción y entregas',
    description:
      'Permite gestionar etapas, bloqueos, programación, confirmación manual del trabajo terminado, anulaciones y entregas; no autoriza cobros.',
  },
  finance: {
    label: 'Gestionar cobros y devoluciones',
    description:
      'Permite consultar datos financieros y registrar pagos y devoluciones; no autoriza ajustes por sí solo.',
  },
  adjust: {
    label: 'Registrar ajustes financieros',
    description:
      'Permite ajustes y reversión de pagos. Resolver económicamente una anulación también exige Cobros y devoluciones.',
  },
  clients: {
    label: 'Gestionar clientes',
    description: 'Permite consultar, crear y editar fichas de clientes y contactos.',
  },
  reports: {
    label: 'Consultar indicadores',
    description: 'Permite ver los indicadores e informes del CRM.',
  },
  partial_release_approve: {
    label: 'Autorizar liberaciones parciales',
    description: 'Permite revisar y decidir solicitudes de excepción; no confirma trabajos por QR.',
  },
  binding_scan: {
    label: 'Confirmar trabajos terminados por QR',
    description:
      'Solo con el rol exclusivo de escáner: consulta y confirma OP y solicita liberación parcial. No autoriza entregas ni cobros.',
  },
})

export const permissionInfo = (permission) =>
  PERMISSION_CATALOG[permission] || {
    label: 'Permiso sin etiqueta',
    description: 'Identificador de permiso no reconocido por esta versión de la interfaz.',
  }
