import { readFile, writeFile } from "node:fs/promises";
import { build } from "esbuild";

const { outputFiles } = await build({
  entryPoints: ["widget.mjs"], bundle: true, minify: true, format: "esm",
  target: "es2022", write: false, legalComments: "inline",
});
const template = await readFile("index.html", "utf8");
const bundle = outputFiles[0].text.replace(/<\/script/gi, "<\\/script");
await writeFile("widget.html", template.replace("/* BUNDLE */", () => bundle));
