import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { ArrowDownToLine, ArrowUpFromLine, LockKeyhole, Plus, RefreshCw, CreditCard, Gift } from 'lucide-react'
import { newKey, encryptRecord, decryptRecord, exportBackup, importBackup, RecordSchema } from '@netpositive/vault'
import type { Envelope, VaultRecord } from '@netpositive/vault'

const slot='netpositive:vault:encrypted:v1'
type Item={envelope:Envelope,record:VaultRecord}
type Props={address:string,signMessage:(message:string)=>Promise<string>}
export function Vault({address,signMessage}:Props) {
  const [key,setKey]=useState<Uint8Array<ArrayBuffer>|null>(null)
  const [pass,setPass]=useState(''),[items,setItems]=useState<Item[]>([])
  const [hasVault,setHasVault]=useState(()=>{try{return !!localStorage.getItem(slot)}catch{return false}})
  const [kind,setKind]=useState<'gift-card'|'payment-card'>('gift-card')
  const [adding,setAdding]=useState(false),[busy,setBusy]=useState(false),[status,setStatus]=useState('')
  const importInput=useRef<HTMLInputElement>(null),epoch=useRef(0)
  const lock=()=>{epoch.current++;key?.fill(0);setKey(null);setPass('');setItems([]);setAdding(false);setStatus('');setBusy(false)}
  useEffect(()=>{
    if(!key)return
    let timer:ReturnType<typeof setTimeout>
    const reset=()=>{clearTimeout(timer);timer=setTimeout(lock,5*60*1000)}
    const hidden=()=>{if(document.hidden)lock()}
    reset();window.addEventListener('pointerdown',reset);window.addEventListener('keydown',reset);document.addEventListener('visibilitychange',hidden)
    return()=>{clearTimeout(timer);window.removeEventListener('pointerdown',reset);window.removeEventListener('keydown',reset);document.removeEventListener('visibilitychange',hidden)}
  },[key])
  useEffect(()=>{return()=>{epoch.current++;key?.fill(0)}},[key])
  const priorAddress=useRef(address)
  useEffect(()=>{if(priorAddress.current!==address){lock();priorAddress.current=address}},[address])
  async function persist(master:Uint8Array<ArrayBuffer>, next:Item[], password:string) {
    const backup=await exportBackup(master,next.map(i=>i.envelope),password)
    localStorage.setItem(slot,JSON.stringify(backup))
    return backup
  }
  async function unlock(e:FormEvent) {
    e.preventDefault();const attempt=++epoch.current;setBusy(true);setStatus('')
    try {
      const saved=localStorage.getItem(slot)
      const restored=saved?await importBackup(JSON.parse(saved),pass):{key:newKey(),envelopes:[]}
      const next=await Promise.all(restored.envelopes.map(async envelope=>({envelope,record:await decryptRecord(restored.key,envelope)})))
      if(!saved)await persist(restored.key,next,pass)
      if(attempt!==epoch.current){restored.key.fill(0);return}
      setKey(restored.key);setItems(next);setHasVault(true)
    }catch{if(attempt===epoch.current)setStatus('Couldn’t open the vault. Check your recovery passphrase and browser storage.')}
    finally{if(attempt===epoch.current)setBusy(false)}
  }
  async function save(e:FormEvent<HTMLFormElement>) {
    e.preventDefault();if(!key)return
    const form=e.currentTarget,values=new FormData(form),attempt=epoch.current;setBusy(true);setStatus('')
    try {
      const record=RecordSchema.parse(kind==='gift-card'?{kind,brand:values.get('brand'),code:values.get('code'),valueMinor:Math.round(Number(values.get('value'))*100),currency:values.get('currency')}
        :{kind,issuer:values.get('issuer'),variant:values.get('variant'),network:values.get('network'),last4:values.get('last4')})
      const envelope=await encryptRecord(key,record),next=[...items,{envelope,record}]
      const backup=await exportBackup(key,next.map(i=>i.envelope),pass)
      if(attempt!==epoch.current)return
      localStorage.setItem(slot,JSON.stringify(backup));setItems(next);setAdding(false);form.reset();setStatus('Saved privately on this device.')
    }catch{if(attempt===epoch.current)setStatus('Couldn’t save. Check the fields and available browser storage.')}
    finally{if(attempt===epoch.current)setBusy(false)}
  }
  async function download() {
    if(!key)return;setBusy(true);setStatus('');const attempt=epoch.current
    try {
      const backup=await exportBackup(key,items.map(i=>i.envelope),pass)
      if(attempt!==epoch.current)return
      const url=URL.createObjectURL(new Blob([JSON.stringify(backup)],{type:'application/json'})),a=document.createElement('a')
      a.href=url;a.download='netpositive-encrypted-vault.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)
      setStatus('Encrypted backup exported. Keep your recovery passphrase separately.')
    }catch{if(attempt===epoch.current)setStatus('Couldn’t export this backup.')}
    finally{if(attempt===epoch.current)setBusy(false)}
  }
  async function restore(file:File) {
    if(file.size>10_000_000){setStatus('Backup is too large.');return}
    if(hasVault){setStatus('Use a fresh browser profile to restore another vault; your existing vault has been kept.');return}
    const attempt=epoch.current;setBusy(true);setStatus('')
    try {
      const raw=await file.text(),restored=await importBackup(JSON.parse(raw),pass)
      const next=await Promise.all(restored.envelopes.map(async envelope=>({envelope,record:await decryptRecord(restored.key,envelope)})))
      if(attempt!==epoch.current){restored.key.fill(0);return}
      localStorage.setItem(slot,raw);setKey(restored.key);setItems(next);setHasVault(true)
    }catch{if(attempt===epoch.current)setStatus('Couldn’t restore. Check the backup and recovery passphrase.')}
    finally{if(attempt===epoch.current)setBusy(false)}
  }
  async function sync() {
    if(!key||!address){setStatus('Connect your wallet to sync encrypted records.');return}
    const attempt=epoch.current;setBusy(true);setStatus('')
    let token=''
    async function api(path:string,method='GET',body?:unknown) {
      const r=await fetch(`/vault-api${path}`,{method,headers:{'content-type':'application/json',...(token?{authorization:`Bearer ${token}`}:{})},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(15000)})
      if(!r.ok)throw new Error('Sync unavailable');return r.json()
    }
    try {
      const c=await api('/v1/auth/challenge','POST',{address})
      if(attempt!==epoch.current)return
      // Sign only our expected login statement, with the displayed site's exact origin.
      if(typeof c.message!=='string'||!c.message.startsWith(`${location.host} wants you to sign in with your Ethereum account:`)||!c.message.includes(`URI: ${location.origin}\n`))throw new Error('Wrong sign-in domain')
      const signature=await signMessage(c.message)
      if(attempt!==epoch.current)return
      const session=await api('/v1/auth/verify','POST',{address,signature});token=session.token
      const remote=await api('/v1/vault')
      const merged=new Map(items.map(i=>[i.envelope.id,i]))
      for(const {envelope} of remote.records) {
        if(attempt!==epoch.current)return
        if(!merged.has(envelope.id))merged.set(envelope.id,{envelope,record:await decryptRecord(key,envelope)})
      }
      for(const item of items){if(attempt!==epoch.current)return;await api(`/v1/vault/${item.envelope.id}`,'PUT',item.envelope)}
      const next=[...merged.values()],backup=await exportBackup(key,next.map(i=>i.envelope),pass)
      if(attempt!==epoch.current)return
      localStorage.setItem(slot,JSON.stringify(backup));setItems(next);setStatus('Encrypted records synced. Your recovery key stayed here.')
    }catch{if(attempt===epoch.current)setStatus('Sync unavailable. Your local vault and encrypted backup still work.')}
    finally{if(token)await api('/v1/auth/logout','POST').catch(()=>{});if(attempt===epoch.current)setBusy(false)}
  }
  return <div className="vault-panel">
    <div className="vault-intro"><span className="vault-symbol"><LockKeyhole size={23}/></span><p>Yours to keep.<br/><span>Encrypted before it leaves your device.</span></p></div>
    {!key?<form onSubmit={unlock} className="vault-form">
      <label>Recovery passphrase<input type="password" minLength={16} maxLength={1024} required autoComplete={hasVault?'current-password':'new-password'} value={pass} onChange={e=>setPass(e.target.value)} placeholder="At least 16 characters"/></label>
      {!hasVault&&<p className="vault-caption">Keep this passphrase safe. It opens your vault and your backups.</p>}
      <button className="button button-dark" disabled={busy}>{busy?'Opening…':hasVault?'Unlock vault':'Create vault'}<ArrowUpFromLine size={16}/></button>
      {!hasVault&&<button type="button" className="text-button" disabled={busy||pass.length<16} onClick={()=>importInput.current?.click()}>Restore an encrypted backup</button>}
      <input hidden ref={importInput} type="file" accept="application/json,.json" onChange={e=>{const f=e.target.files?.[0];if(f)void restore(f);e.target.value=''}}/>
    </form>:<>
      <div className="vault-toolbar"><button className="text-button" disabled={busy} onClick={()=>setAdding(!adding)}><Plus size={16}/>Add card</button><button className="text-button" disabled={busy} onClick={download}><ArrowDownToLine size={16}/>Backup</button><button className="text-button" disabled={busy} onClick={sync}><RefreshCw size={16}/>Sync</button><button className="text-button" onClick={lock}>Lock</button></div>
      {adding&&<form className="vault-form vault-add" onSubmit={save}>
        <div className="vault-tabs"><button type="button" aria-pressed={kind==='gift-card'} onClick={()=>setKind('gift-card')}>Gift card</button><button type="button" aria-pressed={kind==='payment-card'} onClick={()=>setKind('payment-card')}>Payment card</button></div>
        {kind==='gift-card'?<><label>Brand<input name="brand" required maxLength={80} placeholder="e.g. Amazon"/></label><label>Voucher code<input type="password" name="code" required maxLength={512} autoComplete="off"/></label><div className="vault-two"><label>Value<input name="value" type="number" min="0.01" max="10000000000" step="0.01" required/></label><label>Currency<select name="currency"><option>INR</option><option>EUR</option><option>USD</option><option>GBP</option></select></label></div></>
          :<><label>Issuer<input name="issuer" required maxLength={80}/></label><label>Card name<input name="variant" required maxLength={80}/></label><div className="vault-two"><label>Last four digits<input name="last4" pattern="[0-9]{4}" inputMode="numeric" maxLength={4} required/></label><label>Network<select name="network"><option>Visa</option><option>Mastercard</option><option>RuPay</option><option>Amex</option><option>Other</option></select></label></div><p className="vault-caption">Card details for your rewards portfolio. Add only the last four digits.</p></>}
        <button className="button button-dark" disabled={busy}>{busy?'Encrypting…':'Save to vault'}<LockKeyhole size={16}/></button>
      </form>}
      <div className="vault-list">{items.length?items.map(({envelope,record})=><div className="vault-item" key={envelope.id}>{record.kind==='gift-card'?<Gift size={21}/>:<CreditCard size={21}/>}<div><strong>{record.kind==='gift-card'?record.brand:record.variant}</strong><span>{record.kind==='gift-card'?new Intl.NumberFormat(undefined,{style:'currency',currency:record.currency}).format(record.valueMinor/100):`${record.issuer} · •••• ${record.last4}`}</span></div><LockKeyhole size={14}/></div>):!adding&&<p className="vault-empty">A little space for everything you hold.</p>}</div>
    </>}
    {status&&<p className="vault-status" role="status">{status}</p>}
  </div>
}
