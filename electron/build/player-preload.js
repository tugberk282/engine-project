'use strict';

const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('tugberkPlayer', Object.freeze({
    bootstrap: () => ipcRenderer.invoke('player:bootstrap'),
    smokeComplete: (result) => ipcRenderer.invoke('player:smoke-complete', result)
}));
