# 几猫港区 · 国产3A大作（OTools 独立插件）

把一份微信收到的**单文件 HTML 3D 第一人称射击游戏**封装成 OTools 独立插件。默认以 `panel` 模式打开，面板加大到 **1440 × 810**，方便运行游戏。

## 这是什么

游戏本体是一个 1.4 MB 的自包含 HTML：three.js 与全部游戏逻辑、样式、贴图都内联在这一个文件里，**没有任何外部资源、CDN、fetch / XHR / WebSocket 请求**，离线可玩。

> **版权说明**：游戏本体是第三方分享的「开发体验版」作品，页面内自述「使用 Fable5.2 自主研发」。版权归原作者所有。本仓库只做 OTools 插件封装，**没有修改游戏玩法、美术或代码逻辑**；唯一改动是在 `<head>` 注入 530 字节的宿主桥标记（见下文）。

### 玩法与操作

- **目标**：切断堆场、仓库、码头三处上行中继，然后到码头南端舷梯旁的撤离艇登船。
- **敌人**：机械飞鸥（空中）、机械猎犬（地面）。
- **键鼠**：`WASD` 移动 · 鼠标视角 · 左键开火 · 右键瞄准 · `R` 换弹 · `E` 切断中继 · `Shift` 冲刺 · `C` 蹲伏 · `Space` 跳跃 · `ESC` 暂停。
- **无指针锁定时**：按住鼠标拖动调整视角（左键同时开火、右键同时瞄准）；方向键或 `IJKL` 转向、`Enter` 开火。游戏会自动降级。
- **触屏 / 手柄**：虚拟摇杆与按键；手柄摇杆转向、RT 开火、LT 瞄准、A 跳跃、B 蹲伏、X 换弹、Y 切断中继、L3 冲刺、Start 暂停。
- **设置**：画质（低/中/高/极高 + 自动）、鼠标灵敏度、反转垂直视角、音量、视野范围 FOV、全屏。设置存 `localStorage['saltline.settings.v1']`。
- **调试参数**：`?bench` 性能面板 · `?autostart=1` 跳过主菜单与过场 · `?noaudio=1` 关音频 · `?q=low|medium|high|ultra` 指定画质 · `?seed=N` 固定随机种子。

## panel 尺寸

`plugin.json` 配置：

```json
"openMode": "panel",
"panelWidth": 1440,
"panelHeight": 810
```

比此前的工具类插件（980 × 700）大一圈。宿主 `src-tauri/src/platform/panel/core.rs` 会按光标所在显示器钳制内容尺寸：

- 宽度 ≤ 显示器逻辑宽度 × `0.92`
- 高度 ≤ 显示器逻辑高度 × `PANEL_MAX_HEIGHT_RATIO = 0.7`
- 下限 320 × 200

例如 1920 × 1080 无缩放的屏幕上，实际约 **1440 × 756**。游戏画布是 `position: fixed; inset: 0`，会自适应任意比例，不受影响。若想更沉浸，可在游戏设置里点「进入全屏」（取决于 webview 是否授予 Fullscreen API）。

## 数据与隐私

完全离线。不上传任何数据，不请求网络。唯一持久化是本机 `localStorage` 里的画面/操作设置。

## 唯一改动：宿主桥标记

`verify-plugin.mjs` 与宿主要求入口 HTML 带 OTools 宿主桥标记。由于游戏不调用任何宿主 API，只注入了一段零副作用脚本（在 `<meta charset="UTF-8">` 之后）：

```html
<!-- OTools 独立插件封装：唯一注入点。游戏本体为自包含单文件，不调用任何宿主 API；
     这里只登记宿主可能注入的 window.otools / window.utools，供宿主识别与环境诊断。 -->
<script>
(function () {
  'use strict';
  try {
    var host = window.otools || window.utools || null;
    window.__OTOOLS_PLUGIN__ = { packid: 'otools-jimao', version: '1.0.0', host: !!host };
    if (host) { window.MC = window.MC || {}; window.MC.otoolsHost = host; }
  } catch (e) {}
})();
</script>
```

- 不覆盖游戏全局，不注册事件，不调用宿主 API，全程 `try/catch`。
- **严格校验**：把这段 530 字节片段从 `web/index.html` 中删掉后，剩余内容与原始 HTML **逐字节一致**（原始 SHA-256 `9e55b5200b088adaf8e1152da04efc0d3b25e236e6baf2dee96f81e23e084966`）。

游戏自身对受限浏览器 API 已有完善容错，所以不需要额外补丁：

| API | 游戏的容错 |
|---|---|
| `localStorage` | 读写都包 `try/catch`，不可用则用默认设置 |
| Fullscreen | 特性检测 + `catch`，不支持时隐藏「进入全屏」行 |
| Pointer Lock | 失败自动降级到拖拽视角模式 |
| WebGL / AudioContext | 启动失败显示 `#fatal` 错误条，`window.__errors` 记录 |

## 工程结构

```
otools-jimao/
├─ plugin.json                    openMode=panel / 1440×810 / v1.0.0
├─ logo.svg
├─ README.md
├─ web/index.html                 游戏单文件（原 HTML + 宿主桥标记）
├─ dist/index.html                build-web.mjs 纯拷贝产物
├─ dist-pack/*.oplg               本地发布包（不入库）
├─ _shots/                        CDP 截图（不入库）
├─ scripts/
│  ├─ build-web.mjs               web/ → dist/ 纯拷贝
│  ├─ pack-plugin.mjs             → .oplg + SHA256SUMS + meta.json
│  ├─ verify-plugin.mjs           发布包结构 / 清单 / CRC 校验
│  ├─ serve-dist.mjs              本地静态服务
│  ├─ smoke.mjs                   CDP 冒烟（41 项 + 7 张截图）
│  ├─ deploy-to-otools.ps1        本地部署到 OTools 主仓库（需手动执行）
│  ├─ publish-market.mjs / publish-market.test.mjs
│  └─ release-policy.mjs / release-policy.test.mjs
├─ .github/workflows/
│  ├─ build-plugin.yml            CI：build → pack → verify → artifact
│  └─ release-plugin.yml          Release + 可选市场上架
└─ .gitignore                     dist/ dist-pack/ _shots/ *.log 不入库
```

## 构建 / 打包 / 校验

```bash
node scripts/build-web.mjs
node scripts/pack-plugin.mjs --out dist-pack --version 1.0.0
node scripts/verify-plugin.mjs dist-pack
```

## 浏览器冒烟

游戏是 WebGL 应用，headless Chrome **必须启用 SwiftShader**，否则 WebGL 上下文创建失败、游戏会显示 `#fatal`。

服务、Chrome、冒烟必须在**同一条 shell 命令**里执行（本机后台进程跨调用不存活），并且**每次换新端口**：

```bash
cd "D:/Repos/xyito/otools/otools-jimao"
NODE="C:/Users/Admin/.workbuddy-ai/binaries/node/versions/22.22.2-6/node.exe"
CHROME="/c/Program Files/Google/Chrome/Application/chrome.exe"
PROFILE="D:/Repos/xyito/otools/otools-jimao/_shots/final-profile"
"$NODE" scripts/serve-dist.mjs 6516 > _shots/serve.log 2>&1 & SRV=$!
sleep 1
"$CHROME" --headless=new --no-sandbox --disable-gpu-sandbox \
  --enable-unsafe-swiftshader --use-gl=angle --use-angle=swiftshader \
  --disable-background-timer-throttling --disable-backgrounding-occluded-windows \
  --disable-renderer-backgrounding --remote-debugging-port=9256 \
  --user-data-dir="$PROFILE" --window-size=1440,810 --no-first-run \
  --no-default-browser-check --autoplay-policy=no-user-gesture-required \
  --hide-scrollbars about:blank > _shots/chrome.log 2>&1 & CHR=$!
sleep 5
CDP_PORT=9256 BASE_URL=http://127.0.0.1:6516/ "$NODE" scripts/smoke.mjs
kill "$CHR" "$SRV"
```

踩过的坑（下次直接避开）：

- **不要加** `--disable-frame-rate-limit` / `--disable-gpu-vsync`：SwiftShader 会全速渲染把 headless 拖死，命令会超时。
- **不要写** `cd X && VAR=... && cmd &`：整条 AND-list 会被丢进后台子 shell，主 shell 仍在旧目录且变量为空。用 `;` 分隔。
- 冒烟脚本结束必须 `ws.close()` + `process.exit()`，否则 CDP WebSocket 挂住 node 事件循环，命令永远不退出。
- SwiftShader 在 1440 × 810 每帧约 400 ms，`introSeconds: 3.5` 的过场推进极慢；完整 HUD 激活改由 `?autostart=1`（`skipIntro`）路径确定性验证。
- headless 合成器在页面静止时不主动出帧，帧数断言里穿插一次 `Page.captureScreenshot` 强制合成。

## 验证记录（v1.0.0）

| 项 | 结果 |
|---|---|
| `dist/index.html` vs `web/index.html` | 一致 |
| 去掉宿主桥片段 vs 原始 HTML | 逐字节一致 |
| `verify-plugin.mjs dist-pack` | 全部通过（3 条目；仅纯前端无 `.wasm` 的可忽略提示） |
| `.oplg` | 451,414 B，`totalBytes 1,428,517`，3 条目 |
| CDP 冒烟 | **41/41 通过**，无 JS 运行时异常、无 fatal |
| WebGL | 上下文有效，渲染循环持续推进 |
| 布局 | 1440/1440 无横向溢出 |
| 截图 | 7 张 1440 × 810，游戏画面 nonblack = 1.000 |

## 已知限制

- panel 高度受宿主「70% 屏高」硬限制；超高分辨率或高 DPI 缩放下实际高度会小于 810。
- `ESC` 可能被宿主用于关闭面板，与游戏内暂停冲突；建议点击面板外部关闭，或先在游戏内暂停。
- 部分 webview 可能不授予 Pointer Lock，游戏会自动降级为拖拽视角（操作说明里已有提示）。
- 无 GPU 的软件渲染环境帧率很低，属环境限制，不是插件问题。

## 发布状态（v1.0.0）

- **GitHub 仓库**：`https://github.com/ootools/otools-jimao`（public，`main`，作为 `xyito` 子模块挂载于 `otools/otools-jimao`）
- **Release**：`https://github.com/ootools/otools-jimao/releases/tag/plugin-otools-jimao-v1.0.0`
- **插件市场**：已上架 OTools 插件市场（latest 列表可见 `otools-jimao` v1.0.0「几猫港区 · 国产3A大作」）
- `build-plugin.yml` 每次 push `main` 自动跑通；`release-plugin.yml` 已成功发布一次（GitHub Release + 市场提交）。

## 本次未执行

- 未运行 `deploy-to-otools.ps1`（会写入 OTools 主仓库，需手动确认）。直接安装 `.oplg` 或在市场里搜索「几猫港区」即可使用。
