const { app } = require('electron');

const { createMainWindow } = require('./src/window/windowManager');

app.whenReady().then(() => {
    createMainWindow();
});

app.on('window-all-closed', () => {
    app.quit();
});
