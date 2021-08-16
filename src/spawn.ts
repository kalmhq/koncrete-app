import { spawn } from "child_process";
import * as isDev from "electron-is-dev";
import { mainWindow } from ".";
import { argocdPath } from "./const";
import { getKubectlProxyLists } from "./proxy";

// TODO: rename this file

const runArgocd = (args: string[], server: string, token: string, streamID: string): Promise<number | null> => {
  return new Promise((resolve, reject) => {
    const combinedArgs = args.concat(
      isDev
        ? ["--server", server, "--grpc-web", "--insecure", "--auth-token", token]
        : ["--server", server, "--grpc-web", "--auth-token", token],
    );

    const p = spawn(argocdPath, combinedArgs);

    p.stdout.on("data", (data) => {
      mainWindow.webContents.send(streamID, new TextDecoder().decode(data), 1);
    });

    p.stderr.on("data", (data) => {
      mainWindow.webContents.send(streamID, new TextDecoder().decode(data), 2);
    });

    p.on("error", (error) => {
      reject(error);
    });

    p.on("close", (code) => {
      resolve(code);
    });
  });
};

export const argocdInstallCluster = (server: string, token: string, context: string, streamID: string) => {
  return runArgocd(["cluster", "add", context], server, token, streamID);
};

export const argocdInstallProxyCluster = (server: string, token: string, proxyID: string, streamID: string) => {
  const proxies = getKubectlProxyLists();
  const proxy = proxies.find((x) => x.id === proxyID);

  if (!proxy) {
    throw new Error("no such proxy " + proxyID);
  }

  if (!proxy.kubeconfigPath) {
    throw new Error("no proxy kubeconfig " + proxyID);
  }

  return runArgocd(["cluster", "add", proxy.context, "--kubeconfig", proxy.kubeconfigPath!], server, token, streamID);
};
