const { app, BrowserWindow, net, protocol, session, Notification, ipcMain, Tray, Menu, nativeImage, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const APP_USER_MODEL_ID = 'com.billwise.desktop';
const TOAST_ACTIVATOR_CLSID = '{C72B7025-4F3E-4D76-9BD7-61D3A17A8A08}';
const REMINDER_AGENT_SWITCH = '--reminder-agent';
const launchedAsReminderAgent = process.argv.includes(REMINDER_AGENT_SWITCH);
let mainWindow = null;
let tray = null;
let isQuitting = false;

app.setAppUserModelId(APP_USER_MODEL_ID);
app.setToastActivatorCLSID(TOAST_ACTIVATOR_CLSID);
protocol.registerSchemesAsPrivileged([{
  scheme: 'billwise',
  privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true }
}]);

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  if (!mainWindow.isVisible()) mainWindow.show();
  mainWindow.focus();
}

function createTray() {
  const icon = nativeImage.createFromBuffer(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAQUlEQVR42mNgoDZQszX4jw9TpBmvIcRqxmoILkXIAK8huDQT7QqauIAY1xDtArK8MHjCgCgvUJyQqJKUqZKZyAEAM74yXsIqNMsAAAAASUVORK5CYII=', 'base64'));
  tray = new Tray(icon);
  tray.setToolTip('Billwise reminders are on');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open Billwise', click: showMainWindow },
    { type: 'separator' },
    { label: 'Quit Billwise', click: () => { isQuitting = true; app.quit(); } }
  ]));
  tray.on('click', showMainWindow);
  tray.on('double-click', showMainWindow);
}

ipcMain.on('billwise:due-notice', (event, notice) => {
  if (!mainWindow || event.sender !== mainWindow.webContents) return;
  if (mainWindow.isVisible() && !mainWindow.isMinimized()) return;
  if (!Notification.isSupported()) return;
  const names = Array.isArray(notice?.names) ? notice.names.map(String).filter(Boolean) : [];
  if (!names.length) return;
  const listed = names.length <= 3 ? names.join(', ') : `${names.slice(0, 3).join(', ')} and ${names.length - 3} more`;
  const notification = new Notification({
    title: names.length === 1 ? 'Bill due today' : `${names.length} bills due today`,
    body: listed
  });
  notification.on('click', showMainWindow);
  notification.show();
});

const hasSingleInstance = app.requestSingleInstanceLock();
if (!hasSingleInstance) {
  app.quit();
} else {
  const legacyUserData = path.join(app.getPath('appData'), 'Billwise');
  const portableDirectory = process.env.PORTABLE_EXECUTABLE_DIR;
  if (portableDirectory) {
    const portableUserData = path.join(portableDirectory, 'BillwiseData');
    if (!fs.existsSync(portableUserData) && fs.existsSync(legacyUserData)) {
      fs.cpSync(legacyUserData, portableUserData, { recursive: true, errorOnExist: true });
    }
    app.setPath('userData', portableUserData);
  } else {
    app.setPath('userData', legacyUserData);
  }

  app.on('second-instance', (_event, commandLine) => {
    if (commandLine.includes(REMINDER_AGENT_SWITCH)) return;
    showMainWindow();
  });
  app.on('before-quit', () => { isQuitting = true; if (tray) tray.destroy(); });

  app.whenReady().then(async () => {
    if (process.platform === 'win32') {
      if (app.isPackaged) {
        app.setLoginItemSettings({
          openAtLogin: true,
          path: process.execPath,
          args: [REMINDER_AGENT_SWITCH],
          name: 'Billwise Reminder Agent',
          enabled: true
        });
      }
      const programs = path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs');
      fs.mkdirSync(programs, { recursive: true });
      const shortcut = path.join(programs, 'Billwise.lnk');
      const shortcutDetails = {
        target: process.execPath,
        cwd: path.dirname(process.execPath),
        description: 'Billwise monthly bill tracker',
        appUserModelId: APP_USER_MODEL_ID,
        toastActivatorClsid: TOAST_ACTIVATOR_CLSID
      };
      shell.writeShortcutLink(shortcut, fs.existsSync(shortcut) ? 'update' : 'create', shortcutDetails);
    }

    await protocol.handle('billwise', request => {
      const url = new URL(request.url);
      if (url.host !== 'app' || !['GET', 'HEAD'].includes(request.method)) return new Response('Not found', { status: 404 });
      const root = app.getAppPath();
      const pathname = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
      const filePath = path.resolve(root, `.${pathname}`);
      const relativePath = path.relative(root, filePath);
      const isInsideApp = relativePath && !relativePath.startsWith('..') && !path.isAbsolute(relativePath);
      if (!isInsideApp) return new Response('Not found', { status: 404 });
      return net.fetch(pathToFileURL(filePath).toString());
    });

    session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
    createTray();
    mainWindow = new BrowserWindow({
      width: 1320,
      height: 900,
      minWidth: 760,
      minHeight: 620,
      show: false,
      autoHideMenuBar: true,
      backgroundColor: '#f6f8f5',
      webPreferences: {
        preload: path.join(__dirname, 'preload.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    });

    mainWindow.on('close', event => {
      if (isQuitting) return;
      event.preventDefault();
      mainWindow.hide();
    });
    mainWindow.on('closed', () => { mainWindow = null; });
    mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    mainWindow.webContents.on('will-navigate', (event, target) => {
      try {
        const destination = new URL(target);
        if (destination.protocol !== 'billwise:' || destination.host !== 'app') event.preventDefault();
      } catch {
        event.preventDefault();
      }
    });
    mainWindow.once('ready-to-show', () => { if (!launchedAsReminderAgent) showMainWindow(); });
    await mainWindow.loadURL('billwise://app/index.html');

    setInterval(() => {
      if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isLoading()) return;
      mainWindow.webContents.executeJavaScript('if (typeof checkDueNotices === "function") checkDueNotices()').catch(error => console.warn('Could not check bill due dates.', error));
    }, 60_000);
  });

  app.on('window-all-closed', () => {});
}