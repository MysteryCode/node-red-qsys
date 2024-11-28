"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.reserveId = reserveId;
const node_net_1 = require("node:net");
let lastId = 0;
function reserveId() {
    return lastId++;
}
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
            return Promise.resolve(this.socket);
        }
        return this.initSocket();
    }
    async initSocket() {
        if (this.connectionPromise) {
            return this.connectionPromise;
        }
        const target = this.config.host.split(":");
        const host = target[0];
        const port = target[1] ? parseInt(target[1], 10) : 1710;
        this.connectionPromise = new Promise((resolve, reject) => {
            const handleReject = (error) => {
                this.connectionPromise = undefined;
                this.updateStatus("Error", error);
                reject(error);
            };
            const handleResolve = (socket) => {
                if (this.socket !== undefined) {
                    this.closeSocket(this.socket);
                }
                this.socket = socket;
                this.connectionPromise = undefined;
                this.updateStatus("Connected");
                resolve(socket);
            };
            const socket = (0, node_net_1.connect)({
                host: host,
                port: port,
                allowHalfOpen: false,
                timeout: 30 * 1000,
            });
            socket.setMaxListeners(0);
            socket.on("ready", () => {
                if (this.config.authentication) {
                    void this.send({
                        jsonrpc: "2.0",
                        method: "Logon",
                        params: {
                            User: this.node.credentials.username,
                            Password: this.node.credentials.password,
                        },
                    }, socket)
                        .then((response) => {
                        if (response.error) {
                            const error = new Error(response.error);
                            handleReject(error);
                        }
                        else {
                            handleResolve(socket);
                        }
                    })
                        .catch((e) => {
                        handleReject(e);
                    });
                }
            });
            socket.on("close", () => {
                const error = new Error(`Socket to ${host}:${port} closed.`);
                this.closeSocket(socket);
                if (this.socket === socket) {
                    this.socket = undefined;
                }
                this.node.debug(error.message);
            });
            socket.on("end", () => {
                const error = new Error(`Socket to ${host}:${port} ended.`);
                this.closeSocket(socket);
                if (this.socket === socket) {
                    this.socket = undefined;
                }
                this.node.debug(error.message);
            });
            socket.on("timeout", () => {
                const error = new Error(`Socket to ${host}:${port} timed out.`);
                this.closeSocket(socket);
                if (this.socket === socket) {
                    this.socket = undefined;
                }
                this.node.debug(error.message);
            });
            socket.on("connectionAttemptFailed", () => {
                const error = new Error(`Connecting to socket ${host}:${port} failed.`);
                this.closeSocket(socket);
                handleReject(error);
            });
            socket.on("connectionAttemptTimeout", () => {
                const error = new Error(`Connecting to socket ${host}:${port} timed out.`);
                this.closeSocket(socket);
                handleReject(error);
            });
            socket.on("connect", () => {
                this.node.debug(`Connection to socket to ${host}:${port} established.`);
                if (!this.config.authentication) {
                    handleResolve(socket);
                }
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
    async send(input, forcedSocket = this.socket) {
        input.jsonrpc = "2.0";
        if (input.params === undefined) {
            input.params = 0;
        }
        if (input.id === undefined) {
            input.id = reserveId();
        }
        let socket;
        try {
            socket = forcedSocket || (await this.getSocket());
        }
        catch (e) {
            return Promise.reject(e);
        }
        socket?.write(this.encapsulate(input));
        let listener;
        let timeout;
        const promise = new Promise((resolve, reject) => {
            listener = (data) => {
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
    receive(data) {
        let rx = [];
        for (let i = 0; i < data.length; i++) {
            if (data[i] == 0x0 && data.length != 0) {
                try {
                    const obj = JSON.parse(Buffer.from(rx).toString());
                    if ("method" in obj) {
                        switch (obj.method) {
                            case "EngineStatus": {
                                const data = obj;
                                if (data.params.State === "Active") {
                                    this.node.emit("ready");
                                }
                                else if (data.params.State === "Standby") {
                                    this.closeSocket(this.socket);
                                }
                                break;
                            }
                            case "ChangeGroup.Poll": {
                                const data = obj;
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
    updateStatus(status, error) {
        this.statusCallbacks.forEach((callback) => {
            callback(this.socket, status, error);
        });
    }
    registerStatusCallback(nodeId, callback) {
        if (!this.statusCallbacks.has(nodeId)) {
            this.statusCallbacks.set(nodeId, callback);
        }
    }
    unregisterStatusCallback(nodeId) {
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
