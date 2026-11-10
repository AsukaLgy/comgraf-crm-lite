const CASE_READ_MODELS = new Set([
  'cases', 'orders', 'calendar', 'calendar-unscheduled-collections',
  'indicators', 'partial-release-requests',
])
const CASE_COUNTS = new Set(['counts', 'personal-counts'])

export function invalidateCaseViews(queryClient, { caseId, clientId, counts = false }) {
  const currentCase = String(caseId)
  const currentClient = String(clientId)
  return queryClient.invalidateQueries({ predicate: ({ queryKey }) => {
    const [kind, id] = queryKey
    if (kind === 'case' || kind === 'print-case') return String(id) === currentCase
    if (kind === 'client') return String(id) === currentClient
    if (kind === 'delete-preview') return (id === 'case' && String(queryKey[2]) === currentCase) ||
      (id === 'client' && String(queryKey[2]) === currentClient)
    return CASE_READ_MODELS.has(kind) || (counts && CASE_COUNTS.has(kind))
  } })
}
