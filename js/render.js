// Draws everything on the canvas. All coordinates are in a 1280x720 space
// that gets scaled to the window. The field is tilted like a TV broadcast.
(function () {
  const FB = (window.FB = window.FB || {});
  const { clamp, lerp } = FB.U;
  const R = FB.Rules;
  const WIDTH = R.FIELD_WIDTH;

  const VIEW_W = 1280;
  const VIEW_H = 720;
  const FIELD_TOP = 172;
  const FIELD_DEPTH = 510;
  const YARD_PX = 20.5;
  const BRO_SIZE = 1.22;

  const NIGHT = '#0b1424';
  const WALL = '#14233f';
  const APRON = '#1d6a33';
  const GRASS_A = '#2e9142';
  const GRASS_B = '#288639';
  const GOLD = '#ffd21f';
  const FONT = '"Arial Black", Impact, "Segoe UI", sans-serif';

  function rgb(hex) {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  function colorGap(a, b) {
    const [r1, g1, b1] = rgb(a);
    const [r2, g2, b2] = rgb(b);
    return Math.hypot(r1 - r2, g1 - g2, b1 - b2);
  }

  function roundRect(c, x, y, w, h, r) {
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
  }

  class Renderer {
    constructor(canvas) {
      this.canvas = canvas;
      this.c = canvas.getContext('2d');
      this.k = 1;
      this.cam = 60;
      this.time = 0;
      this.shake = 0;
      this.fx = [];
      this.kits = null;
      this.crowd = null;
      this.cheer = 0;
    }

    resize(width, height, dpr) {
      this.canvas.width = Math.round(width * dpr);
      this.canvas.height = Math.round(height * dpr);
      this.k = this.canvas.width / VIEW_W;
    }

    // The second team switches to white if the two kits would look alike.
    setMatch(m) {
      const [a, b] = m.teams;
      const kit = (t, white) => ({
        body: white ? '#f4f6fa' : t.primary,
        trim: white ? t.primary : t.secondary,
        helmet: white ? t.primary : t.helmet,
        pants: white ? '#d8dde6' : colorGap(t.primary, '#ffffff') < 120 ? t.secondary : '#eef0f4',
        number: white ? t.primary : colorGap(t.primary, '#ffffff') < 200 ? '#101820' : '#ffffff',
      });
      this.kits = [kit(a, false), kit(b, colorGap(a.primary, b.primary) < 150)];
      this.cam = 60;
      this.fx = [];
      this.buildCrowd(a, b);
    }

    buildCrowd(a, b) {
      const tile = document.createElement('canvas');
      tile.width = 1600;
      tile.height = 150;
      const c = tile.getContext('2d');
      c.fillStyle = '#101b30';
      c.fillRect(0, 0, 1600, 150);
      const colors = [a.primary, a.secondary, b.primary, b.secondary, '#e8e8e8', '#c94f4f', '#4f7fc9', '#d6b24a'];
      const skins = ['#8d5a3b', '#e0ac7e', '#b98058', '#5a3620'];
      for (let row = 0; row < 7; row++) {
        const y = 12 + row * 20;
        for (let x = (row % 2) * 10; x < 1600; x += 20) {
          c.fillStyle = colors[Math.floor(Math.random() * colors.length)];
          c.fillRect(x - 7, y + 3, 14, 12);
          c.fillStyle = skins[Math.floor(Math.random() * skins.length)];
          c.beginPath();
          c.arc(x, y, 6, 0, 7);
          c.fill();
        }
      }
      this.crowd = tile;
    }

    proj(x, y, z) {
      const t = y / WIDTH;
      const s = 0.68 + 0.56 * t;
      const sy = FIELD_TOP + t * (0.78 + 0.22 * t) * FIELD_DEPTH;
      const sx = VIEW_W / 2 + (x - this.cam) * YARD_PX * s + (0.5 - t) * 150;
      return [sx, sy - (z || 0) * YARD_PX * s, s];
    }

    poly(points, fill) {
      const c = this.c;
      c.beginPath();
      points.forEach(([x, y], i) => {
        const [sx, sy] = this.proj(x, y);
        if (i) c.lineTo(sx, sy);
        else c.moveTo(sx, sy);
      });
      c.closePath();
      c.fillStyle = fill;
      c.fill();
    }

    line(x1, y1, x2, y2, color, width) {
      const c = this.c;
      const [a, b] = this.proj(x1, y1);
      const [d, e] = this.proj(x2, y2);
      c.strokeStyle = color;
      c.lineWidth = width;
      c.beginPath();
      c.moveTo(a, b);
      c.lineTo(d, e);
      c.stroke();
    }

    // Text painted flat on the grass.
    groundText(text, x, y, sizeYards, color, spin) {
      const c = this.c;
      const k = this.k;
      const [ax, ay] = this.proj(x, y);
      const [bx, by] = this.proj(x + 1, y);
      const [cx, cy] = this.proj(x, y + 1);
      c.save();
      c.setTransform(((bx - ax) / 20) * k, ((by - ay) / 20) * k, ((cx - ax) / 20) * k, ((cy - ay) / 20) * k, (ax + this.shakeX) * k, (ay + this.shakeY) * k);
      if (spin) c.rotate(spin);
      c.font = `${sizeYards * 20}px ${FONT}`;
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillStyle = color;
      c.fillText(text, 0, 0);
      c.restore();
    }

    // ---- Effects ----------------------------------------------------------

    onEvent(e) {
      switch (e.type) {
        case 'tackle':
          this.dust(e.x, e.y, 10);
          if (e.impact > 9 || e.sack) {
            this.shake = 7;
            this.stars(e.x, e.y);
          }
          break;
        case 'broken':
        case 'stiffhit':
          this.stars(e.x, e.y);
          break;
        case 'td':
          this.confetti(e.team);
          this.cheer = 4;
          break;
        case 'int':
        case 'fumble':
          this.cheer = 2;
          this.shake = 5;
          break;
        case 'dive':
          this.dust(e.x, e.y, 5);
          break;
      }
    }

    dust(x, y, n) {
      for (let i = 0; i < n; i++) {
        this.fx.push({ kind: 'dust', x, y, vx: (Math.random() - 0.5) * 7, vy: (Math.random() - 0.5) * 5, z: 0.2, t: 0, life: 0.5 + Math.random() * 0.3 });
      }
    }

    stars(x, y) {
      for (let i = 0; i < 6; i++) {
        this.fx.push({ kind: 'star', x, y, vx: (Math.random() - 0.5) * 9, vy: (Math.random() - 0.5) * 7, z: 2.4, t: 0, life: 0.55 });
      }
    }

    confetti(team) {
      const kit = this.kits[team];
      for (let i = 0; i < 130; i++) {
        this.fx.push({
          kind: 'confetti', sx: Math.random() * VIEW_W, sy: -20 - Math.random() * 320,
          vy: 170 + Math.random() * 170, sway: Math.random() * 6, t: 0, life: 3.4,
          color: [kit.body, kit.trim, GOLD, '#ffffff'][i % 4],
        });
      }
    }

    updateFx(dt) {
      this.fx.forEach((f) => {
        f.t += dt;
        if (f.kind === 'confetti') {
          f.sy += f.vy * dt;
          f.sx += Math.sin(f.t * 4 + f.sway) * 1.2;
        } else {
          f.x += f.vx * dt;
          f.y += f.vy * dt;
          f.z += dt * 0.8;
        }
      });
      this.fx = this.fx.filter((f) => f.t < f.life);
      this.shake = Math.max(0, this.shake - dt * 22);
      this.cheer = Math.max(0, this.cheer - dt);
    }

    drawFx() {
      const c = this.c;
      this.fx.forEach((f) => {
        const a = 1 - f.t / f.life;
        if (f.kind === 'dust') {
          const [x, y, s] = this.proj(f.x, f.y, f.z);
          c.fillStyle = `rgba(214,200,160,${a * 0.6})`;
          c.beginPath();
          c.arc(x, y, (3 + f.t * 12) * s, 0, 7);
          c.fill();
        } else if (f.kind === 'star') {
          const [x, y, s] = this.proj(f.x, f.y, f.z);
          this.star(x, y, 8 * s, `rgba(255,226,70,${a})`);
        } else {
          c.fillStyle = f.color;
          c.save();
          c.translate(f.sx, f.sy);
          c.rotate(f.t * 5 + f.sway);
          c.fillRect(-4, -2.5, 8, 5);
          c.restore();
        }
      });
    }

    star(x, y, r, color) {
      const c = this.c;
      c.fillStyle = color;
      c.beginPath();
      for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        const rad = i % 2 ? r * 0.45 : r;
        c[i ? 'lineTo' : 'moveTo'](x + Math.cos(a) * rad, y + Math.sin(a) * rad);
      }
      c.closePath();
      c.fill();
    }

    // ---- The stadium ------------------------------------------------------

    updateCam(m, dt) {
      const s = m.sim;
      let goal = this.cam;
      if (s) {
        const b = s.ball;
        if (!s.live) goal = s.los + s.dir * 10;
        else if (b.state === 'air') goal = lerp(b.x, b.tx, 0.4);
        else if (s.carrier) goal = s.carrier.x + s.dirOf(s.carrier.team) * 4;
        else goal = b.x;
      }
      goal = clamp(goal, 24, 96);
      this.cam += (goal - this.cam) * (1 - Math.exp(-dt * 4.5));
    }

    drawStadium(m) {
      const c = this.c;
      c.fillStyle = NIGHT;
      c.fillRect(-20, -20, VIEW_W + 40, VIEW_H + 40);
      if (this.crowd) {
        const offset = -(((this.cam * 4) % 1600) + 1600) % 1600;
        const bounce = this.cheer > 0 ? Math.abs(Math.sin(this.time * 12)) * 5 : Math.sin(this.time * 2) * 1.2;
        c.drawImage(this.crowd, offset, bounce - 6);
        c.drawImage(this.crowd, offset + 1600, bounce - 6);
      }
      c.fillStyle = WALL;
      c.fillRect(-20, 134, VIEW_W + 40, 30);
      c.fillStyle = 'rgba(255,255,255,.08)';
      c.fillRect(-20, 134, VIEW_W + 40, 3);
      c.fillStyle = APRON;
      c.fillRect(-20, 160, VIEW_W + 40, VIEW_H);
    }

    drawField(m) {
      const c = this.c;
      const g = m.g;
      const lo = Math.max(0, this.cam - 62);
      const hi = Math.min(120, this.cam + 62);

      for (let x = 10; x < 110; x += 5) {
        if (x + 5 < lo || x > hi) continue;
        this.poly([[x, 0], [x + 5, 0], [x + 5, WIDTH], [x, WIDTH]], (x / 5) % 2 ? GRASS_A : GRASS_B);
      }

      // The end zone is painted for the team defending it.
      const left = R.dir(g, 0) > 0 ? 0 : 1;
      const zones = [[0, left], [110, R.other(left)]];
      zones.forEach(([x, team]) => {
        const T = m.teams[team];
        this.poly([[x, 0], [x + 10, 0], [x + 10, WIDTH], [x, WIDTH]], T.primary);
        const label = colorGap(T.primary, '#ffffff') < 130 ? T.secondary : '#ffffff';
        this.groundText(T.name.toUpperCase(), x + 5, WIDTH / 2, 5.5, label, x ? Math.PI / 2 : -Math.PI / 2);
      });

      c.lineCap = 'butt';
      for (let x = 10; x <= 110; x += 5) {
        if (x < lo || x > hi) continue;
        this.line(x, 0, x, WIDTH, 'rgba(255,255,255,.92)', x === 10 || x === 110 ? 5 : 2.6);
      }
      for (let x = 11; x < 110; x++) {
        if (x < lo || x > hi || x % 5 === 0) continue;
        [[0.5, 1.3], [17.6, 18.5], [34.8, 35.7], [52, 52.8]].forEach(([a, b]) => {
          this.line(x, a, x, b, 'rgba(255,255,255,.75)', 1.7);
        });
      }
      this.line(0, 0, 120, 0, '#fff', 3.5);
      this.line(0, WIDTH, 120, WIDTH, '#fff', 5);
      this.line(0, 0, 0, WIDTH, '#fff', 3.5);
      this.line(120, 0, 120, WIDTH, '#fff', 3.5);

      for (let line = 10; line <= 90; line += 10) {
        const x = 10 + line;
        if (x < lo || x > hi) continue;
        const n = String(Math.min(line, 100 - line)).split('').join(' ');
        this.groundText(n, x, 44.5, 3.2, 'rgba(255,255,255,.9)');
        this.groundText(n, x, 8.5, 3.2, 'rgba(255,255,255,.9)', Math.PI);
      }
    }

    drawPosts() {
      [0, 120].forEach((x) => {
        const c = this.c;
        const mid = WIDTH / 2;
        const [bx, by] = this.proj(x, mid, 0);
        const [cx, cy] = this.proj(x, mid, 3.3);
        const [lx, ly] = this.proj(x, mid - 3.08, 3.3);
        const [rx, ry] = this.proj(x, mid + 3.08, 3.3);
        const [tx, ty] = this.proj(x, mid - 3.08, 12);
        const [ux, uy] = this.proj(x, mid + 3.08, 12);
        if (Math.max(bx, lx, rx) < -40 || Math.min(bx, lx, rx) > VIEW_W + 40) return;
        c.lineCap = 'round';
        c.strokeStyle = '#e8b400';
        c.lineWidth = 7;
        c.beginPath();
        c.moveTo(bx, by);
        c.lineTo(cx, cy);
        c.stroke();
        c.strokeStyle = GOLD;
        c.lineWidth = 5;
        c.beginPath();
        c.moveTo(tx, ty);
        c.lineTo(lx, ly);
        c.lineTo(rx, ry);
        c.lineTo(ux, uy);
        c.stroke();
      });
    }

    drawMarkers(m) {
      const s = m.sim;
      if (!s) return;
      if (s.kind === 'scrimmage' || s.kind === 'punt') {
        this.line(s.los, 0, s.los, WIDTH, '#3f8bff', 3.4);
      }
      if (s.firstDownX !== null) this.line(s.firstDownX, 0, s.firstDownX, WIDTH, GOLD, 3.4);

      const b = s.ball;
      if (b.state === 'air' && b.kind !== 'fg') {
        const [x, y, sc] = this.proj(b.tx, clamp(b.ty, 0, WIDTH));
        const pulse = 1 + Math.sin(this.time * 12) * 0.12;
        const c = this.c;
        c.strokeStyle = 'rgba(255,230,90,.95)';
        c.lineWidth = 3;
        c.beginPath();
        c.ellipse(x, y, 30 * sc * pulse, 11 * sc * pulse, 0, 0, 7);
        c.stroke();
      }
    }

    drawRoutes(m) {
      const s = m.sim;
      if (m.phase !== 'presnap' || !m.isUser(s.offTeam)) return;
      const c = this.c;
      s.players.forEach((p) => {
        if (p.team !== s.offTeam || !p.route.length) return;
        const pts = [[p.x, p.y]].concat(p.route.map((w) => [w.x, w.y])).map(([x, y]) => this.proj(x, y));
        const run = p.role === 'path';
        c.strokeStyle = run ? 'rgba(255,214,60,.95)' : 'rgba(255,255,255,.85)';
        c.lineWidth = run ? 4 : 3;
        c.setLineDash(run ? [] : [9, 7]);
        c.beginPath();
        pts.forEach(([x, y], i) => c[i ? 'lineTo' : 'moveTo'](x, y));
        c.stroke();
        c.setLineDash([]);
        const [ex, ey] = pts[pts.length - 1];
        const [fx, fy] = pts[pts.length - 2];
        const a = Math.atan2(ey - fy, ex - fx);
        c.fillStyle = c.strokeStyle;
        c.beginPath();
        c.moveTo(ex + Math.cos(a) * 11, ey + Math.sin(a) * 11);
        c.lineTo(ex + Math.cos(a + 2.4) * 11, ey + Math.sin(a + 2.4) * 11);
        c.lineTo(ex + Math.cos(a - 2.4) * 11, ey + Math.sin(a - 2.4) * 11);
        c.fill();
      });
    }

    // ---- Players ----------------------------------------------------------

    drawBro(p, kit, s) {
      const c = this.c;
      const [sx, sy, scale] = this.proj(p.x, p.y);
      if (sx < -90 || sx > VIEW_W + 90) return;
      const lying = p.down > 0;
      const diving = p.dive > 0;
      const size = scale * BRO_SIZE;
      const jump = p.celebrate && s.over ? Math.abs(Math.sin(this.time * 7 + p.num)) * 18 * size : 0;

      c.fillStyle = 'rgba(0,0,0,.3)';
      c.beginPath();
      c.ellipse(sx, sy, (lying ? 26 : 16) * size, 5.5 * size, 0, 0, 7);
      c.fill();

      c.save();
      c.translate(sx, sy - jump);
      c.scale(size * p.face, size);
      if (lying) {
        c.translate(-27, -4);
        c.rotate(1.5);
      } else if (diving) {
        c.translate(-14, -12);
        c.rotate(1.05);
      }

      const speed = Math.hypot(p.vx, p.vy);
      const stride = lying || diving ? 0.2 : Math.sin(p.anim) * clamp(speed / 4, 0, 1);

      c.lineCap = 'round';
      c.lineJoin = 'round';
      const leg = (dir) => {
        const fx = dir * 3 + stride * dir * 11;
        const lift = Math.max(0, stride * dir) * 5;
        c.strokeStyle = kit.pants;
        c.lineWidth = 8;
        c.beginPath();
        c.moveTo(dir * 3, -21);
        c.lineTo(fx, -7 - lift);
        c.stroke();
        c.strokeStyle = kit.trim;
        c.lineWidth = 6;
        c.beginPath();
        c.moveTo(fx, -8 - lift);
        c.lineTo(fx, -3 - lift);
        c.stroke();
        c.fillStyle = '#15181f';
        c.beginPath();
        c.ellipse(fx + 2, -1.5 - lift, 6, 2.8, 0, 0, 7);
        c.fill();
      };
      leg(-1);
      leg(1);

      const arm = (x, y, ex, ey) => {
        c.strokeStyle = kit.body;
        c.lineWidth = 7;
        c.beginPath();
        c.moveTo(x, y);
        c.lineTo((x + ex) / 2, (y + ey) / 2);
        c.stroke();
        c.strokeStyle = p.skin;
        c.lineWidth = 6;
        c.beginPath();
        c.moveTo((x + ex) / 2, (y + ey) / 2);
        c.lineTo(ex, ey);
        c.stroke();
      };

      if (!p.stiff && !p.throwT) arm(-9, -36, -11 - stride * 7, -24);

      c.fillStyle = kit.body;
      roundRect(c, -12, -41, 24, 24, 7);
      c.fill();
      c.fillStyle = kit.trim;
      c.fillRect(-12, -36, 24, 3);
      c.fillStyle = kit.number;
      c.font = 'bold 12px Arial, sans-serif';
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.save();
      if (p.face < 0) c.scale(-1, 1);
      c.fillText(String(p.num), 0, -25);
      c.restore();

      const hasBall = s.carrier === p && s.ball.state === 'held';
      if (p.stiff > 0) arm(9, -36, 27, -38);
      else if (p.throwT > 0) arm(7, -38, 15, -60);
      else if (p.celebrate && s.over) arm(9, -37, 15, -62);
      else if (hasBall) arm(9, -35, 12, -25);
      else arm(9, -36, 11 + stride * 7, -24);
      if (p.celebrate && s.over) arm(-9, -37, -15, -62);

      c.fillStyle = kit.helmet;
      c.beginPath();
      c.arc(1, -52, 14.5, 0, 7);
      c.fill();
      c.fillStyle = p.skin;
      c.beginPath();
      c.arc(4, -50, 10, -0.9, 1.5);
      c.closePath();
      c.fill();
      c.fillStyle = '#fff';
      c.beginPath();
      c.arc(8, -53, 3.4, 0, 7);
      c.fill();
      c.fillStyle = '#111';
      c.beginPath();
      c.arc(9.2, -53, 1.7, 0, 7);
      c.fill();
      c.strokeStyle = '#9aa0ab';
      c.lineWidth = 2.2;
      c.beginPath();
      c.moveTo(4, -47);
      c.lineTo(15.5, -47);
      c.moveTo(4, -43);
      c.lineTo(13, -43);
      c.moveTo(13.5, -50);
      c.lineTo(11, -41);
      c.stroke();
      c.strokeStyle = kit.trim;
      c.lineWidth = 3.4;
      c.beginPath();
      c.arc(1, -52, 13, -2.6, -0.6);
      c.stroke();

      if (hasBall) this.footballAt(13, -27, 0.9, 0.5);
      c.restore();
    }

    footballAt(x, y, size, angle) {
      const c = this.c;
      c.save();
      c.translate(x, y);
      c.rotate(angle);
      c.scale(size, size);
      c.fillStyle = '#7a3f18';
      c.beginPath();
      c.ellipse(0, 0, 9, 5.4, 0, 0, 7);
      c.fill();
      c.strokeStyle = '#fff';
      c.lineWidth = 1.2;
      c.beginPath();
      c.moveTo(-3, 0);
      c.lineTo(3, 0);
      c.moveTo(-1.2, -1.4);
      c.lineTo(-1.2, 1.4);
      c.moveTo(1.2, -1.4);
      c.lineTo(1.2, 1.4);
      c.stroke();
      c.restore();
    }

    drawPlayers(m) {
      const s = m.sim;
      if (!s) return;
      const order = s.players.slice().sort((a, b) => a.y - b.y);
      const c = this.c;

      order.forEach((p) => {
        if (p === s.control && !s.over) {
          const [x, y, sc] = this.proj(p.x, p.y);
          this.star(x, y, 23 * sc, GOLD);
        }
        if (p === s.target && !s.thrown && !s.over && s.live && s.canThrow(s.carrier || {})) {
          const near = s.nearestOpponent(p).d;
          const color = near > 4 ? '#3dff7a' : near > 2 ? '#ffe14d' : '#ff5a4d';
          const [x, y, sc] = this.proj(p.x, p.y);
          c.strokeStyle = color;
          c.lineWidth = 3.5;
          c.beginPath();
          c.ellipse(x, y, 29 * sc, 11 * sc, 0, 0, 7);
          c.stroke();
        }
        this.drawBro(p, this.kits[p.team], s);
      });

      const tagged = s.carrier || s.control;
      if (tagged && !s.over && s.live) {
        const [x, y, sc] = this.proj(tagged.x, tagged.y);
        const text = FB.playerName(tagged);
        c.font = `13px ${FONT}`;
        c.textAlign = 'center';
        c.textBaseline = 'alphabetic';
        const w = c.measureText(text).width + 14;
        c.fillStyle = 'rgba(8,14,28,.72)';
        roundRect(c, x - w / 2, y - 112 * sc, w, 20, 6);
        c.fill();
        c.fillStyle = '#fff';
        c.fillText(text, x, y - 112 * sc + 15);
      }
    }

    drawBall(m) {
      const s = m.sim;
      if (!s) return;
      const b = s.ball;
      if (b.state === 'dead' && s.live === false && s.kind === 'scrimmage') return;
      if (b.state === 'held' && s.carrier) return;
      const [gx, gy, gs] = this.proj(b.x, clamp(b.y, -2, WIDTH + 2));
      const [x, y, sc] = this.proj(b.x, b.y, b.z);
      const c = this.c;
      c.fillStyle = 'rgba(0,0,0,.28)';
      c.beginPath();
      c.ellipse(gx, gy, 7 * gs, 2.6 * gs, 0, 0, 7);
      c.fill();
      this.footballAt(x, y, sc * (1 + b.z * 0.02), b.spin);
    }

    // ---- Heads-up display -------------------------------------------------

    drawScoreboard(m) {
      const c = this.c;
      const g = m.g;
      const cx = VIEW_W / 2;
      const w = 560;
      const left = cx - w / 2;

      c.fillStyle = 'rgba(8,14,30,.94)';
      roundRect(c, left, 8, w, 66, 12);
      c.fill();
      c.strokeStyle = 'rgba(255,255,255,.14)';
      c.lineWidth = 2;
      c.stroke();

      const side = (i, x, align) => {
        const T = m.teams[i];
        c.fillStyle = T.primary;
        roundRect(c, align < 0 ? x : x - 92, 16, 92, 34, 7);
        c.fill();
        c.strokeStyle = T.secondary;
        c.lineWidth = 2;
        c.stroke();
        c.fillStyle = colorGap(T.primary, '#ffffff') < 130 ? T.secondary : '#fff';
        c.font = `21px ${FONT}`;
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        c.fillText(T.abbr, align < 0 ? x + 46 : x - 46, 34);
        if (g.pos === i && g.mode !== 'kickoff') {
          this.footballAt(align < 0 ? x + 104 : x - 104, 56, 0.8, 0);
        }
        c.fillStyle = GOLD;
        c.font = `36px ${FONT}`;
        c.fillText(String(g.score[i]), align < 0 ? x + 134 : x - 134, 35);
      };
      side(0, left + 10, -1);
      side(1, left + w - 10, 1);

      c.fillStyle = '#fff';
      c.textAlign = 'center';
      c.font = `25px ${FONT}`;
      c.fillText(R.clockLabel(g), cx, 29);
      c.fillStyle = '#9fb1cf';
      c.font = `13px ${FONT}`;
      c.fillText(R.quarterLabel(g), cx, 50);

      c.font = `13px ${FONT}`;
      c.fillStyle = 'rgba(8,14,30,.86)';
      const info = g.mode === 'kickoff' ? 'Kickoff' : `${R.downLabel(g)}   •   ${R.spotLabel(g, m.teams)}`;
      const iw = c.measureText(info).width + 34;
      roundRect(c, cx - iw / 2, 80, iw, 25, 8);
      c.fill();
      c.fillStyle = '#fff';
      c.fillText(info, cx, 93);
    }

    hint(m) {
      const s = m.sim;
      if (m.user === null) return '';
      if (m.phase === 'presnap') {
        return m.isUser(m.g.pos) ? 'SPACE  Snap the ball' : 'SHIFT  Choose your defender';
      }
      if (m.phase === 'live' && s && !s.over && s.control) {
        if (s.canThrow(s.control)) return 'SPACE  Throw   •   ARROWS  Move or aim   •   SHIFT  Next receiver';
        if (s.control === s.carrier) return 'ARROWS  Run   •   SPACE  Stiff-arm or dive';
        if (s.control.team !== s.ballTeam) return 'ARROWS  Move   •   SPACE  Dive   •   SHIFT  Nearest defender';
        return 'ARROWS  Move   •   SPACE  Jump for the ball';
      }
      return '';
    }

    drawHint(m) {
      const text = this.hint(m);
      if (!text) return;
      const c = this.c;
      c.font = `14px ${FONT}`;
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      const w = c.measureText(text).width + 30;
      c.fillStyle = 'rgba(8,14,30,.8)';
      roundRect(c, VIEW_W / 2 - w / 2, VIEW_H - 40, w, 28, 8);
      c.fill();
      c.fillStyle = '#fff';
      c.fillText(text, VIEW_W / 2, VIEW_H - 26);
    }

    drawMeter(m) {
      const k = m.kick;
      if (m.phase !== 'kickmeter' || !k) return;
      const c = this.c;
      const w = 460;
      const x = VIEW_W / 2 - w / 2;
      const y = VIEW_H - 142;
      c.fillStyle = 'rgba(8,14,30,.93)';
      roundRect(c, x, y, w, 128, 12);
      c.fill();

      const names = { kickoff: 'KICKOFF', punt: 'PUNT', fg: 'FIELD GOAL', xp: 'EXTRA POINT' };
      c.textAlign = 'left';
      c.textBaseline = 'middle';
      c.fillStyle = GOLD;
      c.font = `16px ${FONT}`;
      c.fillText(names[k.kind], x + 16, y + 18);
      c.textAlign = 'right';
      c.fillStyle = '#fff';
      c.font = `13px ${FONT}`;
      const fg = k.kind === 'fg' || k.kind === 'xp';
      const windText = Math.abs(k.wind) < 0.3 ? 'No wind' : `Wind ${k.wind < 0 ? '▲' : '▼'} ${Math.abs(k.wind * 5).toFixed(0)} mph`;
      c.fillText(fg ? `${Math.round(100 - m.g.yard + 17)} yards   •   ${windText}` : 'UP/DOWN  Aim', x + w - 16, y + 18);

      const bar = (label, by, fill, sweet) => {
        c.textAlign = 'left';
        c.fillStyle = '#9fb1cf';
        c.font = `12px ${FONT}`;
        c.fillText(label, x + 16, by + 8);
        const bx = x + 100;
        const bw = w - 116;
        c.fillStyle = '#25324e';
        roundRect(c, bx, by, bw, 16, 5);
        c.fill();
        if (sweet) {
          c.fillStyle = '#2fbf63';
          c.fillRect(bx + bw * sweet[0], by, bw * (sweet[1] - sweet[0]), 16);
        }
        c.fillStyle = '#fff';
        c.fillRect(bx + bw * fill - 2, by - 3, 5, 22);
      };
      bar('POWER', y + 40, k.power, [0.8, 1]);
      bar('ACCURACY', y + 68, (k.accuracy + 1) / 2, [0.42, 0.58]);

      c.textAlign = 'center';
      c.fillStyle = '#fff';
      c.font = `13px ${FONT}`;
      const aimText = fg ? '   •   UP/DOWN  Aim' : '';
      c.fillText(`SPACE  ${k.stage === 0 ? 'Set power' : 'Set accuracy'}${aimText}`, VIEW_W / 2, y + 108);

      if (fg) {
        const offset = (k.aim * 5 + 0) * 9;
        c.fillStyle = GOLD;
        c.beginPath();
        c.arc(x + w / 2 + offset, y + 94, 4, 0, 7);
        c.fill();
      }
    }

    drawBanner(m) {
      const b = m.banner;
      if (!b) return;
      const c = this.c;
      const grow = clamp(b.t / 0.14, 0, 1);
      const fade = clamp((b.life - b.t) / 0.25, 0, 1);
      const size = 74 * (0.7 + 0.3 * grow);
      c.save();
      c.globalAlpha = fade;
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.font = `${size}px ${FONT}`;
      c.lineJoin = 'round';
      c.lineWidth = 11;
      c.strokeStyle = b.team === null ? '#0a1224' : this.kits[b.team].trim;
      c.strokeText(b.text, VIEW_W / 2, 248);
      c.fillStyle = '#fff';
      c.fillText(b.text, VIEW_W / 2, 248);
      if (b.sub) {
        c.font = `25px ${FONT}`;
        c.lineWidth = 7;
        c.strokeStyle = '#0a1224';
        c.strokeText(b.sub, VIEW_W / 2, 306);
        c.fillStyle = GOLD;
        c.fillText(b.sub, VIEW_W / 2, 306);
      }
      c.restore();
    }

    // ---- One frame --------------------------------------------------------

    draw(m, dt) {
      const c = this.c;
      this.time += dt;
      this.updateCam(m, dt);
      this.updateFx(dt);

      this.shakeX = this.shake ? (Math.random() - 0.5) * this.shake : 0;
      this.shakeY = this.shake ? (Math.random() - 0.5) * this.shake : 0;
      c.setTransform(this.k, 0, 0, this.k, this.shakeX * this.k, this.shakeY * this.k);

      this.drawStadium(m);
      this.drawField(m);
      this.drawPosts();
      this.drawMarkers(m);
      this.drawRoutes(m);
      this.drawPlayers(m);
      this.drawBall(m);
      this.drawFx();

      c.setTransform(this.k, 0, 0, this.k, 0, 0);
      this.drawScoreboard(m);
      this.drawMeter(m);
      this.drawHint(m);
      this.drawBanner(m);
    }
  }

  FB.Renderer = Renderer;
})();
