const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('scribeStudio', {
  chooseFile: () => ipcRenderer.invoke('dialog:choose-file'),
  chooseOutputDir: () => ipcRenderer.invoke('dialog:choose-output-dir'),
  loadConfig: () => ipcRenderer.invoke('config:load'),
  saveConfig: (config) => ipcRenderer.invoke('config:save', config),
  startTranscribe: (payload) => ipcRenderer.invoke('transcribe:start', payload),
  cancelTranscribe: () => ipcRenderer.invoke('transcribe:cancel'),
  openPath: (targetPath) => ipcRenderer.invoke('path:open', targetPath),
  mediaUrl: (targetPath) => ipcRenderer.invoke('path:media-url', targetPath),
  onLog: (callback) => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on('transcribe:log', listener);
    return () => ipcRenderer.removeListener('transcribe:log', listener);
  },
  onState: (callback) => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on('transcribe:state', listener);
    return () => ipcRenderer.removeListener('transcribe:state', listener);
  },
  onDone: (callback) => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on('transcribe:done', listener);
    return () => ipcRenderer.removeListener('transcribe:done', listener);
  }
});
