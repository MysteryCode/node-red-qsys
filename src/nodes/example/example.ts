import { Node, NodeAPI, NodeDef } from "node-red";
import { NodeMessage } from "@node-red/registry";

export type Config = NodeDef;

export type MessageIn = NodeMessage;

class NodeHandler {
  protected node: Node<Config>;

  protected config: Config;

  constructor(node: Node<Config>, config: Config) {
    this.node = node;
    this.config = config;
  }
}

export default (RED: NodeAPI): void => {
  RED.nodes.registerType("example", function (this: Node<Config>, config: Config) {
    RED.nodes.createNode(this, config);

    new NodeHandler(this, config);
  });
};
