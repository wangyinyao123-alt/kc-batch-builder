#!/usr/bin/env node
/**
 * 命令行入口：Markdown → SVG / vsdx。
 *
 *   node bin/flowchart.js 输入.md -o 输出.svg
 *   node bin/flowchart.js 输入.md -o 输出.vsdx --theme dark
 *
 * 只做一期需要的事：解析、排版、渲染。不加参数校验框架，也不加配置文件。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { basename, extname } from 'node:path';

import { parseMarkdown } from '../src/parse.js';
import { layout } from '../src/layout.js';
import { renderSvg } from '../src/render.js';
import { resolveSpec, titleHeight, listTemplates, listPalettes } from '../src/templates.js';
import { toVsdxInput, toVsdxTheme } from '../src/vsdx-input.js';

const USAGE = `用法：flowchart <输入.md> [选项]

选项：
  -o, --out <文件>      输出路径（按扩展名决定格式：.svg / .vsdx）
  -t, --template <名字> 模板（默认 default，见下方列表）
  -p, --palette <名字>  配色，覆盖模板自带的配色
      --no-title        不把首行标题画进图里
  -l, --list            列出所有模板与配色
  -h, --help            显示这段帮助

示例：
  flowchart 流程.md -o 流程.svg --template business
  flowchart 流程.md -o 流程.svg --template minimal --palette dark
  flowchart 流程.md -o 流程.vsdx

模板：
${listTemplates()
  .map((t) => `  ${t.name.padEnd(10)} ${t.label.padEnd(4)} ${t.description}`)
  .join('\n')}

配色：
  ${listPalettes().join(' / ')}
`;

function fail(msg) {
  console.error(`错误：${msg}`);
  process.exit(2);
}

function parseArgs(argv) {
  const opts = { input: null, out: null, template: 'default', palette: null, title: true };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h' || a === '--help') {
      console.log(USAGE);
      process.exit(0);
    } else if (a === '-o' || a === '--out') {
      opts.out = argv[++i];
    } else if (a === '-t' || a === '--template') {
      opts.template = argv[++i];
    } else if (a === '-p' || a === '--palette') {
      opts.palette = argv[++i];
    } else if (a === '-l' || a === '--list') {
      for (const t of listTemplates()) {
        console.log(`${t.name.padEnd(10)} ${t.label.padEnd(4)} [${t.palette}] ${t.description}`);
      }
      console.log(`\n配色：${listPalettes().join(' / ')}`);
      process.exit(0);
    } else if (a === '--no-title') {
      opts.title = false;
    } else if (a.startsWith('-')) {
      fail(`未知选项 ${a}`);
    } else if (!opts.input) {
      opts.input = a;
    } else {
      fail(`多余的参数 ${a}`);
    }
  }
  return opts;
}

/** 把诊断按级别打到 stderr，warn 不阻断，error 阻断。 */
function report(diagnostics) {
  const errors = diagnostics.filter((d) => d.level === 'error');
  for (const d of diagnostics) {
    const where = d.line ? ` 第 ${d.line} 行` : '';
    console.error(`${d.level === 'error' ? '✗' : '!'}${where} ${d.message}`);
  }
  return errors;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!opts.input) fail('缺少输入文件。用 -h 看用法。');

  const src = readFileSync(opts.input, 'utf8');
  const diagram = parseMarkdown(src);
  const errors = report(diagram.diagnostics);
  if (errors.length) {
    fail(`Markdown 有 ${errors.length} 处错误，未生成文件。`);
  }

  let spec;
  try {
    spec = resolveSpec(opts.template, opts.palette ? { palette: opts.palette } : {});
  } catch (e) {
    fail(e.message);
  }
  const laid = layout(diagram, spec);

  const out = opts.out || `${basename(opts.input, extname(opts.input))}.svg`;
  const ext = extname(out).toLowerCase();

  const title = opts.title ? diagram.title || '' : '';

  if (ext === '.svg') {
    writeFileSync(out, renderSvg(laid, spec, { title }), 'utf8');
  } else if (ext === '.vsdx') {
    // 导出器是 CommonJS，且只在真正导 vsdx 时才加载（浏览器构建用不到它）
    const { buildVsdx, nodeImpl } = await import('../../../tools/vsdx-export/src/index.js');
    const vin = toVsdxInput(laid, spec, {
      titleHeight: titleHeight(spec, Boolean(title)),
    });
    const buf = await buildVsdx(vin, toVsdxTheme(spec), nodeImpl());
    writeFileSync(out, buf);
  } else {
    fail(`不认识的输出格式 "${ext}"，只支持 .svg 和 .vsdx`);
  }

  const warn = diagram.diagnostics.filter((d) => d.level === 'warn').length;
  console.log(
    `✓ ${out} ｜ ${laid.nodes.length} 个节点、${laid.edges.length} 条连线` +
      ` ｜ 画布 ${Math.round(laid.width + spec.padding * 2)}×` +
      `${Math.round(laid.height + spec.padding * 2 + titleHeight(spec, Boolean(title)))}` +
      (warn ? ` ｜ ${warn} 条提示` : '')
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
