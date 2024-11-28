import { EditorNodeDef, EditorNodeProperties, EditorRED } from "node-red";
import { MixerControlMethod } from "./qsys-mixer";
import { QSysResponseComonentsItem } from "../qsys-config/qsys-config";

declare const RED: EditorRED;

interface Defaults extends EditorNodeProperties {
  codename: string;
  method: MixerControlMethod | undefined;
  ins: number[] | "*" | undefined;
  outs: number[] | "*" | undefined;
  cues: number[] | "*" | undefined;
  ramp: number | undefined;
  core: string;
}

type AutoCompleteResult = {
  value: string;
  label: string;
  i: number;
};

RED.nodes.registerType("qsys-mixer", {
  category: "Q-SYS",
  paletteLabel: "Q-SYS Mixer",
  color: "#1a7ab9",
  icon: "qsys-mixer.svg",
  inputs: 1,
  outputs: 0,
  defaults: {
    name: {
      value: "Mixer",
      required: true,
    },
    codename: {
      value: "",
      require: true,
    },
    method: {
      value: undefined,
      require: true,
    },
    ins: {
      value: undefined,
      required: false,
    },
    outs: {
      value: undefined,
      required: false,
    },
    cues: {
      value: undefined,
      required: false,
    },
    ramp: {
      value: undefined,
      required: false,
    },
    core: {
      value: "",
      type: "qsys-config",
    },
  },
  label: function () {
    return this.name || "Mixer";
  },
  oneditprepare: function () {
    const methodField = document.getElementById("node-input-method") as HTMLSelectElement;
    const methodChangeCallback = () => {
      const option: HTMLOptionElement | null = methodField.options[methodField.selectedIndex || -1] || null;
      const enables: string[] = option.dataset.enables ? option.dataset.enables.replace(" ", "").split(",") : [];

      ["ins", "outs", "cues", "ramp"].forEach((parameter) => {
        const element: HTMLDivElement | null = document
          .getElementById(`node-input-${parameter}`)
          ?.closest(".form-row") as HTMLDivElement | null;
        if (element) {
          element.style.display = enables.includes(parameter) ? "block" : "none";
        }
      });
    };

    methodField.addEventListener("change", methodChangeCallback);
    methodChangeCallback();

    // @ts-expect-error using a node red function overlayed over jQuery - mind the big C!
    $("#node-input-codename").autoComplete({
      search: (value: string, done: (matches: AutoCompleteResult[]) => void) => {
        if (!this.core) {
          return;
        }

        return $.ajax({
          url: `qsys/${this.core}/components`,
          method: "GET",
        }).done((response: QSysResponseComonentsItem[]) => {
          const matches: AutoCompleteResult[] = [];

          response.forEach((component) => {
            const i = component.Name.toLowerCase().indexOf(value.toLowerCase());
            if (i > -1 && component.Type === "mixer") {
              matches.push({
                value: component.Name,
                label: component.Name,
                i: i,
              });
            }
          });

          matches.sort((a, b) => {
            return a.i - b.i;
          });

          done(matches);
        });
      },
    });
  },
} as EditorNodeDef<Defaults>);
