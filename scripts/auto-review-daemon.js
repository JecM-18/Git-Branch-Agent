#!/usr/bin/env node
'use strict';

// Standalone daemon: spawns auto-review-agent.js every 2 minutes and sends
// Windows toast notifications for review results. Runs without Electron.

const { spawn } = require('child_process');
const path = require('path');

const INTERVAL_MS = 2 * 60 * 1000;
const ROOT = path.join(__dirname, '..');
const AGENT = path.join(__dirname, 'auto-review-agent.js');

function log(msg) {
  console.log('[' + new Date().toLocaleTimeString() + '] ' + msg);
}

// Windows toast via PowerShell WinRT API — no extra packages needed
function notify(title, body) {
  const safeTitle = title.replace(/'/g, '').replace(/"/g, '');
  const safeBody  = body.replace(/'/g, '').replace(/"/g, '').slice(0, 200);

  const ps = [
    '[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType=WindowsRuntime] | Out-Null',
    '[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType=WindowsRuntime] | Out-Null',
    '$xml = [Windows.Data.Xml.Dom.XmlDocument]::new()',
    '$xml.LoadXml(\'<toast><visual><binding template="ToastGeneric"><text>' + safeTitle + '</text><text>' + safeBody + '</text></binding></visual></toast>\')',
    '$appId = \'{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe\'',
    '[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($appId).Show([Windows.UI.Notifications.ToastNotification]::new($xml))',
  ].join('; ');

  spawn('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  }).unref();
}

function runCycle() {
  return new Promise((resolve) => {
    const proc = spawn('node', [AGENT], { cwd: ROOT });

    proc.stdout.on('data', (chunk) => {
      for (const line of chunk.toString().split(/\r?\n/).filter(Boolean)) {
        let parsed;
        try { parsed = JSON.parse(line); } catch { continue; }

        if (parsed.type === 'review-result') {
          let title;
          if (parsed.decision === 'APPROVE' && parsed.risk === 'LOW_RISK') {
            title = 'PR Auto-Approved';
          } else if (parsed.decision === 'REQUEST_CHANGES') {
            title = 'PR Has Issues - Not Approved';
          } else {
            title = 'PR Needs Your Review';
          }
          const body = '[' + parsed.repo + '] ' + parsed.title;
          notify(title, body);
          log(title + ': ' + body);
        } else if (parsed.type === 'log') {
          log('[agent] ' + parsed.text);
        } else if (parsed.type === 'error') {
          log('[error] ' + parsed.message);
        }
      }
    });

    proc.stderr.on('data', (d) => log('[stderr] ' + d.toString().trim()));
    proc.on('close', resolve);
    proc.on('error', resolve);
  });
}

async function loop() {
  log('Auto Review Daemon started — polling every 2 minutes. Press Ctrl+C to stop.');
  // eslint-disable-next-line no-constant-condition
  while (true) {
    await runCycle();
    await new Promise((r) => setTimeout(r, INTERVAL_MS));
  }
}

loop();
