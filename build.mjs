/**
 * 把 src/*.js 按文件名顺序拼成 lib/client.js（单文件，无构建工具）。
 * 每个片段共享同一个 factory 作用域：React / h / 常量 / 组件。
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const srcDir = path.join(here, 'src')
const outFile = path.join(here, 'lib', 'client.js')

const files = (await fs.readdir(srcDir)).filter((name) => /^\d+.*\.js$/.test(name)).sort()
if (!files.length) {
  console.error('src/ 里没有片段')
  process.exit(1)
}

const parts = []
for (const file of files) {
  const text = await fs.readFile(path.join(srcDir, file), 'utf8')
  parts.push('// ═════════ ' + file + ' ═════════\n' + text.trimEnd() + '\n')
}

const head =
  "window.__ModuleLoader__.load({\n" +
  "  id: 'dsh-wechat-filehelper',\n" +
  '  factory(require) {\n'

const tail =
  "\nreturn { name: 'dsh-wechat-filehelper', inject: ['slots'], apply, _test: { SettingsSection, api, fmtBytes, fmtTime, CLS } }\n" +
  '  },\n})\n'

const out = head + parts.join('\n') + tail
await fs.mkdir(path.dirname(outFile), { recursive: true })
await fs.writeFile(outFile, out, 'utf8')
console.log('OK ' + files.length + ' 段 -> lib/client.js ' + Buffer.byteLength(out) + ' 字节')
