import { useQuery } from '@tanstack/react-query'
import QRCode from 'qrcode'
import { Link } from 'react-router-dom'
import type { AppData } from '../lib/data'
import { message } from '../lib/supabase'
import { qrLink } from '../lib/qr'
export function PrintQR({data}:{data:AppData}) {
  const codes=useQuery({queryKey:['equipment-qr',data.equipment.map(e=>[e.id,e.qr_code])],queryFn:()=>Promise.all(data.equipment.map(async e=>({...e,image:e.qr_code?await QRCode.toDataURL(qrLink(e.qr_code),{width:256,margin:4,errorCorrectionLevel:'M'}):null})))})
  return <section className="qr-print-page"><div className="no-print"><Link className="back" to="/equipment">← Оборудование</Link><h1>Печать QR</h1><p>Карточки оборудования для печати на A4. QR открывает карточку оборудования обычной камерой телефона.</p><button disabled={!codes.data||codes.isFetching} onClick={()=>window.print()}>Печатать</button>{codes.isPending&&<p>Готовим QR-коды…</p>}{codes.error&&<p role="alert">{message(codes.error)} <button onClick={()=>void codes.refetch()}>Повторить</button></p>}</div><div className="qr-print-grid">{codes.data?.map(e=><article className="qr-print-card" key={e.id}>{e.image?<img src={e.image} alt={`QR: ${e.name}`} width={256} height={256}/>:<p>QR-код не задан</p>}<h2>{e.name}</h2><p>Инв. № {e.inv_number}</p><p>{data.sites.find(s=>s.id===e.site_id)?.name}</p></article>)}</div></section>
}
