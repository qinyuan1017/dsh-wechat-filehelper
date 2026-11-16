// test/client.test.mjs — 在假 module loader 里执行 lib/client.js，验证注册行为
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

let pass = 0;
let fail = 0;
async function check(label, fn) {
  try {
    await fn();
    pass += 1;
    console.log("PASS " + label);
  } catch (err) {
    fail += 1;
    console.log("FAIL " + label + " :: " + ((err && err.message) || err));
  }
}

const bundlePath = path.join(import.meta.dirname, "..", "lib", "client.js");
const code = fs.readFileSync(bundlePath, "utf8");

let factory = null;
globalThis.window = { __ModuleLoader__: { load: (spec) => { factory = spec.factory } } };
const styles = [];
globalThis.document = {
  getElementById: () => null,
  createElement: () => ({ id: "", set textContent(value) { this.text = value } }),
  head: { appendChild: (el) => styles.push(el) },
};

const reactStub = {
  createElement: () => null,
  useState: (initial) => [initial, () => {}],
  useEffect: () => {},
  useRef: (initial) => ({ current: initial }),
  useCallback: (fn) => fn,
};

// bundle 是 UMD 风格：先执行，它自己会调 window.__ModuleLoader__.load 交回 factory
new Function(code)();
const mod = factory((id) => (id === "react" ? reactStub : {}));

const registrations = [];
const fakeSlots = {
  register: (spec, component) => {
    registrations.push({ spec, component });
    return () => {};
  },
  inject: (slot, cb) => cb(),
};
const ctx = {
  get: (name) => (name === "slots" ? fakeSlots : undefined),
  effect: (fn) => fn(),
};

await check("bundle 载入后交出 name / inject / apply", () => {
  assert.ok(factory, "factory 未注册");
  assert.equal(mod.name, "dsh-wechat-filehelper");
  assert.deepEqual(mod.inject, ["slots"]);
  assert.equal(typeof mod.apply, "function");
});

await check("apply 往 settings.section 注册一个分区", () => {
  mod.apply(ctx);
  assert.equal(registrations.length, 1);
  const spec = registrations[0].spec;
  assert.equal(spec.name, "settings.section");
  assert.equal(spec.id, "wechat-filehelper");
  assert.equal(typeof spec.label, "string");
  assert.ok(spec.label.length > 0);
  assert.equal(typeof registrations[0].component, "function");
});

await check("样式注入到 document.head", () => {
  assert.ok(styles.length >= 1);
  assert.match(String(styles[0].text), /\.wf-root/);
});

await check("RPC 路由常量与后端一致", () => {
  assert.match(code, /\/wechat-filehelper\/api/);
});

await check("bundle 尾部是 inject: ['slots'] 的插件对象", () => {
  assert.match(code, /return \{ name: 'dsh-wechat-filehelper', inject: \['slots'\], apply/);
});

console.log("");
console.log(pass + " 过 / " + fail + " 不过");
if (fail > 0) process.exitCode = 1;
