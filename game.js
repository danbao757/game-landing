/* ============================================================
 * 高考冲刺大作战 - 游戏核心逻辑
 * ============================================================ */

// ─── ZhiPu AI 配置 ───
const ZHIPU_API_URL = 'https://open.bigmodel.cn/api/paas/v4/chat/completions';
const ZHIPU_API_KEY = '7bf6eb414d39415baf72cd7ca57f56a1.StEPo8uIFfPtfTvf';

// ─── 全局状态 ───
let currentRound = 1;
const totalRounds = 4;
let gamePhase = 'input'; // 'input' | 'branch' | 'quiz' | 'result'
let storyText = `高三学生小明睡过头了，闹钟响了三遍都没听到。
当他终于醒来时，距离高考开始只剩30分钟！
而考场在城市的另一端，正常情况下需要40分钟车程...`;

let submissions = [];
let likedSubmissionId = '';
let branches = [];
let selectedBranch = -1;
let selectedSuggestion = '';
let aiStrategy = '';
let finalOutcome = '';
let storyExpanded = false;
let isAILoading = false;

// 计时器
let audienceTimerId = null;
let countdownTimerId = null;

// 观众模式
let isAudienceMode = false;
let audienceNickname = '';
let audienceSubmissions = [];

// 答题
let quizQuestions = [];
let currentQuizIndex = 0;
let answers = new Map();

// ─── 页面加载 ───
document.addEventListener('DOMContentLoaded', () => {
  initQRCode();
  initStory();
});

// ─── 视图切换 ───
function showView(viewName) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  const viewEl = document.getElementById('view-' + viewName);
  if (viewEl) viewEl.classList.add('active');
  window.scrollTo(0, 0);
}

// ─── 二维码 ───
function initQRCode() {
  const url = window.location.href.split('?')[0];
  document.getElementById('qr-url-display').textContent = url;
  try {
    new QRCode(document.getElementById('qrcode-container'), {
      text: url, width: 200, height: 200,
      colorDark: '#333333', colorLight: '#ffffff',
      correctLevel: QRCode.CorrectLevel.M
    });
  } catch (e) {
    document.getElementById('qrcode-container').innerHTML =
      '<p style="font-size:14px;color:#FF6B00;">二维码生成失败<br>请复制上方链接分享</p>';
  }
}

// ─── 倒计时 ───
function startCountdown() {
  showView('rule');
  let countdown = 30;
  const numEl = document.getElementById('countdown-num');
  numEl.textContent = countdown;
  numEl.className = 'countdown-num';
  countdownTimerId = setInterval(() => {
    countdown--;
    numEl.textContent = countdown;
    if (countdown <= 10) numEl.className = 'countdown-num danger';
    else if (countdown <= 20) numEl.className = 'countdown-num warning';
    if (countdown <= 0) {
      clearInterval(countdownTimerId);
      startGame();
    }
  }, 1000);
}

// ─── 开始游戏 ───
function startGame() {
  if (countdownTimerId) clearInterval(countdownTimerId);
  currentRound = 1;
  gamePhase = 'input';
  storyText = `高三学生小明睡过头了，闹钟响了三遍都没听到。
当他终于醒来时，距离高考开始只剩30分钟！
而考场在城市的另一端，正常情况下需要40分钟车程...`;
  submissions = getMockSubmissions(1);
  likedSubmissionId = '';
  branches = [];
  selectedBranch = -1;
  selectedSuggestion = '';
  aiStrategy = '';
  finalOutcome = '';
  storyExpanded = false;
  isAILoading = false;
  answers = new Map();
  currentQuizIndex = 0;
  showView('game');
  updateGameUI();
  startAudienceSimulation();
}

// ─── 更新游戏界面 ───
function updateGameUI() {
  document.getElementById('round-num').textContent = currentRound;
  document.getElementById('round-badge').textContent = '第' + currentRound + '关';
  document.getElementById('submission-count').textContent = '🔥 ' + submissions.length + '条投稿';
  document.getElementById('submission-count-sm').textContent = '共 ' + submissions.length + ' 条';

  const phaseEl = document.getElementById('header-phase');
  if (gamePhase === 'branch') phaseEl.textContent = '🔀 请选择一个路线';
  else phaseEl.textContent = '';

  renderStory();
  renderSubmissions();

  if (gamePhase === 'input') {
    document.getElementById('branch-card').style.display = 'none';
    document.getElementById('strategy-buttons').style.display = '';
    updateStrategyButtons();
  } else {
    document.getElementById('branch-card').style.display = '';
    document.getElementById('strategy-buttons').style.display = 'none';
    renderBranches();
  }
}

// ─── 剧情渲染 ───
function renderStory() {
  let text = cleanStoryText(storyText);
  if (currentRound > 1 && !storyExpanded) {
    const parts = text.split(/\n\n(?=【选择路径】|小明|他|突然|这时|此时|路上|考场|距离|眼看|就在|终于)/);
    if (parts.length > 3) {
      text = parts[0] + '\n\n··· 以上剧情已折叠 ···\n\n' + parts.slice(-2).join('\n\n');
      document.getElementById('toggle-story-btn').style.display = '';
      document.getElementById('toggle-story-btn').textContent = '▼ 展开完整剧情';
    } else {
      document.getElementById('toggle-story-btn').style.display = 'none';
    }
  } else {
    document.getElementById('toggle-story-btn').style.display = currentRound > 1 ? '' : 'none';
    document.getElementById('toggle-story-btn').textContent = storyExpanded ? '▲ 收起历史剧情' : '▼ 展开完整剧情';
  }
  document.getElementById('story-text').textContent = text;
}

function toggleStory() {
  storyExpanded = !storyExpanded;
  const text = cleanStoryText(storyText);
  document.getElementById('story-text').textContent = text;
  document.getElementById('toggle-story-btn').textContent = storyExpanded ? '▲ 收起历史剧情' : '▼ 展开完整剧情';
}

function cleanStoryText(text) {
  return text
    .replace(/续写\d+-\d+字/g, '').replace(/\[续写\d+-\d+字\]/g, '')
    .replace(/【故事续写】/g, '').trim();
}

// ─── 策略按钮 ───
function updateStrategyButtons() {
  const randomBtn = document.getElementById('btn-random');
  const topBtn = document.getElementById('btn-top');
  randomBtn.disabled = isAILoading || submissions.length === 0;
  topBtn.disabled = isAILoading || submissions.length === 0;
  randomBtn.textContent = isAILoading ? '⏳ 生成中...' : '🎲 命运之抽';
  topBtn.textContent = isAILoading ? '⏳ 生成中...' : '📊 众望所归';
}

// ─── 触发AI ───
async function triggerAI(strategy) {
  if (isAILoading) return;
  aiStrategy = strategy;

  let picked = null;
  if (strategy === 'highest') picked = getHighestVoted();
  else picked = getRandomSubmission();

  if (!picked) { alert('请先投稿！'); return; }

  selectedSuggestion = picked.content;
  isAILoading = true;
  updateStrategyButtons();
  showAILoading(true);

  try {
    const result = await callZhipuAI(storyText, picked.content, currentRound);
    if (result.success) {
      storyText = storyText + '\n\n' + cleanStoryText(result.storyContinuation);
      branches = result.branches;
      finalOutcome = result.finalOutcome || '';
      storyExpanded = false;
      gamePhase = 'branch';
      selectedBranch = -1;
      updateGameUI();
    } else {
      alert('AI生成失败: ' + (result.error || '请重试'));
    }
  } catch (e) {
    alert('网络错误，请检查网络后重试');
  } finally {
    isAILoading = false;
    showAILoading(false);
    updateGameUI();
  }
}

function showAILoading(show) {
  const modal = document.getElementById('ai-loading-modal');
  modal.style.display = show ? 'flex' : 'none';
}

// ─── 智谱AI调用 ───
async function callZhipuAI(currentStory, selectedInput, roundNumber) {
  const roundTheme = getRoundTheme(roundNumber);
  const consistency = buildConsistencyConstraint(currentStory, selectedInput);
  let predeterminedOutcome = '';
  if (roundNumber === 4) predeterminedOutcome = Math.random() < 0.6 ? '失败' : '成功';

  const playerConstraint = `\n🔴【硬性约束 — 玩家行动已发生，绝不可推翻】🔴\n小明已经做了以下事情（这是已经发生的事实，不是建议）：${selectedInput}\n\n你的任务：延续这个已发生的事实，展开接下来的发展。\n\n分支应该围绕"在当前状态下会发生什么"来展开，而非"换一种出行方式"。`;

  const systemPrompt = `你是写实故事作家。请续写60字以内的故事进展。

${roundTheme}
${playerConstraint}
${consistency}

规定输出（严格按此格式，三项分支缺一不可，每项都必须有标题和描述）：
【故事续写】
(在此续写故事)
【分支一】标题：[5字内] 描述：[一句话描述这个选择的具体场景，不少于10字] 难度：简单
【分支二】标题：[5字内] 描述：[一句话描述这个选择的具体场景，不少于10字] 难度：中等
【分支三】标题：[5字内] 描述：[一句话描述这个选择的具体场景，不少于10字] 难度：困难
${roundNumber === 4 ? `【结局判定】故事最终结局必须为【${predeterminedOutcome}】，请严格按照这个结果来写结局` : ''}`;

  const trimmedStory = currentStory.length > 1500
    ? currentStory.slice(0, 200) + '\n···（中间剧情已折叠）···\n' + currentStory.slice(-1300)
    : currentStory;

  const userPrompt = `已确定的玩家行动（已发生）：${selectedInput}\n当前完整剧情：${trimmedStory}`;

  // 最多重试2次
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const resp = await fetch(ZHIPU_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + ZHIPU_API_KEY },
        body: JSON.stringify({
          model: 'glm-4-flash',
          messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }],
          max_tokens: 1000, temperature: 0.7
        })
      });

      if (!resp.ok) {
        if (attempt === 0) { await sleep(1000); continue; }
        return { success: false, storyContinuation: '', branches: [], error: 'API错误: ' + resp.status };
      }

      const data = await resp.json();
      const response = data.choices?.[0]?.message?.content || '';
      if (!response) {
        if (attempt === 0) { await sleep(1000); continue; }
        return { success: false, storyContinuation: '', branches: [], error: 'AI返回为空' };
      }

      const storyMatch = response.match(/【故事续写】\s*([\s\S]*?)(?=【分支一】|$)/);
      const continuation = storyMatch?.[1]?.trim() || response.substring(0, 100);

      // 提取3个分支
      const branches = [];
      for (let i = 1; i <= 3; i++) {
        const label = ['', '一', '二', '三'][i];
        const regex = new RegExp(`【分支${label}】[\\s\\S]*?标题[：:]\\s*([^\\n]+?)\\s*描述[：:]\\s*([^\\n]+?)\\s*(?:难度[：:]\\s*([^\\n]+?))?(?=\\s*(?:【分支|【结局|$))`);
        const match = response.match(regex);
        const title = match?.[1]?.trim() || ['绕行小路', '主路冲刺', '冒险捷径'][i-1];
        let desc = match?.[2]?.trim() || ['穿居民区小路', '主干道打车出发', '横穿工地'][i-1];
        desc = desc.replace(/不少于\d+字/g, '').replace(/一句话描述这个选择的具体场景/g, '').replace(/\[[^\]]*\]/g, '').trim();
        if (desc.length < 2) desc = ['穿居民区小路', '主干道打车出发', '横穿工地'][i-1];
        const difficulty = (match?.[3]?.trim() || ['简单', '中等', '困难'][i-1]).replace(/难度[：:]\s*/g, '');
        branches.push({
          id: i, title, description: desc,
          icon: ['🛵', '🚗', '🏃'][i-1],
          difficulty: difficulty
        });
      }

      if (branches.length < 3) {
        if (attempt === 0) { await sleep(1000); continue; }
      }

      let outcome = '';
      if (roundNumber === 4) outcome = predeterminedOutcome === '成功' ? 'success' : 'failure';

      return { success: true, storyContinuation: continuation, branches, finalOutcome: outcome };
    } catch (e) {
      if (attempt === 0) { await sleep(1000); continue; }
      return { success: false, storyContinuation: '', branches: [], error: '网络错误' };
    }
  }
  return { success: false, storyContinuation: '', branches: [], error: '多次重试失败' };
}

function getRoundTheme(round) {
  const themes = {
    1: '第一关·紧急出发：小明刚冲出家门赶往考场。请根据玩家建议，合理续写小明的行动。难度★★',
    2: '第二关·城市穿行：小明正在去考场的路上，遇到现实障碍，需要做出选择。难度★★★',
    3: '第三关·最大危机：时间越来越紧，遭遇重大障碍。难度★★★★',
    4: '第四关·最后冲刺：考场就在眼前，突发意外扎堆！\n规则：简单路线暗藏陷阱，困难路线反而是最稳妥选择。\n结尾标注【结局判定】成功 或 【结局判定】失败。难度★★★★★'
  };
  return themes[round] || '';
}

function buildConsistencyConstraint(storyText, selectedInput) {
  let constraint = '⚠️【剧情一致性硬约束 — 必须遵守】⚠️\n以下剧情已经发生，你生成的内容绝不能与以下任何事实矛盾：\n';
  if (selectedInput) {
    constraint += `\n【当前关卡玩家已执行的行动 — 不可推翻】\n小明已经执行了：${selectedInput}\n所有续写和三个分支都必须从这个已确定的状态出发\n`;
  }
  const paths = [...storyText.matchAll(/【选择路径】([^\n]+)/g)].map(m => m[1].trim());
  if (paths.length === 0 && !selectedInput) {
    constraint += '- 小明是一个高三学生，睡过头了，正在赶去高考考场\n距离高考开始时间紧迫，他必须尽快赶到\n';
  } else if (paths.length > 0) {
    constraint += '\n以下是小明在之前关卡中已经做出的确定选择，不可更改：\n';
    paths.forEach((p, i) => { constraint += `- 第${i+1}关结束时的确定选择：${p}\n`; });
  }
  constraint += '\n- 你必须基于上述已确定的选择来续写，不能引入与它们矛盾的设定\n';
  constraint += '- 【禁止】如果小明已在车上，分支不能出现"骑单车""跑步""打车"等\n';
  constraint += '- 分支应该围绕当前已确定状态下的不同后续发展来展开\n';
  return constraint;
}

// ─── 分支渲染 ───
function renderBranches() {
  document.getElementById('branch-loading').style.display = isAILoading ? '' : 'none';
  const branchOptions = document.getElementById('branch-options');
  if (isAILoading || branches.length < 3) { branchOptions.innerHTML = ''; return; }

  branchOptions.innerHTML = branches.map(b => `
    <div class="branch-option" onclick="selectBranch(${b.id})">
      <div class="branch-icon">${b.icon}</div>
      <div class="branch-title">${escapeHtml(b.title)}</div>
      <div class="branch-desc">${escapeHtml(b.description)}</div>
      <span class="branch-difficulty ${getDifficultyClass(b.difficulty)}">${escapeHtml(b.difficulty)}</span>
    </div>
  `).join('');
}

function getDifficultyClass(d) {
  if (d.includes('简') || d.includes('easy') || d.includes('Easy')) return 'easy';
  if (d.includes('中') || d.includes('medium') || d.includes('Medium')) return 'medium';
  return 'hard';
}

// ─── 选择分支 ───
function selectBranch(branchId) {
  selectedBranch = branchId;
  const branch = branches.find(b => b.id === branchId);
  if (branch) {
    storyText += `\n\n【选择路径】小明选择了${branch.title}。${branch.description}`;
  }

  if (currentRound >= totalRounds) {
    stopAudienceSimulation();
    const isSuccess = finalOutcome === 'success';
    document.getElementById('outcome-emoji').textContent = isSuccess ? '🎉' : '😢';
    document.getElementById('outcome-title').textContent = isSuccess ? '成功抵达考场！' : '遗憾错过考试...';
    document.getElementById('outcome-msg').textContent = isSuccess
      ? '在全场观众的帮助下，小明终于冲进了考场！\n\n他气喘吁吁地坐到座位上，翻开试卷的那一刻，嘴角露出了微笑。\n\n这一路虽然惊险，但因为有你们的支持，他没有放弃！\n\n接下来，来测测你的高考人格类型吧～'
      : '尽管小明拼尽全力，最终还是没能及时赶到考场。\n\n但这段经历让他学会了珍惜时间、学会在困境中做出选择。\n\n别灰心！人生的路很长，这只是一个小插曲。\n\n来测测你的高考人格类型吧～';
    document.getElementById('outcome-modal').classList.add('show');
  } else {
    currentRound++;
    submissions = getMockSubmissions(currentRound);
    likedSubmissionId = '';
    branches = [];
    selectedSuggestion = '';
    selectedBranch = -1;
    finalOutcome = '';
    storyExpanded = false;
    gamePhase = 'input';
    updateGameUI();
  }
}

function closeOutcomeAndStartQuiz() {
  document.getElementById('outcome-modal').classList.remove('show');
  startQuiz();
}

// ─── 观众模拟 ───
function startAudienceSimulation() {
  stopAudienceSimulation();
  const names = ['高三·阿杰', '高三·小美', '高三·大壮', '高三·学霸', '高三·卷王',
    '高三·学渣逆袭中', '高三·佛系少女', '高三·冲鸭', '送考爸爸', '隔壁班老王',
    '监考老师本师', '吃瓜群众', '路过的小学生', '隔壁老王太太', '追梦少年'];
  const pool = [
    '骑共享单车啊，手机扫码一秒搞定！', '打车吧，现在叫车很快的',
    '让他爸开车送，双闪一路飙过去', '走小路穿小区，比大路快多了',
    '求助路边交警叔叔，说明情况', '打电话给考场老师，看能不能通融',
    '地铁！地铁不堵车而且准时', '跑！什么都别想，就是跑！',
    '让同学在考场门口接应他', '翻墙抄近道，中学后面有捷径',
    '借路边外卖小哥的电动车', '拦一辆出租车，给双倍车费',
    '先把准考证找出来，别慌！', '发朋友圈求助，万能的朋友圈',
    '用导航选躲避拥堵路线'
  ];

  const scheduleNext = () => {
    if (gamePhase !== 'input') { audienceTimerId = setTimeout(scheduleNext, 4000); return; }
    const rand = Math.random();
    if (rand < 0.35) {
      const name = names[Math.floor(Math.random() * names.length)];
      let content = pool[Math.floor(Math.random() * pool.length)];
      if (Math.random() < 0.3) content += ' 💪';
      submissions = [{
        id: 'aud_' + Date.now(), content, likes: Math.floor(Math.random() * 3) + 1,
        timestamp: Date.now(), userName: name
      }, ...submissions];
      renderSubmissions();
    } else if (rand < 0.8 && submissions.length > 0) {
      const idx = Math.floor(Math.random() * submissions.length);
      submissions[idx].likes++;
      renderSubmissions();
    }
    audienceTimerId = setTimeout(scheduleNext, 2000 + Math.random() * 4000);
  };
  audienceTimerId = setTimeout(scheduleNext, 1500);
}

function stopAudienceSimulation() {
  if (audienceTimerId) { clearTimeout(audienceTimerId); audienceTimerId = null; }
}

// ─── 投稿渲染 ───
function renderSubmissions() {
  const el = document.getElementById('submissions-list');
  el.innerHTML = submissions.map(s => `
    <div class="submission-item">
      <div class="submission-header">
        <span class="submission-name">${escapeHtml(s.userName)}</span>
        <span class="submission-time">${formatTime(s.timestamp)}</span>
      </div>
      <div class="submission-content">${escapeHtml(s.content)}</div>
      <div class="submission-footer">
        <button class="like-btn ${likedSubmissionId === s.id ? 'liked' : ''}" onclick="toggleLike('${s.id}')">
          ${likedSubmissionId === s.id ? '❤️' : '🤍'} ${s.likes}
        </button>
      </div>
    </div>
  `).join('');
}

function toggleLike(id) {
  if (likedSubmissionId === id) {
    const s = submissions.find(s => s.id === id);
    if (s) s.likes = Math.max(0, s.likes - 1);
    likedSubmissionId = '';
  } else {
    if (likedSubmissionId) {
      const old = submissions.find(s => s.id === likedSubmissionId);
      if (old) old.likes = Math.max(0, old.likes - 1);
    }
    const s = submissions.find(s => s.id === id);
    if (s) s.likes++;
    likedSubmissionId = id;
  }
  renderSubmissions();
}

function getHighestVoted() {
  if (submissions.length === 0) return null;
  return submissions.reduce((a, b) => a.likes > b.likes ? a : b);
}

function getRandomSubmission() {
  if (submissions.length === 0) return null;
  return submissions[Math.floor(Math.random() * submissions.length)];
}

// ─── Mock投稿 ───
function getMockSubmissions(round) {
  const base = Date.now();
  const data = {
    1: [
      { id:'r1_1', content:'小明飞快穿好衣服，抓起书包就往外冲', likes:12, userName:'观众A' },
      { id:'r1_2', content:'他决定骑共享单车抄近路去考场', likes:8, userName:'观众B' },
      { id:'r1_3', content:'小明打电话给爸爸，让他开车送自己去', likes:15, userName:'观众C' }
    ],
    2: [
      { id:'r2_1', content:'小明决定穿过公园抄近路', likes:10, userName:'路人甲' },
      { id:'r2_2', content:'他看到路边有摩的，赶紧招手拦车', likes:14, userName:'路人乙' },
      { id:'r2_3', content:'让同学帮忙查实时路况，选最优路线', likes:9, userName:'路人丙' }
    ],
    3: [
      { id:'r3_1', content:'手机快没电了，先问路人借充电宝', likes:11, userName:'热心市民' },
      { id:'r3_2', content:'求助路边交警，看能否帮忙开道', likes:16, userName:'交警叔叔' },
      { id:'r3_3', content:'放弃了，准备跑过去，拼最后一把', likes:7, userName:'旁观者' }
    ],
    4: [
      { id:'r4_1', content:'小明看到考场大门了，但排队人很多', likes:13, userName:'送考家长' },
      { id:'r4_2', content:'从后门绕进去，那里人少', likes:10, userName:'保安大叔' },
      { id:'r4_3', content:'大喊我是考生，让前面的人让一让', likes:17, userName:'监考老师' }
    ]
  };
  return (data[round] || data[1]).map(d => ({ ...d, timestamp: base - (data[round].length - data[round].indexOf(d)) * 60000 }));
}

// ─── 观众模式 ───
function enterAudience() {
  isAudienceMode = true;
  showView('audience');
  document.getElementById('nickname-card').style.display = '';
  document.getElementById('audience-submit-area').style.display = 'none';
  if (audienceSubmissions.length === 0) {
    audienceSubmissions = [
      {
        id: 's1', nickname: '高三学长', content: '记得带2B铅笔和准考证！考前深呼吸三次，告诉自己"我已经准备得很充分了"！',
        likes: 128, timestamp: Date.now() - 3600000, liked: false
      },
      {
        id: 's2', nickname: '语文老师', content: '作文先列提纲再下笔，开头结尾要呼应，审题时间不少于5分钟',
        likes: 96, timestamp: Date.now() - 7200000, liked: false
      },
      {
        id: 's3', nickname: '学霸同桌', content: '遇到不会的题先跳过！把能拿的分先拿到手，最后再回头啃硬骨头',
        likes: 85, timestamp: Date.now() - 10800000, liked: false
      }
    ];
  }
  renderAudienceSubmissions();
}

function confirmNickname() {
  const val = document.getElementById('nickname-input').value.trim();
  if (!val) { alert('请先给自己起个昵称吧~'); return; }
  if (val.length > 12) { alert('昵称最多12个字哦~'); return; }
  audienceNickname = val;
  document.getElementById('nickname-card').style.display = 'none';
  document.getElementById('audience-submit-area').style.display = '';
  document.getElementById('nickname-display').textContent = val;
  renderAudienceSubmissions();
}

function changeNickname() {
  document.getElementById('nickname-card').style.display = '';
  document.getElementById('audience-submit-area').style.display = 'none';
  document.getElementById('nickname-input').value = '';
}

function submitAudienceTip() {
  const text = document.getElementById('audience-input').value.trim();
  if (!text) { alert('请输入你的赶考妙招~'); return; }
  if (text.length > 200) { alert('妙招最多200个字，精简一下吧~'); return; }
  audienceSubmissions = [{
    id: 'sub_' + Date.now(), nickname: audienceNickname, content: text,
    likes: 0, timestamp: Date.now(), liked: false
  }, ...audienceSubmissions];
  document.getElementById('audience-input').value = '';
  document.getElementById('char-count').textContent = '0/200';
  renderAudienceSubmissions();
  alert('✅ 投稿成功！你的妙招已展示');
}

function renderAudienceSubmissions() {
  document.getElementById('audience-count').textContent = audienceSubmissions.length + '条';
  document.getElementById('audience-wall-count').textContent = '共 ' + audienceSubmissions.length + ' 条';
  const el = document.getElementById('audience-submissions');
  el.innerHTML = audienceSubmissions.map((s, i) => `
    <div class="submission-item">
      <div class="submission-header">
        <span class="submission-name">${i < 3 ? ['🥇','🥈','🥉'][i] + ' ' : ''}${escapeHtml(s.nickname)}</span>
        <span class="submission-time">${formatTime(s.timestamp)}</span>
      </div>
      <div class="submission-content">${escapeHtml(s.content)}</div>
      <div class="submission-footer">
        <button class="like-btn ${s.liked ? 'liked' : ''}" onclick="audienceToggleLike('${s.id}')">
          ${s.liked ? '❤️' : '🤍'} ${s.likes}
        </button>
      </div>
    </div>
  `).join('');
}

function audienceToggleLike(id) {
  const s = audienceSubmissions.find(s => s.id === id);
  if (!s) return;
  if (s.liked) { s.likes = Math.max(0, s.likes - 1); s.liked = false; }
  else { s.likes++; s.liked = true; }
  renderAudienceSubmissions();
}

// ─── 实时字数 ───
document.addEventListener('input', function(e) {
  if (e.target.id === 'audience-input') {
    const len = e.target.value.length;
    const el = document.getElementById('char-count');
    el.textContent = len + '/200';
    el.className = 'char-count' + (len > 180 ? ' warn' : '');
  }
});

// ─── 答题 ───
function startQuiz() {
  quizQuestions = getQuizQuestions();
  currentQuizIndex = 0;
  answers = new Map();
  showView('quiz');
  renderQuizQuestion();
}

function getQuizQuestions() {
  return [
    {
      id: 1,
      question: '离高考还有一个月，你发现自己的复习计划严重落后，你会？',
      options: [
        { id: 'A', text: '制定更严格的计划，每天压缩休息时间赶进度', scores: { J:10, S:10, T:10 } },
        { id: 'B', text: '调整心态，果断放弃次要内容，死磕重点', scores: { P:10, E:10, F:10 } },
        { id: 'C', text: '找老师和学霸请教，重新制定高效策略', scores: { E:10, N:10, J:10 } },
        { id: 'D', text: '不给自己太大压力，尽力而为顺其自然', scores: { I:10, S:10, P:10 } }
      ]
    },
    {
      id: 2,
      question: '考场上，你发现旁边同学在偷看你的答题卡，你会？',
      options: [
        { id: 'A', text: '不动声色地把答题卡往自己的方向挪了挪', scores: { I:10, T:10, J:10 } },
        { id: 'B', text: '果断举手，小声告知监考老师', scores: { E:10, S:10, J:10 } },
        { id: 'C', text: '无所谓，反正我的答案也不一定对', scores: { E:10, N:10, F:10 } },
        { id: 'D', text: '内心有点不舒服，但强忍下来专注自己', scores: { I:10, F:10, T:10 } }
      ]
    },
    {
      id: 3,
      question: '考完数学后大家讨论答案，你发现最后一道大题做错了，你会？',
      options: [
        { id: 'A', text: '立刻翻书验证，越想越懊悔，久久不能释怀', scores: { T:10, J:10, S:10 } },
        { id: 'B', text: '告诉自己无法改变的事就别想了，专心备战下一科', scores: { P:10, N:10, F:10 } },
        { id: 'C', text: '找同学倾诉情绪，互相安慰打气', scores: { E:10, I:10, N:10 } },
        { id: 'D', text: '一个人安静地消化，这件事不会再对任何人提起', scores: { I:10, S:10, F:10 } }
      ]
    },
    {
      id: 4,
      question: '如果高考成绩比你预估的低了30分，你的第一反应是？',
      options: [
        { id: 'A', text: '怀疑阅卷出问题，立刻申请复核分数', scores: { T:10, J:10, I:10 } },
        { id: 'B', text: '冷静接受现实，马上研究这个分段能报什么学校', scores: { P:10, S:10, T:10 } },
        { id: 'C', text: '情绪崩溃大哭一场，然后和父母商量下一步', scores: { F:10, E:10, J:10 } },
        { id: 'D', text: '相信一切都是最好的安排，人生的路不止一条', scores: { N:10, I:10, P:10 } }
      ]
    },
    {
      id: 5,
      question: '高考结束后，你最想对曾经的自己说一句什么？',
      options: [
        { id: 'A', text: '"你应该可以更拼一点的"', scores: { J:10, S:10, T:10 } },
        { id: 'B', text: '"谢谢你没有放弃，坚持到了最后"', scores: { F:10, P:10, N:10 } },
        { id: 'C', text: '"不论结果如何，我都为你感到骄傲"', scores: { E:10, F:10, N:10 } },
        { id: 'D', text: '"这段奋斗的时光本身，就已经很珍贵了"', scores: { I:10, S:10, P:10 } }
      ]
    }
  ];
}

function renderQuizQuestion() {
  const q = quizQuestions[currentQuizIndex];
  document.getElementById('quiz-num').textContent = currentQuizIndex + 1;
  document.getElementById('quiz-progress-fill').style.width = ((currentQuizIndex + 1) / quizQuestions.length * 100) + '%';
  document.getElementById('quiz-question').textContent = q.question;
  document.getElementById('quiz-options').innerHTML = q.options.map(o => `
    <div class="quiz-option" onclick="answerQuestion('${o.id}')">
      ${escapeHtml(o.text)}
    </div>
  `).join('');
}

function answerQuestion(optionId) {
  const q = quizQuestions[currentQuizIndex];
  answers.set(q.id, optionId);
  if (currentQuizIndex < quizQuestions.length - 1) {
    currentQuizIndex++;
    renderQuizQuestion();
  } else {
    showResult();
  }
}

// ─── 结果 ───
function showResult() {
  const scores = { E:50, I:50, S:50, N:50, T:50, F:50, J:50, P:50 };
  answers.forEach((oid, qid) => {
    const q = quizQuestions.find(q => q.id === qid);
    const o = q?.options.find(o => o.id === oid);
    if (o) { for (const [k, v] of Object.entries(o.scores)) { if (scores[k] !== undefined) scores[k] += v; } }
  });

  const typeStr =
    (scores.E >= scores.I ? 'E' : 'I') +
    (scores.N >= scores.S ? 'N' : 'S') +
    (scores.T >= scores.F ? 'T' : 'F') +
    (scores.J >= scores.P ? 'J' : 'P');

  const typeMap = getTypeMap();
  const info = typeMap[typeStr] || {
    name: '独一无二的你',
    description: '你拥有与众不同的性格组合，没有人能定义你。高考只是人生旅途中的一站，而你拥有无限的潜能去创造属于自己的精彩未来！',
    blessing: '🌈 愿高考成为你精彩人生的新起点！你的独特无可替代，你的未来充满无限可能。相信自己，你已经足够优秀，放手去追逐属于你的梦想吧！加油！',
    advice: '相信自己的独特之处，大胆探索属于你的人生道路'
  };

  document.getElementById('result-emoji').textContent = getTypeEmoji(typeStr);
  document.getElementById('result-type').textContent = typeStr;
  document.getElementById('result-name').textContent = info.name;
  document.getElementById('result-desc').textContent = info.description;
  document.getElementById('result-blessing').textContent = info.blessing;
  document.getElementById('result-advice').textContent = info.advice;
  renderDimensions(scores);
  showView('result');
}

function renderDimensions(scores) {
  const dims = [
    { name: '能量来源', left: '内向(I)', right: '外向(E)', score: Math.round(scores.E / (scores.E + scores.I) * 100) },
    { name: '认知方式', left: '感觉(S)', right: '直觉(N)', score: Math.round(scores.N / (scores.N + scores.S) * 100) },
    { name: '决策方式', left: '思考(T)', right: '情感(F)', score: Math.round(scores.F / (scores.F + scores.T) * 100) },
    { name: '生活方式', left: '判断(J)', right: '感知(P)', score: Math.round(scores.P / (scores.P + scores.J) * 100) }
  ];
  document.getElementById('dimensions').innerHTML = dims.map(d => `
    <div class="dimension-item">
      <div class="dimension-name">${d.name}</div>
      <div class="dimension-bar"><div class="dimension-fill" style="width:${d.score}%"></div></div>
      <div class="dimension-labels"><span>${d.left}</span><span>${d.right}</span></div>
    </div>
  `).join('');
}

function getTypeEmoji(type) {
  const map = {
    ENFP:'🎨', ENFJ:'👑', ENTP:'💡', ENTJ:'🏆',
    ESFP:'🎭', ESFJ:'🤝', ESTP:'⚡', ESTJ:'📋',
    INFP:'🕊️', INFJ:'🔮', INTP:'🔬', INTJ:'🏗️',
    ISFP:'🎵', ISFJ:'🛡️', ISTP:'🔧', ISTJ:'📊'
  };
  return map[type] || '🌈';
}

function getTypeMap() {
  return {
    ENFP: { name:'社团点子王', description:'你是班级里最有创意的那一个，脑子里永远有数不完的新点子。在备考中，你用天马行空的想象力把枯燥的知识变成有趣的记忆法。同桌说跟你一起复习永远不会无聊！', blessing:'🌟 愿你的创造力在考场上闪闪发光！你不需要像别人那样死记硬背，你有自己独特的学习方式。保持你的热情和好奇心，大学社团在向你招手！', advice:'发挥你的创意优势，同时记得制定一个具体的时间表，把灵感落地为行动' },
    ENFJ: { name:'班级精神领袖', description:'你是班里的主心骨，总能在大家最焦虑的时候给出一句暖心的话。高三最后一个月，同学们都说"有你在就安心"。你的存在本身就是一种力量！', blessing:'👑 愿你的温暖和领导力照亮最后的冲刺！你不仅会考上理想的大学，还会成为大学里最受欢迎的学长/学姐。相信自己，你是大家的定心丸！', advice:'在照顾大家情绪的同时，也别忘了给自己留一些安静的独处时间' },
    ENTP: { name:'解题鬼才', description:'面对压轴题，别人还在苦思冥想，你已经找到了三种不同的解法。你享受攻克难题的快感，不按常理出牌是你的标签。在高考战场上，你是那个能逆风翻盘的人！', blessing:'💡 愿你的聪明才智在考场上大杀四方！没有难题能困住你，你天生就是来找bug的。大学实验室、辩论队和创业大赛都在等着你！', advice:'发挥你的思维优势，但别忘了扎实基础，答题时多检查一遍哦' },
    ENTJ: { name:'学霸指挥官', description:'你是班级里的"总设计师"，高三开学就画好了复习路线图，每一步都目标明确。你不是在学习，你是在执行一场精密的战役。同学们都偷偷参考你的计划表！', blessing:'🏆 愿你的战略布局在高考中大获全胜！你的执行力和规划能力让你注定成为想成为的人。大学学生会主席的位置非你莫属，高考只是你征服的第一个目标！', advice:'计划很棒，但也要给自己留一点弹性空间，偶尔放松反而效率更高' },
    ESFP: { name:'班级活宝', description:'你是班里的开心果，课间十分钟也能把全班逗得哈哈大笑。面对高考压力，你用乐观化解焦虑，是大家的"情绪充电宝"。高三因为有你的笑声而没那么煎熬！', blessing:'🎭 愿你的阳光心态融化考场上的一切紧张！笑着答题的你运气不会太差。大学迎新晚会、十佳歌手大赛，舞台已经在等你啦！', advice:'保持乐观，但每一道题都要认真对待，别让粗心偷走你的分数' },
    ESFJ: { name:'暖心课代表', description:'你是老师最信赖的帮手、同学最依赖的伙伴。每次发复习资料你都多印几份，生怕有人没拿到。你的善良和责任感让你成为班级里最温暖的存在。', blessing:'🤝 愿你的善良在高考中获得最美好的回报！你一直照顾着身边的人，现在请相信世界也会温柔待你。大学宿舍里，你会是最受欢迎的室友！', advice:'照顾别人也要照顾好自己，相信你已经准备得足够好了' },
    ESTP: { name:'行动派少年', description:'你不是那种坐得住的人，比起刷题你更相信"实战出真知"。面对突发状况你从不慌张，考场上的任何意外都难不倒你。你是那个能在最后十分钟力挽狂澜的人！', blessing:'⚡ 愿你的果敢和应变力让你在高考中如鱼得水！你是天生的实战派，没有什么能阻挡你的脚步。大学体育场、户外社团，广阔天地任你闯！', advice:'发挥你的行动力优势，答题时沉住气多检查一遍，稳中求胜' },
    ESTJ: { name:'自律大学霸', description:'你是教室最早到、最晚走的那个人。你的错题本比别人的课本还厚，每一道题旁边都工工整整写着解题思路。你的自律让所有人佩服，你走的每一步都踏实有力。', blessing:'📋 愿你的每一份努力都在高考中完美兑现！自律的人值得最好的结果。你一定会考上心仪的大学，然后继续保持你那让人佩服的作息表！', advice:'你的自律能力超强，但也要偶尔放松一下，去操场跑一圈也很好' },
    INFP: { name:'文艺梦想家', description:'你的笔记本扉页上写着喜欢的诗，桌面贴着梦想大学的照片。你有丰富的内心世界，高考对你来说不只是考试，而是通往梦想的桥。你细腻而坚韧，安静却有力量。', blessing:'🕊️ 愿你心中的诗和远方照亮高考的每一分钟！你的梦想值得被认真对待。大学文学社、校刊编辑部，那些美好的地方正在等你。勇敢去追！', advice:'保持你的梦想力，同时把大目标拆成每天的小任务，一步步靠近' },
    INFJ: { name:'深度思考者', description:'你不满足于"是什么"，总要追问"为什么"。在别人刷题的时候，你在理解知识背后的逻辑。你看问题比同龄人深得多，你的思想里藏着超越年龄的成熟。', blessing:'🔮 愿你的深度思考在高考中带你看透每一道题的本质！你天生就懂得学习的意义，高考只是你展现深度的第一站。大学哲学社、心理协会，你会找到同频的人！', advice:'深度思考很宝贵，但也别忘了照顾好自己的身体和睡眠' },
    INTP: { name:'理科学霸', description:'你是数理化的王者，解题对你来说就像玩游戏。你享受推导公式的快感，草稿纸上写满了别人看不懂的演算。在理科的世界里，你就是那个无所不能的人！', blessing:'🔬 愿你的逻辑思维在高考中大放异彩！每一道难题都在等待你来破解。大学实验室、ACM竞赛队、科研项目，那才是你的主场！', advice:'发挥你的理科优势，但语文英语也要稳住，注意书写规范哦' },
    INTJ: { name:'未来规划师', description:'你早就在心里画好了未来十年的蓝图——什么大学、什么专业、什么工作。高三对你来说只是计划中的一环，每一步都经过深思熟虑。你是自己人生的总导演！', blessing:'🏗️ 愿你精心规划的蓝图在高考中完美展开！你是天生的战略家，这场考试只是你宏大计划中的一步。相信自己，你的未来比你想象的还要精彩！', advice:'计划很完美，但也接受过程中的小偏差，路不只一条' },
    ISFP: { name:'艺术特长生', description:'你有独特的审美和节奏，不随波逐流。别人刷五三，你可能有自己的复习方法。你相信感觉，直觉往往比分析更准确。高三的你，是用心在感受这段特别的时光。', blessing:'🎨 愿你的独特天赋在高考中画出最美的答卷！你不需要和别人一样，你的节奏就是最好的节奏。大学设计系、音乐社，你的舞台很大！', advice:'保持你的独特风格，但也跟上整体复习进度，别落下重要知识点' },
    ISFJ: { name:'默默耕耘者', description:'你从不张扬，但你的努力所有人都看在眼里。每天第一个到教室开灯的是你，默默把黑板擦干净的是你。你的勤奋和专注是最珍贵的品质，量变终将引起质变！', blessing:'🛡️ 愿你的坚持和付出在高考中获得最丰厚的回报！你走过的每一步都算数，你的认真是最强大的武器。大学图书馆靠窗的位置，已经为你留好了！', advice:'你的踏实很珍贵，偶尔也要抬头看看方向，和同学交流一下心得' },
    ISTP: { name:'动手达人', description:'你不是纸上谈兵的类型，比起听课你更喜欢动手实验。你冷静理性，考场上的紧张气氛影响不了你。你总是能用最直接有效的方式解决问题，实用主义是你的王牌！', blessing:'🔧 愿你的冷静和实用智慧在高考中扫清一切障碍！你总是能找到最优解。大学工科实验室、机器人社团，那才是你大展身手的地方！', advice:'你很务实，但也要给理想留一些空间，保持对大学生活的憧憬' },
    ISTJ: { name:'稳扎稳打型', description:'你是考场上最稳的那一个，从不慌乱。你的笔记工整得像印刷品，每一道错题都认真订正。你不靠运气，你的每一分都来自日复一日的踏实努力。稳，就是你的超能力！', blessing:'📊 愿你的稳重和扎实为高考奠定最坚实的基础！你从来不靠运气靠实力。大学里，你会继续用这种让人安心的风格，成为导师最信赖的学生！', advice:'你的稳定性超强，偶尔也可以尝试一下新的学习方法换换口味' }
  };
}

// ─── 重新开始 ───
function restartGame() {
  currentRound = 1;
  gamePhase = 'input';
  storyText = `高三学生小明睡过头了，闹钟响了三遍都没听到。
当他终于醒来时，距离高考开始只剩30分钟！
而考场在城市的另一端，正常情况下需要40分钟车程...`;
  submissions = getMockSubmissions(1);
  likedSubmissionId = '';
  branches = [];
  selectedBranch = -1;
  selectedSuggestion = '';
  aiStrategy = '';
  finalOutcome = '';
  storyExpanded = false;
  isAILoading = false;
  answers = new Map();
  currentQuizIndex = 0;
  stopAudienceSimulation();
  startCountdown();
}

// ─── 辅助函数 ───
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function formatTime(ts) {
  const diff = Date.now() - ts;
  if (diff < 60000) return '刚刚';
  if (diff < 3600000) return Math.floor(diff / 60000) + '分钟前';
  if (diff < 86400000) return Math.floor(diff / 3600000) + '小时前';
  return Math.floor(diff / 86400000) + '天前';
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ─── 初始化 ───
function initStory() {
  // 页面加载后展示首页
  showView('home');
}
