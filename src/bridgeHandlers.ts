import * as dns from "dns";
import { ipcMain } from "electron";
import { promises as fsPromises } from "fs";
import * as YAML from "yaml";
import { argoCDCliStatus, downloadArgoCDCLI, loadArgoCDStatus } from "./download";
import { getKubectlProxyLists, startKubectlProxy, stopKubectlProxy } from "./proxy";
import { useArgocdInstallCluster } from "./spawn";

// Run in main process

export const registerHandlers = () => {
  ipcMain.handle("load-kubeconfig", (event) => {
    const path = process.env.KUBECONFIG || `${process.env.HOME}/.kube/config`;
    return fsPromises
      .readFile(path)
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

  ipcMain.handle("argocd-cli-install-cluster", (event, server: string, token: string, context: string) => {
    return useArgocdInstallCluster(server, token, context);
  });

  ipcMain.handle("start-private-cluster-proxy", (event, context: string) => {
    return startKubectlProxy(context);
  });

  ipcMain.handle("stop-private-cluster-proxy", (event, context: string) => {
    return stopKubectlProxy(context);
  });

  ipcMain.handle("get-private-cluster-proxy-lists", (event) => {
    return getKubectlProxyLists();
  });
};
