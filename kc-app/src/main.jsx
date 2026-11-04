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

// 设计稿没有左侧栏，也没有任何页面导航：顶栏里 x=280 处是环境标签「测试」，
// 右侧账号簇在 x=835..1228。导航改放到底部状态栏（DSL 里那片区域是空文本区），
// 避免挤进 x=390 的像素星星贴纸位置。
const DECOR_BY_ROUTE = { tasks: 'p2', detail: 'p4', new: 'p3', retry: 'p3', settings: 'p5' };

const NAV = [
  { key: 'tasks', label: '任务中心' },
  { key: 'new', label: '新建任务' },
  { key: 'settings', label: '设置' },
];

// 顶栏右簇在四个画板上位置不同（P2 是 778 起的旧稿，P3/P4/P5 是 835 起的新稿）。
// 统一按新稿（多数派）绝对定位，坐标 = DSL 值 − 顶栏左缘 35。
const TB_RIGHT = {
  conn: 800,   // DSL 连接指示灯 x=835
  sep: 881,    // DSL 连接分隔 x=916
  avatar: 899, // DSL 用户头像 x=934
  account: 942,// DSL 账号名 x=977
  switcher: 1057, // DSL 切换按钮底 x=1092
  dots: 1144,  // DSL 窗口控制点1 x=1179
};

function TopBar({ route, setRoute, tasks, creds, onLogout }) {
  const runningCount = tasks.filter((t) => t.status === 'running').length;
  return (
    <header className="topbar">
      <div className="tb-icon">KC</div>
      <div className="tb-brand">KC 批量建库工具</div>

      {/* 环境标签：DSL 顶栏 x=280 y=50 的「测试」 */}
      <div className="tb-env">测试</div>

      <button
        className="tb-conn"
        style={{ left: TB_RIGHT.conn }}
        onClick={() => setRoute('settings')}
        title="连接设置"
      >
        <span className={`tb-dot ${creds ? 'on' : ''}`} />
        <span>{creds ? '已连接' : '未连接'}</span>
      </button>
      <div className="tb-sep" style={{ left: TB_RIGHT.sep }} />
      <button
        className="tb-avatar"
        style={{ left: TB_RIGHT.avatar }}
        onClick={() => setRoute('settings')}
        title="打开设置"
      >
        {(creds?.user || 'U').slice(0, 1).toUpperCase()}
      </button>
      <div className="tb-account" style={{ left: TB_RIGHT.account }}>
        {creds?.user || '未登录'}
      </div>
      <button className="tb-switch" style={{ left: TB_RIGHT.switcher }} onClick={onLogout}>
        切换 ▾
      </button>
      <div className="tb-dots" style={{ left: TB_RIGHT.dots }}>
        <span className="wd" />
        <span className="wd" />
        <span className="wd" />
      </div>
    </header>
  );
}

function StatusBar({ tasks, route, setRoute }) {
  const running = tasks.filter((t) => t.status === 'running').length;
  return (
    <footer className="statusbar">
      <span className={`sb-dot ${running ? 'busy' : 'idle'}`} />
      <span className="sb-text">
        {running ? `正在执行 ${running} 个任务` : '就绪'}
      </span>
      {/* 页面导航：DSL 状态栏中段为空白，放这里不会与任何贴纸相交 */}
      <nav className="sb-nav">
        {NAV.map((n) => (
          <button
            key={n.key}
            className={`sb-nav-item ${route === n.key ? 'active' : ''}`}
            onClick={() => setRoute(n.key)}
          >
            {n.label}
            {n.key === 'tasks' && running > 0 && <span className="sb-count">{running}</span>}
          </button>
        ))}
      </nav>
      <span className="sb-right">ISHRemote 驱动 · v0.2.5</span>
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
          <StatusBar tasks={tasks} route={route} setRoute={setRoute} />
        </div>
      </div>
    </AppCtx.Provider>
  );
}

createRoot(document.getElementById('root')).render(<Shell />);
