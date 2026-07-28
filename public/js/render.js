/**
 * 아레나 공용 렌더러 - 학생/관리자 화면에서 함께 사용
 * 좌표계: 아레나 1000x600 을 캔버스 크기에 맞춰 레터박스 스케일
 */
const Arena = (() => {
  const W = 1000;
  const H = 600;

  const ZONE_COLORS = ['#4caf7d', '#e05c5c', '#4d8fd6', '#d6a94d'];
  const ZONE_LABELS = ['①', '②', '③', '④'];

  function computeView(canvas) {
    const cw = canvas.width;
    const ch = canvas.height;
    const scale = Math.min(cw / W, ch / H);
    return {
      scale,
      ox: (cw - W * scale) / 2,
      oy: (ch - H * scale) / 2,
    };
  }

  function toArena(view, cx, cy) {
    return { x: (cx - view.ox) / view.scale, y: (cy - view.oy) / view.scale };
  }

  // 구역 사각형 목록 계산 (서버 getZone 과 동일한 배치)
  function zoneRects(question) {
    if (!question) return [];
    if (question.type === 'ox') {
      return [
        { x: 0, y: 0, w: W / 2, h: H, label: 'O', color: '#4caf7d' },
        { x: W / 2, y: 0, w: W / 2, h: H, label: 'X', color: '#e05c5c' },
      ];
    }
    if (question.type === 'choice') {
      const n = question.choices.length;
      if (n <= 3) {
        return question.choices.map((c, i) => ({
          x: (W / n) * i, y: 0, w: W / n, h: H,
          label: ZONE_LABELS[i], text: c, color: ZONE_COLORS[i],
        }));
      }
      return question.choices.map((c, i) => {
        const col = i % 2;
        const row = Math.floor(i / 2);
        return {
          x: (W / 2) * col, y: (H / 2) * row, w: W / 2, h: H / 2,
          label: ZONE_LABELS[i], text: c, color: ZONE_COLORS[i],
        };
      });
    }
    return [];
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function drawBackground(ctx, showZones, question, highlightAnswer) {
    // 바닥
    const grd = ctx.createLinearGradient(0, 0, 0, H);
    grd.addColorStop(0, '#bfe3b4');
    grd.addColorStop(1, '#9fd49a');
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, W, H);

    // 잔디 무늬 점
    ctx.fillStyle = 'rgba(255,255,255,0.15)';
    for (let i = 0; i < 40; i++) {
      const x = (i * 137.5) % W;
      const y = (i * 91.7) % H;
      ctx.beginPath();
      ctx.arc(x, y, 3, 0, Math.PI * 2);
      ctx.fill();
    }

    if (showZones && question) {
      const rects = zoneRects(question);
      rects.forEach((r, i) => {
        const isAnswer = highlightAnswer != null && i === highlightAnswer;
        ctx.fillStyle = r.color + (isAnswer ? 'cc' : '55');
        ctx.fillRect(r.x + 6, r.y + 6, r.w - 12, r.h - 12);
        ctx.strokeStyle = r.color;
        ctx.lineWidth = isAnswer ? 8 : 3;
        ctx.strokeRect(r.x + 6, r.y + 6, r.w - 12, r.h - 12);

        // 큰 라벨 (O / X / 번호)
        ctx.fillStyle = 'rgba(255,255,255,0.85)';
        ctx.font = `bold ${question.type === 'ox' ? 160 : 70}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(r.label, r.x + r.w / 2, r.y + r.h / 2 - (r.text ? 25 : 0));

        // 보기 텍스트
        if (r.text) {
          ctx.fillStyle = '#1b3a2a';
          ctx.font = 'bold 30px sans-serif';
          wrapText(ctx, r.text, r.x + r.w / 2, r.y + r.h / 2 + 45, r.w - 50, 36);
        }
      });
      // 경계선
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.lineWidth = 4;
      ctx.setLineDash([14, 10]);
      if (question.type === 'ox' || (question.type === 'choice' && question.choices.length === 2)) {
        line(ctx, W / 2, 0, W / 2, H);
      } else if (question.type === 'choice' && question.choices.length === 3) {
        line(ctx, W / 3, 0, W / 3, H);
        line(ctx, (2 * W) / 3, 0, (2 * W) / 3, H);
      } else if (question.type === 'choice' && question.choices.length >= 4) {
        line(ctx, W / 2, 0, W / 2, H);
        line(ctx, 0, H / 2, W, H / 2);
      }
      ctx.setLineDash([]);
    }

    // 아레나 테두리
    ctx.strokeStyle = '#5e8c5a';
    ctx.lineWidth = 6;
    ctx.strokeRect(3, 3, W - 6, H - 6);
  }

  function line(ctx, x1, y1, x2, y2) {
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }

  function wrapText(ctx, text, cx, cy, maxW, lineH) {
    const words = String(text).split(' ');
    const lines = [];
    let cur = '';
    for (const w of words) {
      const test = cur ? cur + ' ' + w : w;
      if (ctx.measureText(test).width > maxW && cur) {
        lines.push(cur);
        cur = w;
      } else cur = test;
    }
    if (cur) lines.push(cur);
    lines.slice(0, 3).forEach((l, i) => ctx.fillText(l, cx, cy + i * lineH));
  }

  // 캐릭터 그리기
  function drawCharacter(ctx, p, opts = {}) {
    const { x, y } = p.disp;
    const t = performance.now() / 1000;
    const walking = p.walking;
    const bob = walking ? Math.sin(t * 14 + p.seed) * 3 : Math.sin(t * 2 + p.seed) * 1.5;
    const r = 24;
    const ghost = !p.alive;

    ctx.save();
    ctx.translate(x, y);
    if (ghost) ctx.globalAlpha = 0.45;

    // 그림자
    ctx.fillStyle = 'rgba(0,0,0,0.2)';
    ctx.beginPath();
    ctx.ellipse(0, r + 6, r * 0.8, 7, 0, 0, Math.PI * 2);
    ctx.fill();

    // 발
    const step = walking ? Math.sin(t * 14 + p.seed) * 8 : 0;
    ctx.fillStyle = ghost ? '#888' : shade(p.color, -30);
    ctx.beginPath();
    ctx.ellipse(-9 + step * 0.4, r + 2 - Math.max(0, step) * 0.4, 8, 5, 0, 0, Math.PI * 2);
    ctx.ellipse(9 - step * 0.4, r + 2 - Math.max(0, -step) * 0.4, 8, 5, 0, 0, Math.PI * 2);
    ctx.fill();

    // 몸통
    ctx.translate(0, bob);
    ctx.fillStyle = ghost ? '#aaa' : p.color;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.15)';
    ctx.lineWidth = 2;
    ctx.stroke();

    // 눈
    const dir = p.facing || 1;
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(-8, -5, 7, 0, Math.PI * 2);
    ctx.arc(8, -5, 7, 0, Math.PI * 2);
    ctx.fill();
    if (ghost) {
      // 탈락: X 눈
      ctx.strokeStyle = '#555';
      ctx.lineWidth = 2.5;
      [[-8, -5], [8, -5]].forEach(([ex, ey]) => {
        ctx.beginPath();
        ctx.moveTo(ex - 4, ey - 4); ctx.lineTo(ex + 4, ey + 4);
        ctx.moveTo(ex + 4, ey - 4); ctx.lineTo(ex - 4, ey + 4);
        ctx.stroke();
      });
    } else {
      ctx.fillStyle = '#222';
      ctx.beginPath();
      ctx.arc(-8 + dir * 2.5, -5, 3.5, 0, Math.PI * 2);
      ctx.arc(8 + dir * 2.5, -5, 3.5, 0, Math.PI * 2);
      ctx.fill();
      // 입
      ctx.strokeStyle = '#222';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, 5, 6, 0.15 * Math.PI, 0.85 * Math.PI);
      ctx.stroke();
    }

    // 액세서리
    drawAccessory(ctx, p.accessory, r, ghost);
    ctx.restore();

    // 이름 + 하트 (머리 위)
    ctx.save();
    ctx.translate(x, y);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const heartsY = -r - 34;
    if (p.hearts > 0 || !p.alive) {
      ctx.font = '13px sans-serif';
      const hs = '❤️'.repeat(Math.min(p.hearts, 10));
      if (hs) ctx.fillText(hs, 0, heartsY);
      if (!p.alive) {
        ctx.fillText('💀', 0, heartsY);
      }
    }

    ctx.font = 'bold 15px sans-serif';
    const nw = ctx.measureText(p.nickname).width;
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    roundRect(ctx, -nw / 2 - 6, -r - 24, nw + 12, 18, 8);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.fillText(p.nickname, 0, -r - 15);

    // 말풍선 (주관식 공개 등)
    if (p.bubble) {
      ctx.font = 'bold 16px sans-serif';
      const bw = Math.min(220, Math.max(40, ctx.measureText(p.bubble).width + 20));
      const by = -r - 72;
      ctx.fillStyle = p.bubbleColor || '#fff';
      roundRect(ctx, -bw / 2, by - 14, bw, 30, 10);
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.2)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-6, by + 16);
      ctx.lineTo(6, by + 16);
      ctx.lineTo(0, by + 26);
      ctx.closePath();
      ctx.fillStyle = p.bubbleColor || '#fff';
      ctx.fill();
      ctx.fillStyle = '#222';
      ctx.fillText(clip(ctx, p.bubble, bw - 16), 0, by + 1);
    }
    ctx.restore();

    // 목표 지점 표시 (자기 자신만)
    if (opts.showTarget && p.target) {
      ctx.save();
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.lineWidth = 3;
      const rad = 12 + Math.sin(t * 6) * 3;
      ctx.beginPath();
      ctx.arc(p.target.x, p.target.y, rad, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  function clip(ctx, text, maxW) {
    let s = String(text);
    while (s.length > 1 && ctx.measureText(s).width > maxW) s = s.slice(0, -1);
    return s === text ? s : s + '…';
  }

  function drawAccessory(ctx, kind, r, ghost) {
    ctx.save();
    if (ghost) ctx.globalAlpha = 0.7;
    switch (kind) {
      case 'cap': // 모자
        ctx.fillStyle = '#3b6fd4';
        ctx.beginPath();
        ctx.arc(0, -r + 4, r * 0.72, Math.PI, 0);
        ctx.fill();
        ctx.fillRect(-r * 0.72, -r + 2, r * 1.9, 5);
        break;
      case 'ribbon': // 리본
        ctx.fillStyle = '#e0559a';
        ctx.beginPath();
        ctx.moveTo(2, -r + 2);
        ctx.lineTo(16, -r - 8);
        ctx.lineTo(16, -r + 10);
        ctx.closePath();
        ctx.moveTo(-2, -r + 2);
        ctx.lineTo(-16, -r - 8);
        ctx.lineTo(-16, -r + 10);
        ctx.closePath();
        ctx.fill();
        ctx.beginPath();
        ctx.arc(0, -r + 2, 5, 0, Math.PI * 2);
        ctx.fill();
        break;
      case 'crown': // 왕관
        ctx.fillStyle = '#f2c53d';
        ctx.beginPath();
        ctx.moveTo(-14, -r + 2);
        ctx.lineTo(-14, -r - 12);
        ctx.lineTo(-7, -r - 4);
        ctx.lineTo(0, -r - 14);
        ctx.lineTo(7, -r - 4);
        ctx.lineTo(14, -r - 12);
        ctx.lineTo(14, -r + 2);
        ctx.closePath();
        ctx.fill();
        break;
      case 'glasses': // 안경
        ctx.strokeStyle = '#333';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(-8, -5, 9, 0, Math.PI * 2);
        ctx.moveTo(9 + 8, -5);
        ctx.arc(8, -5, 9, 0, Math.PI * 2);
        ctx.moveTo(-1, -5);
        ctx.lineTo(1, -5);
        ctx.stroke();
        break;
      case 'flower': // 꽃
        ctx.fillStyle = '#fff';
        for (let i = 0; i < 5; i++) {
          const a = (i / 5) * Math.PI * 2;
          ctx.beginPath();
          ctx.arc(12 + Math.cos(a) * 6, -r - 2 + Math.sin(a) * 6, 5, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.fillStyle = '#f2c53d';
        ctx.beginPath();
        ctx.arc(12, -r - 2, 4.5, 0, Math.PI * 2);
        ctx.fill();
        break;
    }
    ctx.restore();
  }

  function shade(hex, amt) {
    const n = parseInt(hex.slice(1), 16);
    const r = Math.max(0, Math.min(255, (n >> 16) + amt));
    const g = Math.max(0, Math.min(255, ((n >> 8) & 0xff) + amt));
    const b = Math.max(0, Math.min(255, (n & 0xff) + amt));
    return `rgb(${r},${g},${b})`;
  }

  /**
   * 전체 프레임 그리기
   * chars: Map<id, charState> — charState: {disp:{x,y}, walking, facing, seed, ...playerPublic}
   */
  function draw(canvas, chars, question, opts = {}) {
    const ctx = canvas.getContext('2d');
    const view = computeView(canvas);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#2e4632';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.save();
    ctx.translate(view.ox, view.oy);
    ctx.scale(view.scale, view.scale);

    drawBackground(ctx, opts.showZones, question, opts.highlightAnswer);

    // y 순 정렬해서 그리기 (아래 있는 캐릭터가 앞으로)
    const list = [...chars.values()].sort((a, b) => a.disp.y - b.disp.y);
    for (const c of list) {
      drawCharacter(ctx, c, { showTarget: opts.selfId === c.id });
    }
    ctx.restore();
    return view;
  }

  return { W, H, computeView, toArena, zoneRects, draw };
})();
