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

export type QSysApiErrorCode = -32700 | -32600 | -32601 | -32602 | -32603 | -32604 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;

export interface QsysResponseError {
  code: QSysApiErrorCode;
  message: string;
  data?: any;
}

export interface QsysResponse {
  jsonrpc: string;
  result?: unknown;
  method?: string;
  id: number | null;
  error?: QsysResponseError;
}

export interface StatusParams {
  State: "Idle" | "Active" | "Standby";
  DesignName: string;
  DesignCode: string;
  IsRedundant: boolean;
  IsEmulator: boolean;
}

export interface QsysResponseLogon extends QsysResponse {
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

export interface QSysResponseComonentsControls extends QsysResponse {
  result: {
    Name: string;
    Controls: QSysResponseComonentsItemControl[];
  };
}

export interface QSysResponseComonentsItemControl {
  Name: string;
  Type: string;
  Value: string | null | boolean;
  Position: number;
  Direction?: "Read/Write" | "Write" | "Read";
  ValueMin?: number;
  StringMin?: string;
  ValueMax?: number;
  StringMax?: string;
}

export interface QSysResponseComonentsItem {
  ControlSource: number;
  Controls: null | QSysResponseComonentsItemControl[];
  ID: string;
  Name: string;
  Properties: Array<unknown>;
  Type: string;
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

export class QSysApiError extends Error {
  public readonly code: QSysApiErrorCode;

  constructor(code: QSysApiErrorCode, message?: string) {
    super(message);

    this.code = code;
  }

  public get hint(): string {
    switch (this.code) {
      case -32700:
        return "Parse error. Invalid JSON was received by the server.";
      case -32600:
        return "Invalid request. The JSON sent is not a valid Request object.";
      case -32601:
        return "Method not found.";
      case -32602:
        return "Invalid params.";
      case -32603:
        return "Server error.";
      case -32604:
        return "Core is on Standby. This code is returned when a QRC command is received while the Core is not the active Core in a redundant Core configuration.";
      case 2:
        return "Invalid Page Request ID";
      case 3:
        return "Bad Page Request - could not create the requested Page Request";
      case 4:
        return "Missing file";
      case 5:
        return "Change Groups exhausted";
      case 6:
        return "Unknown change croup";
      case 7:
        return "Unknown component name";
      case 8:
        return "Unknown control";
      case 9:
        return "Illegal mixer channel index";
      case 10:
        return "Logon required";
      default:
        return "Unknown Error";
    }
  }
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
              if (response.error) {
                const error = new QSysApiError(response.error.code, response.error.message);

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

          if (data.error !== undefined) {
            const error = new QSysApiError(data.error.code, data.error.message);

            reject(error);
          }

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

  public async getComponentList() {
    return await this.send({
      method: "Component.GetComponents",
      params: undefined,
    });
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

  RED.httpAdmin.get("/qsys/:id/components", RED.auth.needsPermission("qsys-config.components"), (req, res) => {
    const nodeId = req.params.id;
    const node = RED.nodes.getNode(nodeId) as QsysConfigNode<Config> | undefined;

    if (!node) {
      res.sendStatus(404);

      return;
    }

    node.nodeHandler
      .getComponentList()
      .then((response) => {
        res
          .setHeader("Content-Type", "application/json")
          .status(200)
          .send(JSON.stringify(response.result, null, 2));
      })
      .catch((err) => {
        res
          .setHeader("Content-Type", "application/json")
          .status(503)
          .send(JSON.stringify(err, null, 2));
      });
  });

  RED.httpAdmin.get(
    "/qsys/:id/components/:component/controls",
    RED.auth.needsPermission("qsys-config.components"),
    (req, res) => {
      const nodeId = req.params.id;
      const component = req.params.component;
      const node = RED.nodes.getNode(nodeId) as QsysConfigNode<Config> | undefined;

      if (!node || !component) {
        res.sendStatus(404);

        return;
      }

      node.nodeHandler
        .send({
          method: "Component.GetControls",
          params: {
            Name: component,
          },
        })
        .then((response) => {
          const data = response as QSysResponseComonentsControls;

          res
            .setHeader("Content-Type", "application/json")
            .status(200)
            .send(JSON.stringify(data.result.Controls, null, 2));
        })
        .catch((err) => {
          if (err instanceof QSysApiError) {
            if (err.code === 7) {
              res
                .setHeader("Content-Type", "application/json")
                .status(404)
                .send(JSON.stringify(err, null, 2));

              return;
            }
          }

          res
            .setHeader("Content-Type", "application/json")
            .status(503)
            .send(JSON.stringify(err, null, 2));
        });
    },
  );
};
