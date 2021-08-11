import { spawn } from "child_process";
import { app } from "electron";
import * as isDev from "electron-is-dev";
import * as events from "events";
import * as fs from "fs";
import * as httpProxy from "http-proxy";
import * as net from "net";
import { NetConnectOpts } from "net";
import * as reconnectCore from "reconnect-core";
import * as spdy from "spdy";
import * as tls from "tls";
import { ConnectionOptions } from "tls";
import * as waitOn from "wait-on";
import { mainWindow } from ".";
import { privateClusterProxiesFilePath } from "./const";
import { PrivateClusterProxy } from "./types";

interface PrivateClusterProxyServer extends PrivateClusterProxy {
  handler?: events.EventEmitter;
  kubectlProxyPID?: number;
}

const reconnect = reconnectCore((...args: any) => {
  return net.connect.apply(null, args);
});

const reconnectTLS = reconnectCore((...args: any) => {
  var cleartextStream = tls.connect.apply(tls, args);
  if (!isDev) {
    cleartextStream.on("secureConnect", function () {
      if (cleartextStream.authorized) {
        cleartextStream.emit("connect");
      } else {
        cleartextStream.emit("error", cleartextStream.authorizationError);
      }
    });
  }

  return cleartextStream;
});

const makeID = (length: number) => {
  var result = "";
  var characters = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  var charactersLength = characters.length;

  for (var i = 0; i < length; i++) {
    result += characters.charAt(Math.floor(Math.random() * charactersLength));
  }

  return result;
};

export const runKubectlProxy = (id: string, context: string, proxyHandler: events.EventEmitter) => {
  let timmer: NodeJS.Timeout;
  let isStopped = false;

  proxyHandler.on("exit", () => {
    isStopped = true;

    if (timmer) {
      clearTimeout(timmer);
    }
  });

  const run = () => {
    const p = spawn("kubectl", ["proxy", "--context", context, "-p", "30032"]);

    p.stdout.on("data", (data) => {
      console.log("stdout data", data.toString());
      savePrivateClusterProxy({ id, context, kubectlProxyStatus: "Running" });
    });

    p.stderr.on("data", (data) => {
      const msg = data.toString() as string;
      console.log("stderr data", msg);
      savePrivateClusterProxy({ id, context, kubectlProxyError: msg });
    });

    p.on("error", (error) => {
      console.log(context, "kubectl proxy child process gets error. Error: ", error);
      savePrivateClusterProxy({ id, context, kubectlProxyError: error.message });
    });

    p.on("exit", (code) => {
      console.log(context, "kubectl proxy child process exits. Code: ", code);
    });

    p.on("close", (code) => {
      console.log(context, "kubectl proxy child process is closed. Code: ", code);

      if (!isStopped) {
        proxyHandler.off("exit", p.kill);
        timmer = setTimeout(run, 3000);
      }

      savePrivateClusterProxy({ id, context, kubectlProxyStatus: "Stopped" });
    });

    if (p.pid) {
      savePrivateClusterProxy({ id, context, kubectlProxyPID: p.pid });
    }

    proxyHandler.on("exit", p.kill);

    return p;
  };

  run();
};

const proxiesList: PrivateClusterProxyServer[] = [];
const dumpEmitter = new events.EventEmitter();

dumpEmitter.on("dump", () => {
  const data = getSafeSerializedProxyList();
  // console.log("dump", data);
  fs.writeFile(privateClusterProxiesFilePath, JSON.stringify(data), (err) => {
    if (err) {
      console.error(err);
      return;
    }
  });
});

const getSafeSerializedProxyList = (): PrivateClusterProxy[] => {
  return proxiesList.map((x) => {
    return Object.assign({}, x, {
      handler: undefined,
    } as Partial<PrivateClusterProxyServer>);
  });
};

const loadPrivateClusterProxies = () => {
  fs.readFile(privateClusterProxiesFilePath, (err, data) => {
    if (err) {
      console.log(err);
      return;
    }

    try {
      const proxies: PrivateClusterProxyServer[] = JSON.parse(data.toString());

      for (let i = 0; i < proxies.length; i++) {
        const proxy = proxies[i];
        startProxy(proxy.context, proxy.id);
      }
    } catch (e) {
      console.log(e);
      return;
    }
  });
};

loadPrivateClusterProxies();

const removePrivateClusterProxy = (id: string) => {
  const index = proxiesList.findIndex((x) => x.id === id);

  if (index >= 0) {
    console.log("remove", id);
    const proxy = proxiesList[index];
    console.log(proxy.handler);
    proxy.handler && proxy.handler.emit("exit");

    proxiesList.splice(index, 1);

    const data = getSafeSerializedProxyList();
    mainWindow.webContents.send("watch-private-cluster-proxy-lists", data);
    dumpEmitter.emit("dump");
  }
};

const savePrivateClusterProxy = (
  obj: Partial<PrivateClusterProxyServer> & { id: string },
  createWhenMissing?: boolean,
) => {
  const index = proxiesList.findIndex((x) => x.id === obj.id);
  const patchedObj = Object.assign(
    {
      kubectlProxyError: "",
      kubectlProxyStatus: "Stopped",
      koncreteProxyServerConnectionStatus: "Disconnected",
      kubectlProxyConnectionStatus: "Disconnected",
    } as Partial<PrivateClusterProxyServer>,
    proxiesList[index],
    obj,
  );

  if (index >= 0) {
    console.log("save", obj);
    proxiesList[index] = patchedObj;
  } else if (createWhenMissing) {
    console.log("create", obj);
    proxiesList.push(patchedObj);
  }

  const data = getSafeSerializedProxyList();
  mainWindow.webContents.send("watch-private-cluster-proxy-lists", data);
  dumpEmitter.emit("dump");
};

const startProxy = (context: string, _id?: string) => {
  if (!_id) {
    // const id = makeID(32);
    _id = "UzmK356STQuQrgapyn3hAyneli4YQuPk";
  }

  const id = _id;
  const proxyHandler = new events.EventEmitter();

  app.on("before-quit", () => {
    proxyHandler.emit("exit");
  });

  // Clear conflict
  removePrivateClusterProxy(id);
  savePrivateClusterProxy({ id, context, handler: proxyHandler }, true);

  // runKubectlProxy(id, context, proxyHandler);
  savePrivateClusterProxy({ id, context }, true);

  const pipeEmitter = new events.EventEmitter();

  const connectKubectlProxy = () => {
    const reconnectOptions: reconnectCore.ModuleOptions<net.Socket> = {
      initialDelay: 1e3,
      maxDelay: 30e3,
      strategy: "fibonacci",
      failAfter: Infinity,
      randomisationFactor: 0,
      immediate: false,
    };

    const con = reconnect(reconnectOptions)
      .on("connect", (con) => {
        console.log("kubectl proxy socket connected");

        pipeEmitter.removeAllListeners("data-from-koncrete");
        pipeEmitter.on("data-from-koncrete", (data) => {
          con.write(data);
        });

        con.on("data", (data) => {
          console.log(data.toString());
          pipeEmitter.emit("data-from-kubectl", data);
        });

        con.on("end", () => console.log("end !!!!!!!!!!!!!!!!"));

        savePrivateClusterProxy({ id, context, kubectlProxyConnectionStatus: "Connected" });
      })
      .on("error", (err) => {
        console.log("kubectl error", err);
      })
      .on("disconnect", (err) => {
        savePrivateClusterProxy({ id, context, kubectlProxyConnectionStatus: "Disconnected" });
      })
      .connect({
        port: 30033,
        host: "localhost",
      } as NetConnectOpts);

    const con1 = reconnectTLS(reconnectOptions)
      .on("connect", (con) => {
        console.log("Koncrete proxy socket connected");

        const buffer = Buffer.alloc(32);
        buffer.write(id, "utf-8");
        con.write(buffer);

        pipeEmitter.removeAllListeners("data-from-kubectl");
        pipeEmitter.on("data-from-kubectl", (data) => {
          con.write(data);
        });
        con.on("end", () => console.log("end !!!!!!!!!!!!!!!!"));

        con.on("data", (data) => {
          pipeEmitter.emit("data-from-koncrete", data);
        });

        savePrivateClusterProxy({ id, context, koncreteProxyServerConnectionStatus: "Connected" });
      })
      .on("error", (err) => {
        console.log("Koncrete proxy ERROR", err);
      })
      .on("disconnect", (err) => {
        savePrivateClusterProxy({ id, context, koncreteProxyServerConnectionStatus: "Disconnected" });
      })
      .connect({
        port: 3333,
        host: "localhost",
        rejectUnauthorized: false,
      } as ConnectionOptions);

    proxyHandler.on("exit", () => con.disconnect());
    proxyHandler.on("exit", () => con1.disconnect());
  };

  var server = spdy.createServer(
    {
      spdy: { plain: true, protocols: ["h2"] },
    },
    (req, res) => {
      const proxy = httpProxy.createProxyServer({ target: "http://localhost:30032" });
      proxy.web(req, res);
    },
  );

  server.listen(30033);

  proxyHandler.on("exit", () => {
    // proxy.close();
    server.close();
  });

  waitOn({
    resources: ["http://127.0.0.1:30032", "tcp:127.0.0.1:30033"],
    validateStatus: function (status) {
      return status >= 200 && status < 300;
    },
  }).then(connectKubectlProxy);
};

export const getKubectlProxyLists = (): PrivateClusterProxy[] => {
  return getSafeSerializedProxyList();
};

export const startKubectlProxy = (context: string) => {
  return startProxy(context);
};

export const stopKubectlProxy = (id: string) => {
  return removePrivateClusterProxy(id);
};
