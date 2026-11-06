/** Compatibility entry points for Track and existing trade links. */
import {useEffect} from 'react'
import {DisputeCenter} from './disputes/DisputeCenter'
import {Dialog} from './disputes/DisputeDialog'
import './disputes/disputes.css'
import './disputes/surface.css'
export function DisputeSection({id,status,onChanged}:{id:string;status:string;onChanged:()=>void}){
 useEffect(()=>{if(!['code_submitted','disputed'].includes(status))return;const timer=setInterval(onChanged,10000);return()=>clearInterval(timer)},[status,onChanged])
 if(!['code_submitted','disputed'].includes(status))return null
 return <section className="dispute-surface ds-inline"><DisputeCenter key={id} tradeId={id} onChanged={onChanged}/></section>
}
export function RaiseDispute({id,open,onClose,onDone}:{id:string;open:boolean;onClose:()=>void;onDone:()=>void}){
 if(!open)return null
 return <div className="dispute-surface"><Dialog title="Trade protection" close={()=>{onClose();onDone()}}><DisputeCenter key={id} tradeId={id}/></Dialog></div>
}
export function DisputeView({id,onChanged}:{id:string;token:string;live?:boolean;onChanged:()=>void}){
 return <div className="dispute-surface ds-inline"><DisputeCenter key={id} tradeId={id} onChanged={onChanged}/></div>
}
