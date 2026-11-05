import { useEffect, useRef, useState } from 'react'
import { IDKitRequestWidget, proofOfHuman } from '@worldcoin/idkit'
import type { IDKitRequestHookConfig } from '@worldcoin/idkit'
import { Dialog } from './Dialog'
export function WorldID({address,signMessage,close,verified}:{address:string,signMessage:(s:string)=>Promise<string>,close:()=>void,verified:()=>void}) {
  const [request,setRequest]=useState<IDKitRequestHookConfig|null>(null),[busy,setBusy]=useState(false),[status,setStatus]=useState('')
  const token=useRef(''),epoch=useRef(0),controller=useRef(new AbortController())
  const api=async(path:string,body?:unknown)=>{
    const r=await fetch(`/vault-api${path}`,{method:body===undefined?'GET':'POST',headers:{'content-type':'application/json',...(token.current?{authorization:`Bearer ${token.current}`}:{})},body:body===undefined?undefined:JSON.stringify(body),signal:controller.current.signal})
    if(!r.ok)throw new Error('Verification unavailable');return r.json()
  }
  const logout=()=>{const current=token.current;token.current='';if(current)void fetch('/vault-api/v1/auth/logout',{method:'POST',headers:{authorization:`Bearer ${current}`},keepalive:true}).catch(()=>{})}
  useEffect(()=>{controller.current=new AbortController();return()=>{epoch.current++;controller.current.abort();logout()}},[address])
  async function start() {
    const attempt=++epoch.current;setBusy(true);setStatus('')
    try {
      const c=await api('/v1/auth/challenge',{address})
      if(attempt!==epoch.current)return
      if(typeof c.message!=='string'||!c.message.startsWith(`${location.host} wants you to sign in with your Ethereum account:`)||!c.message.includes(`URI: ${location.origin}\n`))throw new Error('Wrong sign-in domain')
      const signature=await signMessage(c.message)
      if(attempt!==epoch.current)return
      const session=await api('/v1/auth/verify',{address,signature})
      if(attempt!==epoch.current)return
      token.current=session.token
      const w=await api('/v1/world/request',{})
      if(attempt!==epoch.current)return
      if(w.signal!==address.toLowerCase()||w.action!=='netpositive-trader-v1'||!/^app_[a-zA-Z0-9]+$/.test(w.app_id)||!['staging','production'].includes(w.environment))throw new Error('Invalid request')
      setRequest({app_id:w.app_id,action:w.action,rp_context:w.rp_context,environment:w.environment,allow_legacy_proofs:false,preset:proofOfHuman({signal:w.signal})})
    }catch{logout();if(attempt===epoch.current)setStatus('Verification is unavailable. Your vault remains accessible.')}
    finally{if(attempt===epoch.current)setBusy(false)}
  }
  if(request)return <IDKitRequestWidget {...request} open={true} onOpenChange={open=>{if(!open){logout();close()}}}
    handleVerify={async result=>{await api('/v1/world/verify',result)}}
    onSuccess={()=>{verified();logout();close()}}
    onError={()=>{logout();setRequest(null);setStatus('Verification cancelled or refused. You can try again.')}}/>
  return <Dialog title="A human connection." close={close}>
    <p className="dialog-subtitle">Verify once to join the exchange. Your identity stays private.</p>
    <button className="button button-dark full-width" disabled={busy||!address} onClick={start}>{busy?'Preparing…':'Verify with World ID'}</button>
    {status&&<p className="vault-status" role="status">{status}</p>}
  </Dialog>
}
