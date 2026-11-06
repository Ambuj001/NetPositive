/** Reuse this branch's configured backend URL and wallet-bound bearer session. */
import {API_URL as backendUrl, ApiError} from './api'
export const API_URL=backendUrl
export async function api<T>(path:string,token='',body?:unknown):Promise<T>{
 const r=await fetch(API_URL+path,{method:body===undefined?'GET':'POST',headers:{...(token?{Authorization:`Bearer ${token}`}:{ }),...(body===undefined?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(12000)})
 const data=await r.json().catch(()=>null)
 if(!r.ok||!data)throw new ApiError(r.status,data?.error||'dispute_protocol_unavailable',data?.message||'Timed dispute protection is not connected to this backend yet.')
 return data as T
}
