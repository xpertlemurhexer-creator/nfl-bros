// Starts the game: keyboard input, the main loop, and every menu screen.
(function () {
  const FB = window.FB;
  const R = FB.Rules;
  const Season = FB.Season;
  const STEP = 1 / 60;
  const SETTINGS_KEY = 'nflbros.settings.v1';

  const stage = document.getElementById('stage');
  const canvas = document.getElementById('game');
  const screenEl = document.getElementById('screen');
  const overlayEl = document.getElementById('overlay');
  const renderer = new FB.Renderer(canvas);
  const sound = new FB.Sound();

  const App = {
    match: null,
    season: null,
    paused: false,
    difficulty: 'normal',
    muted: false,
    onGameOver: null,
    overlayFor: null,
    menuIndex: 0,
  };

  // ---- Settings ---------------------------------------------------------

  function loadSettings() {
    try {
      const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
      if (FB.DIFFICULTY[saved.difficulty]) App.difficulty = saved.difficulty;
      App.muted = !!saved.muted;
    } catch (e) {
      // Defaults are fine.
    }
    sound.setMuted(App.muted);
  }

  function saveSettings() {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify({ difficulty: App.difficulty, muted: App.muted }));
    } catch (e) {
      // Settings just won't be remembered.
    }
  }

  // ---- Layout -----------------------------------------------------------

  function fit() {
    const w = Math.min(window.innerWidth, (window.innerHeight * 16) / 9);
    const h = (w * 9) / 16;
    stage.style.width = w + 'px';
    stage.style.height = h + 'px';
    stage.style.fontSize = (w / 1280) * 16 + 'px';
    renderer.resize(w, h, Math.min(window.devicePixelRatio || 1, 2));
  }

  // ---- Keyboard ---------------------------------------------------------

  const held = new Set();
  const pending = { action: false, switched: false, dirEdge: null };
  const MOVE_KEYS = {
    ArrowUp: [0, -1], KeyW: [0, -1], ArrowDown: [0, 1], KeyS: [0, 1],
    ArrowLeft: [-1, 0], KeyA: [-1, 0], ArrowRight: [1, 0], KeyD: [1, 0],
  };

  function moveVector() {
    let x = 0;
    let y = 0;
    held.forEach((code) => {
      const m = MOVE_KEYS[code];
      if (m) {
        x += m[0];
        y += m[1];
      }
    });
    return { x: Math.sign(x), y: Math.sign(y) };
  }

  function readInput() {
    const v = moveVector();
    const input = { x: v.x, y: v.y, action: pending.action, switched: pending.switched, dirEdge: pending.dirEdge };
    pending.action = false;
    pending.switched = false;
    pending.dirEdge = null;
    return input;
  }

  function nearestButton(code) {
    const buttons = Array.from(screenEl.querySelectorAll('button:not(:disabled)'));
    if (!buttons.length) return;
    const current = document.activeElement;
    if (buttons.indexOf(current) < 0) {
      buttons[0].focus();
      return;
    }
    const [dx, dy] = MOVE_KEYS[code];
    const a = current.getBoundingClientRect();
    const ax = a.left + a.width / 2;
    const ay = a.top + a.height / 2;
    let best = null;
    let bestCost = Infinity;
    buttons.forEach((b) => {
      if (b === current) return;
      const r = b.getBoundingClientRect();
      const ox = r.left + r.width / 2 - ax;
      const oy = r.top + r.height / 2 - ay;
      const along = ox * dx + oy * dy;
      if (along <= 1) return;
      const across = Math.abs(ox * dy) + Math.abs(oy * dx);
      const cost = along + across * 2.5;
      if (cost < bestCost) {
        bestCost = cost;
        best = b;
      }
    });
    if (best) best.focus();
  }

  function menuOpen() {
    return screenEl.childElementCount > 0;
  }

  function onKeyDown(e) {
    sound.unlock();
    const code = e.code;
    const inGame = App.match && !menuOpen();

    if (MOVE_KEYS[code] || code === 'Space' || code === 'Tab') e.preventDefault();

    if (code === 'KeyM' && !e.repeat) {
      App.muted = !App.muted;
      sound.setMuted(App.muted);
      saveSettings();
      return;
    }

    if (menuOpen()) {
      if (MOVE_KEYS[code] && !e.repeat) nearestButton(code);
      if (code === 'Space' && !e.repeat && document.activeElement && document.activeElement.tagName === 'BUTTON') {
        document.activeElement.click();
      }
      if (code === 'Escape' && !e.repeat && App.paused) resumeGame();
      return;
    }
    if (!inGame) return;

    if ((code === 'Escape' || code === 'KeyP') && !e.repeat) {
      pauseGame();
      return;
    }

    if (App.match.menu) {
      onMenuKey(code, e.repeat);
      return;
    }
    if (App.match.phase === 'patchoice') {
      if (!e.repeat && code === 'Digit1') chooseConversion('xp');
      if (!e.repeat && code === 'Digit2') chooseConversion('two');
      if (MOVE_KEYS[code] && !e.repeat) {
        App.menuIndex = 1 - App.menuIndex;
        renderConversion();
      }
      if ((code === 'Space' || code === 'Enter') && !e.repeat) chooseConversion(App.menuIndex ? 'two' : 'xp');
      return;
    }

    if (MOVE_KEYS[code]) {
      if (!held.has(code)) {
        held.add(code);
        pending.dirEdge = moveVector();
      }
      return;
    }
    if (e.repeat) return;
    if (code === 'Space' || code === 'Enter') pending.action = true;
    if (code === 'ShiftLeft' || code === 'ShiftRight' || code === 'KeyE') pending.switched = true;
  }

  function onKeyUp(e) {
    held.delete(e.code);
  }

  function onMenuKey(code, repeat) {
    const menu = App.match.menu;
    const count = menu.plays.length;
    const perRow = 5;
    const move = { ArrowLeft: -1, KeyA: -1, ArrowRight: 1, KeyD: 1, ArrowUp: -perRow, KeyW: -perRow, ArrowDown: perRow, KeyS: perRow }[code];
    if (move && !repeat) {
      const next = App.menuIndex + move;
      if (next >= 0 && next < count) App.menuIndex = next;
      markPlay();
      return;
    }
    if (repeat) return;
    if (code === 'Space' || code === 'Enter') choosePlay(menu.plays[App.menuIndex].id);
    const digit = /^Digit([1-9])$/.exec(code);
    if (digit && menu.plays[digit[1] - 1]) choosePlay(menu.plays[digit[1] - 1].id);
    if (code === 'Digit0' && menu.plays[9]) choosePlay(menu.plays[9].id);
  }

  // ---- Game overlays ----------------------------------------------------

  function hideOverlay() {
    overlayEl.hidden = true;
    overlayEl.innerHTML = '';
    App.overlayFor = null;
  }

  function choosePlay(id) {
    App.match.choosePlay(id);
    hideOverlay();
  }

  function chooseConversion(choice) {
    App.match.chooseConversion(choice);
    hideOverlay();
  }

  function markPlay() {
    overlayEl.querySelectorAll('.play').forEach((el, i) => el.classList.toggle('sel', i === App.menuIndex));
  }

  function keyPeople(m, side) {
    const team = side === 'offense' ? m.g.pos : R.other(m.g.pos);
    const roster = m.rosters[team];
    const slots = side === 'offense' ? ['QB', 'RB', 'WR1', 'WR2', 'TE'] : ['DL1', 'DL2', 'LB1', 'LB2', 'CB1', 'CB2', 'S'];
    const named = slots.map((s) => roster[s]).filter((p) => p.name);
    return named.map((p) => `<b>${p.name}</b> ${p.pos}`).join('  •  ');
  }

  function renderPlaycall() {
    const m = App.match;
    const menu = m.menu;
    const g = m.g;
    App.menuIndex = 0;
    const title = menu.side === 'offense' ? 'Call your play' : 'Call your defense';
    overlayEl.innerHTML = `
      <div class="playcall">
        <header>
          <h2>${title}</h2>
          <span class="muted">${R.downLabel(g)}  •  ${R.spotLabel(g, m.teams)}  •  ARROWS and SPACE, or number keys</span>
        </header>
        <div class="plays">
          ${menu.plays.map((p, i) => `
            <button class="play" data-id="${p.id}">
              <canvas width="256" height="144"></canvas>
              <kbd>${(i + 1) % 10}</kbd>
              <b>${p.name}</b>
              <small>${p.blurb}</small>
            </button>`).join('')}
        </div>
        <div class="who">${keyPeople(m, menu.side)}</div>
      </div>`;
    overlayEl.hidden = false;
    overlayEl.querySelectorAll('.play').forEach((el, i) => {
      el.addEventListener('click', () => choosePlay(el.dataset.id));
      drawDiagram(el.querySelector('canvas'), menu.plays[i], menu.side);
    });
    markPlay();
  }

  function renderConversion() {
    overlayEl.innerHTML = `
      <div class="choice">
        <h2>After the touchdown</h2>
        <div class="row">
          <button class="btn ${App.menuIndex === 0 ? 'on' : ''}" data-c="xp">1. Kick extra point</button>
          <button class="btn ${App.menuIndex === 1 ? 'on' : ''}" data-c="two">2. Go for two</button>
        </div>
      </div>`;
    overlayEl.hidden = false;
    overlayEl.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => chooseConversion(b.dataset.c)));
  }

  function syncOverlay() {
    const m = App.match;
    const want = m.menu ? 'menu' : m.phase === 'patchoice' ? 'conversion' : null;
    if (want === App.overlayFor) return;
    hideOverlay();
    App.overlayFor = want;
    if (want === 'menu') renderPlaycall();
    if (want === 'conversion') {
      App.menuIndex = 0;
      renderConversion();
    }
  }

  // A small sketch of a play, with the offense moving up the card.
  function drawDiagram(cv, play, side) {
    const c = cv.getContext('2d');
    const w = cv.width;
    const h = cv.height;
    const deep = play.depth === 'deep' ? 2.4 : 4.8;
    const px = (dy) => w / 2 + dy * 5.4;
    const py = (dx) => h - 34 - dx * deep;
    c.lineCap = 'round';
    c.lineWidth = 3;

    c.strokeStyle = 'rgba(255,255,255,.5)';
    c.beginPath();
    c.moveTo(0, py(0));
    c.lineTo(w, py(0));
    c.stroke();

    const dot = (x, y, color) => {
      c.fillStyle = color;
      c.beginPath();
      c.arc(x, y, 6, 0, 7);
      c.fill();
    };
    const pathFrom = (spot, pts, color) => {
      c.strokeStyle = color;
      c.beginPath();
      c.moveTo(px(spot[1]), py(spot[0]));
      pts.forEach(([dx, dy]) => c.lineTo(px(spot[1] + dy), Math.max(5, py(spot[0] + dx))));
      c.stroke();
    };

    if (side === 'offense') {
      if (play.type === 'punt' || play.type === 'fg') {
        c.fillStyle = '#fff';
        c.font = '700 26px "Arial Black", sans-serif';
        c.textAlign = 'center';
        c.fillText(play.type === 'punt' ? 'PUNT' : 'FG', w / 2, h / 2 + 8);
        return;
      }
      if (play.path) {
        const spot = FB.Plays.OFFENSE_SPOTS[play.carrier];
        pathFrom(spot, play.path, '#ffd21f');
      }
      Object.keys(play.routes || {}).forEach((slot) => pathFrom(FB.Plays.OFFENSE_SPOTS[slot], play.routes[slot], '#ffffff'));
      Object.values(FB.Plays.OFFENSE_SPOTS).forEach(([dx, dy]) => dot(px(dy), py(dx), '#7fd0ff'));
    } else {
      Object.keys(FB.Plays.DEFENSE_SPOTS).forEach((slot) => {
        const [dx, dy] = FB.Plays.DEFENSE_SPOTS[slot];
        const a = play.assign[slot];
        const x = px(dy);
        const y = py(-dx * 0.55) - 46;
        if (a.role === 'rush') {
          c.strokeStyle = '#ff7a6b';
          c.beginPath();
          c.moveTo(x, y);
          c.lineTo(w / 2, h - 20);
          c.stroke();
        } else if (a.role === 'zone') {
          c.strokeStyle = 'rgba(127,208,255,.9)';
          c.beginPath();
          c.ellipse(px(a.at[1]), Math.max(16, 62 - a.at[0] * 2.1), 28, 14, 0, 0, 7);
          c.stroke();
        }
        dot(x, y, '#ffb45e');
      });
    }
  }

  // ---- Screens ----------------------------------------------------------

  function show(html, backdrop) {
    screenEl.innerHTML = html;
    screenEl.classList.toggle('backdrop', backdrop !== false);
    const first = screenEl.querySelector('[data-focus]') || screenEl.querySelector('button:not(:disabled)');
    if (first) first.focus();
  }

  function clearScreen() {
    screenEl.innerHTML = '';
    screenEl.classList.remove('backdrop');
  }

  function on(selector, handler) {
    screenEl.querySelectorAll(selector).forEach((el) => el.addEventListener('click', () => handler(el)));
  }

  function bars(T, against) {
    return FB.UNIT_LABELS.map(([key, label]) => {
      const v = T[key];
      const color = against ? (v >= against[key] ? 'var(--green)' : 'var(--red)') : 'var(--gold)';
      return `<div class="bar"><span>${label}</span><i style="--v:${((v - 50) / 49) * 100}%;--c:${color}"></i><b>${v}</b></div>`;
    }).join('');
  }

  function stars(T) {
    return [T.qbName].concat(T.stars.map((s) => `${s[1]} (${s[0]})`)).join(', ');
  }

  function teamCard(T, against) {
    return `
      <h3>${T.fullName}</h3>
      <div class="muted">Record ${T.record}  •  Overall ${T.ovr}</div>
      <div style="margin-top:.5em">${bars(T, against)}</div>
      <div class="fact"><b>Strength:</b> ${T.strength}</div>
      <div class="fact bad"><b>Weakness:</b> ${T.weakness}</div>
      <div class="fact muted">${stars(T)}</div>`;
  }

  function title() {
    App.match = null;
    App.season = null;
    App.onGameOver = null;
    hideOverlay();
    const saved = Season.load();
    show(`
      <div class="title">
        <h1 class="logo">NFL <span>BROS</span></h1>
        <div class="tagline">Arcade football. Run the offense, then stop the other team.</div>
        <div class="menu">
          <button class="btn" id="quick" data-focus>Quick Game</button>
          ${saved ? `<button class="btn" id="resume">Continue Season (${saved.user})</button>` : ''}
          <button class="btn" id="season">New Season</button>
          <button class="btn" id="how">How to Play</button>
        </div>
        <div class="row">
          ${Object.keys(FB.DIFFICULTY).map((d) => `<button class="btn ${App.difficulty === d ? 'on' : ''}" data-diff="${d}">${d[0].toUpperCase() + d.slice(1)}</button>`).join('')}
        </div>
        <div class="small">Team ratings use 2026 records through Week 8. M mutes sound. Space or Enter selects.</div>
      </div>`);
    on('#quick', () => pickTeam('Pick your team', null, (mine) => {
      pickTeam('Pick your opponent', mine, (theirs) => matchup(mine, theirs, 0, () => startQuick(mine, theirs)));
    }));
    on('#season', () => pickTeam('Pick your team for the season', null, (mine) => {
      App.season = Season.newSeason(mine.abbr);
      Season.save(App.season);
      hub();
    }));
    on('#resume', () => {
      App.season = saved;
      hub();
    });
    on('#how', howTo);
    on('[data-diff]', (el) => {
      App.difficulty = el.dataset.diff;
      saveSettings();
      title();
    });
  }

  function howTo() {
    show(`
      <div class="howto">
        <h1>How to play</h1>
        <p class="muted">You control one player at a time, with the gold star under them. The computer plays everyone else. Pick a play, snap the ball, and play real downs with a 2-minute clock each quarter.</p>
        <div class="controls">
          <b>ARROWS / WASD</b><span>Move, or aim at a receiver as the quarterback</span>
          <b>SPACE</b><span>Snap, throw, stiff-arm when a defender is close, or dive</span>
          <b>SHIFT</b><span>Next receiver as the quarterback. Switch defenders on defense</span>
          <b>SPACE on kicks</b><span>Press once for power, then again for accuracy</span>
          <b>1-9</b><span>Quick-pick a play</span>
          <b>ESC or P</b><span>Pause</span>
          <b>M</b><span>Mute</span>
        </div>
        <p class="muted">The ring around your target shows how open they are: green is open, yellow is tight, red is covered.</p>
        <div><button class="btn" id="back">Back</button></div>
      </div>`);
    on('#back', title);
  }

  function pickTeam(heading, taken, done) {
    const cells = [];
    FB.CONFERENCES.forEach((conf) => FB.DIVISIONS.forEach((div) => cells.push(`<div class="head">${conf} ${div}</div>`)));
    for (let row = 0; row < 4; row++) {
      FB.CONFERENCES.forEach((conf) => FB.DIVISIONS.forEach((div) => {
        const T = FB.Teams.filter((t) => t.conf === conf && t.div === div)[row];
        const isTaken = taken && taken.abbr === T.abbr;
        cells.push(`<button class="tile ${isTaken ? 'taken' : ''}" data-team="${T.abbr}" ${isTaken ? 'disabled' : ''}
          style="background:${T.primary};color:#fff"><b>${T.abbr}</b><small>${T.record}</small></button>`);
      }));
    }
    show(`
      <div class="picker">
        <h2>${heading}</h2>
        <div class="teams">${cells.join('')}</div>
        <div class="card" id="detail"></div>
      </div>`);
    const detail = document.getElementById('detail');
    const preview = (abbr) => (detail.innerHTML = teamCard(FB.TeamByAbbr[abbr]));
    screenEl.querySelectorAll('.tile').forEach((el) => {
      el.addEventListener('focus', () => preview(el.dataset.team));
      el.addEventListener('mouseenter', () => el.focus());
      el.addEventListener('click', () => done(FB.TeamByAbbr[el.dataset.team]));
    });
    preview(document.activeElement.dataset.team || FB.Teams[0].abbr);
  }

  function matchup(a, b, userIndex, start, leave) {
    show(`
      <div class="matchup">
        <div class="card">${userIndex === 0 ? '<div class="small">YOUR TEAM</div>' : '<div class="small">OPPONENT</div>'}${teamCard(a, b)}</div>
        <div class="card">${userIndex === 1 ? '<div class="small">YOUR TEAM</div>' : '<div class="small">OPPONENT</div>'}${teamCard(b, a)}</div>
        <div class="foot">
          <button class="btn" id="kick" data-focus>Kick Off</button>
          <button class="btn" id="leave">Back</button>
        </div>
      </div>`);
    on('#kick', start);
    on('#leave', leave || title);
  }

  function startMatch(teams, user) {
    held.clear();
    App.match = new FB.Match({ teams, user, difficulty: App.difficulty });
    App.paused = false;
    renderer.setMatch(App.match);
    clearScreen();
  }

  function startQuick(mine, theirs) {
    App.onGameOver = () => finalScreen([
      ['Rematch', () => startQuick(mine, theirs)],
      ['Main Menu', title],
    ]);
    startMatch([mine, theirs], 0);
  }

  function pauseGame() {
    App.paused = true;
    show(`
      <div class="title">
        <h1 class="logo" style="font-size:3.4em">PAUSED</h1>
        <div class="menu">
          <button class="btn" id="res" data-focus>Resume</button>
          <button class="btn" id="how2">Controls</button>
          <button class="btn" id="quit">Quit Game</button>
        </div>
      </div>`, false);
    screenEl.style.background = 'rgba(5,9,15,.75)';
    on('#res', resumeGame);
    on('#how2', () => {
      show(`<div class="howto"><h1>Controls</h1><div class="controls">
        <b>ARROWS / WASD</b><span>Move or aim</span>
        <b>SPACE</b><span>Snap, throw, stiff-arm, dive</span>
        <b>SHIFT</b><span>Next receiver or defender</span></div>
        <div><button class="btn" id="res2">Resume</button></div></div>`, false);
      on('#res2', resumeGame);
    });
    on('#quit', () => {
      screenEl.style.background = '';
      App.season ? hub() : title();
      App.match = null;
    });
  }

  function resumeGame() {
    App.paused = false;
    screenEl.style.background = '';
    clearScreen();
  }

  function finalScreen(buttons) {
    const m = App.match;
    const g = m.g;
    const [a, b] = m.teams;
    const headline = g.score[0] === g.score[1]
      ? 'Tie game'
      : g.winner === m.user ? 'You win!' : `${m.teams[g.winner].name} win`;
    const line = (label, key) => `<tr><td>${label}</td><td>${Math.round(g.stats[0][key])}</td><td>${Math.round(g.stats[1][key])}</td></tr>`;
    show(`
      <div class="final">
        <h1>${headline}</h1>
        <div class="bigscore">${a.abbr} ${g.score[0]}  -  ${g.score[1]} ${b.abbr}</div>
        <table class="box card">
          <tr><th></th><th>${a.abbr}</th><th>${b.abbr}</th></tr>
          ${line('Passing yards', 'pass')}${line('Rushing yards', 'rush')}${line('First downs', 'first')}
          ${line('Turnovers', 'turnovers')}${line('Sacks', 'sacks')}
        </table>
        <div class="row">${buttons.map((b2, i) => `<button class="btn" data-b="${i}">${b2[0]}</button>`).join('')}</div>
      </div>`);
    on('[data-b]', (el) => buttons[Number(el.dataset.b)][1]());
  }

  // ---- Season hub -------------------------------------------------------

  function recordOf(s, abbr) {
    const r = Season.table(s)[abbr];
    return r.t ? `${r.w}-${r.l}-${r.t}` : `${r.w}-${r.l}`;
  }

  function scheduleRows(s) {
    return s.weeks.map((week, i) => {
      const g = week.find((x) => x.h === s.user || x.a === s.user);
      const now = i === s.week && s.phase === 'regular' ? 'now' : '';
      if (!g) return `<tr class="${now}"><td>${i + 1}</td><td colspan="2" class="muted">Bye</td></tr>`;
      const home = g.h === s.user;
      const opp = home ? g.a : g.h;
      let result = '';
      if (g.hs !== null) {
        const mine = home ? g.hs : g.as;
        const theirs = home ? g.as : g.hs;
        result = `<span class="${mine > theirs ? 'win' : 'loss'}">${mine > theirs ? 'W' : 'L'} ${mine}-${theirs}</span>`;
      }
      return `<tr class="${now}"><td>${i + 1}</td><td>${home ? 'vs' : 'at'} ${opp}</td><td>${result}</td></tr>`;
    }).join('');
  }

  function standingsTable(s, conf) {
    return FB.DIVISIONS.map((div) => {
      const rows = Season.divisionStandings(s, conf, div);
      return `<tr><th colspan="4">${conf} ${div}</th></tr>` + rows.map((r) =>
        `<tr class="${r.abbr === s.user ? 'you' : ''}"><td>${r.abbr}</td><td>${r.w}-${r.l}${r.t ? '-' + r.t : ''}</td><td>${r.pf}</td><td>${r.pa}</td></tr>`).join('');
    }).join('');
  }

  function playoffPanel(s) {
    const p = s.playoffs;
    const lines = p.history.concat(s.phase === 'done' ? [] : [{ round: p.round, games: p.games }]).map((r) => {
      const games = r.games.map((g) => {
        const score = g.hs === null ? '' : ` ${g.hs}-${g.as}`;
        return `<div>${g.h} vs ${g.a}<span class="muted">${score}</span></div>`;
      }).join('');
      return `<h3 style="font-size:.9em;margin-top:.6em;color:var(--gold)">${Season.ROUNDS[r.round]}</h3>${games}`;
    }).join('');
    return `<div class="card scroll">${lines}</div>`;
  }

  function playSeasonGame(g, record) {
    const home = FB.TeamByAbbr[g.h];
    const away = FB.TeamByAbbr[g.a];
    const user = g.h === App.season.user ? 0 : 1;
    matchup(home, away, user, () => {
      App.onGameOver = () => {
        const score = App.match.g.score;
        const mine = score[user];
        const theirs = score[1 - user];
        finalScreen([['Continue', () => {
          record(App.season, mine, theirs);
          Season.save(App.season);
          App.match = null;
          hub();
        }]]);
      };
      startMatch([home, away], user);
    }, hub);
  }

  function hub() {
    App.match = null;
    App.onGameOver = null;
    hideOverlay();
    const s = App.season;
    const T = FB.TeamByAbbr[s.user];
    const conf = T.conf;
    let next = '';
    let center = `<div class="card scroll"><table class="sched">${scheduleRows(s)}</table></div>`;

    if (s.phase === 'regular') {
      const g = Season.userGame(s);
      if (g) {
        const home = g.h === s.user;
        const opp = FB.TeamByAbbr[home ? g.a : g.h];
        next = `
          <div class="muted">Week ${s.week + 1} of ${Season.WEEKS}</div>
          <h3>${home ? 'vs' : 'at'} ${opp.fullName}</h3>
          <div class="fact"><b>Strength:</b> ${opp.strength}</div>
          <div class="fact bad"><b>Weakness:</b> ${opp.weakness}</div>
          <button class="btn" id="play" data-focus>Play Game</button>
          <button class="btn" id="sim">Simulate Game</button>`;
      } else {
        next = `
          <div class="muted">Week ${s.week + 1} of ${Season.WEEKS}</div>
          <h3>Bye week</h3>
          <button class="btn" id="bye" data-focus>Next Week</button>`;
      }
    } else if (s.phase === 'playoffs') {
      const g = Season.userPlayoffGame(s);
      center = playoffPanel(s);
      if (g) {
        const home = g.h === s.user;
        const opp = FB.TeamByAbbr[home ? g.a : g.h];
        next = `
          <div class="muted">${Season.ROUNDS[s.playoffs.round]}</div>
          <h3>${home ? 'vs' : 'at'} ${opp.fullName}</h3>
          <button class="btn" id="playoff" data-focus>Play Game</button>
          <button class="btn" id="simoff">Simulate Game</button>`;
      } else {
        const stillIn = s.playoffs.alive[conf].indexOf(s.user) >= 0;
        const qualified = s.playoffs.seeds[conf].indexOf(s.user) >= 0;
        const heading = stillIn ? 'First-round bye' : qualified ? 'Your season is over' : 'You missed the playoffs';
        next = `
          <div class="muted">${Season.ROUNDS[s.playoffs.round]}</div>
          <h3>${heading}</h3>
          <button class="btn" id="round" data-focus>${stillIn ? 'Next Round' : 'Watch Results'}</button>`;
      }
    } else {
      const champ = FB.TeamByAbbr[s.playoffs.champion];
      center = playoffPanel(s);
      next = `
        <div class="muted">Season complete</div>
        <h3>${champ.fullName} win the Super Bowl${champ.abbr === s.user ? '. That\'s you!' : ''}</h3>
        <button class="btn" id="fresh" data-focus>Start a New Season</button>`;
    }

    show(`
      <div class="hub">
        <header>
          <h2>${T.fullName} <span class="muted">${recordOf(s, s.user)}</span></h2>
          <button class="btn" id="menu">Main Menu</button>
        </header>
        <div class="card next">${next}</div>
        ${center}
        <div class="card scroll"><table class="standings"><tr><th></th><th>W-L</th><th>PF</th><th>PA</th></tr>${standingsTable(s, conf)}</table></div>
      </div>`);

    const advance = (fn) => {
      fn();
      Season.save(s);
      hub();
    };
    on('#menu', title);
    on('#play', () => playSeasonGame(Season.userGame(s), Season.recordUserGame));
    on('#playoff', () => playSeasonGame(Season.userPlayoffGame(s), Season.recordUserPlayoffGame));
    on('#sim', () => advance(() => Season.finishWeek(s)));
    on('#bye', () => advance(() => Season.finishWeek(s)));
    on('#simoff', () => advance(() => Season.finishRound(s)));
    on('#round', () => advance(() => Season.finishRound(s)));
    on('#fresh', () => {
      Season.clear();
      App.season = null;
      title();
    });
  }

  // ---- Main loop --------------------------------------------------------

  let last = 0;
  let spare = 0;

  function frame(time) {
    const dt = Math.min(0.05, (time - last) / 1000 || 0);
    last = time;
    const m = App.match;
    if (m) {
      if (!App.paused && m.phase !== 'final' && !menuOpen()) {
        spare += dt;
        let steps = 0;
        while (spare >= STEP && steps < 6) {
          m.update(STEP, readInput());
          spare -= STEP;
          steps++;
        }
        if (steps === 6) spare = 0;
        m.events.splice(0).forEach((e) => {
          renderer.onEvent(e);
          sound.onEvent(e);
          if (e.type === 'final') {
            hideOverlay();
            if (App.onGameOver) App.onGameOver();
          }
        });
        syncOverlay();
      }
      renderer.draw(m, App.paused ? 0 : dt);
    }
    requestAnimationFrame(frame);
  }

  window.addEventListener('resize', fit);
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', () => held.clear());
  window.addEventListener('mousedown', () => sound.unlock());

  window.App = App;
  loadSettings();
  fit();
  title();
  requestAnimationFrame(frame);
})();
