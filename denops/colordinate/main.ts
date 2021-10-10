import { Denops } from "https://deno.land/x/denops_std@v2.0.1/mod.ts";
import * as fn from "https://deno.land/x/denops_std@v2.0.1/function/mod.ts";
import * as autocmd from "https://deno.land/x/denops_std@v2.0.1/autocmd/mod.ts";
import {
  ensureObject,
  ensureString,
  isArray,
  isObject,
  isString,
} from "https://deno.land/x/unknownutil@v1.1.0/mod.ts";
import * as helper from "https://deno.land/x/denops_std@v2.0.1/helper/mod.ts";
import { globals } from "https://deno.land/x/denops_std@v2.0.1/variable/mod.ts";
import {
  parse,
  stringify,
} from "https://deno.land/std@0.110.0/encoding/yaml.ts";
import { existsSync } from "https://deno.land/std@0.110.0/fs/mod.ts";

type HighlightName = string;
const HIGHLIGHT_ATTRS = [
  "bold",
  "italic",
  "reverse",
  "standout",
  "underline",
  "undercurl",
  "strikethrough",
] as const;
type HighlightAttr = typeof HIGHLIGHT_ATTRS[number];

function isHighlightAttr(x: unknown): x is HighlightAttr {
  return isString(x) && (HIGHLIGHT_ATTRS as unknown as string[]).includes(x);
}

const YAML_KEY_ORDER = ["color", "style", "links"];

function sortYamlKey(a: string, b: string): number {
  return YAML_KEY_ORDER.indexOf(a) - YAML_KEY_ORDER.indexOf(b);
}

// type ColorConfigDict = Record<HighlightName, ColorConfig>;
type ColorConfig = {
  color?: { fg?: string; bg?: string };
  style?: HighlightAttr[];
  links?: HighlightName[];
};

function isColorConfig(x: unknown): x is ColorConfig {
  if (!isObject(x)) {
    console.error("The value of color config must be an object. Actual:");
    console.error(x);
    return false;
  }
  if ("color" in x) {
    if (!isObject(x["color"])) {
      console.error(
        "The value corresponding to attribute 'color' must be an object. Actual config:",
      );
      console.error(x);
      return false;
    }
  }
  if ("style" in x) {
    if (!isArray(x["style"], isHighlightAttr)) {
      console.error(
        "The value corresponding to attribute 'style' must be a attribute array.",
      );
      console.error(
        `Possible attributes: [${HIGHLIGHT_ATTRS.join(", ")}]. Actual config:`,
      );
      console.error(x);
      return false;
    }
  }
  if ("links" in x) {
    if (!isArray(x["links"], isString)) {
      console.error(
        "The value corresponding to attribute 'links' must be a string array. Actual config:",
      );
      console.error(x);
      return false;
    }
  }
  return true;
}

class ColorConfigDict {
  record: Record<HighlightName, ColorConfig>;
  matchIds: number[];

  constructor(record: Record<HighlightName, ColorConfig>) {
    this.record = record;
    this.matchIds = [];
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

      const links = (conf.links ?? []).map((linkName) =>
        `hi! link ${linkName} ${key}`
      );

      return [
        `hi! ${key} guifg=${fg} guibg=${bg} gui=${ctermstr}`,
        ...links,
      ].join("\n");
    }).join("\n");
  }

  toYaml(): string {
    return stringify(this.record, { skipInvalid: true, sortKeys: sortYamlKey });
  }

  static async getCurrentConfig(denops: Denops): Promise<ColorConfigDict> {
    let synId = 0;
    const record: Record<string, ColorConfig> = {};
    while (true) {
      synId += 1;
      const transId = await fn.synIDtrans(denops, synId) as number;
      if (transId == 0) {
        break;
      }
      const name = await fn.synIDattr(denops, synId, "name", "gui") as string;
      if (name == "") {
        continue;
      }

      if (synId == transId) {
        if (record[name] == undefined) {
          record[name] = {};
        }

        let fg: string | undefined = await fn.synIDattr(
          denops,
          synId,
          "fg",
          "gui",
        ) as string;
        fg = fg == "" ? undefined : fg;
        let bg: string | undefined = await fn.synIDattr(
          denops,
          synId,
          "bg",
          "gui",
        ) as string;
        bg = bg == "" ? undefined : bg;
        record[name]["color"] = { fg, bg };

        const style: HighlightAttr[] = [];
        for (const attr of HIGHLIGHT_ATTRS) {
          const existsAttr = await fn.synIDattr(
            denops,
            synId,
            attr,
            "gui",
          ) as number;
          if (existsAttr == 1) {
            style.push(attr);
          }
        }
        if (style.length > 0) {
          record[name]["style"] = style;
        }
      } else {
        const transName = await fn.synIDattr(
          denops,
          transId,
          "name",
          "gui",
        ) as string;
        if (record[transName] == undefined) {
          record[transName] = {};
        }
        if (record[transName]["links"] == undefined) {
          record[transName]["links"] = [name];
        } else {
          record[transName]["links"]?.push(name);
        }
      }
    }
    return new ColorConfigDict(record);
  }

  async addHighlights(buffer: ColordinateBuffer) {
    await Promise.all(
      this.matchIds.map((id) => fn.matchdelete(buffer.denops, id)),
    );
    this.matchIds = await Promise.all(
      Object.keys(this.record).map((name) => buffer.addHighlight(name)),
    );
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
    const id = await fn.bufnr(
      denops,
      await fn.fnameescape(denops, name) as string,
    );

    await fn.setbufvar(denops, id, "&buftype", "nowrite");
    await fn.setbufvar(denops, id, "&swapfile", 0);
    await fn.setbufvar(denops, id, "&backup", 0);
    await fn.setbufvar(denops, id, "&foldenable", 1);
    // await fn.setbufvar(denops, id, "&foldmethod", "indent");
    await fn.setbufvar(denops, id, "&foldmethod", "expr");
    await fn.setbufvar(
      denops,
      id,
      "&foldexpr",
      "getline(v:lnum)[:5]=='    - '",
    );
    await fn.setbufvar(denops, id, "&foldminlines", 3);
    await fn.setbufvar(denops, id, "&foldlevelstart", 0);
    await fn.setbufvar(denops, id, "&filetype", "yaml");
    await fn.setbufvar(denops, id, "&syntax", "OFF");

    await autocmd.group(denops, "colordinate", (helper) => {
      helper.remove("*", "<buffer>");
      helper.define(
        ["BufReadPost", "BufWinEnter", "TextChanged"],
        "<buffer>",
        `call denops#notify("${denops.name}", "reflect", [])`,
      );
      helper.define(
        "BufWriteCmd",
        "<buffer>",
        `setlocal nomodified`,
      );
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

  async addHighlight(name: string): Promise<number> {
    return await fn.matchadd(this.denops, name, `\\<${name}\\>`) as number;
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
        return;
      }
      const text = (await buffer.getLines()).join("\n");
      const conf = ColorConfigDict.parse(text);
      await helper.execute(
        denops,
        `
        if exists('syntax_on')
          syntax reset
        endif
        let g:colors_name = 'colordinate'
        `,
      );
      await helper.execute(denops, conf.toScript());
      await conf.addHighlights(buffer);
    },

    async load() {
      buffer = await ColordinateBuffer.init(denops, "[Colordinate]");
      const conf = await ColorConfigDict.getCurrentConfig(denops);
      await buffer.setText(conf.toYaml());
    },

    async jump() {
      const pos = await fn.getcurpos(denops);
      const synId = await fn.synID(denops, pos[1], pos[2], false) as number;
      const synName = await fn.synIDattr(denops, synId, "name") as string;

      console.log(synName);

      if (buffer == null) {
        buffer = await ColordinateBuffer.init(denops, "[Colordinate]");
        const conf = await ColorConfigDict.getCurrentConfig(denops);
        await buffer.setText(conf.toYaml());
      } else {
        const winnr = await fn.winbufnr(
          denops,
          await fn.bufnr(denops, "\\[Colordinate\\]") as number,
        ) as number;
        if (winnr > 0) {
          const winid = await fn.win_getid(denops, winnr) as number;
          await fn.win_gotoid(denops, winid);
        } else {
          await helper.execute(denops, "sbuffer \\[Colordinate]");
        }
      }

      await fn.search(denops, `\\<${synName}\\>`, "w");
    },

    async save(csname: unknown) {
      ensureString(csname);
      if (buffer == null) {
        throw new Error(
          "Buffer [Colordinate] is not found. First you should run :ColordinateLoad.",
        );
      }

      const fpath = await globals.get<string>(denops, "colordinate_save_path");
      const fname = (fpath == null)
        ? `${csname}.vim`
        : `${fpath}/${csname}.vim`;
      const text = (await buffer.getLines()).join("\n");
      const conf = ColorConfigDict.parse(text);
      let content = [
        `" Generated by colordinate.vim (https://github.com/monaqa/colordinate.vim)`,
        `if exists('syntax_on')`,
        `  syntax reset`,
        `endif`,
        `let g:colors_name = '${csname}'`,
        "",
        "",
      ].join("\n");

      content += conf.toScript();
      if (
        !existsSync(fname) ||
        await fn.confirm(
            denops,
            `The file ${fname} already exists. Overwrite it?`,
            "&Yes\n&No",
          ) == 1
      ) {
        await Deno.writeTextFile(fname, content);
      }
    },
  };

  await helper.execute(
    denops,
    `
    command! ColordinateLoad call denops#request("${denops.name}", "load", [])
    command! ColordinateJump call denops#request("${denops.name}", "jump", [])
    command! -nargs=1 ColordinateSave call denops#request("${denops.name}", "save", [<q-args>])
    `,
  );
}
