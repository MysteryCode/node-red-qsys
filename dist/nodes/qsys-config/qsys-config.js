"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_net_1 = require("node:net");
class NodeHandler {
    node;
    config;
    nodeApi;
    socket = undefined;
    noOpIntervalId = undefined;
    statusCallbacks = new Map();
    connectionPromise = undefined;
    constructor(node, config, nodeApi) {
        this.node = node;
        this.config = config;
        this.nodeApi = nodeApi;
        this.node.on("close", () => {
            if (this.noOpIntervalId) {
                clearInterval(this.noOpIntervalId);
            }
        });
    }
    async getSocket() {
        if (this.socket) {
            return this.socket;
        }
        return this.initSocket();
    }
    async initSocket() {
        if (this.connectionPromise) {
            try {
                const socket = await this.connectionPromise;
                return socket;
            }
            catch (e) {
                if (e instanceof Error) {
                    this.node.error(e);
                }
            }
        }
        const target = this.config.host.split(":");
        const host = target[0];
        const port = target[1] ? parseInt(target[1], 10) : 1710;
        this.connectionPromise = new Promise((resolve, reject) => {
            const socket = (0, node_net_1.connect)({
                host: host,
                port: port,
                allowHalfOpen: false,
                timeout: 30 * 1000,
            });
            socket.setMaxListeners(0);
            socket.on("ready", () => {
                if (this.config.authentication) {
                }
            });
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
                reject(error);
            });
            socket.on("connectionAttemptTimeout", () => {
                const error = new Error(`Connecting to socket ${host}:${port} timed out.`);
                this.closeSocket(socket);
                reject(error);
            });
            socket.on("connect", () => {
                this.node.debug(`Connecting to socket to ${host}:${port} succeeded.`);
                if (this.socket != undefined) {
                    this.closeSocket(this.socket);
                }
                this.socket = socket;
                resolve(socket);
            });
            socket.on("error", (err) => {
                this.node.error(err.message);
                if (err.errno === -4078) {
                    this.closeSocket(socket);
                }
            });
            socket.on("data", (data) => this.receive(data));
            this.node.on("close", () => this.closeSocket(socket));
            if (!this.noOpIntervalId) {
                this.noOpIntervalId = setInterval(() => {
                    try {
                    }
                    catch (e) {
                        this.node.debug(e);
                    }
                }, 30 * 1000);
            }
        });
        return this.connectionPromise;
    }
    closeSocket(socket) {
        socket?.destroy();
        socket = undefined;
    }
    encapsulate = (input) => {
        return Buffer.concat([Buffer.from(JSON.stringify(input)), Buffer.from([0x0])]);
    };
    send(input, forcedSocket = this.socket) {
        input.jsonrpc = "2.0";
        if (forcedSocket) {
            forcedSocket.write(this.encapsulate(input));
            return;
        }
        return this.getSocket().then((socket) => {
            socket?.write(this.encapsulate(input));
        });
    }
    receive(data) {
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
                                }
                                else if (obj.params.State === "Standby") {
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
                }
                catch (err) {
                    if (err instanceof Error) {
                        this.node.error(err.message);
                    }
                }
            }
            else {
                rx.push(data[i]);
            }
        }
    }
    registerStatusCallback(nodeId, callback) {
        if (!this.statusCallbacks.has(nodeId)) {
            this.statusCallbacks.set(nodeId, callback);
        }
    }
    munregisterStatusCallback(nodeId) {
        if (this.statusCallbacks.has(nodeId)) {
            this.statusCallbacks.delete(nodeId);
        }
    }
}
exports.default = (RED) => {
    RED.nodes.registerType("qsys-config", function (config) {
        RED.nodes.createNode(this, config);
        this.nodeHandler = new NodeHandler(this, config, RED);
    }, {
        credentials: {
            username: {
                type: "text",
            },
            password: {
                type: "password",
            },
        },
    });
};
