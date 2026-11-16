import { pathToFileURL } from 'node:url'
const mod = await import(pathToFileURL('functions/api/[[default]].js').href)
const handler = mod.onRequest

// 取一条新鲜详情，拿第一集 m3u8
const res = await handler({ request: new Request('http://t/api/maccms?__base=https%3A%2F%2Fcj.lziapi.com%2F&ac=detail&ids=165605') })
const d = JSON.parse(await res.text())
const v = d.list[0]
const urls = v.vod_play_url.split('$$$')
const first = urls[0].split('#')[0].split('$').pop()
console.log('m3u8:', first.slice(0, 90))

const r = await handler({ request: new Request('http://t/api/hls?u=' + encodeURIComponent(first)) })
const text = await r.text()
console.log('status:', r.status, '| type:', r.headers.get('content-type'))
if (r.status !== 200) { console.log(text.slice(0, 200)); process.exit(0) }
const lines = text.split('\n')
const proxied = lines.filter(l => l.trim().startsWith('/api/'))
console.log('改写出的代理地址示例:')
console.log(proxied.slice(0, 3).join('\n'))
console.log('原始直链残留:', lines.some(l => l.includes('http') && !l.includes('#') && !l.startsWith('/api/')) ? '有(注意!)' : '无')
// 顺着改写结果再拉一个子列表验证链路闭环
const child = proxied.find(l => l.includes('/api/hls?u='))
if (child) {
  const r2 = await handler({ request: new Request('http://t' + child.trim()) })
  const t2 = await r2.text()
  console.log('子列表:', r2.status, '分片数:', t2.split('\n').filter(l => l.trim().startsWith('/api/seg')).length)
}
