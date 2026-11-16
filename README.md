# dsh-wechat-filehelper 🐦

**让你——或者你的 AI——把电脑上的文件一把甩进自己的微信。**

不用打开网页版，不用天天扫码，不用点那个"上传文件"按钮。
扫一次码，之后在 DeepSeek Harness 里说一句「把这个发我微信」，文件就躺你手机上了。

---

## 🤔 这东西到底解决什么问题

想把电脑上的文件弄到手机上，以前是这么过的：

- 打开微信 → 文件传输助手 → 点上传 → 选文件 → 等它转圈 → 手机上点下载 😮‍💨
- 或者拿数据线、或者丢网盘、或者自己发自己邮件

现在不用了。你在 DSH 里跟 AI 说一句就行：

> 「把刚才那个报告发我微信」

然后你手机微信里就多了一个文件。就这样。没有第三步。

---

## ✨ 它能干什么

| 你说话 | 它干的活 |
|---|---|
| 「把这个发我微信」 | 传文件 📎 |
| 「把 xxx.xlsx 传到我手机」 | 传文件 |
| 「今天的数据发我一下」 | 先找最近改动的文件，再传 |
| 「给我微信发句话」 | 发文字 💬 |
| 「手机刚才发给我的东西收一下」 | 把文件下载到电脑 ⬇️ |

而且它会**自己找文件**——你说"刚才那个"，它会去翻最近 30 分钟改过的东西，然后挑一个发，不会傻乎乎反问你"是哪个文件呀" 🙃

---

## 🚀 怎么用

### 如果你只是用户

1. 装好插件，重启 DSH（一次性）
2. 设置页里找到「微信文件传输助手」，点「扫码登录」，掏出手机扫一下
3. 完事。之后张嘴就行

设置页里还能看到：**当前登录的是谁**、**什么时候登录的**、**发过哪些文件、成没成功**（失败会写原因，不用瞎猜）📋

### 如果你是 AI（或者你在写提示词）

一个工具，十来个动作：

```js
wechat_filehelper({ action: "send_file", filePath: "E:/out/report.xlsx" })
// → 已发到微信：report.xlsx（18642 字节，1 片，1204 ms）

wechat_filehelper({ action: "send_text", text: "跑完了，一共 37 条" })
wechat_filehelper({ action: "candidates" })        // 最近改动的文件清单
wechat_filehelper({ action: "list" })              // 手机发过来的文件
wechat_filehelper({ action: "pull", msgId: "77" }) // 下载到本地
wechat_filehelper({ action: "history" })           // 发送记录
```

第一次用要扫码：

```js
wechat_filehelper({ action: "login" })        // 给你一张二维码图片
wechat_filehelper({ action: "login_check" })  // 扫完了没
```

---

## 📦 装上

```bash
cd ~/.dsh/profiles/desktop
# package.json 里加两行：
#   dependencies:   "dsh-wechat-filehelper": "file:/path/to/dsh-wechat-filehelper"
#   dsh.profile.bundles: 也加进去
pnpm install
```

插件自带 `cordis.patch.yml`，装上就自动挂载，不用手动改配置。

不想装宿主也能用命令行顶着：

```bash
node scripts/fh.mjs qr       # 出二维码
node scripts/fh.mjs wait     # 等扫码
node scripts/fh.mjs status   # 登录状态
node scripts/fh.mjs send 文件路径
node scripts/fh.mjs text "要说的话"
```

---

## 🧠 它是怎么做到的

微信有个「文件传输助手网页版」（filehelper.weixin.qq.com）。
这个插件**只把那个网页当一次性的登录入口**——你扫码登录，它把登录凭证存下来，然后所有操作都走纯 HTTP：

```
扫码 → 换票 → 初始化 → 512KB 分片上传 → 发一条 appmsg 消息 → 完事
```

全程不打开浏览器，不跑无头 Chrome，不模拟点击。就是普通的 HTTP 请求，快的时候 700ms 一个文件 ⚡

| 环节 | 接口 | 一句话 |
|---|---|---|
| 拿二维码 | `jslogin` | appid 是 `wx_webfilehelper` |
| 等你扫 | `login` | 25 秒一轮长轮询 |
| 换登录凭证 | `webwxnewloginpage` | 返回 XML，cookie 里带票据 |
| 认人 | `webwxinit` | 拿到自己的 UserName 和同步钥匙 |
| 传文件 | `webwxuploadmedia` | 512KB 一片，串行传 |
| 发出去 | `webwxsendappmsg` | 一条带附件的消息 |
| 收文件 | `webwxsync` + `webwxgetmedia` | 轮询 + 下载 |

---

## ⚠️ 几个你可能会踩的坑（我替你踩过了）

**1. 单个文件最大 100MB。** 硬上限，超了直接报错，不会传一半挂那儿。

**2. 大文件慢。** 每片之间留了 1.2 秒。这是给微信的风控留的呼吸空间——传太快会被判定"操作过于频繁"。宁可慢也别封号 ⏳

**3. 有些微信号登不上网页版。** 微信对部分账号关了这个口子，扫码后会提示不支持。这不是插件的问题，换号吧 🙏

**4. 登录态会过期。** 一般能撑一天。失效了工具会明确告诉你重新扫码，不会静默失败。

**5. 只能发给自己。** 目标固定是「文件传输助手」，就是你自己。不是群发工具。

---

## 🔬 开发笔记：四个把我干趴下的坑

写这个插件的过程基本是"猜 → 被打回 → 扒官方源码 → 秒过"。

**① 二维码不是 PNG，是 JPEG。**
文件后缀写死 `.png`，图片打不开。改成按 `Content-Type` 判断才对。

**② 408 不是"过期"，是"这轮没人扫"。**
微信这个接口是 25 秒长轮询，超时返回 `code=408`，意思是"再等等"，不是码废了。我一开始当过期处理，白让人扫了三次 😅

**③ 每个请求都要带 `mmweb_appid: wx_webfilehelper`。**
少了这个头，登录接口直接甩你一个 `Ret=1100`（参数错误），不告诉你缺什么。

**④ 上传的文件字段名是 `filename`，不是 `file`。**
这个最坑。字段名错了服务端也返回成功，但 `MediaId` 是空的——看起来传上去了，其实文件根本没进去。
而且 `uploadmediarequest` 里的结构跟网上大多数教程写的不一样：

```diff
- { TotalChunks, Chunk, FileSize, Filename }   ❌ 照这个写永远拿不到 MediaId
+ { ClientMediaId, TotalLen, StartPos, DataLen, MediaType,
+   FromUserName, ToUserName, FileMd5 }          ✅ 官方真正要的
```

分片信息走独立的 `chunks` / `chunk` 两个字段，别塞进 JSON 里。

---

## 🧪 测试

```bash
node test/protocol.test.mjs   # 17 项 · 协议层，纯 mock 不联网
node test/plugin.test.mjs     # 14 项 · 完整链路：注册 → 提示词 → 登录 → 发文件 → 收件
node test/rpc.test.mjs        # 10 项 · 设置页接口（含鉴权、未知 op、历史倒序）
node test/client.test.mjs     #  5 项 · 客户端 bundle 在假 loader 下跑起来并注册成功
```

**46 项，全绿。** 而且全部离线跑——不需要你有微信账号，不需要网络。

真机也验过了：

| 场景 | 结果 |
|---|---|
| 扫码登录 | ✅ 成功（会话域 `szfilehelper.weixin.qq.com`） |
| 发 171 字节文本 | ✅ 719 ms |
| 发 1.2MB 文件 | ✅ 3.65 s，分 3 片 |
| 发纯文字 | ✅ 成功 |

---

## 🗂 项目结构

```
dsh-wechat-filehelper/
├── index.js              # 插件入口：工具 + 系统提示 + 路由
├── lib/
│   ├── webwx.js          # 协议客户端，所有接口都在这
│   ├── filehelper.js     # 业务：登录状态机 / 发文件 / 收件
│   ├── session.js        # 登录态落盘
│   ├── history.js        # 发送历史
│   └── client.js         # 设置页 UI（src/ 拼出来的）
├── src/                  # 设置页源码（三个片段）
├── scripts/fh.mjs        # 命令行版本
└── test/                 # 46 项测试
```

---

## 📄 License

MIT。拿去改，改完记得给个 star ⭐

---

<p align="center">
  <sub>为 DeepSeek Harness 写的。为"懒得开网页"写的。</sub>
</p>
