#!/usr/bin/env node
// scripts/fh.mjs — 不开宿主也能用的命令行：qr 出二维码 / wait 等扫码 / status 看状态 / send 发文件
import fs from "node:fs";
import path from "node:path";
import { createClient } from "../lib/filehelper.js";

const [cmd, ...rest] = process.argv.slice(2);
const client = createClient();

function print(obj) {
  console.log(JSON.stringify(obj, null, 2));
}

if (cmd === "qr") {
  const out = await client.login();
  print({ state: out.state, qrPath: out.qrPath, uuid: out.uuid, expiresInSec: out.expiresInSec });
} else if (cmd === "wait") {
  const limit = Number(rest[0] || 300);
  const started = Date.now();
  let last = "";
  let beat = Date.now();
  while (Date.now() - started < limit * 1000) {
    const out = await client.checkLogin({ waitSec: 20 });
    if (out.state !== last) {
      console.log("[" + new Date().toISOString().slice(11, 19) + "] " + out.state + (out.hint ? " - " + out.hint : ""));
      last = out.state;
      beat = Date.now();
    } else if (Date.now() - beat > 60000) {
      console.log("[" + new Date().toISOString().slice(11, 19) + "] 仍在等扫码…（已 " + Math.round((Date.now() - started) / 1000) + "s）");
      beat = Date.now();
    }
    if (out.state === "online") {
      print({ ok: true, state: "online", nickName: out.nickName, userName: out.userName });
      process.exit(0);
    }
    if (out.state === "expired" || out.state === "rejected" || out.state === "no_pending") {
      print({ ok: false, state: out.state, hint: out.hint });
      process.exit(1);
    }
  }
  print({ ok: false, state: "timeout", hint: "等待超时，重新 qr" });
  process.exit(1);
} else if (cmd === "status") {
  print(client.status());
} else if (cmd === "send") {
  const out = await client.sendFile(rest[0]);
  print(out);
} else if (cmd === "text") {
  const out = await client.sendText(rest.join(" "));
  print(out);
} else {
  console.log("用法: fh.mjs qr|wait [秒]|status|send <文件>|text <文字>");
  process.exit(2);
}
