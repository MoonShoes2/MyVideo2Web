import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ping } from '../lib/api'
import { clearPageCache } from '../lib/repo'
import {
  CACHE_CAPACITY_OPTIONS,
  DEFAULT_BASE_URL,
  SPEED_OPTIONS,
  normalizeBaseUrl,
  updateSettings,
  useSettings,
} from '../lib/settings'
import { formatSpeed } from '../lib/parse'
import { Icon } from '../components/icons'
import { ScreenTopBar, Segmented, Switch } from '../components/common'
import { PageShell, useGoBack } from '../App'

const THEME_OPTIONS = [
  { label: '跟随系统', value: 0 },
  { label: '浅色', value: 1 },
  { label: '深色', value: 2 },
]

export default function Settings() {
  const goBack = useGoBack()
  const navigate = useNavigate()
  const settings = useSettings()
  const [speedOpen, setSpeedOpen] = useState(false)
  const [urlOpen, setUrlOpen] = useState(false)
  const [urlInput, setUrlInput] = useState(settings.baseUrl)
  const [pinging, setPinging] = useState(false)
  const [pingResult, setPingResult] = useState<string | null>(null)

  const doPing = async (url: string) => {
    if (pinging) return
    setPinging(true)
    setPingResult(null)
    try {
      const code = await ping(url)
      setPingResult(
        code >= 200 && code < 400 ? `连接成功（HTTP ${code}）` : `接口返回 HTTP ${code}，请检查地址`,
      )
    } catch (e) {
      setPingResult(`连接失败：${(e as Error).message || '网络异常'}`)
    } finally {
      setPinging(false)
    }
  }

  return (
    <PageShell>
      <div className="flex h-full flex-col overflow-y-auto bg-bg no-scrollbar">
        <ScreenTopBar title="设置" onBack={goBack} />

        <Group title="外观">
          <div className="px-3 py-3">
            <Segmented
              options={THEME_OPTIONS}
              value={settings.themeMode}
              onChange={(v) => updateSettings({ themeMode: v })}
            />
          </div>
        </Group>

        <Group title="播放">
          <Row
            title="自动连播下一集"
            subtitle="本集播完自动进入下一集"
            trailing={
              <Switch
                checked={settings.autoPlayNext}
                onChange={(v) => updateSettings({ autoPlayNext: v })}
              />
            }
          />
          <Row
            title="自动跳过片内广告"
            subtitle="识别源站标记的插播广告，播放到该处自动跳过"
            trailing={
              <Switch checked={settings.skipAds} onChange={(v) => updateSettings({ skipAds: v })} />
            }
          />
          <Row
            title="播放页亮度手势"
            subtitle="左半屏上下滑调节画面亮度；浏览器内用遮罩实现，不改系统背光"
            trailing={<span className="text-label-lg text-muted">已支持</span>}
          />
          <Row
            title="默认倍速"
            onClick={() => setSpeedOpen(true)}
            trailing={
              <>
                <span className="text-label-lg text-muted">{formatSpeed(settings.defaultSpeed)}x</span>
                <Chevron />
              </>
            }
            last
          />
        </Group>

        <Group title="下载">
          <Row
            title="仅 Wi-Fi 下载"
            subtitle="移动网络下不下载，避免消耗流量"
            trailing={
              <Switch checked={settings.wifiOnly} onChange={(v) => updateSettings({ wifiOnly: v })} />
            }
          />
          <Row
            title="缓存管理"
            subtitle="查看占用、清理页面与离线缓存"
            onClick={() => navigate('/cache')}
            trailing={<Chevron />}
            last
          />
        </Group>

        <Group title="接口">
          <Row
            title="接口地址"
            subtitle={settings.baseUrl}
            onClick={() => {
              setUrlInput(settings.baseUrl)
              setPingResult(null)
              setUrlOpen(true)
            }}
            trailing={
              <>
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    doPing(settings.baseUrl)
                  }}
                  className="tap px-1.5 py-1.5 text-label-md text-brand"
                >
                  {pinging ? '测试中…' : '测试连接'}
                </button>
                <Chevron />
              </>
            }
            last
          />
          {pingResult && (
            <p
              className={`px-4 py-2 text-label-sm ${
                pingResult.startsWith('连接成功') ? 'text-success' : 'text-danger'
              }`}
            >
              {pingResult}
            </p>
          )}
        </Group>

        <Group title="关于">
          <Row
            title="版本号"
            trailing={<span className="text-label-md text-muted">1.0.0 · Web</span>}
          />
          <p className="px-4 py-3 text-label-sm text-muted">
            数据来源：第三方采集接口，本应用不存储任何视频文件，所有内容版权归原站点与权利人所有。
          </p>
        </Group>

        <div className="h-7" />
      </div>

      {speedOpen && (
        <Dialog onClose={() => setSpeedOpen(false)} title="默认倍速">
          {SPEED_OPTIONS.map((value) => (
            <button
              key={value}
              onClick={() => {
                updateSettings({ defaultSpeed: value })
                setSpeedOpen(false)
              }}
              className="tap flex w-full items-center gap-3 rounded-lg px-2 py-2"
            >
              <span
                className={`flex h-[18px] w-[18px] items-center justify-center rounded-full border-2 ${
                  Math.abs(settings.defaultSpeed - value) < 0.01 ? 'border-brand' : 'border-muted/50'
                }`}
              >
                {Math.abs(settings.defaultSpeed - value) < 0.01 && (
                  <span className="h-2 w-2 rounded-full bg-brand" />
                )}
              </span>
              <span className="text-body-lg text-ink">{formatSpeed(value)}x</span>
            </button>
          ))}
        </Dialog>
      )}

      {urlOpen && (
        <Dialog onClose={() => setUrlOpen(false)} title="接口地址">
          <input
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            placeholder={DEFAULT_BASE_URL}
            className="w-full rounded-lg border border-divider bg-bg px-3 py-2 text-body-md text-ink outline-none focus:border-brand"
          />
          <p className="mt-2 text-label-sm text-muted">换域名时在此修改，无需重新部署。</p>
          <div className="mt-3 flex items-center gap-2">
            <button onClick={() => doPing(urlInput)} disabled={pinging} className="tap px-1 py-1 text-label-lg text-brand">
              {pinging ? '测试中…' : '测试连接'}
            </button>
            {pingResult && (
              <span
                className={`min-w-0 flex-1 truncate text-label-sm ${
                  pingResult.startsWith('连接成功') ? 'text-success' : 'text-danger'
                }`}
              >
                {pingResult}
              </span>
            )}
          </div>
          <div className="mt-3 flex justify-end gap-2">
            <button onClick={() => setUrlOpen(false)} className="tap rounded-lg px-3 py-2 text-label-lg text-muted">
              取消
            </button>
            <button
              onClick={async () => {
                const changed = normalizeBaseUrl(urlInput) !== settings.baseUrl
                updateSettings({ baseUrl: urlInput })
                // 页面缓存按接口存的：换了源，旧源的列表/详情不能再拿出来用
                if (changed) await clearPageCache()
                setUrlOpen(false)
              }}
              className="tap rounded-lg px-3 py-2 text-label-lg text-brand"
            >
              保存
            </button>
          </div>
        </Dialog>
      )}
    </PageShell>
  )
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <p className="px-[30px] pb-1.5 pt-3.5 text-label-md text-muted">{title}</p>
      <div className="mx-4 overflow-hidden rounded-card bg-surface">{children}</div>
    </section>
  )
}

function Row({
  title,
  subtitle,
  trailing,
  onClick,
  last,
}: {
  title: string
  subtitle?: string
  trailing?: React.ReactNode
  onClick?: () => void
  last?: boolean
}) {
  return (
    <div>
      <div
        onClick={onClick}
        className={`flex min-h-[56px] items-center px-4 py-2.5 ${onClick ? 'tap cursor-pointer' : ''}`}
      >
        <div className="min-w-0 flex-1">
          <p className="text-title-sm text-ink">{title}</p>
          {subtitle && <p className="mt-0.5 line-clamp-2 text-label-sm text-muted">{subtitle}</p>}
        </div>
        <div className="ml-3 flex items-center gap-1">{trailing}</div>
      </div>
      {!last && <div className="ml-4 h-px bg-divider" />}
    </div>
  )
}

function Chevron() {
  return <Icon name="chevron" size={18} className="text-muted/70" />
}

export function Dialog({
  title,
  children,
  onClose,
}: {
  title: string
  children: React.ReactNode
  onClose: () => void
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-8" onClick={onClose}>
      <div
        className="w-full max-w-[360px] rounded-2xl bg-surface-high p-5 animate-fade-in"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="mb-3 text-title-md text-ink">{title}</h3>
        {children}
      </div>
    </div>
  )
}

/** 缓存容量选项在 Web 端只影响提示文案，保留常量以对齐原生设置项。 */
export const CACHE_OPTIONS = CACHE_CAPACITY_OPTIONS
