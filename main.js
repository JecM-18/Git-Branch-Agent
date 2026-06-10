'use strict';

const { app, BrowserWindow, ipcMain, shell } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const ENV_FILE = path.join(__dirname, '.env');

// ─── Window ───────────────────────────────────────────────────────────────────
function createWindow() {
  const win = new BrowserWindow({
    width: 800,
    height: 700,
    minWidth: 640,
    minHeight: 540,
    title: 'Git Branch Agent',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.setMenuBarVisibility(false);
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// ─── .env helpers ─────────────────────────────────────────────────────────────
function parseEnvFile(content) {
  const result = {};
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let val = trimmed.slice(eqIdx + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    result[key] = val;
  }
  return result;
}

function writeEnvFile(settings) {
  const lines = Object.entries(settings)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => `${k}=${v}`);
  fs.writeFileSync(ENV_FILE, lines.join('\n') + '\n', 'utf8');
}

ipcMain.handle('get-settings', () => {
  if (!fs.existsSync(ENV_FILE)) return {};
  return parseEnvFile(fs.readFileSync(ENV_FILE, 'utf8'));
});

ipcMain.handle('save-settings', (_, settings) => {
  writeEnvFile(settings);
});

// ─── Script runner ────────────────────────────────────────────────────────────
function runScript(event, scriptFile, args) {
  return new Promise((resolve, reject) => {
    const scriptPath = path.join(__dirname, 'scripts', scriptFile);
    const proc = spawn('node', [scriptPath, ...args], { cwd: __dirname });

    proc.stdout.on('data', (d) =>
      event.sender.send('output-line', { type: 'stdout', text: d.toString() })
    );
    proc.stderr.on('data', (d) =>
      event.sender.send('output-line', { type: 'stderr', text: d.toString() })
    );
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Process exited with code ${code}`));
    });
    proc.on('error', (err) =>
      reject(new Error(`Could not start Node.js: ${err.message}`))
    );
  });
}

ipcMain.handle('run-create-branch', (event, ticket) =>
  runScript(event, 'create-branch.js', [ticket])
);

ipcMain.handle('run-create-mid-branch', (event, ticket, env) =>
  runScript(event, 'create-mid-branch.js', [ticket, env])
);

ipcMain.handle('run-log-time', (event, ticket, time, dateStr) =>
  runScript(event, 'log-time.js', [ticket, time, dateStr])
);

ipcMain.handle('run-create-pr', (event, input, env, reviewers, useMid) => {
  const args = [input, env, reviewers];
  if (!useMid) args.push('--no-mid');
  return runScript(event, 'create-pr.js', args);
});

ipcMain.handle('run-format-teams-message', (event, ticket) =>
  runScript(event, 'format-teams-message.js', [ticket])
);

ipcMain.handle('run-create-jira-ticket', (event, project, type, title, description, costCenter, assignToMe) => {
  const args = [project, type, title, description || '', costCenter || '', assignToMe ? 'true' : 'false'];
  return runScript(event, 'create-jira-ticket.js', args);
});

ipcMain.handle('open-external', (_, url) => shell.openExternal(url));
