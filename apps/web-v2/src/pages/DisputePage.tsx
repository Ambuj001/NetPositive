import {useState} from 'react'
import {useNavigate,useParams} from 'react-router-dom'
import {ArrowLeft,ArrowRight} from 'lucide-react'
import {DisputeCenter} from '../components/disputes/DisputeCenter'
import '../components/disputes/disputes.css'
import '../components/disputes/surface.css'
export default function DisputePage(){
 const {id}=useParams();const nav=useNavigate();const [draft,setDraft]=useState(id||'')
 return <main className="dispute-surface ds-page"><div className="ds-wrap"><header className="ds-heading"><div><span>Trade protection</span><h1>Disputes</h1><p>Voucher checks, merchant reviews and resolutions.</p></div><button className="np-button secondary compact" onClick={()=>nav('/track')}><ArrowLeft size={14}/>My trades</button></header><form className="ds-find" onSubmit={e=>{e.preventDefault();if(draft.trim())nav(`/dispute/${encodeURIComponent(draft.trim())}`)}}><input aria-label="Order id" placeholder="Find a trade by its order ID" value={draft} onChange={e=>setDraft(e.target.value)} maxLength={128}/><button type="submit" className="np-button secondary compact" disabled={!draft.trim()}>Open trade<ArrowRight size={14}/></button>{id&&<button type="button" className="np-button secondary compact" onClick={()=>{setDraft('');nav('/dispute')}}>All trades</button>}</form><section className="ds-workspace"><DisputeCenter key={id||'all'} tradeId={id}/></section></div></main>
}
