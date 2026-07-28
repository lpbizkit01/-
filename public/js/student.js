/** 학생 클라이언트 */
(() => {
  const socket = io();

  const COLORS = ['#ff7043', '#f2c53d', '#4caf7d', '#3b6fd4', '#9b59d0', '#e0559a', '#4dc3d6', '#8d6e63', '#5c6bc0', '#66bb6a'];
  const ACCESSORIES = [
    { id: 'none', label: '없음' },
    { id: 'cap', label: '🧢 모자' },
    { id: 'ribbon', label: '🎀 리본' },
    { id: 'crown', label: '👑 왕관' },
    { id: 'glasses', label: '🤓 안경' },
    { id: 'flower', label: '🌼 꽃' },
  ];

  let myColor = COLORS[Math.floor(Math.random() * COLORS.length)];
  let myAccessory = 'none';
  let myId = null;
  let gameState = null;

  /** 캐릭터 표시 상태: id → {disp:{x,y}, walking, facing, seed, target, bubble, ...} */
  const chars = new Map();

  // -------------------------------------------------------------------------
  // 입장 화면
  // -------------------------------------------------------------------------
  const $ = (id) => document.getElementById(id);
  const preview = $('preview');

  function renderPreview() {
    const ctx = preview.getContext('2d');
    ctx.clearRect(0, 0, 140, 140);
    const fake = new Map([['me', {
      id: 'me', nickname: $('nickname').value.trim() || '나',
      color: myColor, accessory: myAccessory,
      hearts: 3, alive: true,
      disp: { x: 70, y: 80 }, walking: false, facing: 1, seed: 0,
    }]]);
    // 미리보기는 간단히: draw 함수의 아레나 배경 없이 캐릭터만
    ctx.save();
    const c = fake.get('me');
    // Arena.draw 는 전체 아레나용이라 미리보기는 직접 호출
    drawPreviewChar(ctx, c);
    ctx.restore();
  }

  function drawPreviewChar(ctx, p) {
    // render.js 의 drawCharacter 를 쓰기 위해 임시 캔버스 방식 대신 간단히 재사용
    const tmp = new Map([[p.id, p]]);
    // 배경 없이 캐릭터만 그리도록 임시 뷰 구성
    ctx.clearRect(0, 0, 140, 140);
    ctx.fillStyle = '#e7f0e6';
    ctx.fillRect(0, 0, 140, 140);
    // drawCharacter 는 Arena 내부 함수라 draw 전체를 쓰지 않고 살짝 우회:
    // 미니 아레나를 만들어 그 안에 캐릭터 하나만 배치
    const mini = document.createElement('canvas');
    mini.width = Arena.W; mini.height = Arena.H;
    p.disp = { x: Arena.W / 2, y: Arena.H / 2 };
    Arena.draw(mini, tmp, null, {});
    // 캐릭터 주변만 잘라서 미리보기에 확대 표시
    const cx = Arena.W / 2, cy = Arena.H / 2;
    ctx.drawImage(mini, cx - 70, cy - 90, 140, 150, 0, -10, 140, 150);
  }

  function buildJoinUI() {
    const sw = $('swatches');
    COLORS.forEach((c) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'swatch' + (c === myColor ? ' selected' : '');
      b.style.background = c;
      b.onclick = () => {
        myColor = c;
        sw.querySelectorAll('.swatch').forEach((x) => x.classList.remove('selected'));
        b.classList.add('selected');
        renderPreview();
      };
      sw.appendChild(b);
    });
    const ar = $('accessories');
    ACCESSORIES.forEach((a) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'acc-btn' + (a.id === myAccessory ? ' selected' : '');
      b.textContent = a.label;
      b.onclick = () => {
        myAccessory = a.id;
        ar.querySelectorAll('.acc-btn').forEach((x) => x.classList.remove('selected'));
        b.classList.add('selected');
        renderPreview();
      };
      ar.appendChild(b);
    });
    $('nickname').addEventListener('input', renderPreview);
    renderPreview();
  }
  buildJoinUI();

  $('join-btn').onclick = () => {
    const nickname = $('nickname').value.trim();
    if (!nickname) return showJoinError('닉네임을 입력해 주세요.');
    $('join-btn').disabled = true;
    socket.emit('join', { nickname, color: myColor, accessory: myAccessory }, (res) => {
      $('join-btn').disabled = false;
      if (!res?.ok) return showJoinError(res?.error || '입장에 실패했어요.');
      myId = res.id;
      applyState(res.state);
      $('join-screen').classList.add('hidden');
      $('game-screen').classList.remove('hidden');
      resizeCanvas();
      requestAnimationFrame(loop);
    });
  };

  function showJoinError(msg) { $('join-error').textContent = msg; }

  // -------------------------------------------------------------------------
  // 게임 캔버스
  // -------------------------------------------------------------------------
  const canvas = $('game-canvas');

  function resizeCanvas() {
    const wrap = $('canvas-wrap');
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = wrap.clientWidth * dpr;
    canvas.height = wrap.clientHeight * dpr;
  }
  window.addEventListener('resize', resizeCanvas);

  // 터치/클릭한 지점으로 걸어가기
  let lastMoveSent = 0;
  function handlePoint(e) {
    if (!myId || !gameState) return;
    const me = chars.get(myId);
    if (me && !me.alive) return; // 탈락하면 이동 불가
    const rect = canvas.getBoundingClientRect();
    const dpr = canvas.width / rect.width;
    const view = Arena.computeView(canvas);
    const pt = Arena.toArena(view, (e.clientX - rect.left) * dpr, (e.clientY - rect.top) * dpr);
    if (pt.x < 0 || pt.x > Arena.W || pt.y < 0 || pt.y > Arena.H) return;
    const now = Date.now();
    if (now - lastMoveSent < 60) return; // 전송 빈도 제한
    lastMoveSent = now;
    socket.emit('move', pt);
    if (me) me.target = { x: pt.x, y: pt.y };
  }
  canvas.addEventListener('pointerdown', (e) => { e.preventDefault(); handlePoint(e); });
  canvas.addEventListener('pointermove', (e) => { if (e.buttons || e.pressure > 0) handlePoint(e); });

  // -------------------------------------------------------------------------
  // 상태 반영
  // -------------------------------------------------------------------------
  function applyState(s) {
    gameState = s;
    const seen = new Set();
    for (const p of s.players) {
      seen.add(p.id);
      let c = chars.get(p.id);
      if (!c) {
        c = {
          disp: { x: p.x, y: p.y },
          walking: false, facing: 1,
          seed: Math.random() * 10,
          target: null, bubble: null,
        };
        chars.set(p.id, c);
      }
      Object.assign(c, p);
      c.sx = p.x; c.sy = p.y; // 서버 좌표
    }
    for (const id of [...chars.keys()]) {
      if (!seen.has(id)) chars.delete(id);
    }
    // 내 소켓 id 는 재접속 시 바뀔 수 있음 → 닉네임 매칭은 서버가 처리, id는 join ack 기준
    updateHud();
    updateBubbles();
  }

  function updateHud() {
    const s = gameState;
    if (!s) return;
    const me = s.players.find((p) => p.id === myId);

    // 하트
    if (me) {
      $('my-hearts').textContent = me.alive ? '❤️'.repeat(me.hearts) : '💀 탈락';
      $('dead-banner').classList.toggle('hidden', me.alive);
    }

    // 문제/힌트
    const q = s.question;
    const qt = $('question-text');
    const hint = $('phase-hint');
    const subjBar = $('subjective-bar');
    subjBar.classList.add('hidden');

    if (s.phase === 'lobby') {
      qt.textContent = '🏫 대기 중이에요';
      hint.textContent = '선생님이 문제를 시작하면 화면에 나타나요. 자유롭게 돌아다녀 보세요!';
    } else if (s.phase === 'question' && q) {
      qt.textContent = `Q. ${q.text}`;
      if (q.type === 'ox') hint.textContent = 'O 또는 X 구역으로 이동하세요!';
      else if (q.type === 'choice') hint.textContent = '정답이라고 생각하는 보기 구역으로 이동하세요!';
      else {
        hint.textContent = '아래에 답을 입력하세요. 다른 친구들에게는 보이지 않아요!';
        if (me?.alive) {
          subjBar.classList.remove('hidden');
          $('subjective-status').textContent = me.hasAnswer ? '✅ 제출됨' : '';
        }
      }
    } else if (s.phase === 'reveal' && q) {
      qt.textContent = `Q. ${q.text}`;
      hint.textContent = '⏰ 마감! 모두의 답이 공개됐어요. 선생님이 판정 중…';
    } else if (s.phase === 'result' && q) {
      qt.textContent = `Q. ${q.text}`;
      hint.textContent = '결과가 나왔어요!';
    }

    // 타이머는 loop 에서 갱신
    $('timer').classList.toggle('hidden', !(s.phase === 'question' && s.endsAt));
  }

  // 말풍선: 주관식 공개/결과 때 캐릭터 위에 답 표시
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
        if (s.results.type === 'subjective') {
          c.bubble = `${r.text || '(미제출)'} ${r.correct ? '⭕' : '❌'}`;
        } else {
          c.bubble = r.correct ? '⭕ 정답!' : '❌ 땡!';
        }
        c.bubbleColor = r.correct ? '#d8f2e2' : '#f8dcdc';
      }
    }
  }

  // 결과 오버레이 (내 결과)
  let overlayTimer = null;
  function showMyResult() {
    const s = gameState;
    if (!s?.results || !myId) return;
    const mine = s.results.perPlayer.find((r) => r.id === myId);
    if (!mine) return;
    $('result-emoji').textContent = mine.correct ? '🎉' : (mine.alive ? '💔' : '💀');
    $('result-title').textContent = mine.correct ? '정답!' : (mine.alive ? '틀렸어요!' : '탈락!');
    $('result-desc').textContent = mine.correct
      ? '하트를 지켰어요!'
      : (mine.alive ? `하트가 1개 줄었어요. 남은 하트 ${mine.hearts}개` : '하트를 모두 잃었어요. 유령으로 구경해요!');
    $('result-overlay').classList.remove('hidden');
    clearTimeout(overlayTimer);
    overlayTimer = setTimeout(() => $('result-overlay').classList.add('hidden'), 3500);
  }

  // -------------------------------------------------------------------------
  // 주관식 제출
  // -------------------------------------------------------------------------
  $('subjective-submit').onclick = submitSubjective;
  $('subjective-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') submitSubjective();
  });
  function submitSubjective() {
    const text = $('subjective-input').value.trim();
    if (!text) return;
    socket.emit('answer:text', { text });
    $('subjective-status').textContent = '✅ 제출됨';
    $('subjective-input').blur();
  }

  // -------------------------------------------------------------------------
  // 소켓 이벤트
  // -------------------------------------------------------------------------
  socket.on('state', (s) => {
    const prevPhase = gameState?.phase;
    applyState(s);
    if (s.phase === 'question' && prevPhase !== 'question') {
      $('subjective-input').value = '';
      $('subjective-status').textContent = '';
      $('result-overlay').classList.add('hidden');
    }
    if (s.phase === 'result' && prevPhase !== 'result') showMyResult();
  });

  socket.on('positions', (moved) => {
    for (const [id, x, y] of moved) {
      const c = chars.get(id);
      if (!c) continue;
      if (x > c.sx + 0.5) c.facing = 1;
      else if (x < c.sx - 0.5) c.facing = -1;
      c.sx = x; c.sy = y;
    }
  });

  socket.on('kicked', () => {
    alert('선생님이 퇴장시켰어요.');
    location.reload();
  });

  socket.on('disconnect', () => {
    $('phase-hint').textContent = '⚠️ 연결이 끊겼어요. 다시 연결 중…';
  });
  socket.on('connect', () => {
    // 게임 중 재접속: 같은 닉네임으로 자동 재입장
    if (myId && gameState) {
      const nickname = $('nickname').value.trim();
      socket.emit('join', { nickname, color: myColor, accessory: myAccessory }, (res) => {
        if (res?.ok) { myId = res.id; applyState(res.state); }
        else location.reload();
      });
    }
  });

  // -------------------------------------------------------------------------
  // 렌더 루프
  // -------------------------------------------------------------------------
  function loop() {
    // 표시 좌표를 서버 좌표로 부드럽게 보간
    for (const c of chars.values()) {
      if (c.sx == null) { c.sx = c.x; c.sy = c.y; }
      const dx = c.sx - c.disp.x;
      const dy = c.sy - c.disp.y;
      const dist = Math.hypot(dx, dy);
      c.walking = dist > 2;
      c.disp.x += dx * 0.25;
      c.disp.y += dy * 0.25;
      if (c.target && Math.hypot(c.target.x - c.disp.x, c.target.y - c.disp.y) < 15) c.target = null;
    }

    const s = gameState;
    const showZones = s && (s.phase === 'question' || s.phase === 'result') && s.question &&
      (s.question.type === 'ox' || s.question.type === 'choice');
    let highlightAnswer = null;
    if (s?.phase === 'result' && s.results && s.results.type !== 'subjective') {
      highlightAnswer = s.results.answer;
    }
    Arena.draw(canvas, chars, showZones ? s.question : null, {
      showZones: !!showZones,
      highlightAnswer,
      selfId: myId,
    });

    // 타이머
    if (s?.phase === 'question' && s.endsAt) {
      const remain = Math.max(0, Math.ceil((s.endsAt - Date.now()) / 1000));
      const t = $('timer');
      t.textContent = remain;
      t.classList.toggle('urgent', remain <= 5);
    }

    requestAnimationFrame(loop);
  }
})();
