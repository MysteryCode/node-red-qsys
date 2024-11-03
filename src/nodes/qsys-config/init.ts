import { EditorNodeDef, EditorNodeProperties, EditorRED } from "node-red";

declare const RED: EditorRED;

interface Defaults extends EditorNodeProperties {
  host: string;
  authentication?: 0 | 1;
  username?: string;
  password?: string;
}

RED.nodes.registerType("qsys-config", {
  category: "config",
  defaults: {
    name: {
      value: "Example",
      required: true,
    },
    host: {
      value: "",
      required: true,
    },
    authentication: {
      value: 0,
      required: false,
    },
    username: {
      value: "",
      required: false,
    },
    password: {
      value: "",
      required: false,
    },
  },
  label: function () {
    return this.name;
  },
  oneditprepare: function () {
    document.getElementById("node-config-input-authentication").addEventListener("change", (event) => {
      const field: HTMLInputElement = event.currentTarget as HTMLInputElement;

      document.querySelectorAll(`[data-requires="${field.id}"]`).forEach((element: HTMLElement) => {
        element.style.display = field.checked ? "block" : "none";
      });
    });
  },
} as EditorNodeDef<Defaults>);
