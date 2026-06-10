'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),

  createBranch: (ticket) => ipcRenderer.invoke('run-create-branch', ticket),
  createMidBranch: (ticket, env) =>
    ipcRenderer.invoke('run-create-mid-branch', ticket, env),
  logTime: (ticket, time, dateStr) =>
    ipcRenderer.invoke('run-log-time', ticket, time, dateStr),

  createPR: (input, env, reviewers) => ipcRenderer.invoke('run-create-pr', input, env, reviewers),

  formatTeamsMessage: (ticket) => ipcRenderer.invoke('run-format-teams-message', ticket),

  createJiraTicket: (project, type, title, description, costCenter, assignToMe) => 
    ipcRenderer.invoke('run-create-jira-ticket', project, type, title, description, costCenter, assignToMe),

  onOutputLine: (callback) =>
    ipcRenderer.on('output-line', (_, data) => callback(data)),

  openExternal: (url) => ipcRenderer.invoke('open-external', url),
});
