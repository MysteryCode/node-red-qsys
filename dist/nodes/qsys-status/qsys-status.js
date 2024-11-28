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
            const id = (0, qsys_config_1.reserveId)();
            void this.core?.nodeHandler
                .send({
                id: id,
                method: "StatusGet",
            })
                .then((response) => {
                msg.payload = response.result;
                this.node.send(msg);
            })
                .catch((err) => {
                this.node.error(err);
            });
        });
    }
}
exports.default = (RED) => {
    RED.nodes.registerType("qsys-status", function (config) {
        RED.nodes.createNode(this, config);
        new NodeHandler(this, config, RED);
    });
};