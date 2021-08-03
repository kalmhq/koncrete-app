import { ipcRenderer } from "electron";
import { ArgoCDCliStatus, Bridge } from "./types";

// Run in render process only
// Do not import any other files except typings files

const loadKubeconfig = () => {
  return ipcRenderer.invoke("load-kubeconfig");
};

const getArgocdCLIStatus = async () => {
  return ipcRenderer.invoke("argocd-cli-status") as Promise<ArgoCDCliStatus>;
};

const downloadArgocdCLI = (version: string): Promise<any> => {
  return ipcRenderer.invoke("download-argocd", version);
};

const argocdClIInstallCluster = (
  server: string,
  token: string,
  context: string,
  handler: (output: string, fd: number) => void,
) => {
  const h = (event: any, output: string, fd: number) => {
    handler(output, fd);
  };

  ipcRenderer.on("argocd-cli-install-cluster-stream", h);

  return ipcRenderer.invoke("argocd-cli-install-cluster", server, token, context).then((res) => {
    ipcRenderer.removeListener("argocd-cli-install-cluster-stream", h);
    return res;
  });
};

const dnsResolve4 = (addr: string) => {
  return ipcRenderer.invoke("dnsResolve4", addr);
};

const registerArgoCDCLIInstallationStatusHandler = (handler: (status: ArgoCDCliStatus) => void) => {
  const h = (event: any, status: ArgoCDCliStatus) => {
    handler(status);
  };

  ipcRenderer.on("argocd-cli-status-watch", h);
  getArgocdCLIStatus().then(handler);

  return () => {
    ipcRenderer.removeListener("argocd-cli-status-watch", h);
  };
};

export const bridge: Bridge = {
  loadKubeconfig,
  downloadArgocdCLI,
  getArgocdCLIStatus,
  registerArgoCDCLIInstallationStatusHandler,
  argocdClIInstallCluster,
  dnsResolve4,
};
