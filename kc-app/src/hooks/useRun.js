import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * 一次脚本调用的状态机。
 * phase: idle | prechecking | ready | committing | done | error
 */
export function useRun() {
  const [phase, setPhase] = useState('idle');
  const [events, setEvents] = useState([]); // 原始事件（日志抽屉）
  const [summary, setSummary] = useState(null);
  const [items, setItems] = useState([]);
  const [progress, setProgress] = useState({ i: 0, n: 0, title: '' });
  const [login, setLogin] = useState(null);
  const [warns, setWarns] = useState([]);
  const [error, setError] = useState(null);
  const [artifacts, setArtifacts] = useState([]);
  const [attach, setAttach] = useState([]);
  const [exitCode, setExitCode] = useState(null);
  const [startedAt, setStartedAt] = useState(null);
  const [endedAt, setEndedAt] = useState(null);

  const unsubRef = useRef(null);
  const idRef = useRef(null);

  useEffect(() => () => unsubRef.current && unsubRef.current(), []);

  const reset = useCallback(() => {
    if (unsubRef.current) { unsubRef.current(); unsubRef.current = null; }
    idRef.current = null;
    setPhase('idle');
    setEvents([]);
    setSummary(null);
    setItems([]);
    setProgress({ i: 0, n: 0, title: '' });
    setLogin(null);
    setWarns([]);
    setError(null);
    setArtifacts([]);
    setAttach([]);
    setExitCode(null);
    setStartedAt(null);
    setEndedAt(null);
  }, []);

  const handleEvent = useCallback((evt) => {
    setEvents((prev) => [...prev, evt]);
    switch (evt.type) {
      case 'step':
        break;
      case 'login':
        setLogin(evt);
        if (!evt.ok) {
          setError(evt.error);
          setPhase('error');
        }
        break;
      case 'item':
        setItems((prev) => [...prev, evt]);
        break;
      case 'summary':
        setSummary((prev) => ({ ...(prev || {}), [evt.phase]: evt.counts }));
        if (evt.phase === 'precheck') setPhase('ready');
        break;
      case 'progress':
        setProgress({ i: evt.i, n: evt.n, title: evt.title });
        break;
      case 'warn':
        setWarns((prev) => [...prev, evt.text]);
        break;
      case 'error':
        setError(evt.text);
        break;
      case 'artifact':
        setArtifacts((prev) => [...prev, evt]);
        break;
      case 'attach':
        setAttach((prev) => [...prev, evt]);
        break;
      case 'exit':
        setExitCode(evt.code);
        setEndedAt(Date.now());
        setPhase((p) => {
          if (p === 'error') return 'error';
          return 'done';
        });
        break;
      case 'folder':
        break;
      default:
        break;
    }
  }, []);

  const start = useCallback(async (payload, mode) => {
    reset();
    const id = `${payload.taskType}-${mode}-${Date.now().toString(36)}`;
    idRef.current = id;
    setPhase(mode === 'precheck' ? 'prechecking' : 'committing');
    setStartedAt(Date.now());

    unsubRef.current = window.kc.onRunEvent(id, handleEvent);
    const res = await window.kc.startRun({ ...payload, id, mode });
    if (!res.ok) {
      setError(res.error || '启动失败');
      setPhase('error');
    }
    return id;
  }, [handleEvent, reset]);

  const cancel = useCallback(async () => {
    if (idRef.current) await window.kc.cancelRun(idRef.current);
  }, []);

  const busy = phase === 'prechecking' || phase === 'committing';

  return {
    phase, busy, events, summary, items, progress, login, warns, error,
    artifacts, attach, exitCode, startedAt, endedAt,
    start, cancel, reset,
  };
}
