const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('bridge', {
  onAgents: (fn) => ipcRenderer.on('agents', (_e, list) => fn(list)),
  onConfig: (fn) => ipcRenderer.on('config', (_e, cfg) => fn(cfg)),
  onFocusAgent: (fn) => ipcRenderer.on('focus-agent', (_e, id) => fn(id)),
  setIgnore: (ignore) => ipcRenderer.send('set-ignore', ignore),
  dragStart: () => ipcRenderer.send('drag-start'),
  dragMove: (dx, dy) => ipcRenderer.send('drag-move', dx, dy),
  dragEnd: () => ipcRenderer.send('drag-end'),
  setOption: (key, value) => ipcRenderer.send('set-option', key, value),
  ack: (id) => ipcRenderer.send('ack', id),
  hide: (id) => ipcRenderer.send('hide-agent', id),
  jump: (agent) => ipcRenderer.invoke('jump', agent),
  loadTodos: () => ipcRenderer.invoke('todos-load'),
  saveTodos: (todos) => ipcRenderer.send('todos-save', todos),
  loadRooms: () => ipcRenderer.invoke('rooms-load'),
  saveRooms: (state) => ipcRenderer.send('rooms-save', state),
  github: (cwds, force) => ipcRenderer.invoke('github', cwds, force),
  openUrl: (url) => ipcRenderer.send('open-url', url),
});
