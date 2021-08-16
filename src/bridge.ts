import { ipcRenderer } from "electron";
import { ArgoCDCliStatus, Bridge, PrivateClusterProxy } from "./types";
import { makeID } from "./utils";

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

  const streamID = makeID(32);

  ipcRenderer.on(streamID, h);

  return ipcRenderer
    .invoke("argocd-cli-install-cluster", server, token, context, streamID)
    .then((res) => {
      return res;
    })
    .finally(() => {
      ipcRenderer.off(streamID, h);
    });
};

const argocdClIInstallProxyCluster = (
  server: string,
  token: string,
  proxyID: string,
  handler: (output: string, fd: number) => void,
) => {
  const h = (event: any, output: string, fd: number) => {
    handler(output, fd);
  };

  const streamID = makeID(32);
  ipcRenderer.on(streamID, h);

  return ipcRenderer
    .invoke("argocd-cli-install-proxy-cluster", server, token, proxyID, streamID)
    .then((res) => {
      return res;
    })
    .finally(() => {
      ipcRenderer.removeListener(streamID, h);
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

const startKubectlProxy = (context: string) => {
  return ipcRenderer.invoke("start-private-cluster-proxy", context);
};

const stopKubectlProxy = (context: string) => {
  return ipcRenderer.invoke("stop-private-cluster-proxy", context);
};

const getKubectlProxyLists = (): Promise<PrivateClusterProxy[]> => {
  return ipcRenderer.invoke("get-private-cluster-proxy-lists");
};

const registerPrivateClusterProxiesWatcher = (handler: (proxies: PrivateClusterProxy[]) => void) => {
  const h = (event: any, lists: PrivateClusterProxy[]) => {
    handler(lists);
  };

  ipcRenderer.on("watch-private-cluster-proxy-lists", h);
  getKubectlProxyLists().then(handler);

  return () => {
    ipcRenderer.removeListener("watch-private-cluster-proxy-lists", h);
  };
};

const registerProxyServerHostnameTemplate = (template: string) => {
  return ipcRenderer.invoke("register-proxy-server-hostname-template", template);
};

export const bridge: Bridge = {
  loadKubeconfig,
  downloadArgocdCLI,
  getArgocdCLIStatus,
  registerArgoCDCLIInstallationStatusHandler,
  argocdClIInstallCluster,
  argocdClIInstallProxyCluster,
  dnsResolve4,
  stopKubectlProxy,
  startKubectlProxy,
  getKubectlProxyLists,
  registerPrivateClusterProxiesWatcher,
  registerProxyServerHostnameTemplate,
};
