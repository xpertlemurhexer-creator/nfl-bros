// What happens on the field during one play: movement, blocking, passing,
// tackling, fumbles and kicks. Ratings from teams.js take effect here.
(function () {
  const FB = (window.FB = window.FB || {});
  const { clamp, lerp, dist, gauss } = FB.U;
  const R = FB.Rules;
  const P = FB.Plays;
  const WIDTH = R.FIELD_WIDTH;

  const OFF_SLOTS = ['QB', 'RB', 'WR1', 'WR2', 'TE', 'OL1', 'OL2'];
  const DEF_SLOTS = ['DL1', 'DL2', 'LB1', 'LB2', 'CB1', 'CB2', 'S'];

  // Where a named player goes, in order of preference.
  const STAR_SLOTS = {
    WR: ['WR1', 'WR2', 'TE'], TE: ['TE', 'WR2', 'WR1'], RB: ['RB', 'WR2', 'TE'],
    OT: ['OL1', 'OL2'], G: ['OL2', 'OL1'],
    EDGE: ['DL1', 'DL2', 'LB2', 'LB1'], DT: ['DL2', 'DL1', 'LB1', 'LB2'],
    LB: ['LB1', 'LB2', 'DL1'], CB: ['CB1', 'CB2', 'S'], S: ['S', 'CB2', 'CB1'],
  };
  const NUMBER_RANGE = { QB: [1, 19], RB: [20, 39], WR: [10, 19], TE: [80, 89], OL: [60, 79], DL: [90, 99], LB: [40, 59], CB: [20, 39], S: [20, 39] };
  const SKINS = ['#8d5a3b', '#6f4428', '#b98058', '#e0ac7e', '#5a3620', '#a56a44'];

  const scale = (rating) => ((rating - 75) / 25) * 0.6;
  const unit = (rating) => clamp((rating - 55) / 44, 0, 1);
  const qbSkill = (rating) => 0.4 + 0.45 * unit(rating);

  // Turns a team's ratings into one player's abilities.
  function abilities(slot, T, star) {
    const b = star ? 1 : 0;
    const pos = slot.replace(/\d/g, '');
    const a = { spd: 7, accel: 24, hands: 0.5, tak: 0.5, brk: 0.3, blk: 70, rushP: 70, runS: 70, cov: 60, mass: 1 };
    switch (pos) {
      case 'QB':
        a.spd = 6.4 + 2.5 * ((T.qbRun - 42) / 55);
        a.brk = 0.25 + 0.35 * ((T.qbRun - 42) / 55);
        a.arm = qbSkill(T.qb);
        a.aim = qbSkill(T.qb);
        break;
      case 'RB':
        a.spd = 8.5 + 0.6 * scale(T.rb) + 0.2 * b;
        a.brk = 0.55 + 0.17 * scale(T.rb) + 0.07 * b;
        a.blk = 60;
        a.hands = 0.74;
        a.accel = 27;
        break;
      case 'WR':
        a.spd = 8.7 + 0.6 * scale(T.wr) + 0.25 * b;
        a.hands = 0.84 + 0.1 * scale(T.wr) + 0.05 * b;
        a.brk = 0.32 + 0.1 * scale(T.wr);
        a.blk = 64;
        a.accel = 26;
        break;
      case 'TE':
        a.spd = 7.8 + 0.4 * scale(T.wr) + 0.2 * b;
        a.hands = 0.8 + 0.1 * scale(T.wr) + 0.05 * b;
        a.brk = 0.5;
        a.blk = (T.ol + T.wr) / 2;
        a.mass = 1.3;
        break;
      case 'OL':
        a.spd = 5.8 + 0.3 * scale(T.ol);
        a.blk = T.ol + 4 * b;
        a.accel = 17;
        a.mass = 1.8;
        break;
      case 'DL':
        a.spd = 6.8 + 0.5 * scale(T.rush) + 0.25 * b;
        a.rushP = T.rush + 5 * b;
        a.runS = T.runD + 3 * b;
        a.tak = 0.72 + 0.1 * scale(T.runD);
        a.accel = 20;
        a.mass = 1.7;
        break;
      case 'LB':
        a.spd = 7.8 + 0.4 * scale(T.runD) + 0.2 * b;
        a.tak = 0.8 + 0.12 * scale(T.runD) + 0.05 * b;
        a.rushP = T.rush - 4 + 4 * b;
        a.runS = T.runD;
        a.cov = T.cover - 8;
        a.mass = 1.2;
        break;
      case 'CB':
        a.spd = 8.7 + 0.6 * scale(T.cover) + 0.25 * b;
        a.tak = 0.6 + 0.08 * scale(T.cover);
        a.cov = T.cover + 5 * b;
        a.accel = 25;
        break;
      case 'S':
        a.spd = 8.4 + 0.5 * scale(T.cover) + 0.2 * b;
        a.tak = 0.73 + 0.08 * scale(T.cover);
        a.cov = T.cover + 4 * b;
        a.accel = 24;
        break;
    }
    return a;
  }

  FB.buildRoster = function (T, cpuBonus, rand) {
    const placed = {};
    (T.stars || []).forEach(([pos, name, boost]) => {
      const slot = (STAR_SLOTS[pos] || []).find((s) => !placed[s]);
      if (slot) placed[slot] = { name, star: boost !== 0 };
    });
    placed.QB = { name: T.qbName, star: T.qb >= 85 };

    const roster = {};
    OFF_SLOTS.concat(DEF_SLOTS).forEach((slot) => {
      const pos = slot.replace(/\d/g, '');
      const info = placed[slot] || {};
      const [lo, hi] = NUMBER_RANGE[pos];
      const a = abilities(slot, T, info.star);
      if (cpuBonus) {
        a.spd *= cpuBonus.speed;
        a.tak = clamp(a.tak + cpuBonus.tackle, 0.2, 0.98);
        if (a.aim !== undefined) a.aim = clamp(a.aim + cpuBonus.qb, 0, 1);
      }
      roster[slot] = Object.assign(a, {
        slot,
        pos,
        name: info.name || null,
        star: !!info.star,
        num: lo + Math.floor(rand() * (hi - lo + 1)),
        skin: SKINS[Math.floor(rand() * SKINS.length)],
      });
    });
    return roster;
  };

  FB.playerName = (p) => p.name || `${p.pos} #${p.num}`;

  const clampY = (y) => clamp(y, 2, WIDTH - 2);
  const clampX = (x) => clamp(x, 0.6, 119.4);

  function reset(p, team, x, y, face, role) {
    Object.assign(p, {
      team, x, y, vx: 0, vy: 0, wx: 0, wy: 0, face, role,
      x0: x, y0: y, z: 0,
      route: [], routeI: 0, down: 0, stun: 0, dive: 0, stiff: 0, stiffCd: 0,
      tackleCd: 0, engaged: null, shed: 0, shedCd: 0, leap: 0, slow: 0, throwT: 0,
      took: false, manOn: null, zone: null, delay: 0, nextRead: 0, lastA: 0,
      aimX: x, aimY: y, lane: y, anim: Math.random() * 6, celebrate: false,
    });
    return p;
  }

  class Sim {
    constructor(m, kind) {
      this.m = m;
      this.g = m.g;
      this.rand = m.rand;
      this.kind = kind;
      this.players = [];
      this.t = 0;
      this.overT = 0;
      this.live = false;
      this.over = false;
      this.clockOn = false;
      this.result = null;
      this.carrier = null;
      this.control = null;
      this.target = null;
      this.returner = null;
      this.play = null;
      this.dplay = null;
      this.firstDownX = null;
      this.thrown = false;
      this.completed = false;
      this.scramble = false;
      this.runSeen = false;
      this.handed = false;
      this.sacked = false;
      this.sackBy = null;
      this.intercepted = false;
      this.fumbled = false;
      this.gotBallInEZ = false;
      this.ball = { state: 'dead', x: 60, y: WIDTH / 2, z: 0, spin: 0, vx: 0, vy: 0 };
    }

    dirOf(team) {
      return R.dir(this.g, team);
    }

    add(team, slot, x, y, face, role) {
      const p = reset(this.m.rosters[team][slot], team, x, y, face, role);
      this.players.push(p);
      return p;
    }

    // ---- Lining up ------------------------------------------------------

    static scrimmage(m, play, dplay) {
      const s = new Sim(m, 'scrimmage');
      const g = m.g;
      const off = g.pos;
      const def = R.other(off);
      s.offTeam = off;
      s.defTeam = def;
      s.ballTeam = off;
      s.dir = R.dir(g, off);
      s.los = R.toX(g, off, g.yard);
      s.mid = g.ballY;
      s.play = play;
      s.dplay = dplay;
      s.startYard = g.yard;
      s.mirror = m.rand() < 0.5 ? -1 : 1;
      if (g.mode === 'normal') s.firstDownX = R.toX(g, off, Math.min(100, g.yard + g.toGo));

      const dir = s.dir;
      const my = s.mirror;
      const offP = {};
      OFF_SLOTS.forEach((slot) => {
        const [dx, dy] = P.OFFENSE_SPOTS[slot];
        offP[slot] = s.add(off,slot, s.los + dir * dx, clampY(s.mid + dy * my), dir, 'block');
      });
      s.qb = offP.QB;
      s.eligible = P.ELIGIBLE.map((slot) => offP[slot]);

      const toWorld = (p, pts) => pts.map(([dx, dy]) => ({ x: clampX(p.x0 + dir * dx), y: clampY(p.y0 + dy * my) }));
      const routes = play.routes || {};
      Object.keys(routes).forEach((slot) => {
        offP[slot].role = 'route';
        offP[slot].route = toWorld(offP[slot], routes[slot]);
      });
      if (play.type === 'pass') {
        const back = play.screen ? 8.5 : 7;
        const ownGoal = R.toX(g, off, 0.8);
        const dropX = dir > 0 ? Math.max(s.los - back, ownGoal) : Math.min(s.los + back, ownGoal);
        s.drop = { x: dropX, y: s.mid };
        offP.QB.role = 'qb';
      } else {
        const runner = offP[play.carrier];
        runner.role = 'path';
        runner.route = toWorld(runner, play.path);
        if (play.carrier !== 'QB') offP.QB.role = 'idle';
      }

      const defP = {};
      DEF_SLOTS.forEach((slot) => {
        const [dx, dy] = P.DEFENSE_SPOTS[slot];
        const a = dplay.assign[slot];
        const p = s.add(def,slot, s.los + dir * dx, clampY(s.mid + dy * my), -dir, a.role);
        defP[slot] = p;
        p.delay = a.delay || 0;
        if (a.on) {
          p.manOn = offP[a.on];
          if (slot[0] === 'C') p.y = p.y0 = p.manOn.y;
        }
        if (a.at) p.zone = { x: clampX(s.los + dir * a.at[0]), y: clampY(s.mid + a.at[1] * my) };
        p.aimX = p.x;
        p.aimY = p.y;
      });

      if (m.user === off) {
        s.control = offP.QB;
        s.target = play.type === 'pass' ? s.eligible.find((e) => e.role === 'route') : null;
      } else if (m.user === def) {
        s.control = defP[dplay.user];
      }
      s.ball.x = s.los;
      s.ball.y = s.mid;
      return s;
    }

    static kickoff(m) {
      const s = new Sim(m, 'kickoff');
      const g = m.g;
      const kicker = g.kicker;
      const rec = R.other(kicker);
      s.offTeam = kicker;
      s.defTeam = rec;
      s.ballTeam = rec;
      s.dir = R.dir(g, kicker);
      const dir = s.dir;
      s.los = R.toX(g, kicker, 35);
      s.mid = WIDTH / 2;

      const lanes = { DL1: 9, DL2: 17, LB1: 23, LB2: 31, CB1: 37, CB2: 45 };
      Object.keys(lanes).forEach((slot) => {
        const p = s.add(kicker,slot, s.los - dir * 2, lanes[slot], dir, 'cover');
        p.lane = lanes[slot];
      });
      s.add(kicker,'S', s.los - dir * 5, s.mid, dir, 'cover');

      const spots = {
        OL1: [20, 15], OL2: [20, 38], TE: [22, 27],
        QB: [34, 20], WR2: [34, 34], WR1: [48, 18],
      };
      Object.keys(spots).forEach((slot) => {
        s.add(rec,slot, s.los + dir * spots[slot][0], spots[slot][1], -dir, 'hold');
      });
      s.returner = s.add(rec,'RB', s.los + dir * 56, s.mid, -dir, 'catch');

      if (m.user === rec) s.control = s.returner;
      else if (m.user === kicker) s.control = m.rosters[kicker].LB1;
      s.ball.x = s.los;
      s.ball.y = s.mid;
      return s;
    }

    static punt(m) {
      const s = new Sim(m, 'punt');
      const g = m.g;
      const off = g.pos;
      const rec = R.other(off);
      s.offTeam = off;
      s.defTeam = rec;
      s.ballTeam = rec;
      s.dir = R.dir(g, off);
      const dir = s.dir;
      s.los = R.toX(g, off, g.yard);
      s.mid = g.ballY;
      s.startYard = g.yard;

      const line = { OL1: -2, OL2: 2, TE: 6, RB: -6, WR1: -16, WR2: 16 };
      Object.keys(line).forEach((slot) => {
        const y = clampY(s.mid + line[slot]);
        const p = s.add(off,slot, s.los - dir * 0.6, y, dir, 'cover');
        p.lane = y;
      });
      s.add(off,'QB', s.los - dir * 10, s.mid, dir, 'idle');

      const def = { DL1: [1, -3], DL2: [1, 3], LB1: [2, -9], LB2: [2, 9], CB1: [22, -12], CB2: [22, 12] };
      Object.keys(def).forEach((slot) => {
        s.add(rec,slot, s.los + dir * def[slot][0], clampY(s.mid + def[slot][1]), -dir, 'hold');
      });
      s.returner = s.add(rec,'S', clampX(s.los + dir * 42), s.mid, -dir, 'catch');

      if (m.user === rec) s.control = s.returner;
      else if (m.user === off) s.control = m.rosters[off].TE;
      s.ball.x = s.los - dir * 10;
      s.ball.y = s.mid;
      return s;
    }

    static fieldGoal(m, kind) {
      const s = new Sim(m, kind);
      const g = m.g;
      const off = g.pos;
      const def = R.other(off);
      s.offTeam = off;
      s.defTeam = def;
      s.ballTeam = off;
      s.dir = R.dir(g, off);
      const dir = s.dir;
      s.los = R.toX(g, off, g.yard);
      s.mid = kind === 'xp' ? WIDTH / 2 : g.ballY;
      s.startYard = g.yard;

      const line = { OL1: -1.6, OL2: 1.6, WR1: -4.8, WR2: 4.8, RB: 7.5 };
      Object.keys(line).forEach((slot) => {
        s.add(off,slot, s.los - dir * 0.6, clampY(s.mid + line[slot]), dir, 'idle');
      });
      s.add(off,'QB', s.los - dir * 7, s.mid, dir, 'idle');
      s.add(off,'TE', s.los - dir * 9.5, s.mid - 1.5, dir, 'idle');
      DEF_SLOTS.forEach((slot, i) => {
        s.add(def,slot, s.los + dir * 1, clampY(s.mid - 9 + i * 3), -dir, 'idle');
      });
      s.ball.x = s.los - dir * 7;
      s.ball.y = s.mid;
      return s;
    }

    // ---- Starting a play ------------------------------------------------

    snap() {
      this.live = true;
      this.clockOn = true;
      this.carrier = this.qb;
      this.ball.state = 'held';
      this.m.emit('snap');
    }

    launchKick(power, accuracy, aim) {
      const fromX = this.ball.x;
      const length = this.kind === 'kickoff' ? 48 + 24 * power : 30 + 26 * power;
      const hang = this.kind === 'kickoff' ? 3 + power * 0.9 : 2.6 + power * 1.5;
      const tx = fromX + this.dir * length;
      const ty = this.mid + aim * 15 + accuracy * 9;
      Object.assign(this.ball, { state: 'air', kind: this.kind, sx: fromX, sy: this.mid, tx, ty, t: 0, dur: hang, peak: 15 + power * 7 });
      this.live = true;
      this.m.emit('kick', { power });
    }

    launchFieldGoal(power, accuracy, aim, wind) {
      const dist_ = 100 - this.g.yard + 17;
      const range = 34 + 32 * power;
      const lateral = accuracy * dist_ * 0.16 + wind * (dist_ / 40) + aim * 5;
      const good = dist_ <= range && Math.abs(lateral) < 3.08;
      const goalX = this.dir > 0 ? 120 : 0;
      const fromX = this.ball.x;
      const shortBy = Math.max(0, dist_ - range);
      const tx = goalX - this.dir * shortBy;
      Object.assign(this.ball, {
        state: 'air', kind: 'fg', sx: fromX, sy: this.mid, tx,
        ty: clamp(WIDTH / 2 + lateral, 8, 45), t: 0, dur: 1.2 + dist_ * 0.012, peak: shortBy > 0 ? 9 : 16, good,
      });
      this.live = true;
      this.m.emit('kick', { power });
    }

    // ---- One step of the play -------------------------------------------

    step(dt, input) {
      if (!this.live) return;
      this.t += dt;
      if (this.clockOn && !this.over) R.tick(this.g, dt);

      this.players.forEach((p) => this.timers(p, dt));
      if (this.over) {
        this.overT += dt;
      } else {
        this.checkHandoff();
        this.checkRunSeen();
      }
      FB.AI.think(this, dt);
      if (this.control && !this.over) this.applyUser(input);
      this.move(dt);
      this.separate();
      this.updateBlocks(dt);
      this.stepBall(dt);
      if (!this.over) this.contacts();
      if (!this.over) this.bounds();
    }

    timers(p, dt) {
      const dec = (k) => {
        if (p[k] > 0) p[k] = Math.max(0, p[k] - dt);
      };
      ['down', 'stun', 'stiff', 'stiffCd', 'tackleCd', 'shedCd', 'leap', 'slow', 'throwT', 'delay'].forEach(dec);
      if (p.dive > 0) {
        p.dive -= dt;
        if (p.dive <= 0) {
          p.dive = 0;
          p.down = 1;
          if (p === this.carrier && !this.over) this.endAt(p, false);
        }
      }
    }

    checkHandoff() {
      const play = this.play;
      if (!play || this.handed || play.carrier !== 'RB' || this.t < 0.4) return;
      this.handed = true;
      const rb = this.m.rosters[this.offTeam].RB;
      this.carrier = rb;
      this.qb.role = 'escort';
      if (this.control === this.qb) {
        this.control = rb;
        rb.took = false;
      }
      this.m.emit('handoff');
    }

    checkRunSeen() {
      if (this.runSeen || !this.play) return;
      if (this.play.type !== 'pass' && this.t > 0.3) this.runSeen = true;
    }

    applyUser(input) {
      const c = this.control;
      const moving = input.x !== 0 || input.y !== 0;
      if (moving) c.took = true;

      const throwing = this.canThrow(c);
      if (throwing) {
        if (input.dirEdge) this.aimToward(input.dirEdge);
        if (input.switched) this.cycleTarget();
      } else if (input.switched && c !== this.carrier) {
        this.switchControl();
      }
      const you = this.control;
      if (you.down > 0 || you.dive > 0) return;

      if (you.took) {
        const len = Math.hypot(input.x, input.y) || 1;
        you.wx = input.x / len;
        you.wy = input.y / len;
      }
      if (input.action) this.userAction(you, throwing);
    }

    canThrow(p) {
      return p === this.carrier && p === this.qb && this.kind === 'scrimmage' &&
        this.play.type === 'pass' && !this.scramble && !this.thrown;
    }

    aimToward(d) {
      const q = this.carrier;
      let best = null;
      let bestDot = -2;
      this.eligible.forEach((r) => {
        if (r.down > 0) return;
        const dx = r.x - q.x;
        const dy = r.y - q.y;
        const len = Math.hypot(dx, dy) || 1;
        const dot = (dx * d.x + dy * d.y) / len;
        if (dot > bestDot) {
          bestDot = dot;
          best = r;
        }
      });
      if (best) this.target = best;
    }

    cycleTarget() {
      const list = this.eligible.filter((r) => r.role === 'route' || r === this.target);
      const i = list.indexOf(this.target);
      this.target = list[(i + 1) % list.length];
    }

    // Picks the teammate nearest the ball who isn't already being controlled.
    switchControl() {
      const b = this.ball;
      const team = this.control.team;
      const list = this.players
        .filter((p) => p.team === team && p !== this.control && p !== this.carrier && p.down <= 0)
        .sort((a, c) => dist(a, b) - dist(c, b));
      if (list.length) {
        this.control = list[0];
        this.control.took = false;
        this.m.emit('switch');
      }
    }

    // Before the snap, Shift steps through your defenders in order.
    cycleDefender() {
      const team = this.control.team;
      const list = this.players.filter((p) => p.team === team);
      const i = list.indexOf(this.control);
      this.control = list[(i + 1) % list.length];
    }

    userAction(c, throwing) {
      if (throwing) {
        if (this.target) this.throwTo(this.target);
        return;
      }
      if (this.ball.state === 'air' && this.ball.kind === 'pass') {
        c.leap = 0.45;
        return;
      }
      if (c === this.carrier) {
        const nearest = this.nearestOpponent(c);
        if (nearest.d < 3.2) {
          if (c.stiffCd <= 0) {
            c.stiff = 0.4;
            c.stiffCd = 1.5;
            this.m.emit('stiff', { x: c.x, y: c.y });
          }
        } else {
          this.startDive(c);
        }
      } else if (c.team !== this.ballTeam && c.tackleCd <= 0) {
        this.startDive(c);
      }
    }

    startDive(p) {
      let dx = p.wx || p.vx;
      let dy = p.wy || p.vy;
      if (!dx && !dy) dx = p.face;
      const len = Math.hypot(dx, dy) || 1;
      const speed = p.spd + 2.6;
      p.vx = (dx / len) * speed;
      p.vy = (dy / len) * speed;
      p.dive = 0.36;
      this.m.emit('dive', { x: p.x, y: p.y });
    }

    nearestOpponent(p) {
      let d = 1e9;
      let who = null;
      this.players.forEach((o) => {
        if (o.team === p.team || o.down > 0) return;
        const n = dist(o, p);
        if (n < d) {
          d = n;
          who = o;
        }
      });
      return { d, who };
    }

    pressure(q) {
      let near = 99;
      this.players.forEach((o) => {
        if (o.team === q.team || o.down > 0 || o.engaged) return;
        near = Math.min(near, dist(o, q));
      });
      return clamp(1 - near / 6, 0, 1);
    }

    // ---- Movement and blocking ------------------------------------------

    move(dt) {
      for (const p of this.players) {
        if (p.dive > 0) {
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          continue;
        }
        if (p.down > 0) {
          p.vx *= 0.9;
          p.vy *= 0.9;
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          continue;
        }
        let top = p.spd;
        if (p.engaged) top *= 0.2;
        if (p.stun > 0) top *= 0.25;
        if (p.slow > 0) top *= 0.72;
        if (p === this.control) top *= 1.03;
        if (p === this.carrier) top *= 0.95;
        if (p.role === 'pursue') top *= 1.04;
        if (p.role === 'cover' && this.ball.state === 'air') top *= 1.12;
        const tvx = p.wx * top;
        const tvy = p.wy * top;
        const step = p.accel * dt;
        p.vx += clamp(tvx - p.vx, -step, step);
        p.vy += clamp(tvy - p.vy, -step, step);
        p.x = clamp(p.x + p.vx * dt, -3, 123);
        p.y = clamp(p.y + p.vy * dt, -5, WIDTH + 5);
        if (Math.abs(p.vx) > 0.5) p.face = Math.sign(p.vx);
        p.anim += Math.hypot(p.vx, p.vy) * dt * 1.7;
      }
    }

    separate() {
      const list = this.players;
      for (let i = 0; i < list.length; i++) {
        const a = list[i];
        if (a.down > 0 || a.dive > 0) continue;
        for (let j = i + 1; j < list.length; j++) {
          const b = list[j];
          if (b.down > 0 || b.dive > 0) continue;
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const d = Math.hypot(dx, dy);
          const min = 0.95;
          if (d >= min || d === 0) continue;
          const push = min - d;
          const share = b.mass / (a.mass + b.mass);
          a.x -= (dx / d) * push * share;
          a.y -= (dy / d) * push * share;
          b.x += (dx / d) * push * (1 - share);
          b.y += (dy / d) * push * (1 - share);
        }
      }
    }

    updateBlocks(dt) {
      for (const p of this.players) {
        if (!p.engaged) continue;
        const d = p.engaged;
        if (p.role !== 'block' && p.role !== 'escort') continue;
        d.shed -= dt;
        if (d.shed <= 0 || d.down > 0 || p.down > 0 || dist(p, d) > 2.4) this.release(p, d);
      }
      if (this.over) return;
      for (const p of this.players) {
        if (p.team !== this.ballTeam || p.engaged || p.stun > 0 || p.down > 0) continue;
        if (p.role !== 'block' && p.role !== 'escort') continue;
        for (const d of this.players) {
          if (d.team === p.team || d.engaged || d.shedCd > 0 || d.down > 0 || d.dive > 0) continue;
          if (dist(p, d) < 1.35) {
            this.engage(p, d);
            break;
          }
        }
      }
    }

    engage(p, d) {
      p.engaged = d;
      d.engaged = p;
      const passing = this.play && this.play.type === 'pass' && !this.thrown && !this.scramble;
      const hold = passing ? 1.9 + (p.blk - d.rushP) / 40 : 1.6 + (p.blk - d.runS) / 55;
      let time = Math.max(0.5, hold) * (0.8 + this.rand() * 0.4);
      if (p.role === 'escort') time *= this.kind === 'scrimmage' ? 0.55 : 0.35;
      if (this.play && this.play.screen) time *= 0.45;
      d.shed = time;
    }

    release(p, d) {
      p.engaged = null;
      d.engaged = null;
      d.shedCd = 1.1;
      p.stun = 0.3;
    }

    // ---- The ball -------------------------------------------------------

    predict(p, t) {
      if (p.role === 'route' && p.routeI < p.route.length) {
        let x = p.x;
        let y = p.y;
        let left = t * p.spd * 0.95;
        for (let i = p.routeI; i < p.route.length; i++) {
          const w = p.route[i];
          const d = Math.hypot(w.x - x, w.y - y) || 0.001;
          if (d >= left) return { x: x + ((w.x - x) / d) * left, y: y + ((w.y - y) / d) * left };
          left -= d;
          x = w.x;
          y = w.y;
        }
        return { x, y };
      }
      return { x: p.x + p.vx * t, y: p.y + p.vy * t };
    }

    throwTo(r) {
      const q = this.carrier;
      const speed = 20 + 8 * q.arm;
      let t = dist(q, r) / speed;
      let at = this.predict(r, t);
      for (let i = 0; i < 3; i++) {
        t = Math.hypot(at.x - q.x, at.y - q.y) / speed;
        at = this.predict(r, t);
      }
      const length = Math.hypot(at.x - q.x, at.y - q.y);
      const moving = Math.hypot(q.vx, q.vy) > 2 ? 1.25 : 1;
      const sigma = (0.25 + length / 40) * (1.5 - q.aim) * (1 + this.pressure(q) * 1.5) * moving;
      const tx = clampX(at.x + gauss(this.rand) * sigma);
      const ty = at.y + gauss(this.rand) * sigma;
      Object.assign(this.ball, {
        state: 'air', kind: 'pass', sx: q.x, sy: q.y, tx, ty, t: 0,
        dur: Math.max(0.28, t), peak: 1.4 + length * 0.11, target: r,
      });
      q.throwT = 0.3;
      q.role = 'idle';
      this.carrier = null;
      this.thrown = true;
      r.role = 'catch';
      if (this.m.user === r.team) {
        this.control = r;
        r.took = false;
      }
      this.m.emit('throw', { x: q.x, y: q.y });
    }

    stepBall(dt) {
      const b = this.ball;
      b.spin += dt * 14;
      if (b.state === 'held') {
        if (this.carrier) {
          b.x = this.carrier.x;
          b.y = this.carrier.y;
          b.z = 1.2;
        }
      } else if (b.state === 'air') {
        b.t += dt;
        const f = Math.min(1, b.t / b.dur);
        b.x = lerp(b.sx, b.tx, f);
        b.y = lerp(b.sy, b.ty, f);
        b.z = 1.4 * (1 - f) + 4 * b.peak * f * (1 - f) + (b.kind === 'fg' && b.good ? f * 4 : 0);
        if (f >= 1) this.ballArrives();
      } else if (b.state === 'loose') {
        b.t += dt;
        b.x += b.vx * dt;
        b.y += b.vy * dt;
        b.vx *= 0.975;
        b.vy *= 0.975;
        b.z = Math.abs(Math.sin(b.t * 7)) * 1.2 * Math.max(0, 1 - b.t / 2);
        if (!this.over) this.looseBall();
      }
    }

    ballArrives() {
      const b = this.ball;
      if (b.kind === 'pass') this.resolvePass();
      else if (b.kind === 'fg') {
        b.state = 'dead';
        this.finish({ type: this.kind, good: b.good });
      } else this.landKick();
    }

    resolvePass() {
      const b = this.ball;
      const at = { x: b.tx, y: b.ty };
      let rcv = null;
      let rd = 1e9;
      let def = null;
      let dd = 1e9;
      for (const p of this.players) {
        if (p.down > 0) continue;
        const d = dist(p, at);
        if (p.team === this.offTeam) {
          if (p === this.qb) continue;
          const reach = (p === b.target ? 2.2 : 1.4) + (p.leap > 0 ? 0.8 : 0);
          if (d < reach && d < rd) {
            rd = d;
            rcv = p;
          }
        } else {
          const reach = 1.9 + (p.leap > 0 ? 1 : 0);
          if (d < reach && d < dd) {
            dd = d;
            def = p;
          }
        }
      }

      const contest = def
        ? clamp((1 - dd / 2.9) * (0.5 + unit(def.cov) * 0.5) + (def.leap > 0 ? 0.25 : 0), 0, 0.95)
        : 0;

      if (rcv) {
        const reachFactor = 1 - Math.max(0, rd - 0.7) / 3.4;
        const pCatch = Math.min(0.97, (rcv.hands + 0.12) * reachFactor * (1 - contest * 0.55));
        if (this.rand() < pCatch) return this.caught(rcv);
        if (def && this.rand() < contest * 0.16) return this.intercepted_(def);
      } else if (def && this.rand() < contest * 0.3) {
        return this.intercepted_(def);
      }
      b.state = 'loose';
      b.t = 0;
      b.vx = (b.tx - b.sx) * 0.06;
      b.vy = (b.ty - b.sy) * 0.06;
      this.m.emit('incomplete', { x: b.x, y: b.y, swat: !!def });
      this.finish({ type: 'incomplete' });
    }

    caught(r) {
      this.ball.state = 'held';
      this.carrier = r;
      this.completed = true;
      this.ballTeam = r.team;
      if (this.m.user === r.team) {
        this.control = r;
        r.took = false;
      }
      this.runSeen = true;
      this.setRunRoles();
      this.m.emit('catch', { x: r.x, y: r.y });
    }

    intercepted_(d) {
      this.ball.state = 'held';
      this.carrier = d;
      this.ballTeam = d.team;
      this.intercepted = true;
      this.clearBlocks();
      if (R.toYard(this.g, d.team, d.x) <= 0) this.gotBallInEZ = true;
      if (this.m.user === d.team) {
        this.control = d;
        d.took = false;
      } else if (this.m.user === R.other(d.team)) {
        this.control = this.nearestTeammate(d, this.m.user);
        this.control.took = false;
      }
      this.runSeen = true;
      this.setRunRoles();
      this.m.emit('int', { x: d.x, y: d.y });
    }

    nearestTeammate(to, team) {
      return this.players
        .filter((p) => p.team === team && p.down <= 0)
        .sort((a, b) => dist(a, to) - dist(b, to))[0];
    }

    clearBlocks() {
      this.players.forEach((p) => (p.engaged = null));
    }

    // Once someone is running with the ball, everyone else blocks or chases.
    setRunRoles() {
      const c = this.carrier;
      this.players.forEach((p) => {
        if (p !== c) p.role = p.team === c.team ? 'escort' : 'pursue';
      });
      c.role = 'run';
    }

    landKick() {
      const b = this.ball;
      const rec = this.ballTeam;
      const kickoff = this.kind === 'kickoff';
      const yard = R.toYard(this.g, rec, b.tx);
      if (yard <= 0) {
        b.state = 'dead';
        this.finish({ type: 'touchback', team: rec, yard: kickoff ? R.KICKOFF_TOUCHBACK : R.PUNT_TOUCHBACK });
        return;
      }
      if (b.ty < 0 || b.ty > WIDTH) {
        b.state = 'dead';
        this.finish({ type: 'down', team: rec, yard: kickoff ? Math.max(40, yard) : yard, oob: true, y: clamp(b.ty, 0, WIDTH) });
        return;
      }
      const r = this.returner;
      if (dist(r, { x: b.tx, y: b.ty }) < 2.6) {
        this.fieldKick(r);
      } else {
        b.state = 'loose';
        b.kickLoose = true;
        b.t = 0;
        b.vx = this.dir * 3.5;
        b.vy = 0;
      }
    }

    fieldKick(r) {
      this.ball.state = 'held';
      this.ball.kickLoose = false;
      this.carrier = r;
      this.clockOn = true;
      if (R.toYard(this.g, r.team, r.x) <= 0) this.gotBallInEZ = true;
      if (this.m.user === r.team) {
        this.control = r;
        r.took = false;
      }
      this.setRunRoles();
      this.m.emit('catch', { x: r.x, y: r.y, kick: true });
    }

    looseBall() {
      const b = this.ball;
      if (b.y < 0 || b.y > WIDTH) {
        b.state = 'dead';
        if (b.kickLoose) {
          this.finish({ type: 'down', team: this.ballTeam, yard: Math.max(1, R.toYard(this.g, this.ballTeam, b.x)), oob: true, y: clamp(b.y, 0, WIDTH) });
        } else {
          this.finish({ type: 'down', team: this.ballTeam, yard: clamp(R.toYard(this.g, this.ballTeam, b.x), 1, 99), oob: true, y: clamp(b.y, 0, WIDTH) });
        }
        return;
      }
      if (b.t < 0.3) return;
      let who = null;
      let best = b.t > 5 ? 1e9 : 1.2;
      for (const p of this.players) {
        if (p.down > 0) continue;
        const d = dist(p, b);
        if (d < best) {
          best = d;
          who = p;
        }
      }
      if (!who) return;
      if (b.kickLoose) {
        if (who.team === this.ballTeam) this.fieldKick(who);
        else {
          b.state = 'dead';
          this.finish({ type: 'down', team: this.ballTeam, yard: clamp(R.toYard(this.g, this.ballTeam, b.x), 1, 99), y: b.y });
        }
        return;
      }
      this.recover(who);
    }

    recover(p) {
      const lost = p.team !== this.ballTeam;
      this.ball.state = 'held';
      this.carrier = p;
      this.ballTeam = p.team;
      this.fumbleLost = lost;
      this.m.emit('recover', { x: p.x, y: p.y, lost, team: p.team });
      const yard = R.toYard(this.g, p.team, p.x);
      if (yard >= 100) this.touchdown(p);
      else {
        if (yard <= 0 && lost) this.gotBallInEZ = true;
        this.endAt(p, false);
      }
    }

    // ---- Tackling and the end of the play -------------------------------

    contacts() {
      const c = this.carrier;
      if (!c) return;
      for (const d of this.players) {
        if (d.team === c.team || d.down > 0 || d.engaged || d.tackleCd > 0 || d.stun > 0) continue;
        const reach = 1.2 + (d.dive > 0 ? 0.9 : 0);
        if (dist(d, c) < reach) {
          this.tryTackle(d, c);
          if (this.over || this.carrier !== c) return;
        }
      }
    }

    isSack(c) {
      return this.kind === 'scrimmage' && c === this.qb && this.play.type === 'pass' && !this.scramble && !this.thrown;
    }

    tryTackle(d, c) {
      d.tackleCd = 0.7;
      let chance = clamp(0.62 + (d.tak - c.brk) * 0.8, 0.12, 0.92);
      if (d.dive > 0) chance += 0.12;
      if (this.isSack(c)) chance += 0.15;
      if (c.stiff > 0) {
        chance *= 0.25;
        d.down = 0.9;
        this.m.emit('stiffhit', { x: d.x, y: d.y });
      }
      if (this.rand() < chance) {
        this.tackled(d, c);
      } else {
        if (d.down <= 0) d.stun = 0.55;
        c.slow = 0.22;
        this.m.emit('broken', { x: c.x, y: c.y, name: FB.playerName(c) });
      }
    }

    tackled(d, c) {
      const impact = Math.hypot(d.vx - c.vx, d.vy - c.vy);
      const sack = this.isSack(c);
      this.m.emit('tackle', { x: c.x, y: c.y, impact, sack });
      const looseChance = 0.006 + impact * 0.0008 + (sack ? 0.012 : 0);
      const b = this.ball;
      if (this.rand() < looseChance) {
        b.state = 'loose';
        b.kickLoose = false;
        b.t = 0;
        b.x = c.x;
        b.y = c.y;
        b.vx = c.vx * 0.5 + (this.rand() - 0.5) * 4;
        b.vy = c.vy * 0.5 + (this.rand() - 0.5) * 4;
        this.fumbled = true;
        this.carrier = null;
        c.down = 1.4;
        this.players.forEach((p) => (p.role = 'loose'));
        this.clearBlocks();
        this.m.emit('fumble', { x: c.x, y: c.y });
        return;
      }
      c.down = 2;
      if (sack) {
        this.sacked = true;
        this.sackBy = d;
      }
      this.endAt(c, false);
    }

    bounds() {
      const c = this.carrier;
      if (!c) return;
      if (this.kind === 'scrimmage' && c === this.qb && c.team === this.offTeam && !this.scramble &&
          this.play.type === 'pass' && (c.x - this.los) * this.dir > 0.4) {
        this.scramble = true;
        this.runSeen = true;
        this.setRunRoles();
      }
      const yard = R.toYard(this.g, c.team, c.x);
      if (yard >= 100) {
        this.touchdown(c);
      } else if (c.y < 0 || c.y > WIDTH || yard <= -10) {
        this.endAt(c, true);
      }
    }

    touchdown(c) {
      this.ball.state = 'held';
      this.scorer = c;
      this.players.forEach((p) => {
        if (p.team === c.team) p.celebrate = true;
      });
      this.m.emit('td', { x: c.x, y: c.y, team: c.team, name: FB.playerName(c) });
      this.finish({ type: 'td', team: c.team });
    }

    endAt(c, oob) {
      const team = c.team;
      const yard = R.toYard(this.g, team, c.x);
      if (yard <= 0) {
        if (this.gotBallInEZ) {
          const tb = this.kind === 'punt' ? R.PUNT_TOUCHBACK : R.KICKOFF_TOUCHBACK;
          this.finish({ type: 'touchback', team, yard: tb });
        } else {
          this.finish({ type: 'safety', team: R.other(team) });
        }
        return;
      }
      this.finish({ type: 'down', team, yard, oob, y: c.y, by: c });
    }

    finish(res) {
      if (this.over) return;
      this.over = true;
      this.result = res;
      this.m.emit('whistle', { result: res.type });
    }
  }

  FB.Sim = Sim;
  FB.simHelpers = { OFF_SLOTS, DEF_SLOTS, unit };
})();
