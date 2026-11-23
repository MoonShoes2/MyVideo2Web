import { NavLink, Outlet, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { Icon } from './components/icons'
import { UpdateBanner } from './components/UpdateBanner'
import { useDarkMode } from './lib/settings'
import Home from './pages/Home'
import Category from './pages/Category'
import Mine from './pages/Mine'
import Search from './pages/Search'
import Detail from './pages/Detail'
import Player from './pages/Player'
import Favorites from './pages/Favorites'
import History from './pages/History'
import Downloads from './pages/Downloads'
import Settings from './pages/Settings'
import CachePage from './pages/Cache'

const TABS = [
  { path: '/', label: '首页', icon: 'home' as const },
  { path: '/category', label: '分类', icon: 'grid' as const },
  { path: '/mine', label: '我的', icon: 'person' as const },
]

function BottomBar() {
  return (
    <nav className="shrink-0 border-t border-divider/60 bg-surface pb-[env(safe-area-inset-bottom)]">
      <div className="flex h-14 items-center">
        {TABS.map((tab) => (
          <NavLink
            key={tab.path}
            to={tab.path}
            end={tab.path === '/'}
            className="flex flex-1 flex-col items-center justify-center gap-0.5 py-1.5"
          >
            {({ isActive }) => (
              <>
                <Icon
                  name={tab.icon}
                  size={23}
                  outlined={!isActive}
                  className={isActive ? 'text-brand' : 'text-muted'}
                />
                <span className={`text-label-sm ${isActive ? 'text-brand' : 'text-muted'}`}>
                  {tab.label}
                </span>
              </>
            )}
          </NavLink>
        ))}
      </div>
    </nav>
  )
}

function TabLayout() {
  return (
    <div className="app-shell">
      <div className="min-h-0 flex-1 overflow-hidden">
        <Outlet />
      </div>
      <BottomBar />
    </div>
  )
}

/** 二级页统一外壳：手机上铺满，桌面上仍保持一条手机宽的内容列。 */
export function PageShell({ children }: { children: React.ReactNode }) {
  return <div className="app-shell">{children}</div>
}

/** 顶栏返回：优先退栈，直接打开详情页时退回首页。 */
export function useGoBack() {
  const navigate = useNavigate()
  const location = useLocation()
  return () => {
    if (location.key === 'default') navigate('/', { replace: true })
    else navigate(-1)
  }
}

export default function App() {
  useDarkMode()

  return (
    <>
      <UpdateBanner />
      <Routes>
      <Route element={<TabLayout />}>
        <Route path="/" element={<Home />} />
        <Route path="/category" element={<Category />} />
        <Route path="/mine" element={<Mine />} />
      </Route>
      <Route path="/search" element={<Search />} />
      <Route path="/detail/:vodId" element={<Detail />} />
      <Route path="/player/:vodId" element={<Player />} />
      <Route path="/favorites" element={<Favorites />} />
      <Route path="/history" element={<History />} />
      <Route path="/downloads" element={<Downloads />} />
      <Route path="/settings" element={<Settings />} />
      <Route path="/cache" element={<CachePage />} />
      <Route path="*" element={<TabLayout />} />
      </Routes>
    </>
  )
}
