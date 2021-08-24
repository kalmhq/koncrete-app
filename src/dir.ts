import { app } from "electron";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

export const homedir = (() => {
  const home = app.getPath("home");

  if (home.includes("/snap/") && os.platform() === "linux") {
    return path.join("home", os.userInfo().username);
  }

  return home;
})();

const ensureKoncreteDir = () => {
  try {
    fs.mkdirSync(path.join(homedir, ".koncrete"));
  } catch (e) {}

  try {
    fs.mkdirSync(path.join(homedir, ".koncrete", "bin"));
  } catch (e) {}
};

ensureKoncreteDir();

export const kubeconfigPath = process.env.KUBECONFIG || path.join(homedir, ".kube", "config");
export const argocdPath = path.join(homedir, ".koncrete", "bin", "argocd-v2.0.4");
export const privateClusterProxiesFilePath = path.join(homedir, ".koncrete", "privateClusterProxies.dump");
