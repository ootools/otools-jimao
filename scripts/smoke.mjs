/**
 * 真实浏览器冒烟：验证「几猫港区」这个 WebGL 游戏在 OTools panel 尺寸下能启动、
 * 能渲染、菜单/设置/操作说明可用、能进入游戏，并截图。无第三方依赖。
 *
 * 用法（服务 + Chrome 由外部同一条 shell 命令拉起，见 README）：
 *   CDP_PORT=9251 BASE_URL=http://127.0.0.1:6511/ node scripts/smoke.mjs
 *
 * Chrome 必须启用 SwiftShader，否则 headless 下 WebGL 不可用、游戏会 fatal：
 *   --enable-unsafe-swiftshader --use-gl=angle --use-angle=swiftshader
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS = path.join(root, '_shots');
fs.mkdirSync(SHOTS, { recursive: true });

const CDP_PORT = Number(process.env.CDP_PORT || 9251);
const BASE = process.env.BASE_URL || 'http://127.0.0.1:6511/';
const W = 1440;
const H = 810;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function connect() {
  let page = null;
  for (let i = 0; i < 30 && !page; i += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json();
      page = list.find((t) => t.type === 'page');
    } catch (e) { /* Chrome 还在启动 */ }
    if (!page) await sleep(300);
  }
  if (!page) throw new Error('找不到 CDP 页面目标');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

  let id = 0;
  const pending = new Map();
  const jsErrors = [];
  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
    if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params.exceptionDetails;
      jsErrors.push((d.text || '') + ' ' + (d.exception && d.exception.description ? d.exception.description : ''));
    }
  };
  const send = (method, params) => new Promise((resolve) => {
    const msgId = ++id;
    pending.set(msgId, resolve);
    ws.send(JSON.stringify({ id: msgId, method, params: params || {} }));
  });
  return { send, jsErrors, ws };
}

async function main() {
  const { send, jsErrors, ws } = await connect();
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', {
    width: W, height: H, deviceScaleFactor: 1, mobile: false,
  });
  // headless 会把页面当成后台，rAF 被节流到几乎不推进；游戏 intro 依赖帧时间，
  // 不强制「前台」就会一直卡在过场、HUD 不激活。
  await send('Emulation.setFocusEmulationEnabled', { enabled: true });
  await send('Page.setWebLifecycleState', { state: 'active' });

  const evaluate = async (expression) => {
    const res = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (res.result && res.result.exceptionDetails) throw new Error(res.result.exceptionDetails.text);
    return res.result && res.result.result ? res.result.result.value : undefined;
  };
  const exists = (sel) => evaluate(`!!document.querySelector(${JSON.stringify(sel)})`);
  const count = (sel) => evaluate(`document.querySelectorAll(${JSON.stringify(sel)}).length`);
  const text = (sel) => evaluate(`(document.querySelector(${JSON.stringify(sel)})||{}).textContent||''`);
  const click = (sel) => evaluate(`(function(){var e=document.querySelector(${JSON.stringify(sel)});if(!e)return false;e.click();return true;})()`);
  const visible = (sel) => evaluate(`(function(){var e=document.querySelector(${JSON.stringify(sel)});if(!e)return false;var s=getComputedStyle(e);return s.display!=='none'&&s.visibility!=='hidden'&&!e.hidden&&e.getClientRects().length>0;})()`);

  const results = [];
  const check = (name, ok, detail) => {
    results.push({ name, ok });
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  → ' + detail : ''}`);
  };
  const shot = async (name) => {
    const res = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    if (res.result && res.result.data) {
      fs.writeFileSync(path.join(SHOTS, name + '.png'), Buffer.from(res.result.data, 'base64'));
      console.log(`  shot  ${name}.png`);
    }
  };
  const navigate = async (url, readyExpr = 'window.__ready === true') => {
    await send('Page.navigate', { url });
    for (let i = 0; i < 90; i += 1) {
      await sleep(250);
      let ready = false;
      try { ready = await evaluate(readyExpr); } catch (e) { /* 页面还在 about:blank */ }
      if (ready) return true;
      const fatal = await evaluate('window.__fatal || null').catch(() => null);
      if (fatal) throw new Error('启动失败：' + fatal);
    }
    throw new Error('页面加载超时：' + url);
  };

  // ── 启动（noaudio 避免 headless 下 AudioContext 噪声） ──────────────
  await navigate(BASE + '?noaudio=1');

  check('页面标题为「几猫3A大作」', (await evaluate('document.title')) === '几猫3A大作');
  check('宿主桥标记已注入', (await evaluate('window.__OTOOLS_PLUGIN__ && window.__OTOOLS_PLUGIN__.packid')) === 'otools-jimao');
  check('游戏启动完成（__ready）', (await evaluate('window.__ready')) === true);
  check('无致命错误（__fatal）', (await evaluate('window.__fatal || null')) === null,
    await evaluate('window.__fatal || "null"'));
  check('游戏内部错误列表为空', (await evaluate('window.__errors.length')) === 0,
    await evaluate('JSON.stringify(window.__errors.slice(0, 3))'));
  check('未出现 #fatal 错误条', (await exists('#fatal')) === false);

  // ── WebGL 与渲染循环 ────────────────────────────────────────────
  check('canvas 存在且铺满面板', (await evaluate(
    "(function(){var c=document.getElementById('view');return !!c && c.width>0 && c.height>0 && Math.abs(c.getBoundingClientRect().width - innerWidth)<2;})()")) === true,
    await evaluate('(function(){var c=document.getElementById("view");return c.width+"x"+c.height;})()'));
  check('WebGL 上下文有效', (await evaluate(
    "(function(){var c=document.getElementById('view');var g=c.getContext('webgl2')||c.getContext('webgl');return !!g && !g.isContextLost();})()")) === true);
  console.log('  diag visibility:', await evaluate('document.visibilityState + " hidden=" + document.hidden'));
  const framesA = await evaluate('window.__frames');
  await sleep(1200);
  // headless 合成器在页面静止时不主动出帧；请求一次截图可强制合成一帧。
  // SwiftShader 在 1440×810 下每帧约 400ms，不能用桌面 GPU 的帧率做阈值。
  await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  await sleep(500);
  const framesB = await evaluate('window.__frames');
  check('渲染循环可推进', framesB > framesA, `${framesA} → ${framesB}`);
  check('启动遮罩已隐藏', (await evaluate(
    "(function(){var b=document.getElementById('boot');return !!b && (b.classList.contains('done')||b.hidden);})()")) === true);
  check('panel 尺寸下无横向溢出',
    (await evaluate('document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1')) === true,
    await evaluate('document.documentElement.scrollWidth + "/" + document.documentElement.clientWidth'));

  // ── 主菜单 ─────────────────────────────────────────────────────
  check('主菜单处于 title 屏', (await evaluate('(document.querySelector(".menu")||{}).dataset?.screen')) === 'title');
  check('「开始行动」按钮可见', (await visible('[data-act="deploy"]')) === true);
  check('标题文案含「几猫」', (await text('.m-word')).includes('几猫'), await text('.m-word'));
  check('任务前提文案完整', (await text('.m-premise')).includes('切断三处中继'), await text('.m-premise'));
  check('主菜单含四个入口', (await count('.m-title [data-act]')) >= 4,
    await evaluate('[...document.querySelectorAll(".m-title [data-act]")].map(e=>e.dataset.act).join(",")'));
  check('标注为开发体验版', (await text('.m-note')).includes('开发体验版'));
  await shot('01-menu');

  // ── 设置面板 ────────────────────────────────────────────────────
  check('点击「设置」打开面板', (await click('[data-act="settings"]')) === true);
  await sleep(250);
  check('设置面板可见', (await visible('.panel')) === true);
  check('灵敏度滑块存在', (await exists('#s-sens')) === true);
  check('音量滑块存在', (await exists('#s-vol')) === true);
  check('FOV 滑块存在', (await exists('#s-fov')) === true);
  check('四档画质可选', (await count('[data-q]')) === 4,
    await evaluate('[...document.querySelectorAll("[data-q]")].map(e=>e.dataset.q).join(",")'));
  await shot('02-settings');

  // 改一次灵敏度，验证交互与 localStorage 持久化
  await evaluate("(function(){var i=document.getElementById('s-sens');i.value='1.75';i.dispatchEvent(new Event('input',{bubbles:true}));return true;})()");
  await sleep(150);
  check('设置写入 localStorage', (await evaluate(
    "(function(){try{var s=JSON.parse(localStorage.getItem('saltline.settings.v1')||'null');return !!s && Math.abs(s.sens-1.75)<0.001;}catch(e){return false;}})()")) === true,
    await evaluate("localStorage.getItem('saltline.settings.v1')"));

  // 切到「操作说明」页签
  const controlsTab = await evaluate(
    "(function(){var t=[...document.querySelectorAll('.tab')].find(e=>/操作|控制/.test(e.textContent));if(t){t.click();return t.textContent.trim();}return null;})()");
  await sleep(200);
  check('操作说明页签可切换', controlsTab !== null, controlsTab || 'null');
  check('键鼠操作说明可见', (await evaluate(
    "(function(){var p=document.querySelector('[data-pane=\"controls\"]');return !!p && !p.hidden && /W/.test(p.textContent) && /鼠标/.test(p.textContent);})()")) === true);
  await shot('03-controls');

  // 关闭设置面板
  await evaluate("(function(){var b=document.querySelector('.panel [data-act=\"close\"]')||document.querySelector('.panel-h [data-act]');if(b)b.click();return true;})()");
  await sleep(200);

  // ── 项目介绍 ────────────────────────────────────────────────────
  check('点击「项目介绍」', (await click('[data-act="about"]')) === true);
  await sleep(200);
  check('介绍文案含 Fable5.2 与国产第一人称射击', (await evaluate(
    "(function(){var t=document.body.innerText;return /Fable5\\.2/.test(t) && /国产第一人称射击/.test(t);})()")) === true);
  await shot('04-about');
  await evaluate("(function(){var b=[...document.querySelectorAll('[data-act]')].find(e=>/^(close|back|menu)$/.test(e.dataset.act));if(b)b.click();return true;})()");
  await sleep(200);

  // ── 进入游戏 ────────────────────────────────────────────────────
  check('点击「开始行动」', (await click('[data-act="deploy"]')) === true);
  // intro 是一段按帧时间计时的过场，等它自然结束再检查 HUD；headless 下合成器
  // 偶尔空转，穿插一次空截图强制推进一帧。
  let hudOn = false;
  for (let i = 0; i < 40 && !hudOn; i += 1) {
    await sleep(300);
    hudOn = await evaluate('!!document.querySelector(".hud.on")');
    if (!hudOn && i % 10 === 9) await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  }
  check('菜单已退出', (await evaluate('(document.querySelector(".menu")||{}).dataset?.screen')) !== 'title',
    await evaluate('(document.querySelector(".menu")||{}).dataset?.screen || "null"'));
  check('HUD 已出现', (await exists('.hud')) === true);
  // intro 是 3.5 秒游戏时间，headless SwiftShader 帧率极低时推进很慢。
  // 完整 HUD 激活改由下面的 skipIntro 路径确定性验证；这里只确认进入了过场。
  check('已进入行动过场', (await exists('.loc-card')) === true, `hudOn(loop)=${hudOn} frames=${await evaluate('window.__frames')}`);
  check('进入游戏后仍无致命错误', (await evaluate('window.__fatal || null')) === null);
  const framesC = await evaluate('window.__frames');
  await sleep(1500);
  const framesD = await evaluate('window.__frames');
  check('游戏进行中渲染未停滞', framesD > framesC, `${framesC} → ${framesD}`);
  await shot('05-game');

  // 稍后再截一张，避开过场动画
  await sleep(1800);
  await shot('06-game-hud');

  // ── 直接 autostart 启动路径 ─────────────────────────────────────
  await navigate(BASE + '?noaudio=1&autostart=1');
  check('autostart 直接进游戏', (await evaluate('(document.querySelector(".menu")||{}).dataset?.screen')) !== 'title');
  check('skipIntro 后 HUD 已激活', (await evaluate('!!document.querySelector(".hud.on")')) === true);
  check('skipIntro 后任务目标已设置', (await text('.h-obj-t')).trim().length > 0, await text('.h-obj-t'));
  check('autostart 下渲染正常', (await evaluate('window.__frames')) >= 2);
  await sleep(600);
  await shot('07-autostart-game');
  check('重载后设置仍持久化', (await evaluate(
    "(function(){try{var s=JSON.parse(localStorage.getItem('saltline.settings.v1')||'null');return !!s && Math.abs(s.sens-1.75)<0.001;}catch(e){return false;}})()")) === true);
  check('重载后无横向溢出',
    (await evaluate('document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1')) === true,
    await evaluate('document.documentElement.scrollWidth + "/" + document.documentElement.clientWidth'));

  // ── 全程 JS 异常 ────────────────────────────────────────────────
  const realErrors = jsErrors.filter((s) => !/favicon|net::ERR_/.test(s));
  check('全程无 JS 运行时异常', realErrors.length === 0, realErrors.slice(0, 3).join(' | '));

  const passed = results.filter((r) => r.ok).length;
  console.log(`\n===== ${passed}/${results.length} 通过 =====`);
  const failed = results.filter((r) => !r.ok);
  if (failed.length) {
    console.log('失败项：');
    failed.forEach((r) => console.log('  - ' + r.name));
  }
  // 不关掉 CDP WebSocket，node 事件循环不会空，进程会一直挂着拖垮整条 shell 命令。
  ws.close();
  await sleep(150);
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => { console.error('SMOKE ERROR:', e.stack || e); process.exit(1); });
