"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const qsys_config_1 = require("../qsys-config/qsys-config");
class NodeHandler {
    node;
    config;
    nodeApi;
    core = undefined;
    constructor(node, config, nodeApi) {
        this.node = node;
        this.config = config;
        this.nodeApi = nodeApi;
        this.core = this.nodeApi.nodes.getNode(config.core);
        this.core.nodeHandler.registerStatusCallback(this.node.id, (_socket, status, error) => {
            const nodeStatus = {
                fill: "grey",
                shape: "dot",
                text: "",
            };
            switch (status) {
                case "Inactive":
                    nodeStatus.fill = "grey";
                    nodeStatus.text = "Inactive.";
                    break;
                case "Error":
                    nodeStatus.fill = "red";
                    nodeStatus.text = error instanceof Error ? error.message : "Failure.";
                    break;
                case "Connected":
                case "Active":
                    nodeStatus.fill = "green";
                    nodeStatus.text = "Connected.";
                    break;
                default:
                    break;
            }
            this.node.status(nodeStatus);
        });
        this.node.on("close", () => {
            this.core?.nodeHandler.unregisterStatusCallback(this.node.id);
        });
        this.node.on("input", (msg) => {
            const message = msg;
            const controls = this.config.codename.split(";");
            let params;
            let action = "Get";
            if (["string", "number", "boolean"].includes(typeof message.payload)) {
                action = "Set";
                params = {
                    Name: this.config.codename,
                    Value: message.payload,
                    Ramp: message.ramp,
                };
            }
            else {
                params = controls;
            }
            this.core?.nodeHandler
                .send({
                id: (0, qsys_config_1.reserveId)(),
                method: `Control.${action}`,
                params: params,
            })
                .then((response) => {
                const data = response;
                if (action === "Get" && data.result.length === 1) {
                    msg.payload = data.result.pop();
                }
                else {
                    msg.payload = data.result;
                }
                this.node.send(msg);
            })
                .catch((e) => {
                if (e instanceof Error) {
                    this.node.error(e.message);
                }
            });
        });
    }
}
exports.default = (RED) => {
    RED.nodes.registerType("qsys-named-control", function (config) {
        RED.nodes.createNode(this, config);
        new NodeHandler(this, config, RED);
    });
};
