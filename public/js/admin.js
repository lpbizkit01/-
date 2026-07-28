/** 관리자 클라이언트 */
(() => {
  const socket = io();
  const $ = (id) => document.getElementById(id);

  let questions = [];
  let gameState = null;
  let editingId = null; // null=닫힘, 'new'=새 문제, 그 외=문제 id
  const chars = new Map();
  const verdicts = {}; // 주관식 판정 상태 playerId → bool

  // -------------------------------------------------------------------------
  // 로그인
  // -------------------------------------------------------------------------
  function login() {
    const pin = $('pin').value.trim();
    socket.emit('admin:login', { pin }, (res) => {
      if (!res?.ok) return ($('login-error').textContent = res?.error || '로그인 실패');
      sessionStorage.setItem('adminPin', pin);
      questions = res.questions || [];
      $('login-screen').classList.add('hidden');
      $('admin-app').classList.remove('hidden');
      renderQuestions();
      applyState(res.state);
      resizeCanvas();
      requestAnimationFrame(loop);
    });
  }
  $('login-btn').onclick = login;
  $('pin').addEventListener('keydown', (e) => { if (e.key === 'Enter') login(); });

  // 재접속 시 자동 로그인
  socket.on('connect', () => {
    const saved = sessionStorage.getItem('adminPin');
    if (saved && !$('admin-app').classList.contains('hidden')) {
      socket.emit('admin:login', { pin: saved }, (res) => {
        if (res?.ok) { questions = res.questions; renderQuestions(); applyState(res.state); }
      });
    }
  });

  // -------------------------------------------------------------------------
  // 문제 관리 (CRUD → 전체 저장)
  // -------------------------------------------------------------------------
  const TYPE_LABEL = { ox: 'OX', choice: '객관식', subjective: '주관식' };

  function renderQuestions() {
    const list = $('q-list');
    list.innerHTML = '';
    if (!questions.length) {
      list.innerHTML = '<p class="notice">아직 문제가 없어요. [+ 새 문제]를 눌러 만들어 보세요.</p>';
    }
    questions.forEach((q) => {
      const div = document.createElement('div');
      div.className = 'card q-item';
      div.innerHTML = `
        <span class="q-type-badge q-type-${q.type}">${TYPE_LABEL[q.type]}</span>
        <span class="q-text"></span>
        <button class="ghost small">수정</button>`;
      div.querySelector('.q-text').textContent = q.text;
      div.querySelector('button').onclick = () => openForm(q.id);
      list.appendChild(div);
    });
    renderRunSelect();
  }

  function renderRunSelect() {
    const sel = $('run-question');
    const prev = sel.value;
    sel.innerHTML = '';
    questions.forEach((q) => {
      const opt = document.createElement('option');
      opt.value = q.id;
      opt.textContent = `[${TYPE_LABEL[q.type]}] ${q.text.slice(0, 40)}`;
      sel.appendChild(opt);
    });
    if ([...sel.options].some((o) => o.value === prev)) sel.value = prev;
  }

  function openForm(id) {
    editingId = id;
    const form = $('q-form');
    form.classList.remove('hidden');
    $('qf-delete').classList.toggle('hidden', id === 'new');
    const q = id === 'new'
      ? { type: 'ox', text: '', choices: ['', '', '', ''], answer: 0, timeLimit: 30 }
      : questions.find((x) => x.id === id);
    if (!q) return;
    $('qf-type').value = q.type;
    $('qf-text').value = q.text;
    $('qf-ox-answer').value = q.type === 'ox' ? String(q.answer) : '0';
    ['qf-c0', 'qf-c1', 'qf-c2', 'qf-c3'].forEach((cid, i) => {
      $(cid).value = (q.choices && q.choices[i]) || '';
    });
    $('qf-choice-answer').value = q.type === 'choice' ? String(q.answer) : '0';
    $('qf-subj-answer').value = q.type === 'subjective' ? String(q.answer || '') : '';
    $('qf-time').value = q.timeLimit || 30;
    updateFormType();
    form.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function updateFormType() {
    const t = $('qf-type').value;
    $('qf-ox-wrap').classList.toggle('hidden', t !== 'ox');
    $('qf-choice-wrap').classList.toggle('hidden', t !== 'choice');
    $('qf-subj-wrap').classList.toggle('hidden', t !== 'subjective');
  }
  $('qf-type').onchange = updateFormType;
  $('q-new').onclick = () => openForm('new');
  $('qf-cancel').onclick = () => { editingId = null; $('q-form').classList.add('hidden'); };

  $('qf-save').onclick = () => {
    const type = $('qf-type').value;
    const text = $('qf-text').value.trim();
    if (!text) return alert('문제 내용을 입력해 주세요.');

    let choices = [];
    let answer = 0;
    if (type === 'ox') {
      answer = Number($('qf-ox-answer').value);
    } else if (type === 'choice') {
      choices = ['qf-c0', 'qf-c1', 'qf-c2', 'qf-c3'].map((id) => $(id).value.trim()).filter(Boolean);
      if (choices.length < 2) return alert('보기를 2개 이상 입력해 주세요.');
      answer = Number($('qf-choice-answer').value);
      if (answer >= choices.length) return alert('정답 번호가 보기 개수보다 커요.');
    } else {
      answer = $('qf-subj-answer').value.trim();
    }
    const timeLimit = Number($('qf-time').value) || 30;

    const q = { id: editingId === 'new' ? undefined : editingId, type, text, choices, answer, timeLimit };
    if (editingId === 'new') questions.push(q);
    else {
      const idx = questions.findIndex((x) => x.id === editingId);
      if (idx >= 0) questions[idx] = q;
    }
    saveQuestions();
    editingId = null;
    $('q-form').classList.add('hidden');
  };

  $('qf-delete').onclick = () => {
    if (!confirm('이 문제를 삭제할까요?')) return;
    questions = questions.filter((x) => x.id !== editingId);
    saveQuestions();
    editingId = null;
    $('q-form').classList.add('hidden');
  };

  function saveQuestions() {
    socket.emit('admin:questions:save', { questions }, (res) => {
      if (res?.ok) { questions = res.questions; renderQuestions(); }
      else alert(res?.error || '저장 실패');
    });
  }
  socket.on('questions', (qs) => { questions = qs; renderQuestions(); });

  // -------------------------------------------------------------------------
  // 설정 / 진행
  // -------------------------------------------------------------------------
  $('hearts-apply').onclick = () => {
    socket.emit('admin:settings', { hearts: Number($('hearts-input').value) }, () => {});
  };

  $('run-start').onclick = () => {
    const qId = $('run-question').value;
    if (!qId) return alert('출제할 문제를 선택해 주세요.');
    const q = questions.find((x) => x.id === qId);
    socket.emit('admin:start', { questionId: qId, timeLimit: q?.timeLimit || 30 }, (res) => {
      if (!res?.ok) alert(res?.error || '시작 실패');
    });
  };
  $('run-finish').onclick = () => socket.emit('admin:finish', {}, () => {});
  $('run-lobby').onclick = () => socket.emit('admin:lobby', {}, () => {});
  $('run-reset').onclick = () => {
    if (confirm('모든 학생의 하트를 초기화하고 대기 상태로 돌아갈까요?')) {
      socket.emit('admin:reset', {}, () => {});
    }
  };

  // -------------------------------------------------------------------------
  // 주관식 판정 패널
  // -------------------------------------------------------------------------
  function renderVerdictPanel() {
    const panel = $('verdict-panel');
    const s = gameState;
    if (s?.phase !== 'reveal' || !s.reveal) {
      panel.classList.add('hidden');
      return;
    }
    panel.classList.remove('hidden');
    $('verdict-key').textContent = s.reveal.answerKey
      ? `정답 키: "${s.reveal.answerKey}" (자동 채점 제안이 반영됐어요. 눌러서 바꿀 수 있어요.)`
      : '정답 키가 없어 모두 오답으로 시작해요. 정답 처리할 학생을 눌러 주세요.';

    const list = $('verdict-list');
    list.innerHTML = '';
    for (const e of s.reveal.entries) {
      if (!(e.id in verdicts)) verdicts[e.id] = !!e.suggested;
      const row = document.createElement('div');
      row.className = 'reveal-row';
      const btn = document.createElement('button');
      const paint = () => {
        btn.className = 'verdict-btn ' + (verdicts[e.id] ? 'on-correct' : 'on-wrong');
        btn.textContent = verdicts[e.id] ? '정답 ⭕' : '오답 ❌';
      };
      btn.onclick = () => { verdicts[e.id] = !verdicts[e.id]; paint(); };
      paint();
      const nick = document.createElement('span');
      nick.textContent = e.nickname;
      nick.style.fontWeight = '800';
      const ans = document.createElement('span');
      ans.className = 'ans';
      ans.textContent = e.text || '(미제출)';
      row.append(nick, ans, btn);
      list.appendChild(row);
    }
  }

  $('verdict-apply').onclick = () => {
    socket.emit('admin:verdicts', { verdicts }, () => {});
  };

  // -------------------------------------------------------------------------
  // 상태 반영 / 학생 목록
  // -------------------------------------------------------------------------
  function applyState(s) {
    const prevPhase = gameState?.phase;
    gameState = s;
    if (s.phase !== 'reveal') {
      for (const k of Object.keys(verdicts)) delete verdicts[k];
    }

    // 캐릭터 동기화
    const seen = new Set();
    for (const p of s.players) {
      seen.add(p.id);
      let c = chars.get(p.id);
      if (!c) {
        c = { disp: { x: p.x, y: p.y }, walking: false, facing: 1, seed: Math.random() * 10, bubble: null };
        chars.set(p.id, c);
      }
      Object.assign(c, p);
      c.sx = p.x; c.sy = p.y;
    }
    for (const id of [...chars.keys()]) if (!seen.has(id)) chars.delete(id);

    updateBubbles();
    renderHud();
    renderPlayers();
    renderVerdictPanel();
    $('hearts-now').textContent = `현재: ${s.settings.hearts}`;
    if (prevPhase !== s.phase && s.phase === 'question') {
      // 새 문제 시작 시 판정 상태 초기화
      for (const k of Object.keys(verdicts)) delete verdicts[k];
    }
  }

  function updateBubbles() {
    const s = gameState;
    for (const c of chars.values()) { c.bubble = null; c.bubbleColor = null; }
    if (!s) return;
    if (s.phase === 'reveal' && s.reveal) {
      for (const e of s.reveal.entries) {
        const c = chars.get(e.id);
        if (c) { c.bubble = e.text || '(미제출)'; c.bubbleColor = '#fff'; }
      }
    }
    if (s.phase === 'result' && s.results) {
      for (const r of s.results.perPlayer) {
        const c = chars.get(r.id);
        if (!c) continue;
        c.bubble = s.results.type === 'subjective'
          ? `${r.text || '(미제출)'} ${r.correct ? '⭕' : '❌'}`
          : (r.correct ? '⭕ 정답!' : '❌ 땡!');
        c.bubbleColor = r.correct ? '#d8f2e2' : '#f8dcdc';
      }
    }
  }

  const PHASE_LABEL = { lobby: '🏫 대기', question: '⏱ 문제 진행 중', reveal: '📢 답 공개/판정', result: '🏁 결과' };

  function renderHud() {
    const s = gameState;
    const q = s.question;
    $('a-phase').textContent = PHASE_LABEL[s.phase] || s.phase;
    if (s.phase === 'lobby' || !q) {
      $('a-question').textContent = '🏫 대기 중 — 학생들이 자유롭게 돌아다니고 있어요';
      $('a-submitted').textContent = '';
      return;
    }
    let head = `Q. ${q.text}`;
    if (s.phase === 'result' && s.results && s.results.type !== 'subjective') {
      const label = q.type === 'ox' ? (s.results.answer === 0 ? 'O' : 'X') : `${s.results.answer + 1}번`;
      head += `  →  정답: ${label}`;
    }
    $('a-question').textContent = head;

    if (s.phase === 'question' && q.type === 'subjective') {
      const submitted = s.players.filter((p) => p.alive && p.hasAnswer).length;
      const total = s.players.filter((p) => p.alive).length;
      $('a-submitted').textContent = `제출: ${submitted}/${total}명 (내용은 비밀)`;
    } else {
      $('a-submitted').textContent = '';
    }
  }

  function renderPlayers() {
    const s = gameState;
    const list = $('player-list');
    list.innerHTML = '';
    const alive = s.players.filter((p) => p.alive).length;
    $('player-count').textContent = `${s.players.length}명 (생존 ${alive})`;
    for (const p of s.players) {
      const row = document.createElement('div');
      row.className = 'player-row' + (p.alive ? '' : ' dead');
      const dot = document.createElement('span');
      dot.className = 'player-dot';
      dot.style.background = p.color;
      const nick = document.createElement('span');
      nick.className = 'nick';
      nick.textContent = p.nickname + (p.connected ? '' : ' (연결 끊김)');
      const hearts = document.createElement('span');
      hearts.className = 'hearts-sm';
      hearts.textContent = p.alive ? '❤️'.repeat(p.hearts) : '💀';
      const kick = document.createElement('button');
      kick.className = 'ghost small';
      kick.textContent = '퇴장';
      kick.onclick = () => {
        if (confirm(`${p.nickname} 학생을 내보낼까요?`)) {
          socket.emit('admin:kick', { playerId: p.id }, () => {});
        }
      };
      row.append(dot, nick, hearts, kick);
      list.appendChild(row);
    }
  }

  socket.on('state', applyState);
  socket.on('positions', (moved) => {
    for (const [id, x, y] of moved) {
      const c = chars.get(id);
      if (!c) continue;
      if (x > c.sx + 0.5) c.facing = 1;
      else if (x < c.sx - 0.5) c.facing = -1;
      c.sx = x; c.sy = y;
    }
  });

  // -------------------------------------------------------------------------
  // 캔버스
  // -------------------------------------------------------------------------
  const canvas = $('admin-canvas');
  function resizeCanvas() {
    const wrap = $('admin-canvas-wrap');
    if (!wrap.clientWidth) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = wrap.clientWidth * dpr;
    canvas.height = wrap.clientHeight * dpr;
  }
  window.addEventListener('resize', resizeCanvas);

  function loop() {
    for (const c of chars.values()) {
      if (c.sx == null) { c.sx = c.x; c.sy = c.y; }
      const dx = c.sx - c.disp.x;
      const dy = c.sy - c.disp.y;
      c.walking = Math.hypot(dx, dy) > 2;
      c.disp.x += dx * 0.25;
      c.disp.y += dy * 0.25;
    }
    const s = gameState;
    const showZones = s && (s.phase === 'question' || s.phase === 'result') && s.question &&
      (s.question.type === 'ox' || s.question.type === 'choice');
    let highlightAnswer = null;
    if (s?.phase === 'result' && s.results && s.results.type !== 'subjective') highlightAnswer = s.results.answer;
    Arena.draw(canvas, chars, showZones ? s.question : null, { showZones: !!showZones, highlightAnswer });

    if (s?.phase === 'question' && s.endsAt) {
      const remain = Math.max(0, Math.ceil((s.endsAt - Date.now()) / 1000));
      $('a-timer').textContent = `⏰ ${remain}초`;
    } else {
      $('a-timer').textContent = '';
    }
    requestAnimationFrame(loop);
  }
})();
