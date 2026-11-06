import {useEffect,useState} from 'react'
import {disputeApi,categoryLabel,type DisputeRequest} from '../../lib/dispute'
import {useApp} from '../../lib/store'
/** Existing cases stay readable without invoking the legacy flat-bond write flow. */
export function ExistingDisputeRecord({id}:{id:string}){
 const {token,fullAddress}=useApp();const [record,setRecord]=useState<DisputeRequest|null>(null)
 useEffect(()=>{let current=true;setRecord(null);if(token)void disputeApi.get(id,token).then(({request})=>{if(current&&[request.requester,request.fulfiller].some(a=>a?.toLowerCase()===fullAddress.toLowerCase()))setRecord(request)}).catch(()=>{});return()=>{current=false}},[id,token,fullAddress])
 if(!record||!(record.dispute||record.disputeReason||record.status==='disputed'))return null
 return <section className="protected-trade"><div className="panel-heading"><div><h3>Existing dispute</h3><small>{record.brand} · {record.id}</small></div><span className="status-badge">{record.status.replaceAll('_',' ')}</span></div>{record.dispute?.category&&<p>{categoryLabel(record.dispute.category)}</p>}<p className="field-hint">{record.dispute?.reason||record.disputeReason}</p>{record.resolution?.note&&<p className="field-hint">{record.resolution.note}</p>}<small className="field-hint">Recorded under the previous dispute protocol. This view does not apply the new timers or collect another bond.</small></section>
}
