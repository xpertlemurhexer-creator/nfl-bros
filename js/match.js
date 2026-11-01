// Runs one game from coin toss to final whistle: whose turn it is, which
// screen comes next, and what gets announced. It needs no browser window,
// so whole games can be run at full speed in tests.
(function () {
  const FB = (window.FB = window.FB || {});
  const { clamp } = FB.U;
  const R = FB.Rules;
  const Sim = FB.Sim;

  FB.DIFFICULTY = {
    easy: { speed: 0.95, tackle: -0.1, qb: -0.12, react: 0.8 },
    normal: { speed: 1, tackle: 0, qb: 0, react: 1 },
    hard: { speed: 1.03, tackle: 0.06, qb: 0.1, react: 1.25 },
  };

  const NO_INPUT = { x: 0, y: 0, action: false, switched: false, dirEdge: null };
  const triangle = (x) => 1 - Math.abs((x % 2) - 1);

  // Any given Sunday: each side of the ball runs a little hot or cold.
  function gameDayForm(T, rand) {
    const offense = FB.U.gauss(rand) * 4;
    const defense = FB.U.gauss(rand) * 4;
    const adjusted = Object.assign({}, T);
    ['qb', 'wr', 'rb', 'ol'].forEach((k) => (adjusted[k] = T[k] + offense));
    ['rush', 'runD', 'cover'].forEach((k) => (adjusted[k] = T[k] + defense));
    return adjusted;
  }

  class Match {
    // teams: [team0, team1]. user: 0, 1, or null for a computer-only game.
    constructor(o) {
      this.teams = o.teams;
      this.user = o.user === undefined ? null : o.user;
      this.rand = o.rand || Math.random;
      this.diff = FB.DIFFICULTY[o.difficulty || 'normal'];
      this.g = R.newGame({ quarterLength: o.quarterLength });
      this.rosters = [0, 1].map((i) =>
        FB.buildRoster(gameDayForm(o.teams[i], this.rand), this.user !== null && i !== this.user ? this.diff : null, this.rand));
      this.events = [];
      this.sim = null;
      this.kick = null;
      this.banner = null;
      this.menu = null;
      this.after = null;
      this.pendingDefense = null;
      this.pendingOffense = null;

      const kicker = this.rand() < 0.5 ? 0 : 1;
      this.g.kicker = kicker;
      this.g.openingKicker = kicker;
      this.phase = 'intro';
      this.timer = 2.6;
      this.say(`${this.teams[R.other(kicker)].abbr} WINS THE TOSS`, 'They will receive the opening kickoff', 2.4);
    }

    emit(type, data) {
      this.events.push(Object.assign({ type }, data));
    }

    say(text, sub, life, team) {
      this.banner = { text, sub: sub || '', life: life || 1.7, t: 0, team: team === undefined ? null : team };
    }

    reactFor(team) {
      return this.user !== null && team !== this.user ? this.diff.react : 1;
    }

    isUser(team) {
      return this.user === team;
    }

    update(dt, input) {
      input = input || NO_INPUT;
      if (this.banner) {
        this.banner.t += dt;
        if (this.banner.t >= this.banner.life) this.banner = null;
      }
      switch (this.phase) {
        case 'intro':
        case 'break':
          this.timer -= dt;
          if (this.timer <= 0 || (input.action && this.timer < 2)) this.resume();
          break;
        case 'kickwait':
          this.timer -= dt;
          if (this.timer <= 0) this.cpuKick();
          break;
        case 'kickmeter':
          this.updateMeter(dt, input);
          break;
        case 'playcall':
          if (!this.menu) this.startPlay();
          break;
        case 'presnap':
          this.updatePresnap(dt, input);
          break;
        case 'live':
          this.sim.step(dt, input);
          if (this.sim.over && this.sim.overT >= 0.25) this.endPlay();
          break;
        case 'dead':
          this.sim.step(dt, NO_INPUT);
          this.timer -= dt;
          if (this.timer <= 0 || (input.action && this.timer < this.deadTime - 0.5)) this.advance();
          break;
      }
    }

    // ---- Kickoffs -------------------------------------------------------

    startKickoff() {
      this.g.mode = 'kickoff';
      this.g.ballY = R.FIELD_WIDTH / 2;
      this.sim = Sim.kickoff(this);
      this.beginKick('kickoff', this.g.kicker);
    }

    beginKick(kind, team) {
      if (this.isUser(team)) {
        this.kick = {
          kind, stage: 0, t: 0, power: 0, accuracy: 0, aim: 0,
          wind: kind === 'fg' || kind === 'xp' ? (this.rand() - 0.5) * 4 : 0,
        };
        this.phase = 'kickmeter';
      } else {
        this.kick = { kind, wind: kind === 'fg' || kind === 'xp' ? (this.rand() - 0.5) * 4 : 0 };
        this.phase = 'kickwait';
        this.timer = 1.1;
      }
    }

    updateMeter(dt, input) {
      const k = this.kick;
      k.t += dt;
      k.aim = clamp(k.aim + (input.y || input.x) * dt * 0.8, -1, 1);
      if (k.stage === 0) {
        k.power = triangle(k.t * 0.85);
        if (input.action) {
          k.stage = 1;
          k.t = 0;
        }
      } else {
        k.accuracy = triangle(k.t * 1.5) * 2 - 1;
        if (input.action) this.fireKick(k.power, k.accuracy, k.aim);
      }
    }

    cpuKick() {
      const d = FB.AI.kickDecision(this, this.kick.kind, this.kick.wind);
      this.fireKick(d.power, d.accuracy, d.aim);
    }

    fireKick(power, accuracy, aim) {
      const k = this.kick;
      if (k.kind === 'fg' || k.kind === 'xp') this.sim.launchFieldGoal(power, accuracy, aim, k.wind);
      else this.sim.launchKick(power, accuracy, aim);
      this.phase = 'live';
    }

    // ---- Calling plays --------------------------------------------------

    offenseChoices() {
      const g = this.g;
      if (g.mode !== 'normal') return FB.Plays.conversionOffense;
      const halfEnding = (g.quarter === 2 || g.quarter >= 4) && g.clock <= 30;
      return FB.Plays.offense.filter((p) => {
        if (p.type === 'punt') return g.down === 4;
        if (p.type === 'fg') return g.down === 4 || halfEnding;
        return true;
      });
    }

    startPlaycall() {
      const g = this.g;
      if (this.isUser(g.pos)) {
        this.menu = { side: 'offense', plays: this.offenseChoices() };
        this.pendingDefense = FB.AI.callDefense(this);
      } else if (this.isUser(R.other(g.pos))) {
        this.menu = { side: 'defense', plays: FB.Plays.defense };
        this.pendingOffense = FB.AI.callOffense(this);
      } else {
        this.menu = null;
        this.pendingOffense = FB.AI.callOffense(this);
        this.pendingDefense = FB.AI.callDefense(this);
      }
      this.phase = 'playcall';
    }

    choosePlay(id) {
      if (!this.menu) return;
      if (this.menu.side === 'offense') this.pendingOffense = id;
      else this.pendingDefense = id;
      this.menu = null;
    }

    startPlay() {
      const play = FB.Plays.byId[this.pendingOffense];
      const g = this.g;
      if (play.type === 'punt') {
        g.mode = 'punt';
        this.sim = Sim.punt(this);
        this.beginKick('punt', g.pos);
      } else if (play.type === 'fg') {
        this.sim = Sim.fieldGoal(this, 'fg');
        this.beginKick('fg', g.pos);
      } else {
        this.sim = Sim.scrimmage(this, play, FB.Plays.byId[this.pendingDefense]);
        this.phase = 'presnap';
        this.timer = this.isUser(g.pos) ? 12 : 1.3 + this.rand() * 0.9;
      }
    }

    updatePresnap(dt, input) {
      this.timer -= dt;
      const youHaveBall = this.isUser(this.g.pos);
      if (!youHaveBall && input.switched && this.sim.control) this.sim.cycleDefender();
      if (this.timer <= 0 || (youHaveBall && input.action)) {
        this.sim.snap();
        this.phase = 'live';
      }
    }

    // ---- Conversions ----------------------------------------------------

    startConversion() {
      this.g.ballY = R.FIELD_WIDTH / 2;
      if (this.isUser(this.g.pos)) {
        this.phase = 'patchoice';
      } else {
        this.chooseConversion(FB.AI.chooseConversion(this));
      }
    }

    chooseConversion(choice) {
      R.chooseConversion(this.g, choice);
      if (choice === 'two') {
        this.say('GOING FOR TWO', '', 1.4);
        this.startPlaycall();
      } else {
        this.sim = Sim.fieldGoal(this, 'xp');
        this.beginKick('xp', this.g.pos);
      }
    }

    // ---- After the whistle ----------------------------------------------

    endPlay() {
      const s = this.sim;
      const res = s.result;
      const g = this.g;
      this.recordStats(s, res);

      const sameTeam = res.type === 'down' && !s.intercepted && !s.fumbleLost && s.kind === 'scrimmage';
      const outcome = R.applyResult(g, res);
      if (res.y !== undefined) g.ballY = clamp(res.y, 18, R.FIELD_WIDTH - 18);
      else if (res.type !== 'incomplete') g.ballY = R.FIELD_WIDTH / 2;

      if (sameTeam && !res.oob && outcome.notes.indexOf('downs') < 0) R.tick(g, R.RUNOFF);
      if (res.type === 'fg') R.tick(g, 3);

      this.announce(s, res, outcome);
      this.after = outcome;
      this.phase = 'dead';
      this.deadTime = res.type === 'td' ? 3 : 1.5;
      this.timer = this.deadTime;
    }

    recordStats(s, res) {
      const g = this.g;
      if (s.kind !== 'scrimmage' || g.mode === 'two') return;
      const st = g.stats[s.offTeam];
      st.plays++;
      let gain = 0;
      if (res.type === 'down' && res.team === s.offTeam) gain = res.yard - s.startYard;
      if (res.type === 'td' && res.team === s.offTeam) gain = 100 - s.startYard;
      if (s.completed) st.pass += gain;
      else st.rush += gain;
      if (s.sacked) g.stats[s.defTeam].sacks++;
      s.gain = gain;
    }

    announce(s, res, outcome) {
      const notes = outcome.notes;
      const has = (n) => notes.indexOf(n) >= 0;
      const name = (p) => (p ? FB.playerName(p) : '');
      const big = s.gain >= 20 && s.carrier ? `${name(s.carrier)} for ${Math.round(s.gain)} yards!` : '';

      if (has('td')) this.say('TOUCHDOWN!', `${name(s.scorer)} scores for the ${this.teams[res.team].name}`, 2.8, res.team);
      else if (has('fg-good')) this.say("IT'S GOOD!", `${this.teams[this.g.pos].name} add three`, 2);
      else if (has('fg-miss')) this.say('NO GOOD', 'The kick is off target', 1.8);
      else if (has('conversion-good')) this.say(outcome.points === 2 ? 'TWO POINTS!' : 'EXTRA POINT GOOD', '', 1.5);
      else if (has('conversion-failed')) this.say('NO GOOD', 'The try fails', 1.5);
      else if (has('safety')) this.say('SAFETY!', 'Two points', 2.2, res.team);
      else if (s.intercepted) this.say('INTERCEPTED!', name(s.carrier), 1.9);
      else if (s.fumbleLost) this.say('FUMBLE LOST!', `Recovered by ${name(s.carrier)}`, 1.9);
      else if (s.sacked) this.say('SACK!', name(s.sackBy), 1.5);
      else if (has('downs')) this.say('TURNOVER ON DOWNS', '', 1.8);
      else if (res.type === 'incomplete') this.say('INCOMPLETE', '', 1.2);
      else if (has('touchback')) this.say('TOUCHBACK', '', 1.2);
      else if (has('first')) this.say('FIRST DOWN!', big, 1.4);
      else if (big) this.say('BIG GAIN!', big, 1.5);
    }

    advance() {
      const g = this.g;
      if (g.over) return this.toFinal();
      if (this.after.next === 'pat') return this.startConversion();

      const change = R.endPeriodIfNeeded(g, this.rand() < 0.5);
      if (g.over) return this.toFinal();
      if (change === 'halftime') {
        this.say('HALFTIME', `${this.teams[0].abbr} ${g.score[0]}  ${this.teams[1].abbr} ${g.score[1]}`, 3);
        this.phase = 'break';
        this.timer = 3.2;
        return;
      }
      if (change === 'overtime') {
        this.say('OVERTIME', 'First team to score wins', 3);
        this.phase = 'break';
        this.timer = 3.2;
        return;
      }
      if (change === 'quarter') this.say(`END OF Q${g.quarter - 1}`, '', 1.4);
      this.resume();
    }

    resume() {
      if (this.g.mode === 'kickoff') this.startKickoff();
      else this.startPlaycall();
    }

    toFinal() {
      this.phase = 'final';
      this.emit('final');
    }
  }

  FB.Match = Match;
})();
