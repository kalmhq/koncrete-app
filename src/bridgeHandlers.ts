import * as dns from "dns";
import { app, ipcMain } from "electron";
import { promises as fsPromises } from "fs";
import * as os from "os";
import * as YAML from "yaml";
import { homedir, kubeconfigPath } from "./dir";
import { argoCDCliStatus, downloadArgoCDCLI, loadArgoCDStatus } from "./download";
import { getKubectlProxyLists, registerProxyServerConfig, startKubectlProxy, stopKubectlProxy } from "./proxy";
import { argocdInstallCluster, argocdInstallProxyCluster } from "./spawn";

// Run in main process

export const registerHandlers = () => {
  ipcMain.handle("load-kubeconfig", (event) => {
    return fsPromises
      .readFile(kubeconfigPath)
      .then((buf) => buf.toString())
      .then((content) => YAML.parse(content));
  });

  ipcMain.handle("dnsResolve4", (event, addr) => {
    return new Promise((resolve, reject) => {
      dns.resolve4(addr, (err, addresses) => {
        if (err) {
          reject(err);
          return;
        }

        resolve(addresses);
      });
    });
  });

  ipcMain.handle("argocd-cli-status", async () => {
    await loadArgoCDStatus();
    return argoCDCliStatus;
  });

  ipcMain.handle("download-argocd", (event, version: string) => {
    return downloadArgoCDCLI(version);
  });

  ipcMain.handle(
    "argocd-cli-install-cluster",
    (event, server: string, token: string, context: string, streamID: string) => {
      return argocdInstallCluster(server, token, context, streamID);
    },
  );

  ipcMain.handle(
    "argocd-cli-install-proxy-cluster",
    (event, server: string, token: string, proxyID: string, streamID) => {
      return argocdInstallProxyCluster(server, token, proxyID, streamID);
    },
  );

  ipcMain.handle("start-private-cluster-proxy", (event, context: string) => {
    return startKubectlProxy(context);
  });

  ipcMain.handle("stop-private-cluster-proxy", (event, context: string) => {
    return stopKubectlProxy(context);
  });

  ipcMain.handle("get-private-cluster-proxy-lists", (event) => {
    return getKubectlProxyLists();
  });

  ipcMain.handle("register-proxy-server-config", (event, config) => {
    return registerProxyServerConfig(config);
  });

  ipcMain.handle("homepathDebug", () => {
    return {
      appGetPath: app.getPath("home"),
      osPaht: os.homedir(),
      HOME: process.env.HOME,
      homedir: homedir,
      userInfo: os.userInfo().homedir,
    };
  });
};
