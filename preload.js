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

  createPR: (input, env, reviewers, useMid) => ipcRenderer.invoke('run-create-pr', input, env, reviewers, useMid),

  reviewPR: (input, approve) => ipcRenderer.invoke('run-review-pr', input, approve),

  evaluateComments: (input) => ipcRenderer.invoke('run-evaluate-comments', input),

  createReleaseBranch: (project, version, env, createPR) => 
    ipcRenderer.invoke('run-create-release-branch', project, version, env, createPR),

  formatTeamsMessage: (ticket) => ipcRenderer.invoke('run-format-teams-message', ticket),

  createJiraTicket: (project, type, title, description, costCenter, assignToMe) => 
    ipcRenderer.invoke('run-create-jira-ticket', project, type, title, description, costCenter, assignToMe),

  listJiraTickets: () => ipcRenderer.invoke('jira-list-tickets'),
  listJiraTransitions: (ticketKey) => ipcRenderer.invoke('jira-list-transitions', ticketKey),
  changeJiraStatus: (ticketKey, transitionId) => ipcRenderer.invoke('run-change-jira-status', ticketKey, transitionId),

  onOutputLine: (callback) =>
    ipcRenderer.on('output-line', (_, data) => callback(data)),

  onShowLogTimeTab: (callback) =>
    ipcRenderer.on('show-log-time-tab', () => callback()),

  toggleAutoReview: (enabled) => ipcRenderer.invoke('toggle-auto-review', enabled),
  getAutoReviewStatus: () => ipcRenderer.invoke('get-auto-review-status'),
  runAutoReviewNow: () => ipcRenderer.invoke('run-auto-review-now'),

  onAutoReviewResult: (callback) =>
    ipcRenderer.on('auto-review-result', (_, data) => callback(data)),
  onAutoReviewLog: (callback) =>
    ipcRenderer.on('auto-review-log', (_, text) => callback(text)),
  onShowAutoReviewTab: (callback) =>
    ipcRenderer.on('show-auto-review-tab', () => callback()),

  openExternal: (url) => ipcRenderer.invoke('open-external', url),
});
