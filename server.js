/**
 * 클래스룸 퀴즈 아레나 서버
 * - 관리자: 문제 작성/수정/저장, 게임 진행, 하트 설정
 * - 학생: 닉네임/색깔/꾸미기로 입장, 터치 지점으로 캐릭터가 걸어서 이동
 * - OX/객관식: 구역으로 이동해서 답 선택
 * - 주관식: 비밀 제출 → 시간 종료 후 공개 → 관리자가 탈락 판정
 */
const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const { Server } = require('socket.io');

const PORT = process.env.PORT || 3000;
const ADMIN_PIN = process.env.ADMIN_PIN || '1234';

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// ---------------------------------------------------------------------------
// 문제 저장소 (data/questions.json 에 영구 저장)
// ---------------------------------------------------------------------------
const DATA_DIR = path.join(__dirname, 'data');
const QUESTIONS_FILE = path.join(DATA_DIR, 'questions.json');

function loadQuestions() {
  try {
    return JSON.parse(fs.readFileSync(QUESTIONS_FILE, 'utf8'));
  } catch (e) {
    return [];
  }
}

function saveQuestions(list) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(QUESTIONS_FILE, JSON.stringify(list, null, 2), 'utf8');
}

let questions = loadQuestions();

// ---------------------------------------------------------------------------
// 게임 상태
// ---------------------------------------------------------------------------
const ARENA = { w: 1000, h: 600 };
const WALK_SPEED = 170; // px/초
const TICK_MS = 50;
const CHAR_MARGIN = 30;

const state = {
  phase: 'lobby', // lobby | question | reveal | result
  settings: { hearts: 3 },
  question: null, // 진행 중인 문제 (원본 복사)
  endsAt: 0,
  reveal: null, // 주관식 공개 데이터
  results: null, // 마지막 채점 결과
};

/** @type {Map<string, object>} socketId → player */
const players = new Map();
let questionTimer = null;

function makeSpawn() {
  return {
    x: ARENA.w / 2 + (Math.random() - 0.5) * 300,
    y: ARENA.h / 2 + (Math.random() - 0.5) * 200,
  };
}

function normalizeText(s) {
  return String(s || '').trim().toLowerCase().replace(/\s+/g, '');
}

// 위치 → 구역 번호 (OX: 0=O, 1=X / 객관식: 보기 인덱스)
function getZone(q, x, y) {
  if (!q) return null;
  if (q.type === 'ox') return x < ARENA.w / 2 ? 0 : 1;
  if (q.type === 'choice') {
    const n = q.choices.length;
    if (n <= 3) {
      // 세로 칸 나누기
      const idx = Math.min(n - 1, Math.floor((x / ARENA.w) * n));
      return idx;
    }
    // 4지선다: 4분면
    const col = x < ARENA.w / 2 ? 0 : 1;
    const row = y < ARENA.h / 2 ? 0 : 1;
    return row * 2 + col;
  }
  return null;
}

function playerPublic(p) {
  return {
    id: p.id,
    nickname: p.nickname,
    color: p.color,
    accessory: p.accessory,
    hearts: p.hearts,
    alive: p.alive,
    x: Math.round(p.x),
    y: Math.round(p.y),
    hasAnswer: !!p.answerText,
    connected: p.connected,
  };
}

function questionPublic(q, withAnswer) {
  if (!q) return null;
  const out = {
    id: q.id,
    type: q.type,
    text: q.text,
    choices: q.choices || [],
    timeLimit: q.timeLimit,
  };
  if (withAnswer) out.answer = q.answer;
  return out;
}

function buildState(forAdmin) {
  const showAnswer = forAdmin || state.phase === 'result';
  return {
    phase: state.phase,
    settings: state.settings,
    endsAt: state.endsAt,
    question: questionPublic(state.question, showAnswer),
    players: [...players.values()].map(playerPublic),
    reveal: state.reveal,
    results: state.results,
  };
}

function broadcastState() {
  io.to('players').emit('state', buildState(false));
  io.to('admins').emit('state', buildState(true));
}

// ---------------------------------------------------------------------------
// 이동 틱: 목표 지점으로 "걸어서" 이동
// ---------------------------------------------------------------------------
setInterval(() => {
  const moved = [];
  for (const p of players.values()) {
    if (p.tx == null) continue;
    const dx = p.tx - p.x;
    const dy = p.ty - p.y;
    const dist = Math.hypot(dx, dy);
    const step = WALK_SPEED * (TICK_MS / 1000);
    if (dist <= step) {
      p.x = p.tx;
      p.y = p.ty;
      p.tx = p.ty = null;
    } else {
      p.x += (dx / dist) * step;
      p.y += (dy / dist) * step;
    }
    moved.push([p.id, Math.round(p.x), Math.round(p.y)]);
  }
  if (moved.length) io.emit('positions', moved);
}, TICK_MS);

// 오래 끊긴 플레이어 정리
setInterval(() => {
  const now = Date.now();
  let changed = false;
  for (const [id, p] of players) {
    if (!p.connected && now - p.disconnectedAt > 120000) {
      players.delete(id);
      changed = true;
    }
  }
  if (changed) broadcastState();
}, 10000);

// ---------------------------------------------------------------------------
// 문제 진행
// ---------------------------------------------------------------------------
function startQuestion(qId, timeLimit) {
  const q = questions.find((x) => x.id === qId);
  if (!q) return false;
  clearTimeout(questionTimer);
  state.question = { ...q, timeLimit };
  state.phase = 'question';
  state.endsAt = Date.now() + timeLimit * 1000;
  state.reveal = null;
  state.results = null;
  for (const p of players.values()) p.answerText = '';
  questionTimer = setTimeout(finishQuestion, timeLimit * 1000);
  broadcastState();
  return true;
}

function finishQuestion() {
  clearTimeout(questionTimer);
  if (state.phase !== 'question' || !state.question) return;
  const q = state.question;

  if (q.type === 'subjective') {
    // 주관식: 답 공개 단계로 전환, 탈락 여부는 관리자가 결정
    const key = normalizeText(q.answer);
    state.phase = 'reveal';
    state.endsAt = 0;
    state.reveal = {
      answerKey: q.answer || '',
      entries: [...players.values()]
        .filter((p) => p.alive)
        .map((p) => ({
          id: p.id,
          nickname: p.nickname,
          text: p.answerText || '',
          // 정답 키가 있으면 자동 채점 제안 (관리자가 수정 가능)
          suggested: key ? normalizeText(p.answerText) === key : false,
        })),
    };
    broadcastState();
    return;
  }

  // OX / 객관식: 서 있는 구역으로 자동 채점
  const perPlayer = [];
  for (const p of players.values()) {
    if (!p.alive) continue;
    const zone = getZone(q, p.x, p.y);
    const correct = zone === q.answer;
    if (!correct) p.hearts = Math.max(0, p.hearts - 1);
    if (p.hearts <= 0) p.alive = false;
    perPlayer.push({
      id: p.id,
      nickname: p.nickname,
      zone,
      correct,
      hearts: p.hearts,
      alive: p.alive,
    });
  }
  state.phase = 'result';
  state.endsAt = 0;
  state.results = { type: q.type, answer: q.answer, perPlayer };
  broadcastState();
}

function applySubjectiveVerdicts(verdicts) {
  if (state.phase !== 'reveal' || !state.reveal) return;
  const perPlayer = [];
  for (const entry of state.reveal.entries) {
    const p = players.get(entry.id);
    if (!p || !p.alive) continue;
    const correct = !!verdicts[entry.id];
    if (!correct) p.hearts = Math.max(0, p.hearts - 1);
    if (p.hearts <= 0) p.alive = false;
    entry.correct = correct;
    perPlayer.push({
      id: p.id,
      nickname: p.nickname,
      text: entry.text,
      correct,
      hearts: p.hearts,
      alive: p.alive,
    });
  }
  state.phase = 'result';
  state.results = { type: 'subjective', answer: state.reveal.answerKey, perPlayer };
  broadcastState();
}

// ---------------------------------------------------------------------------
// 소켓 처리
// ---------------------------------------------------------------------------
io.on('connection', (socket) => {
  let role = null; // 'player' | 'admin'

  // ----- 학생 입장 -----
  socket.on('join', (data, ack) => {
    const nickname = String(data?.nickname || '').trim().slice(0, 12);
    if (!nickname) return ack?.({ ok: false, error: '닉네임을 입력해 주세요.' });

    // 같은 닉네임의 끊긴 플레이어가 있으면 이어받기 (재접속)
    let existing = null;
    for (const p of players.values()) {
      if (p.nickname === nickname) {
        if (p.connected) return ack?.({ ok: false, error: '이미 사용 중인 닉네임이에요.' });
        existing = p;
        break;
      }
    }

    let player;
    if (existing) {
      players.delete(existing.id);
      player = { ...existing, id: socket.id, connected: true };
    } else {
      const spawn = makeSpawn();
      player = {
        id: socket.id,
        nickname,
        color: String(data?.color || '#ff7043'),
        accessory: String(data?.accessory || 'none'),
        x: spawn.x,
        y: spawn.y,
        tx: null,
        ty: null,
        hearts: state.settings.hearts,
        alive: true,
        answerText: '',
        connected: true,
        disconnectedAt: 0,
      };
    }
    players.set(socket.id, player);
    role = 'player';
    socket.join('players');
    ack?.({ ok: true, id: socket.id, state: buildState(false) });
    broadcastState();
  });

  // ----- 이동: 터치한 지점으로 걸어감 -----
  socket.on('move', (data) => {
    const p = players.get(socket.id);
    if (!p) return;
    const x = Number(data?.x);
    const y = Number(data?.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    p.tx = Math.max(CHAR_MARGIN, Math.min(ARENA.w - CHAR_MARGIN, x));
    p.ty = Math.max(CHAR_MARGIN, Math.min(ARENA.h - CHAR_MARGIN, y));
  });

  // ----- 주관식 답 제출 (비밀 유지, 마감 전까지 수정 가능) -----
  socket.on('answer:text', (data) => {
    const p = players.get(socket.id);
    if (!p || !p.alive) return;
    if (state.phase !== 'question' || state.question?.type !== 'subjective') return;
    p.answerText = String(data?.text || '').slice(0, 100);
    broadcastState(); // 제출 여부(내용은 비밀)만 갱신
  });

  // ----- 관리자 -----
  socket.on('admin:login', (data, ack) => {
    if (String(data?.pin) !== ADMIN_PIN) return ack?.({ ok: false, error: 'PIN이 올바르지 않습니다.' });
    role = 'admin';
    socket.join('admins');
    ack?.({ ok: true, state: buildState(true), questions });
  });

  const requireAdmin = (fn) => (data, ack) => {
    if (role !== 'admin') return ack?.({ ok: false, error: '권한이 없습니다.' });
    fn(data, ack);
  };

  // 문제 목록 전체 저장 (작성/수정/삭제 반영)
  socket.on('admin:questions:save', requireAdmin((data, ack) => {
    if (!Array.isArray(data?.questions)) return ack?.({ ok: false, error: '잘못된 데이터입니다.' });
    questions = data.questions
      .filter((q) => q && q.text && ['ox', 'choice', 'subjective'].includes(q.type))
      .map((q) => ({
        id: q.id || `q_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        type: q.type,
        text: String(q.text).slice(0, 300),
        choices: q.type === 'choice' ? (q.choices || []).slice(0, 4).map((c) => String(c).slice(0, 100)) : [],
        answer: q.type === 'subjective' ? String(q.answer || '').slice(0, 100) : Number(q.answer) || 0,
        timeLimit: Math.max(5, Math.min(300, Number(q.timeLimit) || 30)),
      }));
    saveQuestions(questions);
    io.to('admins').emit('questions', questions);
    ack?.({ ok: true, questions });
  }));

  // 게임 설정 (하트 수) — 시작 전 변경 가능
  socket.on('admin:settings', requireAdmin((data, ack) => {
    const hearts = Math.max(1, Math.min(10, Number(data?.hearts) || 3));
    state.settings.hearts = hearts;
    // 로비 상태면 현재 접속자에게도 즉시 반영
    if (state.phase === 'lobby') {
      for (const p of players.values()) {
        p.hearts = hearts;
        p.alive = true;
      }
    }
    broadcastState();
    ack?.({ ok: true });
  }));

  socket.on('admin:start', requireAdmin((data, ack) => {
    const timeLimit = Math.max(5, Math.min(300, Number(data?.timeLimit) || 30));
    const ok = startQuestion(data?.questionId, timeLimit);
    ack?.({ ok, error: ok ? undefined : '문제를 찾을 수 없습니다.' });
  }));

  socket.on('admin:finish', requireAdmin((data, ack) => {
    finishQuestion();
    ack?.({ ok: true });
  }));

  // 주관식 탈락 판정 적용 {verdicts: {playerId: true|false}}
  socket.on('admin:verdicts', requireAdmin((data, ack) => {
    applySubjectiveVerdicts(data?.verdicts || {});
    ack?.({ ok: true });
  }));

  // 결과 화면 닫고 로비(대기)로
  socket.on('admin:lobby', requireAdmin((data, ack) => {
    clearTimeout(questionTimer);
    state.phase = 'lobby';
    state.question = null;
    state.endsAt = 0;
    state.reveal = null;
    state.results = null;
    broadcastState();
    ack?.({ ok: true });
  }));

  // 전체 초기화: 하트/생존 리셋
  socket.on('admin:reset', requireAdmin((data, ack) => {
    clearTimeout(questionTimer);
    state.phase = 'lobby';
    state.question = null;
    state.endsAt = 0;
    state.reveal = null;
    state.results = null;
    for (const p of players.values()) {
      p.hearts = state.settings.hearts;
      p.alive = true;
      p.answerText = '';
    }
    broadcastState();
    ack?.({ ok: true });
  }));

  // 특정 학생 내보내기
  socket.on('admin:kick', requireAdmin((data, ack) => {
    const p = players.get(data?.playerId);
    if (p) {
      players.delete(p.id);
      io.sockets.sockets.get(p.id)?.emit('kicked');
      io.sockets.sockets.get(p.id)?.disconnect(true);
      broadcastState();
    }
    ack?.({ ok: true });
  }));

  socket.on('disconnect', () => {
    const p = players.get(socket.id);
    if (p) {
      p.connected = false;
      p.disconnectedAt = Date.now();
      p.tx = p.ty = null;
      broadcastState();
    }
  });
});

server.listen(PORT, () => {
  console.log(`클래스룸 퀴즈 아레나 실행 중: http://localhost:${PORT}`);
  console.log(`관리자 페이지: http://localhost:${PORT}/admin (PIN: ${ADMIN_PIN})`);
});
