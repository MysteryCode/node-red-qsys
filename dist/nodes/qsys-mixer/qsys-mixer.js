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
        this.node.on("input", (msg, _send, done) => {
            const message = msg;
            const method = message.method ?? this.config.method;
            const additionalData = {
                ramp: message.ramp ?? this.config.ramp,
                ins: this.parseSelections(message.ins ?? this.config.ins),
                outs: this.parseSelections(message.outs ?? this.config.outs),
                cues: this.parseSelections(message.cues ?? this.config.cues),
            };
            try {
                this.validate(method, message.payload, additionalData);
            }
            catch (e) {
                if (e instanceof Error) {
                    this.node.warn(e.message);
                }
                return done();
            }
            const inputs = Array.isArray(additionalData.ins) ? additionalData.ins.join(" ") : additionalData.ins;
            const outputs = Array.isArray(additionalData.outs) ? additionalData.outs.join(" ") : additionalData.outs;
            const cues = Array.isArray(additionalData.cues) ? additionalData.cues.join(" ") : additionalData.cues;
            const toNumber = (input) => {
                if (typeof input === "number") {
                    return input;
                }
                return parseInt(input, 10);
            };
            const toBool = (input) => {
                if (typeof input === "boolean") {
                    return input;
                }
                if (input === "true") {
                    return true;
                }
                else if (input === "false") {
                    return false;
                }
                if (typeof input === "number") {
                    return input > 0;
                }
                return false;
            };
            switch (method) {
                case "SetCrossPointGain":
                case "SetCrossPointDelay":
                    this.send({
                        id: (0, qsys_config_1.reserveId)(),
                        method: `Mixer.${method}`,
                        params: {
                            Name: this.config.codename,
                            Inputs: inputs,
                            Outputs: outputs,
                            Value: toNumber(message.payload),
                            Ramp: toNumber(additionalData.ramp ?? 0),
                        },
                    });
                    break;
                case "SetCrossPointMute":
                case "SetCrossPointSolo":
                    this.send({
                        id: (0, qsys_config_1.reserveId)(),
                        method: `Mixer.${method}`,
                        params: {
                            Name: this.config.codename,
                            Inputs: inputs,
                            Outputs: outputs,
                            Value: toBool(message.payload),
                        },
                    });
                    break;
                case "SetInputGain":
                    this.send({
                        id: (0, qsys_config_1.reserveId)(),
                        method: `Mixer.${method}`,
                        params: {
                            Name: this.config.codename,
                            Inputs: inputs,
                            Value: toNumber(message.payload),
                            Ramp: toNumber(additionalData.ramp ?? 0),
                        },
                    });
                    break;
                case "SetInputMute":
                case "SetInputSolo":
                    this.send({
                        id: (0, qsys_config_1.reserveId)(),
                        method: `Mixer.${method}`,
                        params: {
                            Name: this.config.codename,
                            Inputs: inputs,
                            Value: toBool(message.payload),
                        },
                    });
                    break;
                case "SetOutputGain":
                    this.send({
                        id: (0, qsys_config_1.reserveId)(),
                        method: `Mixer.${method}`,
                        params: {
                            Name: this.config.codename,
                            Outputs: outputs,
                            Value: toNumber(message.payload),
                            Ramp: toNumber(additionalData.ramp ?? 0),
                        },
                    });
                    break;
                case "SetOutputMute":
                    this.send({
                        id: (0, qsys_config_1.reserveId)(),
                        method: `Mixer.${method}`,
                        params: {
                            Name: this.config.codename,
                            Outputs: outputs,
                            Value: toBool(message.payload),
                        },
                    });
                    break;
                case "SetCueMute":
                    this.send({
                        id: (0, qsys_config_1.reserveId)(),
                        method: `Mixer.${method}`,
                        params: {
                            Name: this.config.codename,
                            Cues: cues,
                            Value: toBool(message.payload),
                        },
                    });
                    break;
                case "SetCueGain":
                    this.send({
                        id: (0, qsys_config_1.reserveId)(),
                        method: `Mixer.${method}`,
                        params: {
                            Name: this.config.codename,
                            Cues: cues,
                            Value: toNumber(message.payload),
                            Ramp: toNumber(additionalData.ramp ?? 0),
                        },
                    });
                    break;
                case "SetInputCueEnable":
                case "SetInputCueAfl":
                    this.send({
                        id: (0, qsys_config_1.reserveId)(),
                        method: `Mixer.${method}`,
                        params: {
                            Name: this.config.codename,
                            Cues: cues,
                            Inputs: inputs,
                            Value: toBool(message.payload),
                        },
                    });
                    break;
            }
            done();
        });
    }
    validate(method, payload, _additionalParameters = {}) {
        const requireNumericValue = () => {
            if (typeof payload === "string") {
                payload = parseInt(payload, 10);
            }
            if (!isNaN(payload)) {
                throw new Error(`Value '${payload}' (${typeof payload}) is not supported.`);
            }
        };
        const requireBooleanValue = () => {
            if (typeof payload !== "boolean") {
                throw new Error(`Value '${payload}' (${typeof payload}) is not supported.`);
            }
        };
        switch (method) {
            case "SetCrossPointGain":
            case "SetCrossPointDelay":
            case "SetInputGain":
            case "SetOutputGain":
            case "SetCueGain":
                requireNumericValue();
                break;
            case "SetCrossPointMute":
            case "SetCrossPointSolo":
            case "SetInputMute":
            case "SetInputSolo":
            case "SetOutputMute":
            case "SetCueMute":
            case "SetInputCueEnable":
            case "SetInputCueAfl":
                requireBooleanValue();
                break;
            default:
                throw new Error(`Method '${method}' is not supported.`);
        }
    }
    parseSelections(input) {
        if (input === undefined || input === null) {
            return [];
        }
        if (typeof input === "string") {
            if (input === "*") {
                return input;
            }
            input = input.split(" ");
        }
        if (input.includes("*")) {
            return "*";
        }
        const selections = [];
        input.forEach((selection) => {
            if (typeof selection === "string") {
                selection = parseInt(selection, 10);
            }
            if (typeof selection === "number") {
                selections.push(selection);
            }
        });
        return selections;
    }
    send(message) {
        this.core?.nodeHandler.send(message).catch((e) => {
            this.node.error(e);
        });
    }
}
exports.default = (RED) => {
    RED.nodes.registerType("qsys-mixer", function (config) {
        RED.nodes.createNode(this, config);
        new NodeHandler(this, config, RED);
    });
};
