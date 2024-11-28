import { EditorNodeDef, EditorNodeProperties, EditorRED } from "node-red";

declare const RED: EditorRED;

type Defaults = EditorNodeProperties;

RED.nodes.registerType("qsys-status", {
  category: "Q-SYS",
  paletteLabel: "Q-SYS Status",
  color: "#1a7ab9",
  icon: "qsys-status.svg",
  inputs: 1,
  outputs: 1,
  defaults: {
    name: {
      value: "Q-SYS Status",
      required: false,
    },
    core: {
      value: "",
      type: "qsys-config",
    },
  },
  label: function () {
    return this.name || "Q-SYS Status";
  },
} as EditorNodeDef<Defaults>);
