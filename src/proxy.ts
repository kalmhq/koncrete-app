import { spawn } from "child_process";
import debug from "debug";
import { app } from "electron";
import * as isDev from "electron-is-dev";
import * as events from "events";
import * as fs from "fs";
import * as http from "http";
import { RequestOptions } from "http";
import * as http2 from "http2";
import * as net from "net";
import { NetConnectOpts } from "net";
import * as reconnectCore from "reconnect-core";
import * as tls from "tls";
import { ConnectionOptions } from "tls";
import * as tmp from "tmp";
import * as waitOn from "wait-on";
import { mainWindow } from ".";
import { privateClusterProxiesFilePath } from "./const";
import { PrivateClusterProxy } from "./types";
import { makeID } from "./utils";

const dumpLogger = debug("koncrete:proxy:dump");
const logger = debug("koncrete:proxy");

let proxyHostnameTemplate: string;

const getProxyClusterKubeconfigContent = (name: string, id: string) => {
  if (!proxyHostnameTemplate) {
    throw new Error("proxyHostnameTemplate is not set.");
  }

  return `apiVersion: v1
clusters:
- cluster:
    server: ${proxyHostnameTemplate.replace("{{ID}}", id)}
  name: ${name}
contexts:
- context:
    cluster: ${name}
    namespace: default
  name: ${name}
current-context: ${name}
`;
};

interface PrivateClusterProxyServer extends PrivateClusterProxy {
  handler?: events.EventEmitter;
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

export const runKubectlProxy = (context: string, proxyHandler: events.EventEmitter) => {
  let timmer: NodeJS.Timeout;
  let isStopped = false;

  proxyHandler.on("exit", () => {
    isStopped = true;

    if (timmer) {
      clearTimeout(timmer);
    }
  });

  const run = () => {
    const p = spawn("kubectl", ["proxy", "--context", context, "-p", "0"]);

    let output: string = "";
    let port: number;

    p.stdout.on("data", (data) => {
      if (!port) {
        // Extract port from output
        output = output + data.toString();
        const match = output.match(/^Starting.*:(\d+)\s?/);

        if (match && match[1]) {
          port = parseInt(match[1], 10);
          logger("get kubectl port", port);
          proxyHandler.emit("kubectl-port", port);
        }
      }

      proxyHandler.emit("save", { kubectlProxyStatus: "Running" });
    });

    p.stderr.on("data", (data) => {
      const msg = data.toString() as string;
      logger("stderr data", msg);
      proxyHandler.emit("save", { kubectlProxyError: msg });
    });

    p.on("error", (error) => {
      logger(context, "kubectl proxy child process gets error. Error: ", error);
      proxyHandler.emit("save", { kubectlProxyError: error.message });
    });

    p.on("exit", (code) => {
      logger(context, "kubectl proxy child process exits. Code: ", code);
    });

    p.on("close", (code) => {
      logger(context, "kubectl proxy child process is closed. Code: ", code);

      if (!isStopped) {
        proxyHandler.off("exit", p.kill);
        timmer = setTimeout(run, 3000);
      }

      proxyHandler.emit("save", { kubectlProxyStatus: "Stopped" });
    });

    proxyHandler.on("exit", () => {
      p.kill();
    });

    return p;
  };

  run();
};

const proxiesList: PrivateClusterProxyServer[] = [];
const dumpEmitter = new events.EventEmitter();

// Enqueue
dumpEmitter.on("dump", (data) => {
  const tmpName = privateClusterProxiesFilePath + ".tmp";

  try {
    fs.writeFileSync(tmpName, JSON.stringify(data));
    fs.renameSync(tmpName, privateClusterProxiesFilePath);
  } catch (err) {
    dumpLogger(err);
  }
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
      dumpLogger(err);
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
      // if (e instanceof SyntaxError) return;
      dumpLogger(e);
    }
  });
};

const removePrivateClusterProxy = (id: string) => {
  const index = proxiesList.findIndex((x) => x.id === id);

  if (index >= 0) {
    dumpLogger("remove", id);
    const proxy = proxiesList[index];
    dumpLogger(proxy.handler);
    proxy.handler && proxy.handler.emit("exit");

    proxiesList.splice(index, 1);

    const data = getSafeSerializedProxyList();
    mainWindow.webContents.send("watch-private-cluster-proxy-lists", data);
    dumpEmitter.emit("dump", data);
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
      tunnelStatus: "Disconnected",
    } as Partial<PrivateClusterProxyServer>,
    proxiesList[index],
    obj,
  );

  if (index >= 0) {
    dumpLogger("save", obj);
    proxiesList[index] = patchedObj;
  } else if (createWhenMissing) {
    dumpLogger("create", obj);
    proxiesList.push(patchedObj);
  }

  const data = getSafeSerializedProxyList();
  mainWindow.webContents.send("watch-private-cluster-proxy-lists", data);
  dumpEmitter.emit("dump", data);
};

const startProxy = (context: string, _id?: string) => {
  const id = _id || makeID(32);

  let h2Port: number;
  let kubectlProxyPort: number;

  // event bus of this proxy
  const proxyHandler = new events.EventEmitter();

  proxyHandler.on("save", (obj: Partial<PrivateClusterProxyServer>) => {
    savePrivateClusterProxy({ id, context, ...obj });
  });

  app.on("before-quit", () => {
    proxyHandler.emit("exit");
  });

  const tmpobj = tmp.fileSync();

  fs.writeFileSync(tmpobj.name, getProxyClusterKubeconfigContent(context, id));
  logger("proxy cluster kubeconfig path", tmpobj.name);

  proxyHandler.on("exit", () => {
    tmpobj.removeCallback();
  });

  // Clear conflict
  savePrivateClusterProxy({ id, context, handler: proxyHandler, kubeconfigPath: tmpobj.name }, true);

  runKubectlProxy(context, proxyHandler);

  const connectTunnel = () => {
    const reconnectOptions: reconnectCore.ModuleOptions<net.Socket> = {
      initialDelay: 1e3,
      maxDelay: 30e3,
      strategy: "fibonacci",
      failAfter: Infinity,
      randomisationFactor: 0,
      immediate: false,
    };

    let conn1: reconnectCore.Instance<any, net.Socket>;

    const pipeEmitter = new events.EventEmitter();

    const conn2 = reconnectTLS(reconnectOptions)
      .on("reconnect", (n, delay) => {})
      .on("connect", (con) => {
        conn1 = reconnect(reconnectOptions)
          .on("connect", (con) => {
            logger("Tunnel first part connected");
            pipeEmitter.on("data-from-koncrete", (data) => {
              con.write(data);
            });
            con.on("data", (data) => {
              pipeEmitter.emit("data-from-kubectl", data);
            });
          })
          .on("error", (err) => {
            pipeEmitter.removeAllListeners("data-from-koncrete");
          })
          .on("disconnect", (err) => {
            pipeEmitter.removeAllListeners("data-from-koncrete");
          })
          .connect({
            port: h2Port,
            host: "localhost",
          } as NetConnectOpts);

        logger("Tunnel second part connected");

        const buffer = Buffer.alloc(32);
        buffer.write(id, "utf-8");
        con.write(buffer);

        pipeEmitter.on("data-from-kubectl", (data) => {
          con.write(data);
        });

        con.on("data", (data) => {
          pipeEmitter.emit("data-from-koncrete", data);
        });

        proxyHandler.emit("save", { tunnelStatus: "Connected" });
      })
      .on("error", (err) => {
        pipeEmitter.removeAllListeners("data-from-kubectl");
        conn1.disconnect();
      })
      .on("disconnect", (err) => {
        pipeEmitter.removeAllListeners("data-from-kubectl");
        conn1.disconnect();
        proxyHandler.emit("save", { tunnelStatus: "Disconnected" });
      })
      .connect({
        port: 3333,
        host: "localhost",
        rejectUnauthorized: false,
      } as ConnectionOptions);

    proxyHandler.on("exit", () => conn2.disconnect());
  };

  const server = http2
    .createServer({}, (h2req, h2res) => {
      const headers: http.OutgoingHttpHeaders = {};

      Object.keys(h2req.headers).forEach((key) => {
        if (key.startsWith(":")) {
          return;
        }

        const value = h2req.headers[key];
        headers[key] = value;
      });

      const options: RequestOptions = {
        hostname: "localhost",
        port: kubectlProxyPort,
        method: h2req.method,
        path: h2req.url,
        headers,
      };

      const req = http.request(options, (res) => {
        const headers = Object.assign({}, res.headers);

        // Hop-by-hop headers. These are removed when sent to the backend.
        // http://www.w3.org/Protocols/rfc2616/rfc2616-sec13.html
        delete headers["transfer-encoding"];
        delete headers["connection"];
        delete headers["keep-alive"];
        delete headers["upgrade"];
        delete headers["proxy-authenticate"];
        delete headers["proxy-authorization"];
        delete headers["te"];
        delete headers["trailer"];
        h2res.writeHead(res.statusCode!, headers);

        res.pipe(h2res);
        // res.on("data", (data) => {
        // h2res.write(data);
        // });

        res.on("end", () => {
          h2res.end();
        });
      });

      req.on("error", (error) => {
        h2res.destroy();
      });

      h2req.pipe(req);

      h2req.on("end", () => {
        req.end();
      });
    })
    .on("sessionError", (err) => {
      logger("error", err);
    })
    .listen(0);

  proxyHandler.on("exit", () => {
    server.close();
  });

  h2Port = (server.address() as net.AddressInfo).port;

  proxyHandler.on("kubectl-port", (port) => {
    kubectlProxyPort = port;
  });

  // when kubectl is ready for the first time, start the tunnel
  proxyHandler.once("kubectl-port", (port) => {
    waitOn({
      resources: ["http://127.0.0.1:" + port, "tcp:127.0.0.1:" + h2Port],
      validateStatus: function (status) {
        return status >= 200 && status < 300;
      },
    }).then(connectTunnel);
  });
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

export const RegisterProxyServerHostnameTemplate = (hostname: string) => {
  if (!proxyHostnameTemplate) {
    proxyHostnameTemplate = hostname;
    loadPrivateClusterProxies();
  }
};
