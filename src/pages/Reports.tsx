import type { AppData } from '../lib/data'
export function Reports({data}:{data:AppData}){return <><h1>Отчёты</h1><p>Всего нарядов: {data.orders.length}</p></>}
