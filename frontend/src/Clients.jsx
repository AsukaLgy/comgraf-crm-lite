import {useEffect,useRef,useState} from 'react'
import {Link, useParams, useNavigate, useLocation} from 'react-router-dom'
import {useQuery,useQueryClient} from '@tanstack/react-query'
import {Plus, MoreHorizontal, Trash2} from 'lucide-react'
import {api,money,date} from './api'
import {FormDialog,Field,Loading,ErrorBox,Panel,Badge,Empty} from './components'
import CaseTable from './CaseTable'
import NewCase from './NewCase'
import { isValidRtn, validateRtn } from './rtn'
import DeleteDialog from './DeleteDialog'
import ClientIdentityFields from './ClientIdentityFields'

function ClientActionsMenu({onDelete}){
  const [open,setOpen]=useState(false), root=useRef(null), trigger=useRef(null)
  useEffect(()=>{
    if(!open)return
    function closeOnOutside(event){if(!root.current?.contains(event.target)){setOpen(false);trigger.current?.focus()}}
    function closeOnEscape(event){if(event.key==='Escape'){event.preventDefault();setOpen(false);trigger.current?.focus()}}
    document.addEventListener('pointerdown',closeOnOutside)
    document.addEventListener('keydown',closeOnEscape)
    return ()=>{document.removeEventListener('pointerdown',closeOnOutside);document.removeEventListener('keydown',closeOnEscape)}
  },[open])
  return <div className="client-actions-menu" ref={root}>
    <button type="button" ref={trigger} aria-expanded={open} aria-controls="client-actions-list" onClick={()=>setOpen(value=>!value)}><MoreHorizontal size={17}/>Más opciones</button>
    {open&&<div id="client-actions-list" className="client-actions-list"><button type="button" className="client-delete-option" onClick={()=>{setOpen(false);trigger.current?.focus();onDelete()}}><Trash2 size={17}/>Eliminar cliente</button></div>}
  </div>
}

export function ClientDialog({client,onClose}){
  const qc=useQueryClient(),initial=client?{...Object.fromEntries(['name','company','rtn','observations','provisional','version'].map(k=>[k,client[k]])),phones:client.phones.join('\n'),emails:client.emails.join('\n'),addresses:client.addresses.join('\n')}:{name:'',company:'',rtn:'',phones:'',emails:'',addresses:'',observations:'',provisional:true}
  const historicalInvalid = Boolean(client?.rtn) && !isValidRtn(client.rtn)
  return <FormDialog title={client?'Editar cliente':'Nuevo cliente'} initial={initial} onClose={onClose} onSave={async v=>{if(v.rtn!==client?.rtn)validateRtn(v.rtn);const body={...v,...Object.fromEntries(['phones','emails','addresses'].map(k=>[k,v[k].split('\n').map(s=>s.trim()).filter(Boolean)]))};await api('/clients'+(client?'/'+client.id:''),{method:client?'PUT':'POST',body});qc.invalidateQueries({queryKey:['clients']});qc.invalidateQueries({queryKey:['client']})}} render={(v,set)=><div className="form-grid"><ClientIdentityFields values={v} set={set}/>{historicalInvalid&&v.rtn===client.rtn&&<small className="rtn-warning">El RTN histórico no tiene 14 dígitos. Puedes corregirlo; los demás cambios del perfil se pueden guardar sin modificarlo.</small>}<Field label="Cliente provisional" type="checkbox" checked={v.provisional} onChange={e=>set('provisional',e.target.checked)}/>{[['phones','Teléfonos (uno por línea)'],['emails','Correos (uno por línea)'],['addresses','Direcciones (una por línea)'],['observations','Observaciones comerciales']].map(([k,l])=><Field key={k} label={l}><textarea rows={3} value={v[k]} onChange={e=>set(k,e.target.value)}/></Field>)}</div>}/>
}
export default function Clients({user}){
  const {id}=useParams(),[search,setSearch]=useState(''),[modal,setModal]=useState(null),[deleteCaseId,setDeleteCaseId]=useState(null),qc=useQueryClient(),nav=useNavigate(),location=useLocation()
  const query=useQuery({queryKey:id?['client',id]:['clients',search],queryFn:()=>api(id?'/clients/'+id:'/clients?q='+encodeURIComponent(search))})
  const c=id?query.data:null
  return <>{!id&&location.state?.notice&&<div className="notice" role="status">{location.state.notice}</div>}<div className="page-heading"><div><div className="eyebrow">RELACIONES COMERCIALES</div><h1>{c?c.name:'Clientes'}</h1><p>Un perfil compartido, toda su historia.</p></div><div className="actions">{c&&<button onClick={()=>setModal('case')}>Nueva solicitud</button>}<button className="primary" onClick={()=>setModal('client')}><Plus size={16}/>{c?'Editar cliente':'Nuevo cliente'}</button>{c&&user.roles.includes('Administrador')&&<ClientActionsMenu onDelete={()=>setModal('delete')}/>}</div></div><ErrorBox error={query.error}/>{query.isPending?<Loading/>:c?<><div className="profile-grid"><Panel title="Datos del cliente"><p>{c.company||'Persona particular'} <Badge>{c.provisional?'Provisional':'Identificado'}</Badge></p><p>RTN: {c.rtn||'No registrado'}</p>{Boolean(c.rtn)&&!isValidRtn(c.rtn)&&<p className="rtn-warning" role="status">El RTN histórico no tiene 14 dígitos. Corrígelo al editar el perfil.</p>}{[...c.phones,...c.emails,...c.addresses].map((v,i)=><p key={i}>{v}</p>)}<p className="prewrap">{c.observations}</p></Panel><Panel title="Contactos vinculados" action={<button onClick={()=>setModal('contact')}>Agregar</button>}>{c.contacts.map(v=><div className="contact" key={v.id}><strong>{v.name}</strong><p>{v.position} · {v.phone} · {v.email}</p></div>)}{!c.contacts.length&&<Empty/>}</Panel></div><Panel title="Todas las solicitudes, abiertas y cerradas"><CaseTable items={c.cases} user={user} showCreated onDelete={user.roles.includes("Administrador") ? record=>setDeleteCaseId(record.id) : undefined}/></Panel><div className="profile-grid"><Panel title="Cotizaciones">{c.cases.flatMap(c=>c.quotes.map(q=><p key={q.id}><Link to={'/cases/'+c.id}>{c.number} · v{q.version}</Link> · {q.status} · {money(q.total,q.currency)}</p>))}</Panel><Panel title="Entregas">{c.cases.filter(c=>c.production).map(c=><article key={c.id}><Link to={'/cases/'+c.id}>{c.number} · {c.subject}</Link><p>{c.delivery_status}</p>{c.deliveries.map(d=><small key={d.id}>{date(d.delivered_at)} · {d.quantity} · {d.receiver}</small>)}</article>)}</Panel></div></>:<Panel title="Directorio"><Field label="Buscar cliente por nombre, empresa, RTN, correo o teléfono" type="search" value={search} onChange={e=>setSearch(e.target.value)}/>{query.data?.length?<div className="table-wrap"><table><thead><tr><th>Cliente / empresa</th><th>RTN</th><th>Teléfonos</th><th>Correos</th><th>Perfil</th></tr></thead><tbody>{query.data.map(c=><tr key={c.id}><td><Link to={'/clients/'+c.id}>{c.name}</Link><small>{c.company}</small></td><td>{c.rtn||'—'}</td><td>{c.phones.join(', ')||'—'}</td><td>{c.emails.join(', ')||'—'}</td><td><Badge>{c.provisional?'Provisional':'Identificado'}</Badge></td></tr>)}</tbody></table></div>:<Empty>Registra el primer cliente. Basta con su nombre para crear un perfil provisional.</Empty>}</Panel>}
    {deleteCaseId&&<DeleteDialog key={deleteCaseId} kind="case" id={deleteCaseId} onClose={()=>setDeleteCaseId(null)} onDeleted={()=>{setDeleteCaseId(null);void qc.invalidateQueries({queryKey:['client',id]})}}/>}{modal==='client'&&<ClientDialog client={c} onClose={()=>setModal(null)}/>}{modal==='case'&&<NewCase user={user} creationContext="personal" clientId={Number(id)} client={c} onClose={()=>setModal(null)}/>}{modal==='delete'&&<DeleteDialog key={id} kind="client" id={id} onClose={()=>setModal(null)} onDeleted={()=>{setModal(null);nav('/clients',{replace:true,state:{notice:'Cliente eliminado'}})}}/>}{modal==='contact'&&<FormDialog title="Nuevo contacto" initial={{name:'',phone:'',email:'',position:''}} onClose={()=>setModal(null)} onSave={async v=>{await api(`/clients/${id}/contacts`,{method:'POST',body:v});qc.invalidateQueries({queryKey:['client',id]})}} render={(v,set)=><div className="form-grid">{[['name','Nombre'],['phone','Teléfono'],['email','Correo'],['position','Cargo']].map(([k,l])=><Field key={k} label={l} required={k==='name'} value={v[k]} onChange={e=>set(k,e.target.value)}/>)}</div>}/>}
  </>
}
