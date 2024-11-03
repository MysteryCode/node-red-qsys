import { Node, NodeAPI, NodeDef } from "node-red";
import { NodeMessage } from "@node-red/registry";
import { connect, Socket } from "node:net";

export interface QsysConfigNode<TConfig extends NodeDef> extends Node<TConfig> {
  nodeHandler: NodeHandler;
}

export interface QsysMessage {
  jsonrpc: string;
  method: string;
  id: number;
  params: object;
}

export interface Config extends NodeDef {
  host: string;
  authentication: 0 | 1 | undefined;
  username: string | undefined;
  password: string | undefined;
}

export type MessageIn = NodeMessage;

export type StatusCallback = (socket: Socket | undefined, status: string) => void;

class NodeHandler {
  protected node: Node<Config>;

  protected config: Config;

  protected nodeApi: NodeAPI;

  protected socket: Socket | undefined = undefined;

  protected noOpIntervalId: NodeJS.Timeout | undefined = undefined;

  protected statusCallbacks: Map<string, StatusCallback> = new Map<string, StatusCallback>();

  protected connectionPromise: Promise<Socket> | undefined = undefined;

  constructor(node: Node<Config>, config: Config, nodeApi: NodeAPI) {
    this.node = node;
    this.config = config;
    this.nodeApi = nodeApi;

    this.node.on("close", () => {
      if (this.noOpIntervalId) {
        clearInterval(this.noOpIntervalId);
      }
    });
  }

  protected async getSocket(): Promise<Socket> {
    if (this.socket) {
      return this.socket;
    }

    return this.initSocket();
  }

  protected async initSocket(): Promise<Socket> {
    if (this.connectionPromise) {
      try {
        const socket = await this.connectionPromise;

        return socket;
      } catch (e) {
        if (e instanceof Error) {
          this.node.error(e);
        }
      }
    }

    const target = this.config.host.split(":");
    const host = target[0];
    const port = target[1] ? parseInt(target[1], 10) : 1710;

    this.connectionPromise = new Promise<Socket>((resolve, reject) => {
      // initiate socket connection
      const socket = connect({
        host: host,
        port: port,
        allowHalfOpen: false,
        timeout: 30 * 1000,
      });
      socket.setMaxListeners(0);

      // start communication
      socket.on("ready", () => {
        // try authentication
        if (this.config.authentication) {
          //this.send(
          //  {
          //    jsonrpc: "2.0",
          //    method: "Logon",
          //    params: {
          //      User: this.node.credentials.username,
          //      Password: this.node.credentials.password,
          //    },
          //  },
          //  socket,
          //);
        }
      });

      // handle cleanup if socket closes
      socket.on("close", () => {
        const error = new Error(`Socket to ${host}:${port} closed.`);

        this.closeSocket(socket);
        this.node.debug(error.message);
      });
      socket.on("end", () => {
        const error = new Error(`Socket to ${host}:${port} ended.`);

        this.closeSocket(socket);
        this.node.debug(error.message);
      });
      socket.on("timeout", () => {
        const error = new Error(`Socket to ${host}:${port} timed out.`);

        this.closeSocket(socket);
        this.node.debug(error.message);
      });
      socket.on("connectionAttemptFailed", () => {
        const error = new Error(`Connecting to socket ${host}:${port} failed.`);

        this.closeSocket(socket);
        //this.node.error(error.message);

        reject(error);
      });
      socket.on("connectionAttemptTimeout", () => {
        const error = new Error(`Connecting to socket ${host}:${port} timed out.`);

        this.closeSocket(socket);
        //this.node.error(error.message);

        reject(error);
      });

      // make socket available after connection succeeded
      socket.on("connect", () => {
        this.node.debug(`Connecting to socket to ${host}:${port} succeeded.`);

        if (this.socket != undefined) {
          this.closeSocket(this.socket);
        }

        this.socket = socket;

        resolve(socket);
      });

      // display errors
      socket.on("error", (err: Error | NodeJS.ErrnoException) => {
        this.node.error(err.message);

        // Error: connect ECONNREFUSED 127.0.0.1:1710 => -4078
        if ((err as NodeJS.ErrnoException).errno === -4078) {
          this.closeSocket(socket);
        }
      });

      socket.on("data", (data) => this.receive(data));

      this.node.on("close", () => this.closeSocket(socket));

      // start sending cyclic noop command to keep socket alive
      if (!this.noOpIntervalId) {
        this.noOpIntervalId = setInterval(() => {
          try {
            //void this.send({
            //  jsonrpc: "2.0",
            //  method: "NoOp",
            //  params: {},
            //});
          } catch (e) {
            this.node.debug(e);
          }
        }, 30 * 1000);
      }
    });

    return this.connectionPromise;
  }

  protected closeSocket(socket: Socket | undefined) {
    socket?.destroy();
    socket = undefined;
  }

  protected encapsulate = (input: object): Buffer => {
    return Buffer.concat([Buffer.from(JSON.stringify(input)), Buffer.from([0x0])]);
  };

  public send(input: Partial<QsysMessage>, forcedSocket: Socket | undefined = this.socket) {
    input.jsonrpc = "2.0";

    if (forcedSocket) {
      forcedSocket.write(this.encapsulate(input));

      return;
    }

    return this.getSocket().then((socket) => {
      socket?.write(this.encapsulate(input));
    });
  }

  protected receive(data: Buffer) {
    let rx = [];

    for (let i = 0; i < data.length; i++) {
      if (data[i] == 0x0 && data.length != 0) {
        try {
          const obj = JSON.parse(Buffer.from(rx).toString());

          if ("method" in obj) {
            switch (obj.method) {
              case "EngineStatus":
                if (obj.params.State === "Active") {
                  this.node.emit("ready");
                } else if (obj.params.State === "Standby") {
                  this.closeSocket(this.socket);
                }

                break;

              case "ChangeGroup.Poll": {
                const changes = obj.params.Changes;
                if (changes.length !== 0) {
                  for (let i = 0; i < changes.length; i++) {
                    this.node.emit("rx", changes[i]);
                  }
                }
                break;
              }

              default:
                break;
            }
          }

          rx = [];
        } catch (err) {
          if (err instanceof Error) {
            this.node.error(err.message);
          }
        }
      } else {
        rx.push(data[i]);
      }
    }
  }

  public registerStatusCallback(nodeId: string, callback: StatusCallback): void {
    if (!this.statusCallbacks.has(nodeId)) {
      this.statusCallbacks.set(nodeId, callback);
    }
  }

  public munregisterStatusCallback(nodeId: string): void {
    if (this.statusCallbacks.has(nodeId)) {
      this.statusCallbacks.delete(nodeId);
    }
  }
}

export default (RED: NodeAPI): void => {
  RED.nodes.registerType(
    "qsys-config",
    function (this: QsysConfigNode<Config>, config: Config) {
      RED.nodes.createNode(this, config);

      this.nodeHandler = new NodeHandler(this, config, RED);
    },
    {
      credentials: {
        username: {
          type: "text",
        },
        password: {
          type: "password",
        },
      },
    },
  );
};
