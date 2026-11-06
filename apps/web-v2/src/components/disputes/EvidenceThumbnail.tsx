import {useEffect,useState} from 'react'
import {X} from 'lucide-react'
/** Browser-memory preview only. Never stores or uploads an evidence file. */
export function EvidenceThumbnail({file,onRemove}:{file:File|null;onRemove:()=>void}){
 const [url,setUrl]=useState<string|null>(null)
 useEffect(()=>{if(!file){setUrl(null);return}const next=URL.createObjectURL(file);setUrl(next);return()=>URL.revokeObjectURL(next)},[file])
 if(!file||!url)return null
 return <div className="dp-evidence-image"><img src={url} alt="Selected merchant error screenshot"/><button type="button" onClick={onRemove} aria-label="Remove evidence screenshot"><X size={14}/></button><span>{file.name}</span></div>
}
