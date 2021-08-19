export interface ArgoCDCliStatus {
  status: "installed" | "uninstalled" | "installing" | "loading";
  total: number;
  received: number;
}

export interface KubeConfig {
  apiVersion: string;
  clusters: {
    name: string;
    cluster: {
      server: string;
    };
  }[];
  contexts: {
    name: string;
    context: {
      cluster: string;
      user: string;
    };
  }[];
  "current-context": string;
  users: {
    name: string;
  }[];
}

export interface PrivateClusterProxy {
  id: string;
  context: string;
  server: string;
  kubectlProxyStatus: "Running" | "Stopped";
  kubectlProxyError: string;
  tunnelStatus: "Connected" | "Disconnected";
  kubeconfigPath?: string;
}

export interface ProxyServerSettings {
  hostTemplate: string;
  proxyServerAddress: string;
}

export interface Bridge {
  loadKubeconfig: () => Promise<KubeConfig>;
  downloadArgocdCLI: (version: string) => Promise<any>;
  getArgocdCLIStatus: () => Promise<ArgoCDCliStatus>;
  registerArgoCDCLIInstallationStatusHandler: (handler: (status: ArgoCDCliStatus) => void) => () => void;

  argocdClIInstallProxyCluster: (
    server: string,
    token: string,
    proxyID: string,
    handler: (output: string, fd: number) => void,
  ) => Promise<number>;

  argocdClIInstallCluster: (
    server: string,
    token: string,
    context: string,
    onOutput: (output: string, fd: number) => void,
  ) => Promise<number>;

  getKubectlProxyLists: () => Promise<PrivateClusterProxy[]>;
  registerPrivateClusterProxiesWatcher: (handle: (proxies: PrivateClusterProxy[]) => void) => void;
  startKubectlProxy: (context: string) => void;
  stopKubectlProxy: (context: string) => void;
  registerProxyServerConfig: (config: ProxyServerSettings) => void;

  dnsResolve4: (addr: string) => Promise<any>;
}
