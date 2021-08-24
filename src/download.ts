const { https: hs } = require("follow-redirects");
import * as crypto from "crypto";
import * as fs from "fs";
import { access } from "fs";
import * as https from "https";
import * as os from "os";
import { throttle } from "throttle-debounce";
import { mainWindow } from ".";
import { argocdPath } from "./dir";
import "./proxy";
import { ArgoCDCliStatus } from "./types";

const checksums = {
  "v2.0.4": {
    darwin: "0a35e08e820be4224742d81c17bc4748",
    linux: "554eedf86bcd28c5f6690753259f5ff4",
    windows: "074b457df20c4172d65a9f08952db989",
  },
};

export const argoCDCliStatus: ArgoCDCliStatus = {
  status: "loading",
  total: 0,
  received: 0,
};

const setArgoCDCliStatus = (status: ArgoCDCliStatus["status"], received: number, total: number) => {
  argoCDCliStatus.status = status;
  argoCDCliStatus.total = total;
  argoCDCliStatus.received = received;

  if (!mainWindow) {
    return;
  }

  if (received < total) {
    mainWindow.setProgressBar(received / total);
  } else {
    mainWindow.setProgressBar(-1);
  }

  mainWindow.webContents.send("argocd-cli-status-watch", argoCDCliStatus);
};

export const loadArgoCDStatus = () => {
  if (argoCDCliStatus.status === "installing") {
    return argoCDCliStatus;
  }
  return new Promise((resolve) =>
    access(argocdPath, 7, (err) => {
      if (err) {
        setArgoCDCliStatus("uninstalled", 0, 0);
      } else {
        fs.readFile(argocdPath, function (err, data) {
          var checksum = crypto.createHash("md5").update(data).digest("hex");

          const platform = os.platform();
          let _platform: string;

          if (platform === "win32" || platform === "cygwin") {
            _platform = "windows";
          } else if (platform === "darwin") {
            _platform = "darwin";
          } else {
            _platform = "linux";
          }

          if (checksum !== checksums["v2.0.4"][_platform as keyof typeof checksums["v2.0.4"]]) {
            setArgoCDCliStatus("uninstalled", 0, 0);
          } else {
            setArgoCDCliStatus("installed", 0, 0);
          }

          resolve(void 0);
        });
      }
    }),
  );
};

loadArgoCDStatus();

export const downloadFile = ({ url: remoteFile, path: localFile }: { url: string; path: string }) => {
  return new Promise(function (resolve, reject) {
    (hs as typeof https).get(remoteFile).on("response", (res) => {
      const file = fs.createWriteStream(localFile);

      const len = parseInt(res.headers["content-length"] as string, 10);
      let downloaded = 0;

      const setStatusWithThrottle = throttle(100, true, setArgoCDCliStatus);

      res
        .on("data", (chunk) => {
          file.write(chunk);
          downloaded += chunk.length;
          setStatusWithThrottle(argoCDCliStatus.status, downloaded, len);
        })
        .on("end", function () {
          file.end();
          fs.chmod(localFile, 0o755, console.log);
          setArgoCDCliStatus("installed", 0, 0);
          resolve(true);
        })
        .on("error", function (err) {
          setArgoCDCliStatus("uninstalled", 0, 0);
          reject(err);
        });
    });
  });
};

export const downloadArgoCDCLI = (version: string = "v2.0.4") => {
  if (argoCDCliStatus.status === "installing") {
    throw "Can't install when the previous installing is not finished";
  }

  const arch = os.arch();
  const platform = os.platform();

  let _platform: string;

  if (arch !== "x64") {
    throw "only amd64 arch is support";
  }

  if (platform === "win32" || platform === "cygwin") {
    _platform = "windows";
  } else if (platform === "darwin") {
    _platform = "darwin";
  } else {
    _platform = "linux";
  }

  const url = `https://github.com/argoproj/argo-cd/releases/download/${version}/argocd-${_platform}-amd64${
    _platform === "windows" ? ".exe" : ""
  }`;

  setArgoCDCliStatus("installing", 0, 1);

  return downloadFile({ url, path: argocdPath });
};
