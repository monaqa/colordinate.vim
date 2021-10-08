import { Denops } from "https://deno.land/x/denops_std@v2.0.1/mod.ts";
import * as fn from "https://deno.land/x/denops_std@v2.0.1/function/mod.ts";
import * as autocmd from "https://deno.land/x/denops_std@v2.0.1/autocmd/mod.ts";
import {
  isObject,
  ensureObject,
} from "https://deno.land/x/unknownutil@v1.1.0/mod.ts";
import * as helper from "https://deno.land/x/denops_std@v2.0.1/helper/mod.ts";
import { parse, stringify } from "https://deno.land/std@0.110.0/encoding/yaml.ts";

type HighlightName = string;
type HighlightAttr = "bold" | "italic" | "reverse" | "standout" | "underline" | "undercurl" | "strikethrough";
const HIGHLIGHT_ATTRS: HighlightAttr[] = ["bold" , "italic" , "reverse" , "standout" , "underline" , "undercurl" , "strikethrough"];

// type ColorConfigDict = Record<HighlightName, ColorConfig>;
type ColorConfig = {
  color?: { fg?: string; bg?: string },
  style?: HighlightAttr[],
  links?: HighlightName[],
};

function isColorConfig(x: unknown): x is ColorConfig {
  if (!isObject(x)) {
    return false
  }
  if ("color" in x) {
    if (!isObject(x["color"])) {return false}
  }
  return true;
}

class ColorConfigDict {
  record: Record<HighlightName, ColorConfig>;

  constructor(record: Record<HighlightName, ColorConfig>) {
    this.record = record;
  }

  static parse(content: string): ColorConfigDict {
    const data = parse(content);
    ensureObject(data, isColorConfig);
    return new ColorConfigDict(data);
  }

  toScript(): string {
    return Object.keys(this.record).map((key) => {
      const conf = this.record[key];

      const color = conf.color ?? { fg: "None", bg: "None" };
      const fg = color.fg ?? "None";
      const bg = color.bg ?? "None";

      let ctermstr = (conf.style ?? []).join(",");
      ctermstr = ctermstr === "" ? "NONE" : ctermstr;

      const links = (conf.links ?? []).map((linkName) => `hi! link ${linkName} ${key}`);

      return [
        `hi! ${key} guifg=${fg} guibg=${bg} gui=${ctermstr}`,
        ...links
      ].join("\n");
    }).join("\n");
  }

  toYaml(): string {
    return stringify(this.record, {skipInvalid: true})
  }

  static async getCurrentConfig(denops: Denops): Promise<ColorConfigDict> {
    let synId = 1;
    const record: Record<string, ColorConfig> = {};
    while (true) {
      const transId = await fn.synIDtrans(denops, synId) as number;
      if (transId == 0) {
        break;
      }
      const name = await fn.synIDattr(denops, synId, "name", "gui") as string;

      if (synId == transId) {
        if (record[name] == undefined) {
          record[name] = {}
        }

        let fg: string | undefined = await fn.synIDattr(denops, synId, "fg", "gui") as string;
        fg = fg == '' ? undefined : fg;
        let bg: string | undefined = await fn.synIDattr(denops, synId, "bg", "gui") as string;
        bg = bg == '' ? undefined : bg;
        record[name]["color"] = { fg, bg };

        const style: HighlightAttr[] = [];
        for (const attr of HIGHLIGHT_ATTRS) {
          const existsAttr = await fn.synIDattr(denops, synId, attr, "gui") as number;
          if (existsAttr == 1) {
            style.push(attr);
          }
        }
        if (style.length > 0) {
          record[name]["style"] = style;
        }

      } else {
        const transName = await fn.synIDattr(denops, transId, "name", "gui") as string;
        if (record[transName] == undefined) {
          record[transName] = {}
        }
        if (record[transName]["links"] == undefined) {
          record[transName]["links"] = [name];
        } else {
          record[transName]["links"]?.push(name);
        }
      }

      synId += 1;
    }
    return new ColorConfigDict(record);
  }
}

class ColordinateBuffer {
  denops: Denops;
  name: string;
  id: number;

  constructor(denops: Denops, name: string, id: number) {
    this.denops = denops;
    this.name = name;
    this.id = id;
  }

  public static init = async (denops: Denops, name: string, cmd?: string) => {
    cmd = cmd ?? "vsplit";
    await helper.execute(
      denops,
      // `${cmd} ${await fn.fnameescape(denops, name) as string}`,
      `${cmd} ${name}`,
    );
    const id = await fn.bufnr(denops, await fn.fnameescape(denops, name) as string);

    await fn.setbufvar(denops, id, "&buftype", "acfile");
    await fn.setbufvar(denops, id, "&bufhidden", "wipe");
    await fn.setbufvar(denops, id, "&swapfile", 0);
    await fn.setbufvar(denops, id, "&backup", 0);
    await fn.setbufvar(denops, id, "&foldenable", 1);
    await fn.setbufvar(denops, id, "&foldmethod", "indent");
    await fn.setbufvar(denops, id, "&foldminlines", 3);
    await fn.setbufvar(denops, id, "&foldlevelstart", 2);
    await fn.setbufvar(denops, id, "&filetype", "yaml");
    await fn.setbufvar(denops, id, "&syntax", "OFF");

    await autocmd.group(denops, "colordinate", (helper) => {
      helper.remove("*", "<buffer>");
      helper.define("BufWriteCmd", "<buffer>", `call denops#notify("${denops.name}", "reflect", [])`)
    });

    return new ColordinateBuffer(denops, name, id);
  };

  async resetModified() {
    await fn.setbufvar(this.denops, this.id, "&modified", 0);
  }

  async getLines(): Promise<string[]> {
    return await fn.getbufline(this.denops, this.id, 1, "$");
  }

  // バッファ全体の文字を書き換える。
  async setText(text: string) {
    const lines = text.trim().split("\n");
    await fn.deletebufline(this.denops, this.id, 1, "$");
    await fn.appendbufline(this.denops, this.id, 0, lines);
  }

}

export async function main(denops: Denops): Promise<void> {

  let buffer: ColordinateBuffer | null = null;

  denops.dispatcher = {
    async new() {
      buffer = await ColordinateBuffer.init(denops, "[Colordinate]");
    },

    async reflect() {
      if (buffer == null) {
        return
      }
      const text = (await buffer.getLines()).join("\n");
      const conf = ColorConfigDict.parse(text);
      await helper.execute(denops, `
      if exists('syntax_on')
        syntax reset
      endif
      let g:colors_name = 'colordinate'
      `);
      await helper.execute(denops, conf.toScript());
      await buffer.resetModified();
    },

    async load() {
      buffer = await ColordinateBuffer.init(denops, "[Colordinate]");
      const conf = await ColorConfigDict.getCurrentConfig(denops);
      await buffer.setText(conf.toYaml());
      await buffer.resetModified();
    }
  }

  await helper.execute(denops,
  `
  command! ColordinateLoad call denops#request("${denops.name}", "load", [])
  `);

}
