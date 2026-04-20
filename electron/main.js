/**
 * Storyboarder — Electron main process.
 *
 * Responsibilities:
 *   1. Pick a free local port.
 *   2. Spawn the Node backend (server/index.js) as a child process, telling it:
 *        - the port it should listen on
 *        - the directory containing the built Vite frontend
 *        - the workspace folder
 *   3. Wait until the backend's /api/health responds.
 *   4. Open a BrowserWindow pointing at http://127.0.0.1:<port>/ (packaged)
 *      or http://127.0.0.1:4173/ (dev, running against `npm run dev:client`).
 *   5. Cleanly terminate the backend on app quit.
 *
 * Design notes:
 *   - We keep the backend as a child process rather than importing it into the
 *     main process. Zero refactor of server/ code; the existing HTTP boundary
 *     becomes the IPC boundary. Crashes in the backend don't take down the UI.
 *   - In dev, set STORYBOARDER_ELECTRON_DEV=1 and the URL points at Vite so
 *     HMR works. Backend still spawned on :3001 (or whatever STORYBOARDER_PORT
 *     is) so vite's /api proxy keeps working.
 *   - Production: backend listens on a random free port. Renderer loads from
 *     that same port, so all relative /api/... fetches keep working.
 */

import { app, BrowserWindow, Menu, shell, dialog } from 'electron';
import pkg from 'electron-updater';
const { autoUpdater } = pkg;
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const IS_DEV = !!process.env.STORYBOARDER_ELECTRON_DEV;

let serverProcess = null;
let mainWindow = null;
let shuttingDown = false;

/** Find a random unused TCP port on 127.0.0.1. */
function pickFreePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.unref();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

/** Poll the backend's /api/health until it replies 200 or we time out. */
async function waitForBackend(port, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (res.ok) return true;
    } catch {
      // Connection refused while booting — keep polling.
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`Backend did not become ready on port ${port} within ${timeoutMs}ms`);
}

/**
 * Resolve the server entry point. In dev we run from the repo root. In a
 * packaged app, electron-builder places server/ inside resources/ (see the
 * extraResources config in build/electron-builder.yml).
 */
function getServerEntry() {
  if (app.isPackaged) {
    // process.resourcesPath -> <app>/Contents/Resources on macOS,
    // <app>/resources on Win/Linux. electron-builder copies 'server/' there.
    return join(process.resourcesPath, 'server', 'index.js');
  }
  return join(__dirname, '..', 'server', 'index.js');
}

/** Resolve the built frontend (vite output). */
function getStaticDir() {
  if (app.isPackaged) {
    return join(process.resourcesPath, 'dist');
  }
  return join(__dirname, '..', 'dist');
}

/** Resolve the default workspace folder — always ~/Storyboarder regardless of mode. */
function getWorkspaceDir() {
  return join(homedir(), 'Storyboarder');
}

async function startBackend() {
  const port = await pickFreePort();
  const entry = getServerEntry();

  // In packaged builds, process.execPath points at the Electron binary and
  // re-invoking it with ELECTRON_RUN_AS_NODE=1 is the supported way to launch
  // a Node child. In dev we can use the system `node`.
  const command = app.isPackaged ? process.execPath : process.execPath; // same for dev — Electron's Node works
  const env = {
    ...process.env,
    STORYBOARDER_PORT: String(port),
    STORYBOARDER_STATIC_DIR: getStaticDir(),
    STORYBOARDER_WORKSPACE: getWorkspaceDir(),
    ELECTRON_RUN_AS_NODE: '1',
  };

  serverProcess = spawn(command, [entry], {
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  serverProcess.stdout.on('data', (buf) => {
    process.stdout.write(`[backend] ${buf}`);
  });
  serverProcess.stderr.on('data', (buf) => {
    process.stderr.write(`[backend] ${buf}`);
  });
  serverProcess.on('exit', (code, signal) => {
    console.log(`[backend] exited code=${code} signal=${signal}`);
    if (!shuttingDown) {
      // Backend died unexpectedly — quit the whole app so the user sees a
      // restart rather than a silently broken window.
      app.quit();
    }
  });

  await waitForBackend(port);
  return port;
}

async function createWindow(port) {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    backgroundColor: '#0b1220',
    title: 'Storyboarder',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  const targetUrl = IS_DEV
    ? 'http://127.0.0.1:4173'  // Vite dev server
    : `http://127.0.0.1:${port}/`;

  await mainWindow.loadURL(targetUrl);

  if (IS_DEV) mainWindow.webContents.openDevTools({ mode: 'detach' });

  // External links open in the user's real browser, not inside the app.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function installAppMenu() {
  const isMac = process.platform === 'darwin';
  const template = [
    ...(isMac
      ? [{
          label: app.name,
          submenu: [
            { role: 'about' },
            { type: 'separator' },
            { role: 'services' },
            { type: 'separator' },
            { role: 'hide' },
            { role: 'hideOthers' },
            { role: 'unhide' },
            { type: 'separator' },
            { role: 'quit' },
          ],
        }]
      : []),
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'Open Storyboarder on GitHub',
          click: () => shell.openExternal('https://github.com/sumanurawat/storyboarder-next'),
        },
        {
          label: 'Show workspace folder',
          click: () => shell.openPath(getWorkspaceDir()),
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/**
 * Auto-update: check on startup, silently download new versions in the
 * background, prompt the user before installing (so we don't interrupt work).
 * Skips entirely in dev mode because there's no packaged app to update.
 * electron-updater resolves the update feed from `publish:` in the
 * electron-builder config (GitHub Releases by default).
 */
function wireAutoUpdater() {
  if (IS_DEV) return;
  if (!app.isPackaged) return;

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('error', (err) => {
    // Don't crash if the update feed is unreachable (first release, network
    // offline, GitHub rate limit, etc.) — just log and continue.
    console.warn('[storyboarder-updater] error:', err?.message || err);
  });

  autoUpdater.on('update-available', (info) => {
    console.log(`[storyboarder-updater] update available: ${info?.version}`);
  });

  autoUpdater.on('update-not-available', () => {
    console.log('[storyboarder-updater] up to date');
  });

  autoUpdater.on('update-downloaded', async (info) => {
    if (!mainWindow) return;
    const res = await dialog.showMessageBox(mainWindow, {
      type: 'info',
      buttons: ['Restart now', 'Later'],
      defaultId: 0,
      cancelId: 1,
      title: 'Update ready',
      message: `Storyboarder ${info?.version} is ready to install.`,
      detail: 'The app will restart to apply the update. Your projects are saved.',
    });
    if (res.response === 0) {
      autoUpdater.quitAndInstall();
    }
  });

  // Kick off the check 3s after launch so the user sees the UI first.
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch((err) => {
      console.warn('[storyboarder-updater] checkForUpdates failed:', err?.message || err);
    });
  }, 3000);
}

app.whenReady().then(async () => {
  try {
    installAppMenu();
    const port = IS_DEV ? 3001 : await startBackend();
    if (IS_DEV) {
      // Dev: user runs `npm run dev:server` separately. We just open the window.
    }
    await createWindow(port);
    wireAutoUpdater();
  } catch (err) {
    console.error('[storyboarder] Failed to start:', err);
    app.quit();
  }

  app.on('activate', async () => {
    // macOS: re-open window if the dock icon is clicked.
    if (!mainWindow) {
      const port = IS_DEV ? 3001 : await startBackend();
      await createWindow(port);
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  shuttingDown = true;
  if (serverProcess && !serverProcess.killed) {
    serverProcess.kill();
  }
});

app.on('will-quit', () => {
  if (serverProcess && !serverProcess.killed) {
    serverProcess.kill();
  }
});
