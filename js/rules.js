// The rules of football: downs, scoring, clock and possession.
// Nothing here draws or moves players, so all of it can be tested directly.
//
// g.yard is measured from the possessing team's own goal line: 0 is their
// goal line and 100 is the opponent's. Field x runs 0-120 including end zones.
(function () {
  const FB = (window.FB = window.FB || {});

  FB.U = {
    clamp: (v, a, b) => Math.max(a, Math.min(b, v)),
    lerp: (a, b, t) => a + (b - a) * t,
    dist: (a, b) => Math.hypot(a.x - b.x, a.y - b.y),
    gauss(rand) {
      return (rand() + rand() + rand() - 1.5) / 0.87;
    },
    pick(rand, list) {
      return list[Math.floor(rand() * list.length) % list.length];
    },
    seeded(seed) {
      let s = seed >>> 0 || 1;
      return function () {
        s = (s + 0x6d2b79f5) >>> 0;
        let t = s;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    },
  };

  const R = {
    QUARTER: 120,
    KICKOFF_TOUCHBACK: 25,
    PUNT_TOUCHBACK: 20,
    RUNOFF: 6,
    CONVERSION_YARD: 90,
    FIELD_WIDTH: 53.33,
  };

  const blankStats = () => ({ pass: 0, rush: 0, first: 0, turnovers: 0, sacks: 0, plays: 0 });

  R.newGame = function (opts) {
    opts = opts || {};
    const length = opts.quarterLength || R.QUARTER;
    return {
      score: [0, 0],
      quarter: 1,
      half: 1,
      clock: length,
      quarterLength: length,
      pos: 0,
      yard: 25,
      down: 1,
      toGo: 10,
      ballY: R.FIELD_WIDTH / 2,
      mode: 'kickoff',
      kicker: 0,
      openingKicker: 0,
      ot: false,
      over: false,
      winner: null,
      stats: [blankStats(), blankStats()],
    };
  };

  R.other = (team) => 1 - team;

  // Team 0 drives right in the first half and overtime.
  R.dir = (g, team) => ((team === 0) === (g.half % 2 === 1) ? 1 : -1);
  R.toX = (g, team, yard) => (R.dir(g, team) > 0 ? 10 + yard : 110 - yard);
  R.toYard = (g, team, x) => (R.dir(g, team) > 0 ? x - 10 : 110 - x);

  function firstDown(g) {
    g.down = 1;
    g.toGo = Math.min(10, 100 - g.yard);
  }

  function giveBall(g, team, yard) {
    g.pos = team;
    g.yard = yard;
    g.mode = 'normal';
    firstDown(g);
  }

  function score(g, team, points) {
    g.score[team] += points;
  }

  function finishGame(g) {
    g.over = true;
    g.winner = g.score[0] === g.score[1] ? null : g.score[0] > g.score[1] ? 0 : 1;
  }

  function nextDown(g, out) {
    g.down++;
    if (g.down > 4) {
      out.notes.push('downs');
      g.stats[g.pos].turnovers++;
      giveBall(g, R.other(g.pos), 100 - g.yard);
    }
  }

  function kickoffAfterScore(g, kicker, out) {
    g.kicker = kicker;
    g.mode = 'kickoff';
    out.next = 'kickoff';
  }

  function conversion(g, res, out) {
    const team = g.pos;
    let points = 0;
    if (g.mode === 'pat' && res.type === 'xp' && res.good) points = 1;
    if (g.mode === 'two' && res.type === 'td' && res.team === team) points = 2;
    if (points) score(g, team, points);
    out.notes.push(points ? 'conversion-good' : 'conversion-failed');
    out.points = points;
    kickoffAfterScore(g, team, out);
    return out;
  }

  // Applies a finished play. Returns what happens next: 'play', 'pat' or 'kickoff'.
  R.applyResult = function (g, res) {
    const out = { next: 'play', notes: [], points: 0 };
    if (g.mode === 'pat' || g.mode === 'two') return conversion(g, res, out);

    const kickPlay = g.mode === 'kickoff' || g.mode === 'punt';

    switch (res.type) {
      case 'down': {
        if (kickPlay) {
          giveBall(g, res.team, res.yard);
        } else if (res.team !== g.pos) {
          out.notes.push('turnover');
          g.stats[g.pos].turnovers++;
          giveBall(g, res.team, res.yard);
        } else {
          const gain = res.yard - g.yard;
          g.yard = res.yard;
          g.toGo -= gain;
          if (g.toGo <= 0) {
            out.notes.push('first');
            g.stats[g.pos].first++;
            firstDown(g);
          } else {
            g.toGo = Math.min(g.toGo, 100 - g.yard);
            nextDown(g, out);
          }
        }
        break;
      }
      case 'incomplete':
        nextDown(g, out);
        break;
      case 'touchback':
        out.notes.push('touchback');
        giveBall(g, res.team, res.yard);
        break;
      case 'td':
        if (res.team !== g.pos && !kickPlay) g.stats[g.pos].turnovers++;
        score(g, res.team, 6);
        out.notes.push('td');
        out.points = 6;
        if (g.ot) {
          finishGame(g);
          out.next = 'final';
        } else {
          g.pos = res.team;
          g.yard = R.CONVERSION_YARD;
          g.down = 1;
          g.toGo = 10;
          g.mode = 'pat';
          out.next = 'pat';
        }
        break;
      case 'safety':
        score(g, res.team, 2);
        out.notes.push('safety');
        out.points = 2;
        if (g.ot) {
          finishGame(g);
          out.next = 'final';
        } else {
          kickoffAfterScore(g, R.other(res.team), out);
        }
        break;
      case 'fg':
        if (res.good) {
          score(g, g.pos, 3);
          out.notes.push('fg-good');
          out.points = 3;
          if (g.ot) {
            finishGame(g);
            out.next = 'final';
          } else {
            kickoffAfterScore(g, g.pos, out);
          }
        } else {
          out.notes.push('fg-miss');
          g.stats[g.pos].turnovers++;
          // Missed kicks go back to the spot of the kick, or the 20 if that's further.
          giveBall(g, R.other(g.pos), Math.max(20, 100 - (g.yard - 7)));
        }
        break;
      default:
        throw new Error('Unknown play result: ' + res.type);
    }
    return out;
  };

  R.chooseConversion = function (g, choice) {
    g.mode = choice === 'two' ? 'two' : 'pat';
    g.yard = R.CONVERSION_YARD;
  };

  R.tick = function (g, seconds) {
    g.clock = Math.max(0, g.clock - seconds);
  };

  // Call between plays. Moves on to the next quarter, half or overtime when
  // the clock has run out. Returns what changed, or null.
  R.endPeriodIfNeeded = function (g, coinFlip) {
    if (g.clock > 0 || g.over) return null;
    if (g.mode === 'pat' || g.mode === 'two') return null;

    if (g.quarter === 1 || g.quarter === 3) {
      g.quarter++;
      g.clock = g.quarterLength;
      return 'quarter';
    }
    if (g.quarter === 2) {
      g.quarter = 3;
      g.half = 2;
      g.clock = g.quarterLength;
      g.kicker = R.other(g.openingKicker);
      g.mode = 'kickoff';
      return 'halftime';
    }
    if (g.score[0] !== g.score[1]) {
      finishGame(g);
      return 'final';
    }
    g.quarter++;
    g.ot = true;
    g.half = 3;
    g.clock = g.quarterLength;
    g.kicker = coinFlip ? 0 : 1;
    g.mode = 'kickoff';
    return 'overtime';
  };

  R.ordinal = (n) => ['', '1st', '2nd', '3rd', '4th'][n] || n + 'th';

  R.quarterLabel = (g) => (g.ot ? 'OT' : 'Q' + g.quarter);

  R.clockLabel = function (g) {
    const s = Math.ceil(g.clock);
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  };

  R.downLabel = function (g) {
    if (g.mode === 'kickoff') return 'Kickoff';
    if (g.mode === 'pat') return 'Extra point';
    if (g.mode === 'two') return 'Two-point try';
    const goal = 100 - g.yard <= g.toGo;
    return R.ordinal(g.down) + ' & ' + (goal ? 'Goal' : Math.max(1, Math.round(g.toGo)));
  };

  R.spotLabel = function (g, teams) {
    const y = Math.round(g.yard);
    if (y === 50) return 'Midfield';
    const side = y < 50 ? g.pos : R.other(g.pos);
    return teams[side].abbr + ' ' + Math.min(y, 100 - y);
  };

  FB.Rules = R;
})();
