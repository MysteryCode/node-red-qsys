import { EditorNodeDef, EditorNodeProperties, EditorRED } from "node-red";

declare const RED: EditorRED;

interface Defaults extends EditorNodeProperties {
  codename: string;
}

RED.nodes.registerType("qsys-named-control", {
  category: "Q-SYS",
  paletteLabel: "Q-SYS Named Control",
  color: "#1a7ab9",
  icon: "qsys-named-control.svg",
  inputs: 1,
  outputs: 1,
  defaults: {
    name: {
      value: "Q-SYS Named Control",
      required: false,
    },
    core: {
      value: "",
      type: "qsys-config",
    },
    codename: {
      value: "",
      required: true,
    },
  },
  label: function () {
    return this.name || "Q-SYS Named Control";
  },
} as EditorNodeDef<Defaults>);
