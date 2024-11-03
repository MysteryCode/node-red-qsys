import { Node, NodeAPI, NodeDef } from "node-red";
import { NodeMessage } from "@node-red/registry";
import { Config as QsysConfigNodeConfig, QsysConfigNode, QsysMessage } from "../qsys-config/qsys-config";

export type MixerControlMethod =
  | "SetCrossPointGain"
  | "SetCrossPointDelay"
  | "SetCrossPointMute"
  | "SetCrossPointSolo"
  | "SetInputGain"
  | "SetInputMute"
  | "SetInputSolo"
  | "SetOutputGain"
  | "SetOutputMute"
  | "SetCueMute"
  | "SetCueGain"
  | "SetInputCueEnable"
  | "SetInputCueAfl";

export interface Config extends NodeDef {
  core: string;
  codename: string;
  method: MixerControlMethod;
  ins: number[] | "*"[];
  outs: number[] | "*"[];
  cues: number[] | "*"[];
  ramp: number;
}

export interface MessageIn extends NodeMessage {
  method?: MixerControlMethod;
  payload: boolean | string | number;
  ins?: number[] | "*";
  outs?: number[] | "*";
  cues?: number[] | "*";
  ramp?: number;
}

class NodeHandler {
  protected node: Node<Config>;

  protected config: Config;

  protected nodeApi: NodeAPI;

  protected core: QsysConfigNode<QsysConfigNodeConfig> | undefined = undefined;

  constructor(node: Node<Config>, config: Config, nodeApi: NodeAPI) {
    this.node = node;
    this.config = config;
    this.nodeApi = nodeApi;
    this.core = this.nodeApi.nodes.getNode(config.core) as QsysConfigNode<QsysConfigNodeConfig>;

    this.node.on("input", (msg, _send, done) => {
      const message = msg as MessageIn;

      const method = message.method ?? this.config.method;
      const additionalData = {
        ramp: message.ramp ?? this.config.ramp,
        ins: this.parseSelections(message.ins ?? this.config.ins),
        outs: this.parseSelections(message.outs ?? this.config.outs),
        cues: this.parseSelections(message.cues ?? this.config.cues),
      };

      try {
        this.validate(method, message.payload, additionalData);
      } catch (e) {
        if (e instanceof Error) {
          this.node.warn(e.message);
        }

        return done();
      }

      const inputs = Array.isArray(additionalData.ins) ? additionalData.ins.join(" ") : additionalData.ins;
      const outputs = Array.isArray(additionalData.outs) ? additionalData.outs.join(" ") : additionalData.outs;
      const cues = Array.isArray(additionalData.cues) ? additionalData.cues.join(" ") : additionalData.cues;

      const toNumber = (input: number | string): number => {
        if (typeof input === "number") {
          return input;
        }

        return parseInt(input, 10);
      };

      const toBool = (input: number | string | boolean): boolean => {
        if (typeof input === "boolean") {
          return input;
        }

        if (input === "true") {
          return true;
        } else if (input === "false") {
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
            id: Date.now(),
            method: `Mixer.${method}`,
            params: {
              Name: this.config.codename,
              Inputs: inputs,
              Outputs: outputs,
              Value: toNumber(message.payload as string | number),
              Ramp: toNumber(additionalData.ramp ?? 0),
            },
          });
          break;

        case "SetCrossPointMute":
        case "SetCrossPointSolo":
          this.send({
            id: Date.now(),
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
            id: Date.now(),
            method: `Mixer.${method}`,
            params: {
              Name: this.config.codename,
              Inputs: inputs,
              Value: toNumber(message.payload as string | number),
              Ramp: toNumber(additionalData.ramp ?? 0),
            },
          });
          break;

        case "SetInputMute":
        case "SetInputSolo":
          this.send({
            id: Date.now(),
            method: `Mixer.${method}`,
            params: {
              Name: this.config.codename,
              Inputs: inputs,
              Value: toBool(message.payload as string | number),
            },
          });
          break;

        case "SetOutputGain":
          this.send({
            id: Date.now(),
            method: `Mixer.${method}`,
            params: {
              Name: this.config.codename,
              Outputs: outputs,
              Value: toNumber(message.payload as string | number),
              Ramp: toNumber(additionalData.ramp ?? 0),
            },
          });
          break;

        case "SetOutputMute":
          this.send({
            id: Date.now(),
            method: `Mixer.${method}`,
            params: {
              Name: this.config.codename,
              Outputs: outputs,
              Value: toBool(message.payload as string | number),
            },
          });
          break;

        case "SetCueMute":
          this.send({
            id: Date.now(),
            method: `Mixer.${method}`,
            params: {
              Name: this.config.codename,
              Cues: cues,
              Value: toBool(message.payload as string | number),
            },
          });
          break;

        case "SetCueGain":
          this.send({
            id: Date.now(),
            method: `Mixer.${method}`,
            params: {
              Name: this.config.codename,
              Cues: cues,
              Value: toNumber(message.payload as string | number),
              Ramp: toNumber(additionalData.ramp ?? 0),
            },
          });
          break;

        case "SetInputCueEnable":
        case "SetInputCueAfl":
          this.send({
            id: Date.now(),
            method: `Mixer.${method}`,
            params: {
              Name: this.config.codename,
              Cues: cues,
              Inputs: inputs,
              Value: toBool(message.payload as string | number),
            },
          });
          break;
      }
      done();
    });
  }

  protected validate(
    method: MixerControlMethod,
    payload: unknown,
    _additionalParameters: {
      ramp?: number | undefined;
      ins?: number[] | "*" | undefined;
      outs?: number[] | "*" | undefined;
      cues?: number[] | "*" | undefined;
    } = {},
  ) {
    const requireNumericValue = () => {
      if (typeof payload === "string") {
        payload = parseInt(payload, 10);
      }

      if (!isNaN(payload as number)) {
        throw new Error(`Value '${payload as any}' (${typeof payload}) is not supported.`);
      }
    };

    const requireBooleanValue = () => {
      if (typeof payload !== "boolean") {
        throw new Error(`Value '${payload as any}' (${typeof payload}) is not supported.`);
      }
    };

    switch (method) {
      // numeric value
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
        throw new Error(`Method '${method as any}' is not supported.`);
    }
  }

  protected parseSelections(input: string[] | number[] | string): number[] | "*" {
    if (input === undefined || input === null) {
      return [];
    }

    if (typeof input === "string") {
      if (input === "*") {
        return input;
      }

      input = input.split(" ");
    }

    if ((input as string[]).includes("*")) {
      return "*";
    }

    const selections: number[] = [];
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

  protected send(message: Partial<QsysMessage>) {
    this.core?.nodeHandler.send(message)?.catch((e) => {
      if (e instanceof Error) {
        this.node.warn(`${e.message}\nMessage: ${JSON.stringify(message, null, 2)}`);
      }
    });
  }
}

export default (RED: NodeAPI): void => {
  RED.nodes.registerType("qsys-mixer", function (this: Node<Config>, config: Config) {
    RED.nodes.createNode(this, config);

    new NodeHandler(this, config, RED);
  });
};
