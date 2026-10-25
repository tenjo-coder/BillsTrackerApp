const { app, BrowserWindow, net, protocol, session } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

protocol.registerSchemesAsPrivileged([{
  scheme: 'billwise',
  privileges: {
    standard: true,
    secure: true,
    supportFetchAPI: true,
    stream: true
  }
}]);

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

  app.on('second-instance', () => {
    const window = BrowserWindow.getAllWindows()[0];
    if (window) {
      if (window.isMinimized()) window.restore();
      window.focus();
    }
  });

  app.whenReady().then(async () => {
    await protocol.handle('billwise', request => {
      const url = new URL(request.url);
      if (url.host !== 'app' || !['GET', 'HEAD'].includes(request.method)) {
        return new Response('Not found', { status: 404 });
      }

      const root = app.getAppPath();
      const pathname = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
      const filePath = path.resolve(root, `.${pathname}`);
      const relativePath = path.relative(root, filePath);
      const isInsideApp = relativePath && !relativePath.startsWith('..') && !path.isAbsolute(relativePath);
      if (!isInsideApp) return new Response('Not found', { status: 404 });

      return net.fetch(pathToFileURL(filePath).toString());
    });

    session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));

    const window = new BrowserWindow({
      width: 1320,
      height: 900,
      minWidth: 760,
      minHeight: 620,
      show: false,
      autoHideMenuBar: true,
      backgroundColor: '#f6f8f5',
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    });

    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', (event, target) => {
      try {
        const destination = new URL(target);
        if (destination.protocol !== 'billwise:' || destination.host !== 'app') event.preventDefault();
      } catch {
        event.preventDefault();
      }
    });

    window.once('ready-to-show', () => window.show());
    await window.loadURL('billwise://app/index.html');
  });

  app.on('window-all-closed', () => app.quit());
}
