import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { QueryClientProvider, useQuery } from '@tanstack/react-query'
import { BrowserRouter, Navigate, NavLink, Route, Routes } from 'react-router-dom'
import type { Employee } from '../shared/types'
import { configured, message, queryClient, supabase } from './lib/supabase'
import { aiMock } from './lib/api'
import { flushActions, offline, type PendingAction } from './lib/offline'
import { useData } from './lib/data'
import { Board } from './pages/Board'
import { CreateOrder } from './pages/CreateOrder'
import { OrderDetail } from './pages/OrderDetail'
import { EquipmentPage } from './pages/Equipment'
import { Reports } from './pages/Reports'
function Login() {
  const [error,setError]=useState(''); const [busy,setBusy]=useState(false)
  return <main className="login"><section className="panel"><div className="brand">Наряд<span>AI</span></div><p className="eyebrow">СМЕНА ПОД КОНТРОЛЕМ</p><h1>Начнём работу</h1><p>Войдите по логину и шестизначному ПИН.</p><form onSubmit={async e=>{e.preventDefault();setBusy(true);setError('');const f=new FormData(e.currentTarget);try{const {error}=await supabase.auth.signInWithPassword({email:`${String(f.get('login')).trim().toLowerCase()}@naryad.local`,password:String(f.get('pin'))});if(error)throw error}catch(e){setError(message(e))}finally{setBusy(false)}}}><label>Логин<input name="login" required autoComplete="username" placeholder="master1" pattern="[A-Za-z0-9_.-]+" /></label><label>ПИН<input name="pin" required type="password" inputMode="numeric" pattern="[0-9]{6}" minLength={6} maxLength={6} autoComplete="current-password" /></label>{error&&<p className="error" role="alert">{error}</p>}<button disabled={busy||!configured}>{busy?'Входим…':'Войти'}</button>{!configured&&<p className="error">Настройте VITE_SUPABASE_URL и VITE_SUPABASE_ANON_KEY.</p>}</form></section></main>
}
function Workspace({session}:{session:Session}) {
  const employee=useQuery({queryKey:['employee',session.user.id],queryFn:async()=>{const {data,error}=await supabase.from('employees').select('*').eq('auth_user_id',session.user.id).single();if(error)throw error;return data as Employee}})
  const data=useData(); const [banner,setBanner]=useState(''); const [online,setOnline]=useState(navigator.onLine); const [queue,setQueue]=useState<PendingAction[]>([])
  const [install,setInstall]=useState<(Event & {prompt:()=>Promise<void>}) | null>(null)
  useEffect(()=>{const fn=(e:Event)=>{e.preventDefault();setInstall(e as Event & {prompt:()=>Promise<void>})};window.addEventListener('beforeinstallprompt',fn);return()=>window.removeEventListener('beforeinstallprompt',fn)},[])
  useEffect(()=>{
    const refresh=()=>{void offline.actions.where('userId').equals(session.user.id).toArray().then(setQueue)}
    const net=()=>{setOnline(navigator.onLine);if(navigator.onLine)void flushActions()}
    refresh(); void flushActions(); window.addEventListener('online',net);window.addEventListener('offline',net);window.addEventListener('queue-change',refresh)
    return()=>{window.removeEventListener('online',net);window.removeEventListener('offline',net);window.removeEventListener('queue-change',refresh)}
  },[session.user.id])
  useEffect(()=>{
    if(!employee.data)return
    const id=employee.data.id
    const channel=supabase.channel(`shift-${id}`).on('postgres_changes',{event:'*',schema:'public',table:'orders'},payload=>{
      void queryClient.invalidateQueries()
      if(payload.eventType==='INSERT'&&payload.new.assignee_id===id){setBanner(`Новый наряд №${payload.new.number}`);try{const ctx=new AudioContext();const osc=ctx.createOscillator();osc.connect(ctx.destination);osc.frequency.value=660;osc.start();osc.stop(ctx.currentTime+0.25);osc.onended=()=>void ctx.close()}catch{/* banner remains available */}}
    }).on('postgres_changes',{event:'*',schema:'public',table:'order_events'},()=>void queryClient.invalidateQueries()).on('postgres_changes',{event:'*',schema:'public',table:'ai_reviews'},()=>void queryClient.invalidateQueries()).on('postgres_changes',{event:'INSERT',schema:'public',table:'notifications',filter:`employee_id=eq.${id}`},p=>{setBanner(String(p.new.text));void queryClient.invalidateQueries()}).subscribe()
    return()=>{void supabase.removeChannel(channel)}
  },[employee.data])
  const signOut=async()=>{await supabase.auth.signOut();queryClient.clear()}
  if(employee.error||data.error)return <main><p role="alert" className="error">{message(employee.error||data.error)}</p><button onClick={()=>{void employee.refetch();void data.refetch()}}>Повторить</button><button onClick={signOut}>Выйти</button></main>
  if(!employee.data||!data.data)return <main aria-busy="true">Загружаем смену…</main>
  const me=employee.data, master=['master','admin'].includes(me.role), reports=me.role!=='worker'
  return <><header><NavLink className="brand" to="/">Наряд<span>AI</span></NavLink><span className="user">{me.full_name}<small>{master?'Мастер':me.role==='worker'?'Исполнитель':'Руководитель'}</small></span><button className="secondary" onClick={signOut}>Выйти</button></header><nav><NavLink to="/orders">{me.role==='worker'?'Мои наряды':'Панель смены'}</NavLink>{master&&<NavLink to="/new">＋ Создать наряд</NavLink>}<NavLink to="/equipment">Оборудование / QR</NavLink>{reports&&<NavLink to="/reports">Отчёты и ИИ</NavLink>}{install&&<button onClick={async()=>{await install.prompt();setInstall(null)}}>Установить</button>}</nav><main>{aiMock&&<div className="notice">ИИ: демонстрационные ответы. Наряды и статусы сохраняются в рабочей базе.</div>}{!online&&<div className="notice">Нет сети. Действия со статусами будут сохранены в очередь.</div>}{queue.length>0&&<section className="notice">Ожидают отправки: {queue.length}{queue.map(q=><div key={q.id}>Наряд {q.args.p_order_id}: {q.args.p_action}{q.error&&<><p className="error">{q.error}</p><button onClick={async()=>{await offline.actions.update(q.id!,{error:undefined});await flushActions()}}>Повторить</button><button onClick={async()=>{await offline.actions.delete(q.id!);window.dispatchEvent(new Event('queue-change'));await flushActions()}}>Удалить действие</button></>}</div>)}</section>}{banner&&<div className="notice" role="status">{banner}<button className="secondary" onClick={()=>setBanner('')}>Понятно</button></div>}<Routes><Route path="/orders" element={<Board data={data.data} me={me}/>} /><Route path="/orders/:id" element={<OrderDetail data={data.data} me={me}/>} /><Route path="/new" element={master?<CreateOrder data={data.data} me={me}/>:<Navigate to="/orders" replace/>}/><Route path="/equipment" element={<EquipmentPage data={data.data} canCreate={master}/>}/><Route path="/reports" element={reports?<Reports data={data.data}/>:<Navigate to="/orders" replace/>}/><Route path="*" element={<Navigate to={me.role==='manager'?'/reports':'/orders'} replace/>}/></Routes></main><footer>НарядAI · Решение принимает человек</footer></>
}
function AuthApp(){const [session,setSession]=useState<Session|null>(null);const [ready,setReady]=useState(false);useEffect(()=>{void supabase.auth.getSession().then(({data})=>{setSession(data.session);setReady(true)});const {data}=supabase.auth.onAuthStateChange((_event,s)=>{setSession(s);setReady(true)});return()=>data.subscription.unsubscribe()},[]);return ready?session?<Workspace key={session.user.id} session={session}/>:<Login/>:<main>Загрузка…</main>}
export default function App(){return <QueryClientProvider client={queryClient}><BrowserRouter><AuthApp/></BrowserRouter></QueryClientProvider>}

