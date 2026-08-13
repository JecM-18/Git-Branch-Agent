'use strict';

const { app, BrowserWindow, ipcMain, shell, Notification } = require('electron');
const { spawn } = require('child_process');
const https = require('https');
const path = require('path');
const fs = require('fs');

const ENV_FILE = path.join(__dirname, '.env');

// ─── Time Reminder System ─────────────────────────────────────────────────────
let lastNotificationDate = {
  '12': null,  // Track last notification for 12 PM
  '16': null   // Track last notification for 4 PM
};

function checkTimeReminders() {
  const now = new Date();
  const currentHour = now.getHours();
  const currentDate = now.toDateString();
  
  // Check for 12 PM (12:00)
  if (currentHour === 12 && lastNotificationDate['12'] !== currentDate) {
    showLogTimeReminder('12:00 PM');
    lastNotificationDate['12'] = currentDate;
  }
  
  // Check for 4 PM (16:00)
  if (currentHour === 16 && lastNotificationDate['16'] !== currentDate) {
    showLogTimeReminder('4:00 PM');
    lastNotificationDate['16'] = currentDate;
  }
}

function showLogTimeReminder(time) {
  const notification = new Notification({
    title: '⏰ Time Logging Reminder',
    body: `It's ${time}! Don't forget to log your time in Jira.`,
    urgency: 'normal',
    timeoutType: 'default'
  });
  
  notification.on('click', () => {
    const windows = BrowserWindow.getAllWindows();
    if (windows.length > 0) {
      const win = windows[0];
      if (win.isMinimized()) win.restore();
      win.focus();
      win.webContents.send('show-log-time-tab');
    }
  });
  
  notification.show();
}

// Start checking for time reminders every minute
function startTimeReminderSystem() {
  // Check immediately on startup
  checkTimeReminders();
  
  // Then check every minute
  setInterval(checkTimeReminders, 60000); // 60000ms = 1 minute
}

// ─── Auto Review Agent ────────────────────────────────────────────────────────
let autoReviewInterval = null;
let isReviewRunning = false;
// In-memory queue of review results (max 50, newest first)
const reviewQueue = [];
const MAX_QUEUE_SIZE = 50;

function getEnvSettings() {
  if (!fs.existsSync(ENV_FILE)) return {};
  return parseEnvFile(fs.readFileSync(ENV_FILE, 'utf8'));
}

function showAutoReviewNotification(result) {
  let title, body;

  if (result.decision === 'APPROVE' && result.risk === 'LOW_RISK') {
    title = '✅ PR Auto-Approved';
    body = '[' + result.repo + '] ' + result.title;
  } else if (result.decision === 'REQUEST_CHANGES') {
    title = '❌ PR Has Issues — Not Approved';
    body = '[' + result.repo + '] ' + result.title;
  } else {
    title = '⚠️ PR Ready — Needs Your Review';
    body = '[' + result.repo + '] ' + result.title;
  }

  const notification = new Notification({ title, body, urgency: 'normal', timeoutType: 'default' });

  notification.on('click', () => {
    const windows = BrowserWindow.getAllWindows();
    if (windows.length > 0) {
      const win = windows[0];
      if (win.isMinimized()) win.restore();
      win.focus();
      win.webContents.send('show-auto-review-tab');
    }
    if (result.decision !== 'APPROVE') {
      shell.openExternal(result.url);
    }
  });

  notification.show();
}

// Calls the GitHub API to submit an approval review using built-in https
function submitGitHubApproval(repo, prNumber, summary) {
  return new Promise((resolve, reject) => {
    const env = getEnvSettings();
    const org = env.GITHUB_ORG;
    const pat = env.GITHUB_PAT;
    if (!org || !pat) return reject(new Error('Missing GITHUB_ORG or GITHUB_PAT'));

    const body = JSON.stringify({
      event: 'APPROVE',
      body: '✅ Auto-approved by AI Review Agent.\n\n' + (summary || ''),
    });

    const options = {
      hostname: 'api.github.com',
      path: '/repos/' + org + '/' + repo + '/pulls/' + prNumber + '/reviews',
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + pat,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'User-Agent': 'git-branch-agent',
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) resolve();
        else reject(new Error('GitHub API ' + res.statusCode + ': ' + data));
      });
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function runAutoReviewCycle() {
  if (isReviewRunning) return;
  isReviewRunning = true;

  const scriptPath = path.join(__dirname, 'scripts', 'auto-review-agent.js');
  const proc = spawn('node', [scriptPath], { cwd: __dirname });
  let stderr = '';

  proc.stdout.on('data', async (chunk) => {
    const lines = chunk.toString().split(/\r?\n/).filter(Boolean);
    for (const line of lines) {
      let parsed;
      try { parsed = JSON.parse(line); } catch { continue; }

      if (parsed.type === 'review-result') {
        // Add to queue (newest first)
        reviewQueue.unshift({ ...parsed, reviewedAt: new Date().toISOString() });
        if (reviewQueue.length > MAX_QUEUE_SIZE) reviewQueue.pop();

        // Notify renderer
        BrowserWindow.getAllWindows().forEach((w) =>
          w.webContents.send('auto-review-result', parsed)
        );

        // Auto-approve low-risk clean PRs; notify for everything else
        if (parsed.decision === 'APPROVE' && parsed.risk === 'LOW_RISK') {
          try {
            await submitGitHubApproval(parsed.repo, parsed.prNumber, parsed.summary);
            showAutoReviewNotification(parsed);
          } catch (err) {
            // Approval failed — escalate to human instead
            showAutoReviewNotification({ ...parsed, decision: 'NEEDS_HUMAN' });
          }
        } else {
          showAutoReviewNotification(parsed);
        }

      } else if (parsed.type === 'log') {
        BrowserWindow.getAllWindows().forEach((w) =>
          w.webContents.send('auto-review-log', parsed.text)
        );
      } else if (parsed.type === 'error') {
        BrowserWindow.getAllWindows().forEach((w) =>
          w.webContents.send('auto-review-log', '✗ ' + parsed.message)
        );
      }
    }
  });

  proc.stderr.on('data', (d) => { stderr += d.toString(); });

  proc.on('close', () => { isReviewRunning = false; });
  proc.on('error', () => { isReviewRunning = false; });
}

function startAutoReviewAgent() {
  if (autoReviewInterval) return;
  // Run immediately, then every 2 minutes
  runAutoReviewCycle();
  autoReviewInterval = setInterval(runAutoReviewCycle, 120000);
}

function stopAutoReviewAgent() {
  if (autoReviewInterval) {
    clearInterval(autoReviewInterval);
    autoReviewInterval = null;
  }
}

ipcMain.handle('toggle-auto-review', (_, enabled) => {
  const env = getEnvSettings();
  env.AUTO_REVIEW_ENABLED = enabled ? 'true' : 'false';
  writeEnvFile(env);
  if (enabled) startAutoReviewAgent();
  else stopAutoReviewAgent();
  return { enabled };
});

ipcMain.handle('get-auto-review-status', () => ({
  enabled: !!autoReviewInterval,
  running: isReviewRunning,
  queue: reviewQueue,
}));

ipcMain.handle('run-auto-review-now', () => {
  runAutoReviewCycle();
});


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
  win.maximize();
}

app.whenReady().then(() => {
  createWindow();
  startTimeReminderSystem();
  // Auto-start review agent if previously enabled
  const env = getEnvSettings();
  if (env.AUTO_REVIEW_ENABLED === 'true') {
    startAutoReviewAgent();
  }
});

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

ipcMain.handle('run-review-pr', (event, input, approve) => {
  const args = [input];
  if (approve) args.push('--approve');
  return runScript(event, 'review-pr.js', args);
});

ipcMain.handle('run-evaluate-comments', (event, input) =>
  runScript(event, 'evaluate-pr-comments.js', [input])
);

ipcMain.handle('run-create-release-branch', (event, project, version, env, createPR) => {
  const args = [project, version];
  if (env) args.push(env);
  if (createPR) args.push('--create-pr');
  return runScript(event, 'create-release-branch.js', args);
});

ipcMain.handle('run-format-teams-message', (event, ticket) =>
  runScript(event, 'format-teams-message.js', [ticket])
);

ipcMain.handle('run-create-jira-ticket', (event, project, type, title, description, costCenter, assignToMe) => {
  const args = [project, type, title, description || '', costCenter || '', assignToMe ? 'true' : 'false'];
  return runScript(event, 'create-jira-ticket.js', args);
});

// ─── Change Jira Status (JSON-returning helpers) ──────────────────────────────
function runScriptJSON(scriptFile, args) {
  return new Promise((resolve, reject) => {
    const scriptPath = path.join(__dirname, 'scripts', scriptFile);
    const proc = spawn('node', [scriptPath, ...args], { cwd: __dirname });
    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (d) => { stdout += d.toString(); });
    proc.stderr.on('data', (d) => { stderr += d.toString(); });
    proc.on('close', (code) => {
      if (code === 0) {
        try { resolve(JSON.parse(stdout)); }
        catch { resolve(stdout); }
      } else {
        reject(new Error(stderr.trim() || `Process exited with code ${code}`));
      }
    });
    proc.on('error', (err) => reject(new Error(`Could not start Node.js: ${err.message}`)));
  });
}

ipcMain.handle('jira-list-tickets', () =>
  runScriptJSON('change-jira-status.js', ['list-tickets'])
);

ipcMain.handle('jira-list-transitions', (_, ticketKey) =>
  runScriptJSON('change-jira-status.js', ['list-transitions', ticketKey])
);

ipcMain.handle('run-change-jira-status', (event, ticketKey, transitionId) =>
  runScript(event, 'change-jira-status.js', ['transition', ticketKey, transitionId])
);

ipcMain.handle('open-external', (_, url) => shell.openExternal(url));
