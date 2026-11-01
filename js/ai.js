// The computer: every player you aren't controlling, plus play-calling.
(function () {
  const FB = (window.FB = window.FB || {});
  const { clamp, dist, lerp } = FB.U;
  const WIDTH = FB.Rules.FIELD_WIDTH;

  function seek(p, x, y, scale) {
    const dx = x - p.x;
    const dy = y - p.y;
    const d = Math.hypot(dx, dy);
    if (d < 0.25) return d;
    const s = (scale === undefined ? 1 : scale) * Math.min(1, d / 0.8);
    p.wx = (dx / d) * s;
    p.wy = (dy / d) * s;
    return d;
  }

  const AI = {};

  AI.think = function (s, dt) {
    for (const p of s.players) {
      p.wx = 0;
      p.wy = 0;
      if (p.down > 0 || p.dive > 0 || s.over) continue;
      if (p === s.carrier) AI.carrier(s, p);
      else if (s.ball.state === 'loose') seek(p, s.ball.x, s.ball.y);
      else AI.byRole(s, p, dt);
    }
  };

  AI.byRole = function (s, p, dt) {
    switch (p.role) {
      case 'route': return AI.route(s, p);
      case 'path': return AI.path(s, p);
      case 'catch': return AI.catchBall(s, p);
      case 'block': return AI.block(s, p);
      case 'escort': return AI.escort(s, p);
      case 'rush': return AI.rush(s, p);
      case 'man': return AI.man(s, p, dt);
      case 'zone': return AI.zone(s, p);
      case 'pursue': return AI.pursue(s, p);
      case 'cover': return AI.cover(s, p);
      default: return undefined; // idle and hold players stay put
    }
  };

  // ---- With the ball ----------------------------------------------------

  AI.carrier = function (s, p) {
    if (p.role === 'qb') return AI.qb(s, p);
    if (p.role === 'idle') return undefined;
    if (p.role === 'path' && p.routeI < p.route.length && (p.x - s.los) * s.dir < 3) return AI.path(s, p);
    return AI.runner(s, p);
  };

  AI.path = function (s, p) {
    const w = p.route[p.routeI];
    if (!w) return;
    if (seek(p, w.x, w.y) < 1) p.routeI++;
  };

  // Looks at a fan of directions and picks the most open way upfield.
  AI.runner = function (s, p) {
    const dir = s.dirOf(p.team);
    let bestA = 0;
    let best = -1e9;
    for (let a = -1.4; a <= 1.41; a += 0.2) {
      const ux = Math.cos(a) * dir;
      const uy = Math.sin(a);
      let score = Math.cos(a) * 2.2 - Math.abs(a - p.lastA) * 0.35;
      for (const r of [2.2, 4.5, 7]) {
        const px = p.x + ux * r;
        const py = p.y + uy * r;
        if (py < 1.5 || py > WIDTH - 1.5) score -= 6;
        for (const o of s.players) {
          if (o.team === p.team || o.down > 0) continue;
          const lead = (r / p.spd) * 0.6;
          const d = Math.hypot(o.x + o.vx * lead - px, o.y + o.vy * lead - py);
          if (d < 5) score -= (5 - d) * (5 - d) * 0.18 * (o.engaged ? 0.25 : 1);
        }
      }
      if (score > best) {
        best = score;
        bestA = a;
      }
    }
    p.lastA = bestA;
    p.wx = Math.cos(bestA) * dir;
    p.wy = Math.sin(bestA);

    if (s.control !== p && p.stiffCd <= 0) {
      const near = s.nearestOpponent(p);
      if (near.d < 1.9 && s.rand() < 0.05) {
        p.stiff = 0.4;
        p.stiffCd = 1.6;
      }
    }
  };

  AI.qb = function (s, p) {
    const t = s.t;
    if (t < 0.62) seek(p, s.drop.x, s.drop.y);
    if (s.control === p) return;

    const press = s.pressure(p);
    const ready = { short: 0.8, mid: 1.4, deep: 1.9 }[s.play.depth];
    if (t < ready) return;
    if (t < p.nextRead) return;
    p.nextRead = t + 0.15;

    const speed = 20 + 8 * p.arm;
    const need = s.g.toGo;
    let pick = null;
    let bestValue = -99;
    for (const r of s.eligible) {
      if (r.role !== 'route' || r.down > 0) continue;
      const air = dist(p, r) / speed;
      const at = s.predict(r, air + 0.1);
      let gap = 99;
      for (const d of s.players) {
        if (d.team === p.team || d.down > 0) continue;
        gap = Math.min(gap, Math.hypot(d.x + d.vx * air - at.x, d.y + d.vy * air - at.y));
      }
      const gain = (at.x - s.los) * s.dir;
      let value = Math.min(gap, 7) + Math.min(gain, need + 6) * 0.1;
      if (gain < need && s.g.down >= 3) value -= 0.6;
      if (value > bestValue) {
        bestValue = value;
        pick = r;
      }
    }

    const patience = clamp((t - ready) / 2, 0, 1);
    const wanted = 3.4 - patience * 2 - press * 1.4;
    if (pick && bestValue > wanted) return s.throwTo(pick);
    if (t > 3.6 || press > 0.8) {
      if (pick && (p.brk < 0.4 || s.rand() < 0.5)) return s.throwTo(pick);
      p.role = 'run';
      return;
    }
    const near = s.nearestOpponent(p);
    if (near.who && near.d < 4) seek(p, p.x + (p.x - near.who.x), p.y + (p.y - near.who.y), 0.7);
  };

  // ---- Offense without the ball -----------------------------------------

  AI.route = function (s, p) {
    if (p.routeI < p.route.length) {
      const w = p.route[p.routeI];
      if (seek(p, w.x, w.y) < 0.7) p.routeI++;
      return;
    }
    const near = s.nearestOpponent(p);
    if (near.who && near.d < 4) seek(p, p.x + (p.x - near.who.x), p.y + (p.y - near.who.y), 0.45);
  };

  AI.catchBall = function (s, p) {
    const b = s.ball;
    if (b.state === 'air') seek(p, b.tx, clamp(b.ty, 0.5, WIDTH - 0.5));
  };

  AI.block = function (s, p) {
    if (s.play && s.play.screen && s.t > 1.1) return AI.escort(s, p);
    const passing = s.play && s.play.type === 'pass' && !s.thrown && !s.scramble;
    if (p.engaged) {
      seek(p, p.engaged.x, p.engaged.y, 0.6);
      return;
    }
    if (passing) {
      const q = s.qb;
      let threat = null;
      let near = 1e9;
      for (const d of s.players) {
        if (d.team === p.team || d.engaged || d.down > 0 || d.role !== 'rush') continue;
        const n = dist(d, q);
        if (n < near) {
          near = n;
          threat = d;
        }
      }
      if (threat) {
        const len = near || 1;
        seek(p, threat.x + ((q.x - threat.x) / len) * 1.1, threat.y + ((q.y - threat.y) / len) * 1.1);
      } else {
        seek(p, q.x + s.dir * 2.5, q.y + (p.y0 - s.mid) * 0.6, 0.5);
      }
      return;
    }
    let target = null;
    let near = 13;
    for (const d of s.players) {
      if (d.team === p.team || d.engaged || d.down > 0) continue;
      const n = dist(d, p);
      if (n < near) {
        near = n;
        target = d;
      }
    }
    if (target) seek(p, target.x, target.y);
  };

  AI.escort = function (s, p) {
    const c = s.carrier;
    if (!c) return;
    if (p.engaged) {
      seek(p, p.engaged.x, p.engaged.y, 0.6);
      return;
    }
    let target = null;
    let best = 1e9;
    for (const o of s.players) {
      if (o.team === p.team || o.engaged || o.down > 0) continue;
      const cost = dist(p, o) + dist(o, c) * 0.7;
      if (cost < best) {
        best = cost;
        target = o;
      }
    }
    if (target) seek(p, target.x, target.y);
  };

  // ---- Defense ----------------------------------------------------------

  AI.pursue = function (s, p) {
    const c = s.carrier;
    if (!c) {
      const b = s.ball;
      if (b.state === 'air') seek(p, b.tx, b.ty);
      return;
    }
    const d = dist(p, c);
    const t = Math.min(0.8, (d / p.spd) * 0.7);
    // Kick coverage spreads out so a returner can't cut back through everyone.
    const spread = s.kind === 'scrimmage' ? 0 : clamp(d / 45, 0, 0.45);
    seek(p, c.x + c.vx * t, c.y + c.vy * t + (p.lane - c.y) * spread);
  };

  AI.rush = function (s, p) {
    if (p.delay > 0) return;
    if (s.runSeen) return AI.pursue(s, p);
    const q = s.carrier || s.qb;
    seek(p, q.x, q.y);
  };

  // Goes for the ball if there's time to get there.
  AI.playBall = function (s, p) {
    const b = s.ball;
    if (b.state !== 'air' || b.kind !== 'pass') return false;
    const left = b.dur - b.t;
    if (Math.hypot(b.tx - p.x, b.ty - p.y) > p.spd * (left + 0.35)) return false;
    seek(p, b.tx, b.ty);
    return true;
  };

  // Linebackers read a run quickly. Defensive backs check for a pass first.
  AI.readsRun = function (s, p) {
    if (!s.runSeen) return false;
    return s.play.type === 'pass' || s.t > (p.pos === 'LB' ? 0.6 : 1);
  };

  AI.man = function (s, p, dt) {
    if (AI.readsRun(s, p)) return AI.pursue(s, p);
    if (AI.playBall(s, p)) return;
    const r = p.manOn;
    if (r.role !== 'route' && r.role !== 'catch') {
      seek(p, s.los + s.dir * 5, s.qb.y, 0.6);
      return;
    }
    const react = (5 + 10 * FB.simHelpers.unit(p.cov)) * s.m.reactFor(p.team);
    const f = Math.min(1, dt * react);
    p.aimX += (r.x + r.vx * 0.1 - p.aimX) * f;
    p.aimY += (r.y + r.vy * 0.1 - p.aimY) * f;
    seek(p, p.aimX + s.dir * 1, p.aimY);
  };

  AI.zone = function (s, p) {
    if (AI.readsRun(s, p)) return AI.pursue(s, p);
    if (AI.playBall(s, p)) return;
    const z = p.zone;
    let near = null;
    let d = 10;
    for (const r of s.eligible) {
      if (r.role !== 'route' && r.role !== 'catch') continue;
      const n = Math.hypot(r.x - z.x, r.y - z.y);
      if (n < d) {
        d = n;
        near = r;
      }
    }
    if (near) seek(p, lerp(z.x, near.x, 0.7) + s.dir * 1.5, lerp(z.y, near.y, 0.75));
    else seek(p, z.x, z.y);
  };

  AI.cover = function (s, p) {
    const b = s.ball;
    if (b.state === 'air') seek(p, b.tx - s.dir * 2, lerp(p.lane, b.ty, 0.6));
    else AI.pursue(s, p);
  };

  // ---- Play-calling -----------------------------------------------------

  function weighted(rand, table) {
    const ids = Object.keys(table);
    let roll = rand() * ids.reduce((n, k) => n + Math.max(0, table[k]), 0);
    for (const id of ids) {
      roll -= Math.max(0, table[id]);
      if (roll <= 0) return id;
    }
    return ids[0];
  }

  AI.callOffense = function (m) {
    const g = m.g;
    const T = m.teams[g.pos];
    const D = m.teams[1 - g.pos];
    const margin = g.score[g.pos] - g.score[1 - g.pos];
    const late = g.quarter >= 4 && g.clock < 45;
    const fgDistance = 100 - g.yard + 17;

    if (g.mode === 'normal') {
      const endOfHalf = (g.quarter === 2 || g.quarter >= 4) && g.clock < 9;
      if (endOfHalf && fgDistance <= 52 && margin >= -3) return 'fg';
      if (g.down === 4) {
        const mustGo = late && margin < 0 && (margin < -3 || fgDistance > 52);
        if (!mustGo) {
          if (fgDistance <= 50) return 'fg';
          if (g.toGo <= 2 && g.yard >= 45 && m.rand() < 0.55) return AI.pickNormal(m, T, D, margin, late);
          if (g.yard >= 60 && fgDistance <= 56) return 'fg';
          return 'punt';
        }
      }
    }
    return AI.pickNormal(m, T, D, margin, late);
  };

  AI.pickNormal = function (m, T, D, margin, late) {
    const g = m.g;
    let run = 0.44 + (T.rb - D.runD) * 0.007 - (T.qb + T.wr - 2 * D.cover) * 0.0015;
    if (g.toGo <= 2) run += 0.2;
    if (g.toGo >= 8) run -= 0.22;
    if (late && margin < 0) run -= 0.3;
    if (late && margin > 0) run += 0.35;
    const mobile = (T.qbRun - 60) / 100;

    return weighted(m.rand, {
      dive: run * 0.55,
      sweep: run * 0.45,
      keeper: run * Math.max(0.03, mobile * 0.6),
      slants: (1 - run) * (g.toGo <= 7 ? 0.28 : 0.15),
      curls: (1 - run) * 0.22,
      screen: (1 - run) * 0.1,
      cross: (1 - run) * 0.25,
      deep: (1 - run) * (g.toGo >= 12 || (late && margin < 0) ? 0.38 : 0.13) * (0.7 + T.qb / 300),
    });
  };

  AI.callDefense = function (m) {
    const g = m.g;
    const O = m.teams[g.pos];
    const D = m.teams[1 - g.pos];
    const blitz = 0.16 + (D.rush - O.ol) * 0.006;
    return weighted(m.rand, {
      man: 0.35 + (D.cover - O.wr) * 0.006,
      zone: 0.35 + (g.toGo >= 10 ? 0.2 : 0),
      blitz: blitz + (g.down === 3 ? 0.08 : 0),
      runstop: g.toGo <= 2 ? 0.5 : 0.12 + (O.rb - D.runD) * 0.005,
    });
  };

  AI.chooseConversion = function (m) {
    const g = m.g;
    const margin = g.score[g.pos] - g.score[1 - g.pos];
    const lateGame = g.quarter >= 4;
    return lateGame && (margin === -2 || margin === -5 || margin === 1) ? 'two' : 'xp';
  };

  AI.kickDecision = function (m, kind, wind) {
    const r = m.rand;
    const g = m.g;
    switch (kind) {
      case 'kickoff':
        return { power: 0.25 + 0.75 * r(), accuracy: FB.U.gauss(r) * 0.2, aim: (r() - 0.5) * 1.2 };
      case 'punt':
        return { power: 0.5 + 0.5 * r(), accuracy: FB.U.gauss(r) * 0.2, aim: (r() - 0.5) * 0.8 };
      default: {
        const distance = 100 - g.yard + 17;
        return { power: 0.78 + 0.22 * r(), accuracy: FB.U.gauss(r) * 0.28, aim: (-wind * (distance / 40)) / 5 };
      }
    }
  };

  FB.AI = AI;
})();
