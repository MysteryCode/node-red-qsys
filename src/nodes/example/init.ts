import { EditorNodeDef, EditorNodeProperties, EditorRED } from "node-red";

declare const RED: EditorRED;

type Defaults = EditorNodeProperties;

RED.nodes.registerType("node", {
  category: "example",
  color: "#f00",
  defaults: {
    name: {
      value: "Example",
    },
  },
  inputs: 1,
  outputs: 1,
  paletteLabel: "Example",
  icon: "example.png",
  label: function () {
    return this.name || "Example";
  },
  labelStyle: function () {
    return this.name ? "node_label_italic" : "";
  },
} as EditorNodeDef<Defaults>);
