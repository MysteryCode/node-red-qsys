import { Node, NodeAPI, NodeDef } from "node-red";
import {
  Config as QsysConfigNodeConfig,
  QSysApiError,
  QsysConfigNode,
  QsysResponse,
  reserveId,
} from "../qsys-config/qsys-config";
import { NodeMessage, NodeStatus } from "@node-red/registry";

type NamedControlMethod = "Set" | "Get";

export interface MessageIn extends NodeMessage {
  method?: NamedControlMethod;
  payload: boolean | string | number;
  ramp?: number;
}

interface QSysResponseItem {
  Name: string;
  String?: string;
  Value: boolean | string | number;
  Position?: number;
}

export interface QSysResponseControlGet extends QsysResponse {
  result: QSysResponseItem[];
}

export interface QSysResponseControlSet extends QsysResponse {
  result: QSysResponseItem;
}

export interface Config extends NodeDef {
  core: string;
  codename: string;
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

    this.core.nodeHandler.registerStatusCallback(this.node.id, (_socket, status, error) => {
      const nodeStatus: NodeStatus = {
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
      const message = msg as MessageIn;
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
      } else {
        params = controls;
      }

      this.core?.nodeHandler
        .send({
          id: reserveId(),
          method: `Control.${action}`,
          params: params,
        })
        .then((response) => {
          const data = response as QSysResponseControlSet | QSysResponseControlGet;

          if (action === "Get" && (data as QSysResponseControlGet).result.length === 1) {
            msg.payload = (data as QSysResponseControlGet).result.pop();
          } else {
            msg.payload = data.result;
          }

          this.node.send(msg);
        })
        .catch((e) => {
          this.node.error(e as Error | QSysApiError);
        });
    });
  }
}

export default (RED: NodeAPI): void => {
  RED.nodes.registerType("qsys-named-control", function (this: Node<Config>, config: Config) {
    RED.nodes.createNode(this, config);

    new NodeHandler(this, config, RED);
  });
};
