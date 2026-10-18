'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// The only bridge between the page and the main process
contextBridge.exposeInMainWorld('native', {
  auth: {
    status: () => ipcRenderer.invoke('auth:status'),
    login: () => ipcRenderer.invoke('auth:login'),
    logout: () => ipcRenderer.invoke('auth:logout'),
    setManual: (token, clientId) => ipcRenderer.invoke('auth:setManual', { token, clientId })
  },
  api: (request) => ipcRenderer.invoke('api:request', request),
  json: (url) => ipcRenderer.invoke('net:json', url),
  setTitleBar: (color, symbolColor) => ipcRenderer.invoke('window:titlebar', { color, symbolColor }),
  openExternal: (url) => ipcRenderer.invoke('shell:open', url),
  copy: (text) => ipcRenderer.invoke('clipboard:write', text),
  info: () => ipcRenderer.invoke('app:info')
});
