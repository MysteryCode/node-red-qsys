import { EditorNodeDef, EditorNodeProperties, EditorRED } from "node-red";

declare const RED: EditorRED;

interface Defaults extends EditorNodeProperties {
  bank: string;
}

RED.nodes.registerType("qsys-snapshot", {
  category: "Q-SYS",
  paletteLabel: "Q-SYS Snapshot",
  color: "#1a7ab9",
  icon: "qsys-snapshot.svg",
  inputs: 1,
  outputs: 0,
  defaults: {
    name: {
      value: "Q-SYS Snapshot",
      required: false,
    },
    core: {
      value: "",
      type: "qsys-config",
    },
    bank: {
      value: "",
      required: true,
    },
  },
  label: function () {
    return this.name || "Q-SYS Snapshot";
  },
} as EditorNodeDef<Defaults>);
