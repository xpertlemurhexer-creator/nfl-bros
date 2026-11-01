// Plays the real game through real keyboard events, faster than real time.
// Load it on index.html during a game, then call Bot.start() and read Bot.report().
(function () {
  const R = FB.Rules;
  const held = new Set();
  const log = { errors: [], outcomes: {}, notes: {}, plays: 0, keys: 0, lastPhase: null, stuckFor: 0 };

  const press = (type, code) => window.dispatchEvent(new KeyboardEvent(type, { code, bubbles: true }));

  function tap(code) {
    log.keys++;
    press('keydown', code);
    press('keyup', code);
  }

  function hold(codes) {
    held.forEach((c) => {
      if (codes.indexOf(c) < 0) {
        press('keyup', c);
        held.delete(c);
      }
    });
    codes.forEach((c) => {
      if (!held.has(c)) {
        press('keydown', c);
        held.add(c);
      }
    });
  }

  function steer(from, to) {
    const keys = [];
    if (to.x - from.x > 0.7) keys.push('ArrowRight');
    if (to.x - from.x < -0.7) keys.push('ArrowLeft');
    if (to.y - from.y > 0.7) keys.push('ArrowDown');
    if (to.y - from.y < -0.7) keys.push('ArrowUp');
    hold(keys);
  }

  function callPlay(m) {
    const plays = m.menu.plays;
    let pick = Math.floor(Math.random() * Math.min(plays.length, 8));
    if (m.menu.side === 'offense' && m.g.mode === 'normal' && m.g.down === 4) {
      const distance = 100 - m.g.yard + 17;
      const id = distance <= 50 ? 'fg' : 'punt';
      pick = plays.findIndex((p) => p.id === id);
    }
    tap('Digit' + ((pick + 1) % 10));
  }

  function drive(m) {
    const s = m.sim;
    const me = s.control;
    if (!me || s.over) return hold([]);

    if (s.canThrow(me)) {
      if (s.t > 0.9 + Math.random() * 0.8) tap('Space');
      return;
    }
    if (me === s.carrier) {
      const near = s.nearestOpponent(me);
      const dir = s.dirOf(me.team);
      steer(me, { x: me.x + dir * 6, y: me.y + (near.who && near.d < 5 ? (me.y > near.who.y ? 3 : -3) : 0) });
      if (near.d < 2.2 && Math.random() < 0.15) tap('Space');
      return;
    }
    const goal = s.carrier || (s.ball.state === 'air' ? { x: s.ball.tx, y: s.ball.ty } : s.ball);
    if (me.team !== s.ballTeam) {
      steer(me, goal);
      if (s.carrier && FB.U.dist(me, s.carrier) < 2.6 && Math.random() < 0.2) tap('Space');
      if (Math.random() < 0.01) tap('ShiftLeft');
    } else if (s.ball.state === 'air') {
      steer(me, goal);
    }
  }

  function tick() {
    const m = App.match;
    if (!m || window.Bot.paused) return;
    if (m.phase !== log.lastPhase) {
      log.lastPhase = m.phase;
      log.stuckFor = 0;
    } else {
      log.stuckFor++;
    }
    if (m.menu) {
      hold([]);
      if (log.stuckFor > 2) callPlay(m);
    } else if (m.phase === 'patchoice') {
      const two = window.Bot.conversion ? window.Bot.conversion === 'two' : Math.random() < 0.3;
      if (log.stuckFor > 2) tap(two ? 'Digit2' : 'Digit1');
    } else if (m.phase === 'presnap' && m.isUser(m.g.pos)) {
      if (log.stuckFor > 4) tap('Space');
    } else if (m.phase === 'kickmeter') {
      const k = m.kick;
      if (k.stage === 0 && k.power > 0.85) tap('Space');
      if (k.stage === 1 && Math.abs(k.accuracy) < 0.12) tap('Space');
    } else if (m.phase === 'live') {
      drive(m);
    } else {
      hold([]);
    }
  }

  window.Bot = {
    log,
    done: false,
    start(speedStep) {
      window.addEventListener('error', (e) => log.errors.push(e.message));
      const end = FB.Match.prototype.endPlay;
      FB.Match.prototype.endPlay = function () {
        const s = this.sim;
        const res = s.result;
        const side = this.isUser(s.offTeam) ? 'you' : 'cpu';
        const play = s.kind === 'scrimmage' ? s.play.type : s.kind;
        const key = `${side} ${play} ${res.type}${res.good === false ? ' miss' : ''}`;
        log.outcomes[key] = (log.outcomes[key] || 0) + 1;
        log.plays++;
        return end.call(this);
      };
      const apply = R.applyResult;
      R.applyResult = function (g, res) {
        const out = apply(g, res);
        out.notes.forEach((n) => (log.notes[n] = (log.notes[n] || 0) + 1));
        return out;
      };
      let fake = performance.now();
      window.requestAnimationFrame = (cb) => setTimeout(() => {
        fake += speedStep || 50;
        try {
          tick();
          if (App.match && App.match.phase === 'final') window.Bot.done = true;
          cb(fake);
        } catch (e) {
          log.errors.push(e.stack || String(e));
          throw e;
        }
      }, 0);
    },
    report() {
      const m = App.match;
      return {
        done: window.Bot.done,
        phase: m && m.phase,
        quarter: m && m.g.quarter,
        clock: m && Math.round(m.g.clock),
        score: m && m.g.score,
        plays: log.plays,
        keys: log.keys,
        errors: log.errors.slice(0, 3),
        notes: log.notes,
        outcomes: log.outcomes,
        stats: m && m.g.stats,
      };
    },
  };
})();
