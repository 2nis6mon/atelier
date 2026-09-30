import { BrowserWindow, Menu, app, type MenuItemConstructorOptions } from 'electron';
import { IPC, type MenuCommand } from '../../shared/api';

function send(cmd: MenuCommand) {
  return () => BrowserWindow.getFocusedWindow()?.webContents.send(IPC.menu, cmd) ?? BrowserWindow.getAllWindows()[0]?.webContents.send(IPC.menu, cmd);
}

export function buildMenu(): void {
  const mac = process.platform === 'darwin';
  const template: MenuItemConstructorOptions[] = [
    ...(mac
      ? [
          {
            label: 'Atelier',
            submenu: [
              { role: 'about' as const, label: 'About Atelier' },
              { type: 'separator' as const },
              { label: 'Settings…', accelerator: 'Cmd+,', click: send('settings') },
              { type: 'separator' as const },
              { role: 'hide' as const, label: 'Hide Atelier' },
              { role: 'hideOthers' as const },
              { role: 'unhide' as const },
              { type: 'separator' as const },
              { role: 'quit' as const, label: 'Quit Atelier' },
            ],
          },
        ]
      : []),
    {
      label: 'File',
      submenu: [
        { label: 'New CV', accelerator: 'CmdOrCtrl+N', click: send('new-cv') },
        { label: 'New Application…', accelerator: 'CmdOrCtrl+Shift+N', click: send('new-application') },
        { type: 'separator' },
        { label: 'Import CVs…', accelerator: 'CmdOrCtrl+O', click: send('import') },
        { label: 'Export…', accelerator: 'CmdOrCtrl+E', click: send('export') },
        { type: 'separator' },
        { label: 'Back Up Everything…', click: send('backup') },
        { label: 'Restore from Backup…', click: send('restore') },
        ...(mac ? [] : [{ type: 'separator' as const }, { label: 'Settings…', accelerator: 'Ctrl+,', click: send('settings') }, { role: 'quit' as const }]),
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { label: 'Undo', accelerator: 'CmdOrCtrl+Z', click: send('undo') },
        { label: 'Redo', accelerator: 'Shift+CmdOrCtrl+Z', click: send('redo') },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'pasteAndMatchStyle' },
        { role: 'selectAll' },
        { type: 'separator' },
        { label: 'Bold', accelerator: 'CmdOrCtrl+B', click: send('bold') },
        { label: 'Italic', accelerator: 'CmdOrCtrl+I', click: send('italic') },
      ],
    },
    {
      label: 'View',
      submenu: [
        { label: 'Library', accelerator: 'CmdOrCtrl+1', click: send('go-library') },
        { label: 'Applications', accelerator: 'CmdOrCtrl+2', click: send('go-applications') },
        { type: 'separator' },
        { label: 'Content', accelerator: 'CmdOrCtrl+Alt+1', click: send('mode-content') },
        { label: 'Layout', accelerator: 'CmdOrCtrl+Alt+2', click: send('mode-layout') },
        { label: 'Style', accelerator: 'CmdOrCtrl+Alt+3', click: send('mode-style') },
        { label: 'Versions', accelerator: 'CmdOrCtrl+Alt+4', click: send('mode-versions') },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        ...(app.isPackaged ? [] : [{ role: 'toggleDevTools' as const }]),
      ],
    },
    { role: 'windowMenu' },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
