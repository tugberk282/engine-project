'use strict';

const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('tugberkPlayer', Object.freeze({
    bootstrap: () => ipcRenderer.invoke('player:bootstrap'),
    activateScene: (scenePath) => ipcRenderer.invoke('player:activate-scene', scenePath),
    readJsonAsset: (relativePath) => ipcRenderer.invoke('player:read-json-asset', relativePath),
    readAudioAsset: (relativePath) => ipcRenderer.invoke('player:read-audio-asset', relativePath),
    readImageAsset: (relativePath) => ipcRenderer.invoke('player:read-image-asset', relativePath),
    smokeComplete: (result) => ipcRenderer.invoke('player:smoke-complete', result)
}));
