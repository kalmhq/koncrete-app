import { app, BrowserWindow } from "electron";
import installExtension, { REACT_DEVELOPER_TOOLS } from "electron-devtools-installer";
import * as isDev from "electron-is-dev";
import * as path from "path";
import { registerHandlers } from "./bridgeHandlers";
import "./spawn";

if (isDev) {
  // @ts-ignore
  process.env["NODE_TLS_REJECT_UNAUTHORIZED"] = 0;
}

export let mainWindow: BrowserWindow;

async function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 960,
    title: "Koncrete",
    webPreferences: {
      // contextIsolation: false,
      preload: path.join(__dirname, "preload.js"),
    },
  });

  mainWindow = win;

  if (isDev) {
    win.loadURL("http://localhost:3000");
  } else {
    win.loadURL("https://app.koncrete.dev");
  }

  // Hot Reloading
  if (isDev) {
    // 'node_modules/.bin/electronPath'
    require("electron-reload")(__dirname, {
      electron: path.join(
        __dirname,
        "..",
        "node_modules",
        ".bin",
        "electron" + (process.platform === "win32" ? ".cmd" : ""),
      ),
      forceHardReset: true,
      // hardResetMethod: "exit",
    });
  }

  if (isDev) {
    win.webContents.openDevTools();
  }

  win.webContents.on("new-window", function (e, url) {
    e.preventDefault();
    require("electron").shell.openExternal(url);
  });

  registerHandlers();
}

const runApp = () => {
  // before the app is terminated, clear both timers
  app.on("before-quit", () => {});

  app.whenReady().then(() => {
    // DevTools
    installExtension(REACT_DEVELOPER_TOOLS)
      .then((name) => console.log(`Added Extension:  ${name}`))
      .catch((err) => console.log("An error occurred: ", err));

    createWindow();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
      }
    });

    app.on("window-all-closed", () => {
      if (process.platform !== "darwin") {
        app.quit();
      }
    });

    if (isDev) {
      // SSL/TSL: this is the self signed certificate support
      app.on("certificate-error", (event, webContents, url, error, certificate, callback) => {
        // On certificate error we disable default behaviour (stop loading the page)
        // and we then say "it is all fine - true" to the callback
        event.preventDefault();
        callback(true);
      });
    }
  });
};

runApp();
