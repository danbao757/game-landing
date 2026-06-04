/* ============================================================
 * 高考冲刺大作战 - 游戏核心逻辑 v4
 * 支持 Firebase 实时同步（主持人↔观众跨设备联动）
 * ============================================================ */

// ─── 智谱AI ───
const ZHIPU = 'https://open.bigmodel.cn/api/paas/v4/chat/completions';
const ZHIPU_KEY = '7bf6eb414d39415baf72cd7ca57f56a1.StEPo8uIFfPtfTvf';

// ─── Firebase 配置 ───
// 1. 去 https://console.firebase.google.com/ 创建项目
// 2. 启用 Realtime Database（选择测试模式/允许读写）
// 3. 将下面的配置替换为你的项目配置
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyAvIHuLIIg2XdgEmJjtaB3_b0qisj5q1cU",
  authDomain: "gaokao-8cba2.firebaseapp.com",
  databaseURL: "https://gaokao-8cba2-default-rtdb.firebaseio.com",
  projectId: "gaokao-8cba2",
  storageBucket: "gaokao-8cba2.firebasestorage.app",
  messagingSenderId: "611236689106",
  appId: "1:611236689106:web:9b3ea640766fe4574c690b"
};

// ─── Firebase 实例 ───
let firebaseReady = false;
let db = null;
let roomRef = null;

// ─── 角色 ───
let role = 'host';
let audienceNick = '';

// ─── 游戏状态（本地缓存） ───
let rnd = 1;
let phase = 'input';
let story = `高三学生小明睡过头了，闹钟响了三遍都没听到。
当他终于醒来时，距离高考开始只剩30分钟！
而考场在城市的另一端，正常情况下需要40分钟车程...`;
let subs = [];
let myLikeId = '';
let branches = [];
let outcome = '';
let storyOpen = false;
let aiBusy = false;

let roomCode = '';
let simTimer = null;
let cdTimer = null;
let qIndex = 0;
let qAnswers = new Map();
let localWriteGuard = false; // 防止 Firebase 回写触发循环

// ─── 页面初始化 ───
document.addEventListener('DOMContentLoaded', () => {
  initFirebase();
  const p = new URLSearchParams(location.search);
  roomCode = p.get('room') || '';

  if (p.get('mode') === 'audience') {
    role = 'audience';
    if (roomCode && firebaseReady) {
      initRoomRef();
      listenGameFromFB();
      listenSubsFromFB();
    }
    enterAudienceGame();
  } else {
    showView('home');
  }
  initQR();
});

// ─── Firebase 初始化 ───
function initFirebase() {
  if (!FIREBASE_CONFIG.apiKey || FIREBASE_CONFIG.apiKey === 'YOUR_API_KEY') {
    console.warn('⚠ Firebase 未配置，将使用本地模式（无跨设备同步）');
    firebaseReady = false;
    return;
  }
  try {
    firebase.initializeApp(FIREBASE_CONFIG);
    db = firebase.database();
    firebaseReady = true;
    console.log('✅ Firebase 已连接');
  } catch (e) {
    console.error('Firebase 初始化失败:', e);
    firebaseReady = false;
  }
}

function initRoomRef() {
  if (!db || !roomCode) return;
  roomRef = db.ref('games/' + roomCode);
}

// ─── 游戏状态同步 ───
function syncGameToFB() {
  if (!roomRef || role !== 'host') return;
  localWriteGuard = true;
  roomRef.child('gameState').set({
    story: story, round: rnd, phase: phase,
    branches: JSON.stringify(branches), storyOpen: storyOpen,
    aiBusy: aiBusy, outcome: outcome
  });
  setTimeout(() => { localWriteGuard = false; }, 200);
}

function listenGameFromFB() {
  if (!roomRef || role === 'host') return;
  roomRef.child('gameState').on('value', snap => {
    if (localWriteGuard) return;
    const d = snap.val();
    if (!d) return;
    story = d.story || story;
    rnd = d.round || rnd;
    phase = d.phase || phase;
    branches = d.branches ? JSON.parse(d.branches) : [];
    storyOpen = !!d.storyOpen;
    aiBusy = !!d.aiBusy;
    outcome = d.outcome || '';
    updateUI();
  });
}

// ─── 投稿同步 ───
function pushSubToFB(sub) {
  if (!roomRef) return;
  localWriteGuard = true;
  roomRef.child('submissions').push(sub);
  setTimeout(() => { localWriteGuard = false; }, 200);
}

function listenSubsFromFB() {
  if (!roomRef) return;
  // 初次加载全量
  roomRef.child('submissions').once('value', snap => {
    const data = snap.val();
    subs = data ? Object.entries(data).map(([k, v]) => ({ id: k, ...v })) : [];
    subs.sort((a, b) => b.timestamp - a.timestamp);
    renderSubs();
  });
  // 监听新增
  roomRef.child('submissions').on('child_added', snap => {
    if (localWriteGuard) return;
    const s = { id: snap.key, ...snap.val() };
    if (!subs.find(x => x.id === s.id)) {
      subs.unshift(s);
      renderSubs();
    }
  });
  // 监听点赞变化
  roomRef.child('submissions').on('child_changed', snap => {
    if (localWriteGuard) return;
    const s = subs.find(x => x.id === snap.key);
    if (s) {
      s.likes = snap.val().likes;
      renderSubs();
    }
  });
}

function updateLikeInFB(subId, likes) {
  if (!roomRef) return;
  localWriteGuard = true;
  roomRef.child('submissions/' + subId + '/likes').set(likes);
  setTimeout(() => { localWriteGuard = false; }, 200);
}

// ─── 二维码 ───
function initQR() {
  const base = location.href.split('?')[0];
  const qrContainer = document.getElementById('qrcode-container');
  const qrUrlEl = document.getElementById('qr-url-display');
  const code = roomCode || '';
  const audienceUrl = base + '?mode=audience' + (code ? '&room=' + code : '');
  qrUrlEl.textContent = audienceUrl;
  qrContainer.innerHTML = '';
  try {
    new QRCode(qrContainer, {
      text: audienceUrl, width: 200, height: 200,
      colorDark: '#333', colorLight: '#fff', correctLevel: QRCode.CorrectLevel.M
    });
  } catch (e) {
    qrContainer.innerHTML = '<p style="font-size:14px;color:#FF6B00">二维码生成失败<br>请复制上方链接分享</p>';
  }
}

// ─── 视图 ───
function showView(name) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  const el = document.getElementById('view-' + name);
  if (el) el.classList.add('active');
  window.scrollTo(0, 0);
}

// ─── 生成房间号 ───
function generateRoomCode() {
  return Math.random().toString(36).substring(2, 6).toUpperCase();
}

// ─── 倒计时 ───
function startCountdown() {
  role = 'host';
  // 生成房间号并初始化 Firebase
  if (firebaseReady && !roomCode) {
    roomCode = generateRoomCode();
    initRoomRef();
    initQR(); // 更新二维码带上房间号
    // 清理旧数据
    if (roomRef) roomRef.remove();
  }
  showView('rule');
  document.getElementById('rule-countdown-label').textContent = '房间号: ' + (roomCode || '本地') + ' · 游戏即将开始';
  let n = 30;
  const el = document.getElementById('countdown-num');
  el.textContent = n; el.className = 'countdown-num';
  if (cdTimer) clearInterval(cdTimer);
  cdTimer = setInterval(() => {
    n--;
    el.textContent = n;
    if (n <= 10) el.className = 'countdown-num danger';
    else if (n <= 20) el.className = 'countdown-num warning';
    if (n <= 0) { clearInterval(cdTimer); initGame(); }
  }, 1000);
}

function enterAudienceGame() {
  role = 'audience';
  showView('rule');
  document.getElementById('rule-countdown-label').textContent = '📱 观众模式 · 房间: ' + (roomCode || '本地') + ' · 即将进入游戏';
  let n = 10;
  const el = document.getElementById('countdown-num');
  el.textContent = n; el.className = 'countdown-num';
  if (cdTimer) clearInterval(cdTimer);
  cdTimer = setInterval(() => {
    n--;
    el.textContent = n;
    if (n <= 10) el.className = 'countdown-num danger';
    if (n <= 0) { clearInterval(cdTimer); initGame(); }
  }, 1000);
}

function enterAudienceFromHome() {
  const base = location.href.split('?')[0];
  const params = ['mode=audience'];
  if (roomCode) params.push('room=' + roomCode);
  location.href = base + '?' + params.join('&');
}

// ─── 初始化游戏 ───
function initGame() {
  if (cdTimer) { clearInterval(cdTimer); cdTimer = null; }
  rnd = 1; phase = 'input'; outcome = ''; storyOpen = false; aiBusy = false;
  branches = []; myLikeId = '';
  qIndex = 0; qAnswers = new Map();
  story = `高三学生小明睡过头了，闹钟响了三遍都没听到。
当他终于醒来时，距离高考开始只剩30分钟！
而考场在城市的另一端，正常情况下需要40分钟车程...`;

  // 同步模式：host 写初始状态 + 监听投稿；audience 已通过 listenGameFromFB 监听
  if (role === 'host' && firebaseReady && roomRef) {
    subs = getMockSubs(1); // 初始种子投稿
    syncGameToFB();
    listenSubsFromFB();
    showView('game');
    updateUI();
    // 把种子投稿也推上去
    subs.forEach(s => pushSubToFB(s));
    // 不运行模拟器，等真实观众投稿
  } else if (role === 'host') {
    // 本地模式
    subs = getMockSubs(1);
    showView('game');
    updateUI();
    startSim();
  } else {
    // 观众模式
    showView('game');
    updateUI();
  }
}

// ─── UI刷新 ───
function updateUI() {
  document.getElementById('round-num').textContent = rnd;
  document.getElementById('round-badge').textContent = '第' + rnd + '关';
  document.getElementById('submission-count').textContent = '🔥 ' + subs.length + '条投稿';
  document.getElementById('submission-count-sm').textContent = '共 ' + subs.length + ' 条';

  const roleEl = document.getElementById('role-badge');
  roleEl.textContent = role === 'host' ? '🎬 主持人' : '📱 观众';
  roleEl.className = 'role-badge ' + (role === 'host' ? 'role-host' : 'role-audience');

  document.getElementById('audience-input-card').style.display = role === 'audience' ? '' : 'none';

  const phEl = document.getElementById('header-phase');
  if (phase === 'branch') {
    phEl.textContent = '🔀 请选择一个路线';
  } else {
    phEl.textContent = role === 'audience' ? '等待主持人选择策略…' : '请点击「命运之抽」或「众望所归」';
  }

  renderStory();
  renderSubs();

  if (phase === 'input') {
    document.getElementById('branch-card').style.display = 'none';
    document.getElementById('strategy-area').style.display = '';
    updateStrategyBtns();
  } else {
    document.getElementById('branch-card').style.display = '';
    document.getElementById('strategy-area').style.display = 'none';
    renderBranches();
  }
}

// ─── 剧情 ───
function renderStory() {
  let t = cleanStory(story);
  const btn = document.getElementById('toggle-story-btn');
  if (rnd > 1 && !storyOpen) {
    const lines = t.split('\n');
    if (lines.length > 8) {
      t = lines.slice(0, 3).join('\n') + '\n\n··· 以上剧情已折叠 ···\n\n' + lines.slice(-4).join('\n');
      btn.style.display = '';
      btn.textContent = '▼ 展开完整剧情';
    } else {
      btn.style.display = 'none';
    }
  } else {
    btn.style.display = rnd > 1 ? '' : 'none';
    btn.textContent = storyOpen ? '▲ 收起' : '▼ 展开完整剧情';
  }
  document.getElementById('story-text').textContent = t;
}

function toggleStory() {
  storyOpen = !storyOpen;
  document.getElementById('story-text').textContent = cleanStory(story);
  document.getElementById('toggle-story-btn').textContent = storyOpen ? '▲ 收起' : '▼ 展开完整剧情';
  if (role === 'host') syncGameToFB();
}

function cleanStory(s) {
  return s.replace(/续写\d+-\d+字/g, '').replace(/\[续写\d+-\d+字\]/g, '').replace(/【故事续写】/g, '').trim();
}

// ─── 策略按钮 ───
function updateStrategyBtns() {
  const rBtn = document.getElementById('btn-random');
  const tBtn = document.getElementById('btn-top');
  const hint = document.getElementById('strategy-hint');

  if (role === 'audience') {
    rBtn.disabled = true; tBtn.disabled = true;
    rBtn.textContent = '🎲 命运之抽（主持人）';
    tBtn.textContent = '📊 众望所归（主持人）';
    rBtn.title = '等待主持人操作'; tBtn.title = '等待主持人操作';
    hint.textContent = '你是观众模式，策略选择由主持人决定';
  } else {
    rBtn.disabled = aiBusy || subs.length === 0;
    tBtn.disabled = aiBusy || subs.length === 0;
    rBtn.textContent = aiBusy ? '⏳ 生成中…' : '🎲 命运之抽';
    tBtn.textContent = aiBusy ? '⏳ 生成中…' : '📊 众望所归';
    hint.textContent = '「命运之抽」随机选一条投稿，「众望所归」选票数最高的投稿';
  }
}

// ─── 观众投稿 ───
function submitAudienceTip() {
  if (role !== 'audience') return;
  const input = document.getElementById('audience-tip-input');
  const text = input.value.trim();
  if (!text) return;
  if (text.length > 200) { alert('最多200字'); return; }
  const sub = {
    content: text, likes: 0, timestamp: Date.now(),
    userName: audienceNick || ('观众' + Math.floor(Math.random() * 9000 + 1000))
  };
  input.value = '';

  if (firebaseReady && roomRef) {
    // 同步模式：推到 Firebase
    pushSubToFB(sub);
  } else {
    // 本地模式
    subs.unshift({ id: 'tip_' + Date.now(), ...sub });
    updateUI();
  }
  document.getElementById('submissions-card').scrollIntoView({ behavior: 'smooth' });
  // 字符计数重置
  document.getElementById('char-count').textContent = '0/200';
}

// ─── 触发AI ───
async function triggerAI(strategy) {
  if (role !== 'host') { alert('只有主持人可以操作！'); return; }
  if (aiBusy) return;
  let picked = strategy === 'highest' ? getTopSub() : getRandomSub();
  if (!picked) { alert('请先让观众投稿！'); return; }
  aiBusy = true;
  updateStrategyBtns();
  if (firebaseReady && roomRef) syncGameToFB();
  showAIModal(true);
  try {
    const res = await callAI(story, picked.content, rnd);
    if (res.success) {
      story = story + '\n\n' + cleanStory(res.continuation);
      branches = validateBranches(res.branches, picked.content);
      outcome = res.finalOutcome || '';
      storyOpen = false;
      phase = 'branch';
      if (firebaseReady && roomRef) syncGameToFB();
      updateUI();
    } else {
      alert('AI生成失败: ' + (res.error || '请重试'));
    }
  } catch (e) {
    alert('网络错误，请检查网络后重试');
  } finally {
    aiBusy = false;
    showAIModal(false);
    if (firebaseReady && roomRef) syncGameToFB();
    if (phase === 'input') updateUI();
  }
}

function showAIModal(show) {
  document.getElementById('ai-loading-modal').style.display = show ? 'flex' : 'none';
}

// ─── AI调用（含30秒超时） ───
async function callAI(curStory, selInput, roundNum) {
  const theme = getTheme(roundNum);
  const consist = buildConsistency(curStory, selInput);
  let preOutcome = '';
  if (roundNum === 4) preOutcome = Math.random() < 0.6 ? '失败' : '成功';

  const playerConst = `\n🔴【硬性约束 — 玩家行动已发生，绝不可推翻】🔴\n小明已经做了以下事情（已发生的事实）：${selInput}\n\n你的任务：延续这个已发生的事实展开。\n\n绝对禁止：分支中出现与已执行行动矛盾的交通工具/出行方式。\n例如玩家选了"爸爸开车送"，分支绝不能写"骑单车""跑步""打车"等。\n正确做法：分支围绕"当前状态下遇到什么情况"展开（如堵车/抄近路/抛锚/封路等）。`;

  const sys = `你是写实故事作家。续写60字以内。\n\n${theme}\n${playerConst}\n${consist}\n\n格式（严格）：\n【故事续写】\n(在此续写)\n【分支一】标题：[5字内] 描述：[不少于10字] 难度：简单\n【分支二】标题：[5字内] 描述：[不少于10字] 难度：中等\n【分支三】标题：[5字内] 描述：[不少于10字] 难度：困难\n${roundNum === 4 ? '【结局判定】最终结局必须为【' + preOutcome + '】，严格按此写结局' : ''}`;

  const trimmed = curStory.length > 1200
    ? curStory.slice(0, 200) + '\n···（中间剧情已折叠）···\n' + curStory.slice(-1000)
    : curStory;
  const user = `已确定的行动：${selInput}\n当前剧情：${trimmed}`;

  // ─── 30秒超时控制器 ───
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000);

  try {
    const resp = await fetch(ZHIPU, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + ZHIPU_KEY },
      body: JSON.stringify({
        model: 'glm-4-flash',
        messages: [{ role: 'system', content: sys }, { role: 'user', content: user }],
        max_tokens: 500, temperature: 0.6
      }),
      signal: controller.signal
    });
    clearTimeout(timeoutId);

    if (!resp.ok) return fail('API错误: ' + resp.status);
    const data = await resp.json();
    const txt = data.choices?.[0]?.message?.content || '';
    if (!txt) return fail('AI返回为空');

    const cont = (txt.match(/【故事续写】\s*([\s\S]*?)(?=【分支一】|$)/) || [])[1]?.trim() || txt.substring(0, 100);
    const brs = parseBranches(txt);
    let oc = '';
    if (roundNum === 4) oc = preOutcome === '成功' ? 'success' : 'failure';
    return { success: true, continuation: cont, branches: brs, finalOutcome: oc };
  } catch (e) {
    clearTimeout(timeoutId);
    if (e.name === 'AbortError') return fail('AI请求超时（30秒），请检查网络后重试');
    return fail('网络错误');
  }
}

function parseBranches(txt) {
  const brs = [];
  const labels = ['一', '二', '三'];
  const icons = ['🛵', '🚗', '🏃'];
  const fallbacks = [
    { title: '谨慎绕行', description: '走小路绕开拥堵', difficulty: '简单' },
    { title: '主路直冲', description: '走大路全速前进', difficulty: '中等' },
    { title: '冒险一搏', description: '铤而走险赌一把', difficulty: '困难' }
  ];
  for (let i = 0; i < 3; i++) {
    const re = new RegExp('【分支' + labels[i] + '】[\\s\\S]*?标题[：:]\\s*([^\\n]+?)\\s*描述[：:]\\s*([^\\n]+?)\\s*(?:难度[：:]\\s*([^\\n]+?))?(?=\\s*(?:【分支|【结局|$))');
    const m = txt.match(re);
    const title = (m?.[1] || fallbacks[i].title).trim();
    let desc = (m?.[2] || fallbacks[i].description).trim();
    desc = desc.replace(/不少于\d+字/g, '').replace(/一句话描述/g, '').replace(/\[[^\]]*\]/g, '').trim();
    if (desc.length < 2) desc = fallbacks[i].description;
    const diff = ((m?.[3] || fallbacks[i].difficulty).trim()).replace(/难度[：:]\s*/g, '');
    brs.push({ id: i + 1, title, description: desc, icon: icons[i], difficulty: diff });
  }
  return brs;
}

function fail(msg) { return { success: false, continuation: '', branches: [], error: msg }; }

// ─── 剧情一致性校验 ───
function validateBranches(brs, selInput) {
  let banWords = [];
  const a = selInput;
  if (/开车|爸爸|坐车/.test(a)) banWords = ['骑', '单车', '自行车', '跑步', '狂奔', '跑着', '走路', '步行', '打车', '出租', '网约', '叫车'];
  else if (/单车|骑车|自行车/.test(a)) banWords = ['开车', '打车', '出租', '网约', '叫车', '公交', '地铁', '坐车', '爸爸开车'];
  else if (/打车|出租|网约|叫车/.test(a)) banWords = ['骑', '单车', '自行车', '跑步', '狂奔', '跑着', '走路', '步行', '爸爸开车'];
  else if (/公交|地铁/.test(a)) banWords = ['骑', '单车', '自行车', '跑步', '狂奔', '跑着', '打车', '出租', '网约', '叫车', '开车'];
  else if (/跑步|狂奔|跑过去|跑着/.test(a)) banWords = ['开车', '打车', '出租', '网约', '叫车', '骑', '单车', '自行车', '公交', '地铁', '坐车'];
  if (banWords.length === 0) return brs;

  const fbs = [
    { title: '继续前行', description: '继续赶路，前方出现新变化', icon: '🛣️', difficulty: '简单' },
    { title: '遇到阻碍', description: '路途不顺利，需要想办法解决', icon: '⚠️', difficulty: '中等' },
    { title: '紧急决策', description: '时间紧迫，必须快速做决定', icon: '⏰', difficulty: '困难' }
  ];
  let fi = 0;
  return brs.map(b => {
    if (banWords.some(w => (b.title + b.description).includes(w))) {
      const fb = fbs[fi % fbs.length]; fi++;
      return { id: b.id, title: fb.title, description: fb.description, icon: fb.icon, difficulty: fb.difficulty };
    }
    return b;
  });
}

function buildConsistency(st, si) {
  let c = '⚠️【剧情一致性硬约束 — 必须遵守】⚠️\n以下剧情已经发生，绝不能矛盾：\n';
  if (si) c += '\n【当前关卡已执行的行动 — 不可推翻】\n小明已执行：' + si + '\n';
  const paths = [...st.matchAll(/【选择路径】([^\n]+)/g)].map(m => m[1].trim());
  if (paths.length === 0 && !si) {
    c += '- 高三学生小明，睡过头，赶去高考考场，时间紧迫\n';
  } else if (paths.length > 0) {
    c += '\n以下是小明之前关卡中已做出的选择，不可更改：\n';
    paths.forEach((p, i) => { c += '- 第' + (i+1) + '关选择：' + p + '\n'; });
  }
  c += '\n- 续写和分支必须基于已确定的状态\n';
  c += '- 【禁止】分支中出现与已确定行动矛盾的交通工具\n';
  return c;
}

function getTheme(r) {
  const m = {
    1: '第一关·紧急出发：小明冲出家门赶往考场。难度★★',
    2: '第二关·城市穿行：路上遇到现实障碍。难度★★★',
    3: '第三关·最大危机：时间紧迫，遭遇重大障碍。难度★★★★',
    4: '第四关·最后冲刺：考场就在眼前，突发意外！\n规则：简单路线暗藏陷阱，困难路线反而最稳妥。结尾标注【结局判定】。难度★★★★★'
  };
  return m[r] || '';
}

// ─── 分支渲染 ───
function renderBranches() {
  document.getElementById('branch-loading').style.display = aiBusy ? '' : 'none';
  const el = document.getElementById('branch-options');
  if (aiBusy || branches.length < 3) { el.innerHTML = ''; return; }
  el.innerHTML = branches.map(b =>
    '<div class="branch-option" onclick="pickBranch(' + b.id + ')">' +
    '<div class="branch-icon">' + b.icon + '</div>' +
    '<div class="branch-title">' + esc(b.title) + '</div>' +
    '<div class="branch-desc">' + esc(b.description) + '</div>' +
    '<span class="branch-difficulty ' + diffClass(b.difficulty) + '">' + esc(b.difficulty) + '</span>' +
    '</div>'
  ).join('');
}

function diffClass(d) {
  if (/简|easy/i.test(d)) return 'easy';
  if (/中|medium/i.test(d)) return 'medium';
  return 'hard';
}

// ─── 选择分支 ───
function pickBranch(id) {
  const b = branches.find(x => x.id === id);
  if (!b) return;
  story += '\n\n【选择路径】小明选择了' + b.title + '。' + b.description;
  if (rnd >= 4) {
    if (role === 'host') stopSim();
    const win = outcome === 'success';
    document.getElementById('outcome-emoji').textContent = win ? '🎉' : '😢';
    document.getElementById('outcome-title').textContent = win ? '成功抵达考场！' : '遗憾错过考试...';
    document.getElementById('outcome-msg').textContent = win
      ? '在全场观众的帮助下，小明终于冲进了考场！\n\n他气喘吁吁坐到座位上，翻开试卷的那一刻，嘴角露出了微笑。\n\n这一路虽然惊险，但有你们的支持，他没有放弃！\n\n接下来，测测你的高考人格类型吧～'
      : '尽管拼尽全力，最终还是没能及时赶到。\n\n但这段经历让他学会了珍惜时间、在困境中做选择。\n\n别灰心！人生的路很长，这只是一个小插曲。\n\n来测测你的高考人格类型吧～';
    document.getElementById('outcome-modal').classList.add('show');
    if (role === 'host' && firebaseReady && roomRef) syncGameToFB();
  } else {
    rnd++;
    if (role === 'host') {
      subs = firebaseReady ? getMockSubs(rnd) : getMockSubs(rnd);
    }
    myLikeId = ''; branches = []; outcome = ''; storyOpen = false;
    phase = 'input';
    updateUI();
    if (role === 'host') {
      if (firebaseReady && roomRef) {
        syncGameToFB();
        // 推送新一轮种子投稿
        subs.forEach(s => pushSubToFB(s));
      } else if (!firebaseReady) {
        startSim();
      }
    }
  }
}

function closeOutcome() {
  document.getElementById('outcome-modal').classList.remove('show');
  startQuiz();
}

// ─── 模拟观众（仅本地模式） ───
function startSim() {
  if (firebaseReady && roomRef) return; // 同步模式下不模拟
  stopSim();
  var names = ['高三·阿杰','高三·小美','高三·大壮','学霸同桌','卷王','佛系少女',
    '送考爸爸','隔壁班老王','吃瓜群众','追梦少年','热心市民','语文课代表'];
  var pool = [
    '骑共享单车啊，手机扫码一秒搞定！','打车吧，现在叫车很快的',
    '让他爸开车送，双闪一路飙过去','走小路穿小区，比大路快多了',
    '求助路边交警叔叔，说明情况','打电话给考场老师，看能不能通融',
    '地铁！地铁不堵车而且准时','跑！什么都别想，就是跑！',
    '让同学在考场门口接应他','翻墙抄近道，中学后面有捷径',
    '借路边外卖小哥的电动车','拦一辆出租车，给双倍车费',
    '先把准考证找出来，别慌！','发朋友圈求助，万能的朋友圈',
    '用导航选躲避拥堵路线','稳住心态，深呼吸，保持冷静'
  ];
  var tick = function() {
    if (phase !== 'input') { simTimer = setTimeout(tick, 4000); return; }
    var r = Math.random();
    if (r < 0.30) {
      var name = names[Math.floor(Math.random() * names.length)];
      var txt = pool[Math.floor(Math.random() * pool.length)];
      if (Math.random() < 0.3) txt += ' 💪';
      subs = [{ id: 'sim_' + Date.now(), content: txt, likes: Math.floor(Math.random() * 3) + 1, timestamp: Date.now(), userName: name }, ...subs];
      renderSubs();
    } else if (r < 0.7 && subs.length > 0) {
      var idx = Math.floor(Math.random() * subs.length);
      subs[idx].likes++;
      renderSubs();
    }
    simTimer = setTimeout(tick, 1800 + Math.random() * 3500);
  };
  simTimer = setTimeout(tick, 1200);
}

function stopSim() { if (simTimer) { clearTimeout(simTimer); simTimer = null; } }

// ─── 投稿墙 ───
function renderSubs() {
  var el = document.getElementById('submissions-list');
  el.innerHTML = subs.map(function(s) {
    return '<div class="submission-item">' +
    '<div class="submission-header">' +
    '<span class="submission-name">' + esc(s.userName) + '</span>' +
    '<span class="submission-time">' + fmtTime(s.timestamp) + '</span>' +
    '</div>' +
    '<div class="submission-content">' + esc(s.content) + '</div>' +
    '<div class="submission-footer">' +
    '<button class="like-btn ' + (myLikeId === s.id ? 'liked' : '') + '" onclick="doLike(\'' + s.id + '\')">' +
    (myLikeId === s.id ? '❤️' : '🤍') + ' ' + s.likes +
    '</button>' +
    '</div></div>';
  }).join('');
  // 更新顶部计数
  document.getElementById('submission-count').textContent = '🔥 ' + subs.length + '条投稿';
  document.getElementById('submission-count-sm').textContent = '共 ' + subs.length + ' 条';
}

function doLike(id) {
  var s = subs.find(function(x) { return x.id === id; });
  if (!s) return;
  if (myLikeId === id) {
    s.likes = Math.max(0, s.likes - 1);
    myLikeId = '';
  } else {
    if (myLikeId) {
      var o = subs.find(function(x) { return x.id === myLikeId; });
      if (o) o.likes = Math.max(0, o.likes - 1);
    }
    s.likes++;
    myLikeId = id;
  }
  // 同步到 Firebase
  if (firebaseReady && roomRef) {
    updateLikeInFB(id, s.likes);
  }
  renderSubs();
}

function getTopSub() { return subs.length ? subs.reduce(function(a, b) { return a.likes > b.likes ? a : b; }) : null; }
function getRandomSub() { return subs.length ? subs[Math.floor(Math.random() * subs.length)] : null; }

// ─── Mock ───
function getMockSubs(r) {
  var b = Date.now();
  var m = {
    1: [
      { id:'r1_1', content:'小明飞快穿好衣服，抓起书包就往外冲', likes:12, userName:'观众A' },
      { id:'r1_2', content:'他决定骑共享单车抄近路去考场', likes:8, userName:'观众B' },
      { id:'r1_3', content:'小明打电话给爸爸，让他开车送自己', likes:15, userName:'观众C' },
      { id:'r1_4', content:'叫个网约车，直接输入考场地址', likes:5, userName:'路人D' }
    ],
    2: [
      { id:'r2_1', content:'小明决定穿过公园抄近路', likes:10, userName:'路人甲' },
      { id:'r2_2', content:'他看到路边有摩的，赶紧招手拦车', likes:14, userName:'路人乙' },
      { id:'r2_3', content:'让同学帮忙查实时路况，选最优路线', likes:9, userName:'路人丙' }
    ],
    3: [
      { id:'r3_1', content:'手机快没电了，先问路人借充电宝', likes:11, userName:'热心市民' },
      { id:'r3_2', content:'求助路边交警，看能否帮忙开道', likes:16, userName:'交警叔叔' },
      { id:'r3_3', content:'准备跑过去，拼最后一把', likes:7, userName:'旁观者' }
    ],
    4: [
      { id:'r4_1', content:'小明看到考场大门了，但排队人很多', likes:13, userName:'送考家长' },
      { id:'r4_2', content:'从后门绕进去，那里人少', likes:10, userName:'保安大叔' },
      { id:'r4_3', content:'大喊我是考生，让前面的人让一让', likes:17, userName:'监考老师' }
    ]
  };
  return (m[r] || m[1]).map(function(d) { d.timestamp = b - (m[r].length - m[r].indexOf(d)) * 60000; return d; });
}

// ─── 答题 ───
function startQuiz() {
  qIndex = 0; qAnswers = new Map();
  showView('quiz');
  renderQ();
}

function renderQ() {
  var qs = getQs();
  var q = qs[qIndex];
  document.getElementById('quiz-num').textContent = qIndex + 1;
  document.getElementById('quiz-progress-fill').style.width = ((qIndex + 1) / qs.length * 100) + '%';
  document.getElementById('quiz-question').textContent = q.question;
  document.getElementById('quiz-options').innerHTML = q.options.map(function(o) {
    return '<div class="quiz-option" onclick="answerQ(\'' + o.id + '\')">' + esc(o.text) + '</div>';
  }).join('');
}

function answerQ(oid) {
  qAnswers.set(getQs()[qIndex].id, oid);
  if (qIndex < getQs().length - 1) { qIndex++; renderQ(); }
  else showResult();
}

function getQs() {
  return [
    { id:1, question:'离高考还有一个月，你的复习计划严重落后，你会？', options:[
      { id:'A', text:'制定更严格的计划，压缩休息时间赶进度', scores:{J:10,S:10,T:10} },
      { id:'B', text:'调整心态，果断放弃次要内容，死磕重点', scores:{P:10,E:10,F:10} },
      { id:'C', text:'找老师和学霸请教，重新制定高效策略', scores:{E:10,N:10,J:10} },
      { id:'D', text:'不给自己太大压力，尽力而为顺其自然', scores:{I:10,S:10,P:10} }
    ]},
    { id:2, question:'考场上，旁边同学偷看你的答题卡，你会？', options:[
      { id:'A', text:'不动声色地把答题卡往自己方向挪了挪', scores:{I:10,T:10,J:10} },
      { id:'B', text:'果断举手，小声告知监考老师', scores:{E:10,S:10,J:10} },
      { id:'C', text:'无所谓，反正我的答案也不一定对', scores:{E:10,N:10,F:10} },
      { id:'D', text:'内心有点不舒服，但强忍下来专注自己', scores:{I:10,F:10,T:10} }
    ]},
    { id:3, question:'考完数学后大家讨论答案，你发现最后一道大题做错了，你会？', options:[
      { id:'A', text:'立刻翻书验证，越想越懊悔，久久不能释怀', scores:{T:10,J:10,S:10} },
      { id:'B', text:'告诉自己无法改变的事就别想了，专心备战下一科', scores:{P:10,N:10,F:10} },
      { id:'C', text:'找同学倾诉情绪，互相安慰打气', scores:{E:10,F:10,N:10} },
      { id:'D', text:'一个人安静地消化，不再对任何人提起', scores:{I:10,S:10,F:10} }
    ]},
    { id:4, question:'如果高考成绩比预估低了30分，你的第一反应是？', options:[
      { id:'A', text:'怀疑阅卷出问题，立刻申请复核分数', scores:{T:10,J:10,I:10} },
      { id:'B', text:'冷静接受现实，马上研究这个分段能报什么学校', scores:{P:10,S:10,T:10} },
      { id:'C', text:'情绪崩溃大哭一场，然后和父母商量下一步', scores:{F:10,E:10,J:10} },
      { id:'D', text:'相信一切都是最好的安排，人生路不止一条', scores:{N:10,I:10,P:10} }
    ]},
    { id:5, question:'高考结束后，你最想对曾经的自己说什么？', options:[
      { id:'A', text:'"你应该可以更拼一点的"', scores:{J:10,S:10,T:10} },
      { id:'B', text:'"谢谢你没有放弃，坚持到了最后"', scores:{F:10,P:10,N:10} },
      { id:'C', text:'"不论结果如何，我都为你感到骄傲"', scores:{E:10,F:10,N:10} },
      { id:'D', text:'"这段奋斗的时光本身，就已经很珍贵了"', scores:{I:10,S:10,P:10} }
    ]}
  ];
}

// ─── 结果 ───
function showResult() {
  var sc = { E:50, I:50, S:50, N:50, T:50, F:50, J:50, P:50 };
  qAnswers.forEach(function(oid, qid) {
    var q = getQs().find(function(x) { return x.id === qid; });
    var o = q && q.options.find(function(x) { return x.id === oid; });
    if (o) Object.keys(o.scores).forEach(function(k) { sc[k] += o.scores[k]; });
  });
  var type = (sc.E >= sc.I ? 'E' : 'I') + (sc.N >= sc.S ? 'N' : 'S') + (sc.T >= sc.F ? 'T' : 'F') + (sc.J >= sc.P ? 'J' : 'P');
  var info = typeMap()[type] || { name:'独一无二的你', desc:'你拥有与众不同的性格组合。高考只是人生旅途中的一站，你拥有无限的潜能。', blessing:'🌈 愿高考成为你精彩人生的新起点！', advice:'相信自己的独特之处，大胆探索属于你的人生道路' };

  document.getElementById('result-emoji').textContent = emojiFor(type);
  document.getElementById('result-type').textContent = type;
  document.getElementById('result-name').textContent = info.name;
  document.getElementById('result-desc').textContent = info.desc;
  document.getElementById('result-blessing').textContent = info.blessing;
  document.getElementById('result-advice').textContent = info.advice;
  renderDims(sc);
  showView('result');
}

function renderDims(sc) {
  var dims = [
    { name:'能量来源', left:'内向(I)', right:'外向(E)', pct:Math.round(sc.E/(sc.E+sc.I)*100) },
    { name:'认知方式', left:'感觉(S)', right:'直觉(N)', pct:Math.round(sc.N/(sc.N+sc.S)*100) },
    { name:'决策方式', left:'思考(T)', right:'情感(F)', pct:Math.round(sc.F/(sc.F+sc.T)*100) },
    { name:'生活方式', left:'判断(J)', right:'感知(P)', pct:Math.round(sc.P/(sc.P+sc.J)*100) }
  ];
  document.getElementById('dimensions').innerHTML = dims.map(function(d) {
    return '<div class="dimension-item">' +
    '<div class="dimension-name">' + d.name + '</div>' +
    '<div class="dimension-bar"><div class="dimension-fill" style="width:' + d.pct + '%"></div></div>' +
    '<div class="dimension-labels"><span>' + d.left + '</span><span>' + d.right + '</span></div>' +
    '</div>';
  }).join('');
}

function emojiFor(t) {
  var m = { ENFP:'🎨',ENFJ:'👑',ENTP:'💡',ENTJ:'🏆',ESFP:'🎭',ESFJ:'🤝',ESTP:'⚡',ESTJ:'📋',
    INFP:'🕊️',INFJ:'🔮',INTP:'🔬',INTJ:'🏗️',ISFP:'🎵',ISFJ:'🛡️',ISTP:'🔧',ISTJ:'📊' };
  return m[t]||'🌈';
}

function typeMap() {
  return {
    ENFP:{ name:'社团点子王', desc:'你是班级里最有创意的那一个，脑子里永远有数不完的新点子。在备考中，你用天马行空的想象力把枯燥的知识变成有趣的记忆法。同桌说跟你一起复习永远不会无聊！', blessing:'🌟 愿你的创造力在考场上闪闪发光！你不需要像别人那样死记硬背，你有自己独特的学习方式。保持你的热情和好奇心，大学社团在向你招手！', advice:'发挥你的创意优势，同时记得制定一个具体的时间表，把灵感落地为行动' },
    ENFJ:{ name:'班级精神领袖', desc:'你是班里的主心骨，总能在大家最焦虑的时候给出一句暖心的话。高三最后一个月，同学们都说"有你在就安心"。', blessing:'👑 愿你的温暖和领导力照亮最后的冲刺！你不仅会考上理想的大学，还会成为大学里最受欢迎的学长/学姐。', advice:'在照顾大家情绪的同时，也别忘了给自己留一些安静的独处时间' },
    ENTP:{ name:'解题鬼才', desc:'面对压轴题，别人还在苦思冥想，你已经找到了三种不同的解法。你享受攻克难题的快感，不按常理出牌是你的标签。', blessing:'💡 愿你的聪明才智在考场上大杀四方！没有难题能困住你，你天生就是来找bug的。', advice:'发挥你的思维优势，但别忘了扎实基础，答题时多检查一遍' },
    ENTJ:{ name:'学霸指挥官', desc:'你是班级里的"总设计师"，高三开学就画好了复习路线图，每一步都目标明确。你不是在学习，你是在执行一场精密的战役。', blessing:'🏆 愿你的战略布局在高考中大获全胜！你的执行力和规划能力让你注定成为想成为的人。', advice:'计划很棒，但也要给自己留一点弹性空间，偶尔放松反而效率更高' },
    ESFP:{ name:'班级活宝', desc:'你是班里的开心果，课间十分钟也能把全班逗得哈哈大笑。面对高考压力，你用乐观化解焦虑，是大家的"情绪充电宝"。', blessing:'🎭 愿你的阳光心态融化考场上的一切紧张！笑着答题的你运气不会太差。', advice:'保持乐观，但每一道题都要认真对待，别让粗心偷走你的分数' },
    ESFJ:{ name:'暖心课代表', desc:'你是老师最信赖的帮手、同学最依赖的伙伴。每次发复习资料你都多印几份，生怕有人没拿到。你的善良和责任感让你成为班级里最温暖的存在。', blessing:'🤝 愿你的善良在高考中获得最美好的回报！你一直照顾着身边的人，现在请相信世界也会温柔待你。', advice:'照顾别人也要照顾好自己，相信你已经准备得足够好了' },
    ESTP:{ name:'行动派少年', desc:'你不是那种坐得住的人，比起刷题你更相信"实战出真知"。面对突发状况你从不慌张，考场上的任何意外都难不倒你。', blessing:'⚡ 愿你的果敢和应变力让你在高考中如鱼得水！你是天生的实战派。', advice:'发挥你的行动力优势，答题时沉住气多检查一遍，稳中求胜' },
    ESTJ:{ name:'自律大学霸', desc:'你是教室最早到、最晚走的那个人。你的错题本比别人的课本还厚，每一道题旁边都工工整整写着解题思路。', blessing:'📋 愿你的每一份努力都在高考中完美兑现！自律的人值得最好的结果。', advice:'你的自律能力超强，但也要偶尔放松一下，去操场跑一圈也很好' },
    INFP:{ name:'文艺梦想家', desc:'你的笔记本扉页上写着喜欢的诗，桌面贴着梦想大学的照片。你有丰富的内心世界，高考对你来说不只是考试，而是通往梦想的桥。', blessing:'🕊️ 愿你心中的诗和远方照亮高考的每一分钟！你的梦想值得被认真对待。', advice:'保持你的梦想力，同时把大目标拆成每天的小任务，一步步靠近' },
    INFJ:{ name:'深度思考者', desc:'你不满足于"是什么"，总要追问"为什么"。在别人刷题的时候，你在理解知识背后的逻辑。', blessing:'🔮 愿你的深度思考在高考中带你看透每一道题的本质！', advice:'深度思考很宝贵，但也别忘了照顾好自己的身体和睡眠' },
    INTP:{ name:'理科学霸', desc:'你是数理化的王者，解题对你来说就像玩游戏。你享受推导公式的快感，草稿纸上写满了别人看不懂的演算。', blessing:'🔬 愿你的逻辑思维在高考中大放异彩！每一道难题都在等待你来破解。', advice:'发挥你的理科优势，但语文英语也要稳住，注意书写规范' },
    INTJ:{ name:'未来规划师', desc:'你早就在心里画好了未来十年的蓝图——什么大学、什么专业、什么工作。高三对你来说只是计划中的一环。', blessing:'🏗️ 愿你精心规划的蓝图在高考中完美展开！你是天生的战略家。', advice:'计划很完美，但也接受过程中的小偏差，路不只一条' },
    ISFP:{ name:'艺术特长生', desc:'你有独特的审美和节奏，不随波逐流。别人刷五三，你可能有自己的复习方法。你相信感觉，直觉往往比分析更准确。', blessing:'🎨 愿你的独特天赋在高考中画出最美的答卷！你不需要和别人一样。', advice:'保持你的独特风格，但也跟上整体复习进度，别落下重要知识点' },
    ISFJ:{ name:'默默耕耘者', desc:'你从不张扬，但你的努力所有人都看在眼里。每天第一个到教室开灯的是你，默默把黑板擦干净的是你。', blessing:'🛡️ 愿你的坚持和付出在高考中获得最丰厚的回报！你走过的每一步都算数。', advice:'你的踏实很珍贵，偶尔也要抬头看看方向，和同学交流一下心得' },
    ISTP:{ name:'动手达人', desc:'你不是纸上谈兵的类型，比起听课你更喜欢动手实验。你冷静理性，考场上的紧张气氛影响不了你。', blessing:'🔧 愿你的冷静和实用智慧在高考中扫清一切障碍！你总是能找到最优解。', advice:'你很务实，但也要给理想留一些空间，保持对大学生活的憧憬' },
    ISTJ:{ name:'稳扎稳打型', desc:'你是考场上最稳的那一个，从不慌乱。你的笔记工整得像印刷品，每一道错题都认真订正。你不靠运气，靠日复一日的踏实努力。', blessing:'📊 愿你的稳重和扎实为高考奠定最坚实的基础！你从来不靠运气靠实力。', advice:'你的稳定性超强，偶尔也可以尝试一下新的学习方法换换口味' }
  };
}

// ─── 重新开始 ───
function restartGame() {
  location.href = location.href.split('?')[0];
}

// ─── 工具 ───
function esc(s) {
  var d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

function fmtTime(ts) {
  var diff = Date.now() - ts;
  if (diff < 60000) return '刚刚';
  if (diff < 3600000) return Math.floor(diff / 60000) + '分钟前';
  if (diff < 86400000) return Math.floor(diff / 3600000) + '小时前';
  return Math.floor(diff / 86400000) + '天前';
}
