import {Denops} from "https://deno.land/x/denops_std@v2.0.1/mod.ts";
import {ensureString, ensureObject} from "https://deno.land/x/unknownutil@v1.1.0/mod.ts";
import * as helper from "https://deno.land/x/denops_std@v2.0.1/helper/mod.ts";
import { parse, stringify } from "https://deno.land/std/encoding/yaml.ts";

type HighlightName = string;
type ColorConfigDict = Record<HighlightName, ColorConfig>;
type ColorConfig = {
  color?: {fg?: string, bg?: string},
}

function isColorConfig(x:unknown): x is ColorConfig {
  return true
}

function parseColorConfig(content: string) : ColorConfigDict {
  const data = parse(content);
  ensureObject(data, isColorConfig);
  return data
}

function colorConfigToVimScript(confDict: ColorConfigDict): string {
  return Object.keys(confDict).map((key) => {
    const conf = confDict[key];
    const color = conf.color ?? {fg: "None", bg: "None"};
    const fg = color.fg ?? "None";
    const bg = color.bg ?? "None";
    if (color == undefined) {
      return `hi! ${key} guifg=${fg} guibg=${bg}`
    }
  }).join("\n")
}

export async function main(denops: Denops): Promise<void> {

  denops.dispatcher = {

  }

  await helper.execute(
    denops,
    `
    `
  )

}
