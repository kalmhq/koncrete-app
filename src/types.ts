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

export interface Bridge {
  loadKubeconfig: () => Promise<KubeConfig>;

  downloadArgocdCLI: (version: string) => Promise<any>;

  getArgocdCLIStatus: () => Promise<ArgoCDCliStatus>;

  registerArgoCDCLIInstallationStatusHandler: (handler: (status: ArgoCDCliStatus) => void) => () => void;

  argocdClIInstallCluster: (
    server: string,
    token: string,
    context: string,
    onOutput: (output: string, fd: number) => void,
  ) => Promise<number>;

  dnsResolve4: (addr: string) => Promise<any>;
}

declare global {
  interface Window {
    electron?: Bridge;
    "koncrete-envs": { [key: string]: string };
    heap: any;
  }
}
