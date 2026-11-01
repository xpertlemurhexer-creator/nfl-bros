// A 17-game season: schedule, simulated games, standings and playoffs.
// The schedule follows the NFL's formula but is generated, not the real one.
(function () {
  const FB = (window.FB = window.FB || {});
  const SAVE_KEY = 'nflbros.season.v1';
  const WEEKS = 18;
  const ROUNDS = ['Wild Card', 'Divisional', 'Conference Championship', 'Super Bowl'];

  const S = { WEEKS, ROUNDS };

  const divisionOf = (conf, d) => FB.Teams.filter((t) => t.conf === conf && t.div === FB.DIVISIONS[d]);

  // Every matchup of the season. Each team ends up with 17 games:
  // 6 in its division, 4 against one division in its conference, 4 against
  // one in the other conference, and 3 against same-place teams.
  S.matchups = function () {
    const games = [];
    const add = (home, away) => games.push({ h: home.abbr, a: away.abbr });
    const whole = (a, b) => {
      a.forEach((x, i) => b.forEach((y, j) => ((i + j) % 2 ? add(x, y) : add(y, x))));
    };

    FB.CONFERENCES.forEach((conf) => {
      for (let d = 0; d < 4; d++) {
        const teams = divisionOf(conf, d);
        teams.forEach((x, i) => teams.forEach((y, j) => {
          if (i !== j) add(x, y);
        }));
      }
      whole(divisionOf(conf, 0), divisionOf(conf, 1));
      whole(divisionOf(conf, 2), divisionOf(conf, 3));
      // Same-place games against the two conference divisions not played in full.
      [[0, 2], [1, 3]].forEach(([a, b], flip) => {
        for (let i = 0; i < 4; i++) {
          const x = divisionOf(conf, a)[i];
          const y = divisionOf(conf, b)[i];
          flip ? add(x, y) : add(y, x);
        }
      });
      [[0, 3], [1, 2]].forEach(([a, b], flip) => {
        for (let i = 0; i < 4; i++) {
          const x = divisionOf(conf, a)[i];
          const y = divisionOf(conf, b)[i];
          flip ? add(y, x) : add(x, y);
        }
      });
    });

    for (let d = 0; d < 4; d++) {
      whole(divisionOf('AFC', d), divisionOf('NFC', d));
      const other = (d + 1) % 4;
      for (let i = 0; i < 4; i++) {
        const x = divisionOf('AFC', d)[i];
        const y = divisionOf('NFC', other)[i];
        d % 2 ? add(x, y) : add(y, x);
      }
    }
    return games;
  };

  // Each game gets a week one at a time. When a game's two teams have no free
  // week in common, a chain of existing games swaps between two weeks to open one.
  S.buildSchedule = function (rand) {
    const shuffle = (list) => {
      const out = list.slice();
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
      }
      return out;
    };
    const weekNumbers = Array.from({ length: WEEKS }, (_, i) => i);

    for (let attempt = 0; attempt < 200; attempt++) {
      const games = shuffle(S.matchups());
      const at = {};
      FB.Teams.forEach((t) => (at[t.abbr] = new Array(WEEKS).fill(-1)));
      const weekOf = new Array(games.length).fill(-1);
      const free = (team) => shuffle(weekNumbers.filter((w) => at[team][w] < 0));
      const setWeek = (i, w) => {
        weekOf[i] = w;
        at[games[i].h][w] = i;
        at[games[i].a][w] = i;
      };

      // The games linked to a team through weeks a and b, in turn.
      const chainFrom = (team, a, b) => {
        const chain = [];
        let week = a;
        let i = at[team][week];
        while (i >= 0) {
          chain.push(i);
          team = games[i].h === team ? games[i].a : games[i].h;
          week = week === a ? b : a;
          i = at[team][week];
        }
        return { chain, end: team };
      };

      const place = (i) => {
        const { h, a } = games[i];
        const openH = free(h);
        const openA = free(a);
        const shared = openH.find((w) => openA.indexOf(w) >= 0);
        if (shared !== undefined) {
          setWeek(i, shared);
          return true;
        }
        for (const wh of openH) {
          for (const wa of openA) {
            const { chain, end } = chainFrom(a, wh, wa);
            if (end === h) continue;
            chain.forEach((c) => {
              at[games[c].h][weekOf[c]] = -1;
              at[games[c].a][weekOf[c]] = -1;
            });
            chain.forEach((c) => setWeek(c, weekOf[c] === wh ? wa : wh));
            setWeek(i, wh);
            return true;
          }
        }
        return false;
      };

      if (games.every((_, i) => place(i))) {
        const weeks = weekNumbers.map(() => []);
        games.forEach((g, i) => weeks[weekOf[i]].push({ h: g.h, a: g.a, hs: null, as: null }));
        return weeks;
      }
    }
    throw new Error('Could not build a schedule');
  };

  S.simScore = function (home, away, rand) {
    const score = (off, def, bonus) => {
      const expected = 22 + (off.offPower - def.defPower) * 0.55 + bonus + FB.U.gauss(rand) * 9;
      const points = Math.max(0, expected);
      const touchdowns = Math.floor(points / 7);
      return touchdowns * 7 + Math.round((points - touchdowns * 7) / 3) * 3;
    };
    let hs = score(home, away, 1.5);
    let as = score(away, home, 0);
    if (hs === as) {
      const homeOdds = 0.5 + (home.ovr - away.ovr) * 0.02;
      if (rand() < homeOdds) hs += 3;
      else as += 3;
    }
    return [hs, as];
  };

  S.newSeason = function (userAbbr, seed) {
    const rand = FB.U.seeded(seed || Date.now());
    return {
      user: userAbbr,
      seed: seed || Date.now(),
      week: 0,
      weeks: S.buildSchedule(rand),
      phase: 'regular',
      playoffs: null,
      rngCount: 0,
    };
  };

  function nextRand(s) {
    s.rngCount++;
    const r = FB.U.seeded(s.seed + s.rngCount * 7919);
    return r;
  }

  S.userGame = function (s) {
    if (s.phase !== 'regular') return null;
    return s.weeks[s.week].find((g) => g.h === s.user || g.a === s.user) || null;
  };

  // Plays out every unplayed game of the current week and moves to the next.
  S.finishWeek = function (s) {
    s.weeks[s.week].forEach((g) => {
      if (g.hs === null) {
        const [hs, as] = S.simScore(FB.TeamByAbbr[g.h], FB.TeamByAbbr[g.a], nextRand(s));
        g.hs = hs;
        g.as = as;
      }
    });
    s.week++;
    if (s.week >= WEEKS) S.startPlayoffs(s);
  };

  S.recordUserGame = function (s, userPoints, oppPoints) {
    const g = S.userGame(s);
    if (!g) return;
    const home = g.h === s.user;
    g.hs = home ? userPoints : oppPoints;
    g.as = home ? oppPoints : userPoints;
    S.finishWeek(s);
  };

  S.table = function (s) {
    const rows = {};
    FB.Teams.forEach((t) => {
      rows[t.abbr] = { abbr: t.abbr, conf: t.conf, div: t.div, w: 0, l: 0, t: 0, pf: 0, pa: 0, divW: 0, divL: 0, confW: 0, confL: 0 };
    });
    s.weeks.forEach((week) => week.forEach((g) => {
      if (g.hs === null) return;
      const h = rows[g.h];
      const a = rows[g.a];
      h.pf += g.hs;
      h.pa += g.as;
      a.pf += g.as;
      a.pa += g.hs;
      const sameConf = h.conf === a.conf;
      const sameDiv = sameConf && h.div === a.div;
      const log = (win, lose) => {
        win.w++;
        lose.l++;
        if (sameDiv) {
          win.divW++;
          lose.divL++;
        }
        if (sameConf) {
          win.confW++;
          lose.confL++;
        }
      };
      if (g.hs > g.as) log(h, a);
      else if (g.as > g.hs) log(a, h);
      else {
        h.t++;
        a.t++;
      }
    }));
    return rows;
  };

  const pct = (r) => (r.w + r.t / 2) / Math.max(1, r.w + r.l + r.t);
  const ratio = (w, l) => w / Math.max(1, w + l);

  S.compare = function (x, y) {
    return pct(y) - pct(x) ||
      ratio(y.divW, y.divL) - ratio(x.divW, x.divL) ||
      ratio(y.confW, y.confL) - ratio(x.confW, x.confL) ||
      (y.pf - y.pa) - (x.pf - x.pa) ||
      y.pf - x.pf ||
      x.abbr.localeCompare(y.abbr);
  };

  S.divisionStandings = function (s, conf, div) {
    const rows = S.table(s);
    return Object.values(rows).filter((r) => r.conf === conf && r.div === div).sort(S.compare);
  };

  // Seeds 1-4 are division winners, 5-7 the best of the rest.
  S.seeds = function (s, conf) {
    const winners = FB.DIVISIONS.map((d) => S.divisionStandings(s, conf, d)[0]).sort(S.compare);
    const taken = winners.map((r) => r.abbr);
    const rows = S.table(s);
    const rest = Object.values(rows)
      .filter((r) => r.conf === conf && taken.indexOf(r.abbr) < 0)
      .sort(S.compare)
      .slice(0, 3);
    return winners.concat(rest).map((r) => r.abbr);
  };

  S.startPlayoffs = function (s) {
    s.phase = 'playoffs';
    s.playoffs = {
      round: 0,
      seeds: { AFC: S.seeds(s, 'AFC'), NFC: S.seeds(s, 'NFC') },
      alive: { AFC: S.seeds(s, 'AFC'), NFC: S.seeds(s, 'NFC') },
      history: [],
      games: [],
      champion: null,
    };
    S.setRound(s);
  };

  function bracket(alive) {
    const games = [];
    const list = alive.slice();
    if (list.length === 7) list.shift(); // the top seed sits out the first round
    for (let i = 0; i < list.length / 2; i++) {
      games.push({ h: list[i], a: list[list.length - 1 - i], hs: null, as: null });
    }
    return games;
  }

  S.setRound = function (s) {
    const p = s.playoffs;
    p.games = p.round === 3
      ? [{ h: p.alive.AFC[0], a: p.alive.NFC[0], hs: null, as: null }]
      : bracket(p.alive.AFC).concat(bracket(p.alive.NFC));
  };

  S.userPlayoffGame = function (s) {
    if (s.phase !== 'playoffs') return null;
    return s.playoffs.games.find((g) => g.h === s.user || g.a === s.user) || null;
  };

  S.finishRound = function (s) {
    const p = s.playoffs;
    p.games.forEach((g) => {
      if (g.hs === null) {
        const [hs, as] = S.simScore(FB.TeamByAbbr[g.h], FB.TeamByAbbr[g.a], nextRand(s));
        g.hs = hs;
        g.as = as;
      }
      const loser = g.hs > g.as ? g.a : g.h;
      FB.CONFERENCES.forEach((c) => {
        p.alive[c] = p.alive[c].filter((t) => t !== loser);
      });
    });
    p.history.push({ round: p.round, games: p.games });
    if (p.round === 3) {
      const g = p.games[0];
      p.champion = g.hs > g.as ? g.h : g.a;
      s.phase = 'done';
      return;
    }
    p.round++;
    S.setRound(s);
  };

  S.recordUserPlayoffGame = function (s, userPoints, oppPoints) {
    const g = S.userPlayoffGame(s);
    if (!g) return;
    const home = g.h === s.user;
    g.hs = home ? userPoints : oppPoints;
    g.as = home ? oppPoints : userPoints;
    S.finishRound(s);
  };

  S.save = function (s) {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(s));
    } catch (e) {
      // Saving is a convenience. The game keeps running without it.
    }
  };

  S.load = function () {
    try {
      const text = localStorage.getItem(SAVE_KEY);
      return text ? JSON.parse(text) : null;
    } catch (e) {
      return null;
    }
  };

  S.clear = function () {
    try {
      localStorage.removeItem(SAVE_KEY);
    } catch (e) {
      // Nothing to clear.
    }
  };

  FB.Season = S;
})();
