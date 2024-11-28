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
  params: object | 0;
}

export interface QsysResponse {
  jsonrpc: string;
  result?: unknown;
  method?: string;
  id: number | null;
}

export interface StatusParams {
  State: "Idle" | "Active" | "Standby";
  DesignName: string;
  DesignCode: string;
  IsRedundant: boolean;
  IsEmulator: boolean;
}

export interface QsysResponseLogon extends QsysResponse {
  error?: string;
  response?: unknown;
}

export interface QsysResponseEngineStatus extends QsysResponse {
  params: StatusParams;
}

export interface QsysResponseChangeGroupPoll extends QsysResponse {
  result: {
    Id: string;
    Changes: {
      Component?: string;
      Name: string;
      Value: unknown;
      String: string;
    }[];
  };
}

export interface Config extends NodeDef {
  host: string;
  authentication: 0 | 1 | undefined;
  username: string | undefined;
  password: string | undefined;
}

export type MessageIn = NodeMessage;

export type Status = "Idle" | "Active" | "Standby" | "Error" | "Inactive" | "Connected";

export type StatusCallback = (socket: Socket | undefined, status: Status, error?: Error) => void;

let lastId: number = 0;

export function reserveId(): number {
  return lastId++;
}

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
      return Promise.resolve(this.socket);
    }

    return this.initSocket();
  }

  protected async initSocket(): Promise<Socket> {
    if (this.connectionPromise) {
      return this.connectionPromise;
    }

    const target = this.config.host.split(":");
    const host = target[0];
    const port = target[1] ? parseInt(target[1], 10) : 1710;

    this.connectionPromise = new Promise<Socket>((resolve, reject) => {
      const handleReject = (error: Error) => {
        this.connectionPromise = undefined;

        this.updateStatus("Error", error);

        reject(error);
      };

      const handleResolve = (socket: Socket) => {
        if (this.socket !== undefined) {
          this.closeSocket(this.socket);
        }

        this.socket = socket;
        this.connectionPromise = undefined;

        this.updateStatus("Connected");

        resolve(socket);
      };

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
          void this.send(
            {
              jsonrpc: "2.0",
              method: "Logon",
              params: {
                User: this.node.credentials.username,
                Password: this.node.credentials.password,
              },
            },
            socket,
          )
            .then((response) => {
              if ((response as QsysResponseLogon).error) {
                const error = new Error((response as QsysResponseLogon).error);

                // reject socket
                handleReject(error);
              } else {
                // resolve socket
                handleResolve(socket);
              }
            })
            .catch((e) => {
              handleReject(e);
            });
        }
      });

      // handle cleanup if socket closes
      socket.on("close", () => {
        const error = new Error(`Socket to ${host}:${port} closed.`);

        this.closeSocket(socket);
        if (this.socket === socket) {
          this.socket = undefined;
        }

        this.node.debug(error.message);
        //this.updateStatus("Inactive");
      });
      socket.on("end", () => {
        const error = new Error(`Socket to ${host}:${port} ended.`);

        this.closeSocket(socket);
        if (this.socket === socket) {
          this.socket = undefined;
        }

        this.node.debug(error.message);
        //this.updateStatus("Inactive");
      });
      socket.on("timeout", () => {
        const error = new Error(`Socket to ${host}:${port} timed out.`);

        this.closeSocket(socket);
        if (this.socket === socket) {
          this.socket = undefined;
        }

        this.node.debug(error.message);
        //this.updateStatus("Error", error);
      });
      socket.on("connectionAttemptFailed", () => {
        const error = new Error(`Connecting to socket ${host}:${port} failed.`);

        this.closeSocket(socket);
        //this.node.error(error.message);

        handleReject(error);
      });
      socket.on("connectionAttemptTimeout", () => {
        const error = new Error(`Connecting to socket ${host}:${port} timed out.`);

        this.closeSocket(socket);
        //this.node.error(error.message);

        handleReject(error);
      });

      socket.on("connect", () => {
        this.node.debug(`Connection to socket to ${host}:${port} established.`);

        // resolve if no auth necessary
        if (!this.config.authentication) {
          handleResolve(socket);
        }
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

  public async send(
    input: Partial<QsysMessage>,
    forcedSocket: Socket | undefined = this.socket,
  ): Promise<QsysResponse> {
    input.jsonrpc = "2.0";

    if (input.params === undefined) {
      input.params = 0;
    }

    if (input.id === undefined) {
      input.id = reserveId();
    }

    let socket: Socket;
    try {
      socket = forcedSocket || (await this.getSocket());
    } catch (e) {
      return Promise.reject(e as Error);
    }

    socket?.write(this.encapsulate(input));

    let listener: (...args: any[]) => void;
    let timeout: NodeJS.Timeout;
    const promise = new Promise<QsysResponse>((resolve, reject) => {
      listener = (data: QsysResponse) => {
        if (data.id === input.id) {
          clearTimeout(timeout);
          this.node.removeListener("package", listener);

          resolve(data);
        }
      };

      this.node.addListener("package", listener);

      timeout = setTimeout(() => {
        reject(new Error(`Q-SYS device "${this.node.name}" did not respond within 10 seconds.`));
      }, 10 * 1000);
    });

    return promise;
  }

  protected receive(data: Buffer) {
    let rx = [];

    for (let i = 0; i < data.length; i++) {
      if (data[i] == 0x0 && data.length != 0) {
        try {
          const obj: QsysResponse = JSON.parse(Buffer.from(rx).toString());

          if ("method" in obj) {
            switch (obj.method) {
              case "EngineStatus": {
                const data = obj as QsysResponseEngineStatus;

                if (data.params.State === "Active") {
                  this.node.emit("ready");
                } else if (data.params.State === "Standby") {
                  this.closeSocket(this.socket);
                }

                break;
              }

              case "ChangeGroup.Poll": {
                const data = obj as QsysResponseChangeGroupPoll;
                const changes = data.result.Changes;
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

          this.node.emit("package", obj);

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

  protected updateStatus(status: Status, error?: Error) {
    this.statusCallbacks.forEach((callback) => {
      callback(this.socket, status, error);
    });
  }

  public registerStatusCallback(nodeId: string, callback: StatusCallback): void {
    if (!this.statusCallbacks.has(nodeId)) {
      this.statusCallbacks.set(nodeId, callback);
    }
  }

  public unregisterStatusCallback(nodeId: string): void {
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
