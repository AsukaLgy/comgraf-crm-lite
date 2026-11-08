/* global URL, console, setTimeout, document */
import { chromium } from '@playwright/test'
import { mkdirSync } from 'node:fs'

const out = '../.runtime/client-delete-proof'
mkdirSync(out, {recursive: true})
const browser = await chromium.launch({headless: true})
const caseRow = {id:3,number:'CG-000003',subject:'Pedido ficticio',version:1,client:{name:'Cliente de prueba'},quotes:[],production:null,productions:[],deliveries:[],status:'Abierto',priority:'Normal'}
const profile = {id:1,name:'Cliente de prueba',company:'Imprenta ficticia',rtn:'00123456789012',phones:[],emails:[],addresses:[],contacts:[{id:8,name:'Contacto de prueba',position:'',phone:'',email:''}],cases:[caseRow],provisional:false,observations:''}
const preview = {client:{id:1,name:profile.name,rtn:profile.rtn,version:1},contacts:1,cases:[{id:3,number:caseRow.number,subject:caseRow.subject,version:1}],counts:{productions:1,items:2,quotes:1,tasks:1,attachments:1,events:2,deliveries:1,ledger:1}}

for (const [name, viewport] of [['desktop',{width:1366,height:768}],['mobile',{width:390,height:844}]]) {
  const page = await browser.newPage({viewport,hasTouch:name==='mobile',isMobile:name==='mobile'})
  let requests = 0, fail = true, expanded = false
  page.on('pageerror', error => {throw error})
  await page.route('**/clients/1', route => route.fulfill({path:'dist/index.html',contentType:'text/html'}))
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname
    let body = []
    if (path === '/api/auth/me') body = {id:1,name:'Admin de prueba',roles:['Administrador'],permissions:['*'],timezone:'America/Tegucigalpa'}
    else if (path === '/api/version') body = {contract_version:'5',build:'test'}
    else if (path === '/api/clients/1') body = profile
    else if (path === '/api/clients/1/delete-preview') body = expanded ? {...preview,contacts:2} : preview
    else if (path === '/api/clients/1/delete-definitively') {
      requests++
      await new Promise(resolve => setTimeout(resolve, 150))
      if (fail) return route.fulfill({status:500,contentType:'application/json',body:JSON.stringify({detail:'Error de prueba; inténtalo de nuevo'})})
      if (!expanded) {expanded = true; return route.fulfill({status:409,contentType:'application/json',body:JSON.stringify({detail:'El alcance cambió. Revisa la confirmación actualizada.'})})}
      return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({deleted:true})})
    } else if (path === '/api/clients') body = []
    route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)})
  })
  await page.goto('http://127.0.0.1:4173/clients/1')
  const more = page.getByRole('button',{name:'Más opciones'})
  await more.waitFor()
  if (name === 'mobile') await more.tap(); else await more.click()
  await page.screenshot({path:`${out}/menu-${name}.png`,fullPage:true})
  await page.keyboard.press('Escape')
  if (await page.getByRole('button',{name:'Eliminar cliente'}).count()) throw new Error('Escape no cerró menú')
  if (!(await more.evaluate(el => el === document.activeElement))) throw new Error('No se devolvió foco al botón')
  await more.click()
  await page.locator('.main-content').click({position:{x:8,y:350}})
  if (await page.getByRole('button',{name:'Eliminar cliente'}).count()) throw new Error('Clic exterior no cerró menú')
  await more.click()
  await page.getByRole('button',{name:'Eliminar cliente'}).click()
  const dialog = page.getByRole('dialog',{name:'Eliminar cliente'})
  await dialog.waitFor()
  const input = dialog.getByRole('textbox',{name:'Para confirmar la eliminación definitiva, escribe comgraf'})
  await input.waitFor()
  if (!(await input.evaluate(el => el === document.activeElement))) throw new Error('No se enfocó la confirmación')
  if (await input.inputValue()) throw new Error('Confirmación precargada')
  const submit = dialog.getByRole('button',{name:'Eliminar definitivamente'})
  for (const value of ['', 'com', 'comgraf adicional', 'acomgraf']) {
    await input.fill(value)
    if (await submit.isEnabled()) throw new Error(`Aceptó confirmación inválida: ${value}`)
  }
  for (const value of ['comgraf','COMGRAF','  ComGraf  ']) {
    await input.fill(value)
    if (await submit.isEnabled()) throw new Error('Ignoró el alcance no confirmado')
  }
  const scope = dialog.getByRole('checkbox',{name:'Eliminar cliente y sus solicitudes'})
  await scope.check()
  for (const value of ['', 'com', 'comgraf adicional', 'acomgraf']) {
    await input.fill(value)
    if (await submit.isEnabled()) throw new Error(`Aceptó palabra inválida con alcance confirmado: ${value}`)
  }
  for (const value of ['comgraf','COMGRAF','  ComGraf  ']) {
    await input.fill(value)
    if (!(await submit.isEnabled())) throw new Error(`Rechazó palabra válida: ${value}`)
  }
  await scope.uncheck()
  await page.screenshot({path:`${out}/dialogo-${name}.png`,fullPage:true})
  await dialog.getByRole('button',{name:'Cancelar'}).click()
  if (requests) throw new Error('Cancelar ejecutó eliminación')
  await more.click(); await page.getByRole('button',{name:'Eliminar cliente'}).click()
  await input.waitFor()
  if (await input.inputValue()) throw new Error('Reabrir conservó la palabra')
  await dialog.getByRole('checkbox',{name:'Eliminar cliente y sus solicitudes'}).check()
  await input.fill(' COMGRAF ')
  await submit.evaluate(el => {el.click(); el.click()})
  if (await dialog.count() !== 1) throw new Error('Error cerró diálogo')
  await dialog.getByText('Error de prueba; inténtalo de nuevo').waitFor()
  if (requests !== 1) throw new Error('Operación duplicada')
  fail = false
  await submit.click()
  await dialog.getByText('El alcance cambió. Revisa la confirmación actualizada.').waitFor()
  if (await input.inputValue()) throw new Error('Cambio de alcance no limpió confirmación')
  await dialog.getByText('2 contactos exclusivos').waitFor()
  await dialog.getByRole('checkbox',{name:'Eliminar cliente y sus solicitudes'}).check()
  await input.fill('comgraf')
  await submit.click()
  await page.getByRole('status').filter({hasText:'Cliente eliminado'}).waitFor()
  if (requests !== 3) throw new Error(`Solicitudes inesperadas: ${requests}`)
  console.log(name, 'menú, diálogo, cancelación, error, alcance y éxito verificados')
  await page.close()
}
await browser.close()
