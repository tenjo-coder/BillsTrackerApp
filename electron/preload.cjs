const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('billwiseNotifications', {
  notifyDueBills: notice => ipcRenderer.send('billwise:due-notice', notice)
});