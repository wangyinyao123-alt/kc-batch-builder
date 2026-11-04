import React, { useState, useEffect, useMemo, useCallback, createContext, useContext } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/tokens.css';
import './styles/app.css';
import LoginPage from './pages/LoginPage';
import TaskCenterPage from './pages/TaskCenterPage';
import NewTaskPage from './pages/NewTaskPage';
import SettingsPage from './pages/SettingsPage';
import TaskDetailPage from './pages/TaskDetailPage';
import { loadState, saveState } from './store';
import { installMockBridge } from './mockBridge';
import Decor from './components/Decor';

// 浏览器直开（vite dev）时注入假桥，方便评审；Electron 里有真 preload，不覆盖
installMockBridge();

export const AppCtx = createContext(null);
export const useApp = () => useContext(AppCtx);

// 设计稿没有左侧栏：导航收在顶栏里（顶栏 64px 高，见 DSL div.topbar）
const DECOR_BY_ROUTE = { tasks: 'p2', detail: 'p4', new: 'p3', retry: 'p3', settings: 'p5' };

const NAV = [
  { key: 'tasks', label: '任务中心' },
  { key: 'new', label: '新建任务' },
  { key: 'settings', label: '设置' },
];

function TopBar({ route, setRoute, tasks, creds, onLogout }) {
  const runningCount = tasks.filter((t) => t.status === 'running').length;
  return (
    <header className="topbar">
      <div className="tb-icon">KC</div>
      <div className="tb-brand">KC 批量建库工具</div>

      <nav className="tb-nav">
        {NAV.map((n) => (
          <button
            key={n.key}
            className={`tb-nav-item ${route === n.key ? 'active' : ''}`}
            onClick={() => setRoute(n.key)}
          >
            {n.label}
            {n.key === 'tasks' && runningCount > 0 && <span className="tb-count">{runningCount}</span>}
          </button>
        ))}
      </nav>

      <div className="tb-spacer" />

      <div className="tb-conn">
        <span className={`tb-dot ${creds ? 'on' : ''}`} />
        <span>{creds ? '已连接' : '未连接'}</span>
      </div>
      <div className="tb-sep" />
      <div className="tb-avatar">{(creds?.user || 'U').slice(0, 1).toUpperCase()}</div>
      <div className="tb-account">{creds?.user || '未登录'}</div>
      <button className="tb-switch" onClick={onLogout}>
        切换 ▾
      </button>
      <div className="tb-dots">
        <span className="wd" />
        <span className="wd" />
        <span className="wd" />
      </div>
    </header>
  );
}

function StatusBar({ tasks }) {
  const running = tasks.filter((t) => t.status === 'running').length;
  return (
    <footer className="statusbar">
      <span className={`sb-dot ${running ? 'busy' : 'idle'}`} />
      <span className="sb-text">
        {running ? `正在执行 ${running} 个任务` : '就绪'}
      </span>
      <span className="sb-right">ISHRemote 驱动 · v0.1.0</span>
    </footer>
  );
}

function Shell() {
  const [creds, setCreds] = useState(() => loadState('creds', null));
  const [settings, setSettings] = useState(() => loadState('settings', {
    wsBaseUrl: 'https://kc-prod.hikvision.com/ISHWS/',
    ignoreSsl: false,
    keepLogs: 20,
  }));
  const [tasks, setTasks] = useState(() => loadState('tasks', []));
  const [route, setRouteRaw] = useState('tasks');
  // 路由附带的数据（比如「只重试失败项」把失败标题带到新建页）
  const [routePayload, setRoutePayload] = useState(null);
  const [activeTaskId, setActiveTaskId] = useState(null);

  const setRoute = useCallback((next, payload) => {
    setRoutePayload(payload || null);
    setRouteRaw(next);
  }, []);

  useEffect(() => saveState('settings', settings), [settings]);
  useEffect(() => saveState('tasks', tasks), [tasks]);

  const login = (c) => {
    setCreds(c);
    saveState('creds', c);
  };
  const logout = () => {
    setCreds(null);
    saveState('creds', null);
    setRoute('tasks');
    setActiveTaskId(null);
  };

  const ctx = useMemo(
    () => ({
      creds,
      settings,
      setSettings,
      tasks,
      setTasks,
      login,
      logout,
      activeTaskId,
      setActiveTaskId,
      route,
      routePayload,
      setRoute,
    }),
    [creds, settings, tasks, activeTaskId, route, routePayload]
  );

  if (!creds) return <LoginPage onLogin={login} />;

  return (
    <AppCtx.Provider value={ctx}>
      {/* 设计稿结构：背景插画 → 白色柔化蒙层 → 内缩的应用窗口（x32 y22, 1216×756, 3px #AD5E80 描边） */}
      <div className="app">
        <div className="window">
          <Decor scene={DECOR_BY_ROUTE[route] || 'p2'} />
          <TopBar route={route} setRoute={setRoute} tasks={tasks} creds={creds} onLogout={logout} />
          <main className="content">
            {route === 'tasks' && <TaskCenterPage />}
            {route === 'detail' && <TaskDetailPage />}
            {route === 'new' && <NewTaskPage />}
            {route === 'retry' && <NewTaskPage />}
            {route === 'settings' && <SettingsPage />}
          </main>
          <StatusBar tasks={tasks} />
        </div>
      </div>
    </AppCtx.Provider>
  );
}

createRoot(document.getElementById('root')).render(<Shell />);
