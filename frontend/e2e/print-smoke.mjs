/* global structuredClone, URL, window, document, console */
import { chromium } from '@playwright/test'
import { mkdirSync } from 'node:fs'

const out = '../.runtime/print-proof'
mkdirSync(out, {recursive:true})
const browser = await chromium.launch({headless:true})
const record = {
  id: 1, number: 'CG-000001', subject: 'Talonarios de prueba',
  client: {name:'Cliente Ficticio', company:'Empresa de Prueba', rtn:'00123456789012', phones:['9999-0000'], emails:['demo@example.test']},
  items: [],
  production: {id: 7, order_number:'OP-00007', scan_id:'19e39a12-26bc-4315-9eef-06e1c7af1946', created_at:'2026-11-08T12:00:00',
    client_snapshot:{company:'Empresa de Prueba',person:'Cliente Ficticio',rtn:'00123456789012',phone:'9999-0000',email:'demo@example.test'},
    specs_snapshot:{items:[{id: 1, product:'Talonarios de factura CAI', quantity:10, specs:{cai_format:'Media carta',paper_type:'Químico',cai_binding:'Engrapado',additional_copies:2,detail:'Original y dos copias autocopiativas.'}}]}, instructions:'Revisar numeración antes de producir.'}
}
for (const [label, viewport] of [['desktop',{width:1366,height:768}],['mobile',{width:390,height:844}],['long',{width:1366,height:768}]]) {
  const fixture = structuredClone(record)
  if (label === 'long') fixture.production.instructions = `${'Instrucción detallada de prueba. '.repeat(100)} FIN DE INSTRUCCIONES`
  const page = await browser.newPage({viewport})
  await page.route('**/cases/1/print?*', route => route.fulfill({path:'dist/index.html',contentType:'text/html'}))
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname
    const body = path === '/api/auth/me' ? {id:1,name:'Admin de prueba',roles:['Administrador'],permissions:['*'],timezone:'America/Tegucigalpa'} :
      path === '/api/version' ? {contract_version:'5',build:'test'} : fixture
    route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)})
  })
  await page.goto('http://127.0.0.1:4173/cases/1/print?production_id=7')
  await page.getByText('OP-00007').first().waitFor()
  await page.locator('.order-qr img').waitFor()
  await page.addScriptTag({path:'node_modules/@zxing/browser/umd/zxing-browser.min.js'})
  const decoded = await page.evaluate(async () => {
    const reader = new window.ZXingBrowser.BrowserQRCodeReader()
    const result = await reader.decodeFromImageElement(document.querySelector('.order-qr img'))
    return result.getText()
  })
  if (decoded !== `CGOP1:${record.production.scan_id}`) throw new Error(`QR incorrecto: ${decoded}`)
  await page.screenshot({path:`${out}/${label}.png`,fullPage:true})
  if (label === 'desktop' || label === 'long') await page.pdf({path:`${out}/${label === 'desktop' ? 'orden-ejemplo' : 'orden-larga'}.pdf`,printBackground:true,preferCSSPageSize:true})
  const text = await page.locator('.print-sheet').innerText()
  if (label === 'long' && !text.includes('FIN DE INSTRUCCIONES')) throw new Error('Se truncaron instrucciones largas')
  console.log(label, text.length, decoded)
  await page.close()
}
await browser.close()
