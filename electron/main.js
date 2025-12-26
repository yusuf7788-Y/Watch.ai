const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const waitOn = require('wait-on');

let mainWindow;
let serverProcess;

const isDev = !app.isPackaged;
const PORT = 3001;
const CLIENT_PORT = 5173;

function startServer(folderPath) {
    if (serverProcess) {
        serverProcess.kill();
    }

    const serverPath = path.join(__dirname, '../server/index.js');
    const cwd = folderPath || path.join(__dirname, '../server');
    // Pass folderPath as argument to server
    const args = folderPath ? [serverPath, folderPath] : [serverPath];

    serverProcess = spawn('node', args, {
        stdio: 'pipe', // Pipe instead of inherit to avoid console windows/flashing
        cwd: path.join(__dirname, '../server'),
        env: { ...process.env, PORT: PORT }
    });

    serverProcess.stdout.on('data', (data) => console.log(`Server: ${data}`));
    serverProcess.stderr.on('data', (data) => console.error(`Server Error: ${data}`));

    serverProcess.on('close', (code) => {
        console.log(`Server process exited with code ${code}`);
    });
}

async function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1280,
        height: 800,
        frame: false, // Custom frame for "Premium" feel
        backgroundColor: '#0f0f0f',
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false, // For simple MVP; consider preload for security later
        }
    });

    const url = isDev
        ? `http://localhost:${CLIENT_PORT}`
        : `file://${path.join(__dirname, '../client/dist/index.html')}`;

    if (isDev) {
        // Wait for Vite
        try {
            await waitOn({ resources: [`http://localhost:${CLIENT_PORT}`] });
        } catch (e) {
            console.error('Error waiting for frontend:', e);
        }
    }

    // Wait for Backend
    try {
        await waitOn({ resources: [`http://localhost:${PORT}/api/files`] });
    } catch (e) {
        console.error('Error waiting for backend:', e);
    }

    mainWindow.loadURL(url);

    mainWindow.on('closed', function () {
        mainWindow = null;
    });
}

// IPC Handlers
ipcMain.handle('dialog:openFolder', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
        properties: ['openDirectory']
    });
    if (canceled) {
        return null;
    } else {
        return filePaths[0];
    }
});

ipcMain.on('app:restartServer', (event, folderPath) => {
    console.log('Restarting server for:', folderPath);
    startServer(folderPath);
    // Wait a bit for server to release port and start
    setTimeout(() => {
        mainWindow.reload();
    }, 1000);
});

ipcMain.on('window:minimize', () => mainWindow.minimize());
ipcMain.on('window:maximize', () => {
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
});
ipcMain.on('window:close', () => mainWindow.close());

app.on('ready', () => {
    startServer();
    createWindow();
});

app.on('window-all-closed', function () {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('activate', function () {
    if (mainWindow === null) {
        createWindow();
    }
});

app.on('will-quit', () => {
    if (serverProcess) {
        serverProcess.kill();
    }
});
