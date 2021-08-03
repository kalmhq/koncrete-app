import { spawn } from "child_process";
import * as isDev from "electron-is-dev";
import { mainWindow } from ".";
import { argocdPath } from "./const";

// TODO: rename this file

const runArgocd = (args: string[], server: string, token: string): Promise<number | null> => {
  return new Promise((resolve, reject) => {
    const combinedArgs = args.concat(
      isDev
        ? ["--server", server, "--grpc-web", "--insecure", "--auth-token", token]
        : ["--server", server, "--grpc-web", "--auth-token", token],
    );

    const p = spawn(argocdPath, combinedArgs);

    p.stdout.on("data", (data) => {
      mainWindow.webContents.send("argocd-cli-install-cluster-stream", new TextDecoder().decode(data), 1);
    });

    p.stderr.on("data", (data) => {
      mainWindow.webContents.send("argocd-cli-install-cluster-stream", new TextDecoder().decode(data), 2);
    });

    p.on("error", (error) => {
      reject(error);
    });

    p.on("close", (code) => {
      resolve(code);
    });
  });
};

export const useArgocdInstallCluster = (server: string, token: string, context: string) => {
  return runArgocd(["cluster", "add", context], server, token);
};
