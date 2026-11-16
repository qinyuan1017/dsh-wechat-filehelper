<p align="center">
  <img src="assets/banner.svg" alt="dsh-wechat-filehelper" width="100%">
</p>

<p align="center">
  <a href="README.md">中文</a> · <b>English</b>
</p>

---

## What this is

A plugin for DeepSeek Harness.

Once it is installed, you type "send this to my WeChat" and the file sitting on your computer shows up in WeChat on your phone.

No web client, no upload button, no USB cable. You scan one QR code the first time; after that you never touch it again.

Under the hood it talks to WeChat's own File Transfer Helper web service (`filehelper.weixin.qq.com`) — the same "File Transfer Helper" you already use to move files between your phone and your computer. The plugin borrows it for a single login, then does everything over plain HTTP. No browser is ever launched.

## Install

First make sure DSH is installed and you know where its profile lives (usually `~/.dsh/profiles/desktop`).

Open `package.json` in that directory and add one line in two places:

```jsonc
// under dependencies
"dsh-wechat-filehelper": "file:C:/Users/<you>/my-repos/dsh-wechat-filehelper"

// under dsh.profile.bundles
"dsh-wechat-filehelper"
```

Then run `pnpm install` inside the profile directory and restart DSH.

After the restart there is a "WeChat File Transfer Helper" section in Settings. Click "Scan to log in", scan with WeChat, confirm on your phone. That's it.

The session is stored locally, so you won't scan again next time.

## Use

Three things you'll actually do:

**Send a file** — say "send this to my WeChat", or just give a path.
**Send a message** — say "send a line to my WeChat".
**Receive a file** — anything you sent yourself from the phone can be pulled down to the computer.

If it can't tell which file you mean, it lists what changed in the last half hour and lets you pick, instead of asking "which file exactly?".

## What it doesn't do

- **Only sends to yourself.** The target is always "File Transfer Helper", never a group or another person.
- **100MB per file.** Anything bigger fails immediately rather than dying halfway.
- **Big files are slow.** 512KB per chunk, 1.2s between chunks. That pause is deliberate — WeChat throttles web-client calls, and pushing harder gets you flagged.
- **Some accounts can't use the web client.** WeChat has closed web login for a share of accounts; scanning will just say it's unsupported.
- **Login expires.** Usually about a day. When it does, the plugin tells you to scan again instead of failing silently.

## How it works

Scan → get credentials → initialise → 512KB chunks → send one attachment message.

No headless Chrome, no click simulation. A small file lands in about 700ms.

## Tests

```bash
npm test
```

46 tests, all offline — no WeChat account and no network required.

Verified against the real service too: a 171-byte file in 719ms, a 1.2MB file in 3 chunks in 3.65s, plain text as well.

## License

MIT.

Marketplace submission: [awesome-dsh-plugin#16021](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/pull/16021).
