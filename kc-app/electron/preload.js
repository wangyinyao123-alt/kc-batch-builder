const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('kc', {
  pickDir: () => ipcRenderer.invoke('dialog:pick-dir'),
  pickFile: (filters) => ipcRenderer.invoke('dialog:pick-file', filters),
  reveal: (p) => ipcRenderer.invoke('shell:reveal', p),
  readText: (p) => ipcRenderer.invoke('fs:read-text', p),

  startRun: (payload) => ipcRenderer.invoke('run:start', payload),
  cancelRun: (id) => ipcRenderer.invoke('run:cancel', id),

  /** 订阅某次运行的事件流，返回取消订阅函数 */
  onRunEvent: (id, handler) => {
    const ch = `run:event:${id}`;
    const wrapped = (_e, evt) => handler(evt);
    ipcRenderer.on(ch, wrapped);
    return () => ipcRenderer.removeListener(ch, wrapped);
  },
});
