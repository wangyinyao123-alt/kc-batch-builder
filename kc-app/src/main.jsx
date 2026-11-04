import React, { useState, useEffect, useMemo, createContext, useContext } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/tokens.css';
import './styles/app.css';
import LoginPage from './pages/LoginPage';
import TaskCenterPage from './pages/TaskCenterPage';
import NewTaskPage from './pages/NewTaskPage';
import SettingsPage from './pages/SettingsPage';
import { loadState, saveState } from './store';
import { installMockBridge } from './mockBridge';

// 浏览器直开（vite dev）时注入假桥，方便评审；Electron 里有真 preload，不覆盖
installMockBridge();

export const AppCtx = createContext(null);
export const useApp = () => useContext(AppCtx);

const NAV = [
  { key: 'tasks', label: '任务中心', icon: '◷' },
  { key: 'new', label: '新建任务', icon: '＋' },
  { key: 'settings', label: '设置', icon: '⚙' },
];

function Sidebar({ route, setRoute, tasks }) {
  const runningCount = tasks.filter((t) => t.status === 'running').length;
  return (
    <aside className="sidebar">
      <div className="sidebar-head">
        <div className="brand-mark">KC</div>
        <div>
          <div className="brand-name">内容生产助手</div>
          <div className="brand-sub">Hikvision Content</div>
        </div>
      </div>
      <nav className="nav">
        {NAV.map((n) => (
          <div
            key={n.key}
            className={`nav-item ${route === n.key ? 'active' : ''}`}
            onClick={() => setRoute(n.key)}
          >
            <span style={{ width: 16, textAlign: 'center' }}>{n.icon}</span>
            <span>{n.label}</span>
            {n.key === 'tasks' && runningCount > 0 && (
              <span className="count">{runningCount}</span>
            )}
          </div>
        ))}
      </nav>
      <div className="sidebar-foot">
        <div>v0.1.0 · 内网工具</div>
        <div style={{ marginTop: 2 }}>ISHRemote 驱动</div>
      </div>
    </aside>
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
  const [route, setRoute] = useState('tasks');
  const [activeTaskId, setActiveTaskId] = useState(null);

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
      setRoute,
    }),
    [creds, settings, tasks, activeTaskId]
  );

  if (!creds) return <LoginPage onLogin={login} />;

  return (
    <AppCtx.Provider value={ctx}>
      <div className="app">
        <Sidebar route={route} setRoute={setRoute} tasks={tasks} />
        <main className="main">
          {route === 'tasks' && <TaskCenterPage />}
          {route === 'new' && <NewTaskPage />}
          {route === 'settings' && <SettingsPage />}
        </main>
      </div>
    </AppCtx.Provider>
  );
}

createRoot(document.getElementById('root')).render(<Shell />);
