import { Node, NodeAPI, NodeDef } from "node-red";
import { Config as QsysConfigNodeConfig, QSysApiError, QsysConfigNode, reserveId } from "../qsys-config/qsys-config";
import { NodeMessage, NodeStatus } from "@node-red/registry";

type SnapshotAction = "Save" | "Load";

export interface MessageIn extends NodeMessage {
  action: SnapshotAction;
  payload: number;
  ramp?: number;
}

export interface Config extends NodeDef {
  core: string;
  bank: string;
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

      const params = {
        Name: this.config.bank,
        Bank: message.payload,
        Ramp: message.ramp,
      };

      this.core?.nodeHandler
        .send({
          id: reserveId(),
          method: `Snapshot.${message.action}`,
          params: params,
        })
        .catch((e) => {
          this.node.error(e as Error | QSysApiError);
        });
    });
  }
}

export default (RED: NodeAPI): void => {
  RED.nodes.registerType("qsys-snapshot", function (this: Node<Config>, config: Config) {
    RED.nodes.createNode(this, config);

    new NodeHandler(this, config, RED);
  });
};
