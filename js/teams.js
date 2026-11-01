// All 32 NFL teams and how their real strengths become in-game ratings.
//
// Inputs, as of Nov 1 2026 (before that day's games):
//   fox, w, l, t, pf, pa  FOX preseason rank and ESPN standings. Update these weekly.
//   qb, qbName, qbRun     SI's Week 8 starter list. qb and qbRun are judgement calls.
//   up, down              One entry per source (ESPN, Bleacher Report) naming a unit
//                         as a team's strength or weakness.
//   stars                 Named on ESPN and Bleacher Report's preseason roster pieces.
//                         A third value of 0 means named only, with no ratings boost.
(function () {
  const FB = (window.FB = window.FB || {});

  const RAW = [
    ['BUF', 'Buffalo', 'Bills', 'AFC', 'East', '#00338D', '#C60C30', '#FFFFFF', 6, 5, 1, 0, 197, 171, 'Josh Allen', 96, 88, '', 'runD runD', 'Quarterback', 'Run defense', [['RB', 'James Cook III'], ['DT', 'Ed Oliver', 0], ['LB', 'Terrel Bernard', 0]]],
    ['MIA', 'Miami', 'Dolphins', 'AFC', 'East', '#008E97', '#FC4C02', '#FFFFFF', 31, 1, 5, 0, 98, 157, 'Malik Willis', 70, 84, 'rb rb', 'cover wr', 'Running back', 'Secondary and receivers', [['RB', "De'Von Achane"], ['EDGE', 'Chop Robinson'], ['CB', 'Chris Johnson']]],
    ['NE', 'New England', 'Patriots', 'AFC', 'East', '#002244', '#C60C30', '#B0B7BC', 5, 4, 3, 0, 160, 143, 'Drake Maye', 89, 80, 'cover', 'rush rush', 'Secondary', 'Pass rush', [['CB', 'Christian Gonzalez'], ['WR', 'A.J. Brown'], ['EDGE', 'Harold Landry III']]],
    ['NYJ', 'New York', 'Jets', 'AFC', 'East', '#125740', '#FFFFFF', '#125740', 30, 2, 5, 0, 137, 150, 'Geno Smith', 74, 60, 'runD wr', '', 'Linebackers and weapons', 'Quarterback', [['WR', 'Garrett Wilson'], ['RB', 'Breece Hall'], ['LB', 'Demario Davis']]],
    ['BAL', 'Baltimore', 'Ravens', 'AFC', 'North', '#241773', '#9E7C0C', '#241773', 3, 4, 3, 0, 169, 167, 'Lamar Jackson', 95, 97, 'cover', 'ol ol', 'Quarterback and safeties', 'Interior offensive line', [['S', 'Kyle Hamilton'], ['S', 'Malaki Starks'], ['S', 'Jaylinn Hawkins']]],
    ['CIN', 'Cincinnati', 'Bengals', 'AFC', 'North', '#FB4F14', '#000000', '#FB4F14', 10, 4, 2, 0, 163, 122, 'Joe Burrow', 93, 62, 'wr', 'rush runD', 'Quarterback and receivers', 'Edge rush and linebackers', [['WR', "Ja'Marr Chase"], ['WR', 'Tee Higgins'], ['DT', 'Dexter Lawrence II']]],
    ['CLE', 'Cleveland', 'Browns', 'AFC', 'North', '#311D00', '#FF3C00', '#FF3C00', 28, 5, 2, 0, 133, 146, 'Deshaun Watson', 68, 66, 'rush rush runD', '', 'Defensive front seven', 'Quarterback', [['EDGE', 'Jared Verse'], ['DT', 'Mason Graham'], ['LB', 'Carson Schwesinger']]],
    ['PIT', 'Pittsburgh', 'Steelers', 'AFC', 'North', '#101820', '#FFB612', '#FFB612', 24, 5, 2, 0, 153, 138, 'Aaron Rodgers', 78, 45, 'rush rush', 'runD cover', 'Pass rush', 'Linebackers and safety', [['EDGE', 'T.J. Watt'], ['EDGE', 'Alex Highsmith'], ['EDGE', 'Nick Herbig']]],
    ['HOU', 'Houston', 'Texans', 'AFC', 'South', '#03202F', '#A71930', '#03202F', 9, 2, 5, 0, 165, 170, 'C.J. Stroud', 82, 66, 'rush rush', 'ol ol', 'Pass rush', 'Offensive line', [['EDGE', 'Will Anderson Jr.'], ['EDGE', 'Danielle Hunter'], ['RB', 'David Montgomery']]],
    ['IND', 'Indianapolis', 'Colts', 'AFC', 'South', '#002C5F', '#A2AAAD', '#FFFFFF', 23, 2, 5, 0, 154, 180, 'Daniel Jones', 76, 72, 'rb rb', 'rush runD', 'Running back', 'Edge depth and linebackers', [['RB', 'Jonathan Taylor'], ['EDGE', 'Laiatu Latu'], ['EDGE', 'Arden Key', 0]]],
    ['JAX', 'Jacksonville', 'Jaguars', 'AFC', 'South', '#006778', '#D7A22A', '#101820', 11, 4, 2, 0, 154, 104, 'Trevor Lawrence', 84, 72, 'rush rush', 'rb rb', 'Edge rush', 'Running back', [['EDGE', 'Josh Hines-Allen'], ['EDGE', 'Travon Walker'], ['CB', 'Travis Hunter']]],
    ['TEN', 'Tennessee', 'Titans', 'AFC', 'South', '#0C2340', '#4B92DB', '#0C2340', 27, 1, 6, 0, 108, 156, 'Cam Ward', 73, 72, 'wr wr', 'cover ol', 'Wide receivers', 'Safety and offensive line', [['WR', 'Carnell Tate'], ['WR', "Wan'Dale Robinson"], ['WR', 'Calvin Ridley']]],
    ['KC', 'Kansas City', 'Chiefs', 'AFC', 'West', '#E31837', '#FFB81C', '#E31837', 13, 5, 1, 0, 143, 103, 'Patrick Mahomes', 97, 74, '', 'ol ol', 'Quarterback', 'Offensive tackle', [['RB', 'Kenneth Walker III'], ['OT', 'Josh Simmons', 0], ['OT', 'Jaylon Moore', 0]]],
    ['DEN', 'Denver', 'Broncos', 'AFC', 'West', '#FB4F14', '#002244', '#002244', 2, 5, 2, 0, 144, 141, 'Bo Nix', 84, 74, 'ol ol', 'runD wr', 'Offensive line', 'Linebacker depth and tight end', [['OT', 'Garett Bolles'], ['G', 'Quinn Meinerz'], ['WR', 'Jaylen Waddle']]],
    ['LV', 'Las Vegas', 'Raiders', 'AFC', 'West', '#000000', '#A5ACAF', '#A5ACAF', 29, 3, 4, 0, 183, 197, 'Kirk Cousins', 74, 42, 'wr wr', 'cover runD', 'Tight end', 'Cornerback and interior line', [['TE', 'Brock Bowers'], ['TE', 'Michael Mayer'], ['TE', 'Ian Thomas']]],
    ['LAC', 'Los Angeles', 'Chargers', 'AFC', 'West', '#0080C6', '#FFC20E', '#FFFFFF', 14, 0, 6, 0, 90, 151, 'Justin Herbert', 89, 66, 'ol', 'ol ol', 'Quarterback and tackles', 'Guards', [['OT', 'Rashawn Slater'], ['OT', 'Joe Alt'], ['EDGE', 'Khalil Mack']]],
    ['DAL', 'Dallas', 'Cowboys', 'NFC', 'East', '#041E42', '#869397', '#869397', 19, 3, 4, 0, 189, 180, 'Dak Prescott', 88, 58, 'wr wr', 'cover cover', 'Wide receivers', 'Cornerback', [['WR', 'CeeDee Lamb'], ['WR', 'George Pickens'], ['CB', 'DaRon Bland', 0]]],
    ['NYG', 'New York', 'Giants', 'NFC', 'East', '#0B2265', '#A71930', '#0B2265', 21, 4, 2, 1, 163, 161, 'J.J. McCarthy', 71, 66, 'rush rush', 'runD runD', 'Edge rush', 'Defensive tackle', [['EDGE', 'Brian Burns'], ['EDGE', 'Abdul Carter'], ['EDGE', 'Kayvon Thibodeaux']]],
    ['PHI', 'Philadelphia', 'Eagles', 'NFC', 'East', '#004C54', '#A5ACAF', '#004C54', 7, 2, 5, 0, 127, 175, 'Tanner McKee', 68, 48, 'ol ol', 'cover cover', 'Offensive line', 'Safety', [['OT', 'Lane Johnson'], ['OT', 'Jordan Mailata'], ['CB', 'Riq Woolen']]],
    ['WSH', 'Washington', 'Commanders', 'NFC', 'East', '#5A1414', '#FFB612', '#5A1414', 26, 1, 4, 1, 132, 172, 'Jayden Daniels', 88, 92, '', 'cover', 'Quarterback', 'Cornerback', [['EDGE', 'Odafe Oweh'], ['EDGE', "K'Lavon Chaisson"], ['LB', 'Sonny Styles']]],
    ['CHI', 'Chicago', 'Bears', 'NFC', 'North', '#0B162A', '#C83803', '#0B162A', 8, 5, 2, 0, 180, 143, 'Caleb Williams', 86, 78, 'wr ol', 'rush rush', 'Weapons and offensive line', 'Edge rush', [['EDGE', 'Montez Sweat'], ['G', 'Joe Thuney'], ['WR', 'Luther Burden III']]],
    ['DET', 'Detroit', 'Lions', 'NFC', 'North', '#0076B6', '#B0B7BC', '#B0B7BC', 15, 4, 2, 0, 184, 165, 'Jared Goff', 86, 44, 'wr wr', 'cover cover', 'Receivers and playmakers', 'Secondary', [['WR', 'Amon-Ra St. Brown'], ['RB', 'Jahmyr Gibbs'], ['WR', 'Jameson Williams']]],
    ['GB', 'Green Bay', 'Packers', 'NFC', 'North', '#203731', '#FFB612', '#FFB612', 16, 5, 3, 0, 171, 164, 'Jordan Love', 87, 62, 'rb cover', 'rush runD', 'Backfield and safety', 'Pass rush and interior line', [['EDGE', 'Micah Parsons'], ['RB', 'Josh Jacobs'], ['S', 'Xavier McKinney']]],
    ['MIN', 'Minnesota', 'Vikings', 'NFC', 'North', '#4F2683', '#FFC62F', '#4F2683', 17, 6, 0, 0, 125, 74, 'Kyler Murray', 85, 90, 'wr wr', 'rb rush', 'Pass catchers', 'Running back and defensive line', [['WR', 'Justin Jefferson'], ['WR', 'Jordan Addison'], ['TE', 'T.J. Hockenson']]],
    ['ATL', 'Atlanta', 'Falcons', 'NFC', 'South', '#A71930', '#000000', '#000000', 22, 3, 4, 0, 171, 173, 'Michael Penix Jr.', 75, 56, 'rb rb', '', 'Running back', 'Quarterback', [['RB', 'Bijan Robinson'], ['RB', 'Brian Robinson Jr.'], ['CB', 'Avieon Terrell']]],
    ['CAR', 'Carolina', 'Panthers', 'NFC', 'South', '#0085CA', '#101820', '#101820', 18, 3, 4, 0, 178, 193, 'Bryce Young', 77, 62, 'cover ol', 'wr rb', 'Cornerback and offensive line', 'Pass catchers and running back', [['CB', 'Jaycee Horn'], ['WR', 'Tetairoa McMillan'], ['EDGE', 'Jaelan Phillips']]],
    ['NO', 'New Orleans', 'Saints', 'NFC', 'South', '#101820', '#D3BC8D', '#D3BC8D', 25, 2, 5, 0, 162, 194, 'Tyler Shough', 74, 62, 'wr wr', 'cover cover', 'Wide receivers', 'Cornerback', [['WR', 'Chris Olave'], ['WR', 'Jordyn Tyson'], ['CB', 'Kool-Aid McKinstry']]],
    ['TB', 'Tampa Bay', 'Buccaneers', 'NFC', 'South', '#D50A0A', '#34302B', '#D50A0A', 20, 2, 5, 0, 162, 151, 'Baker Mayfield', 82, 62, 'rush runD', 'wr cover', 'Defensive line', 'Tight end and cornerback', [['DT', 'Vita Vea'], ['DT', 'Calijah Kancey'], ['DT', "A'Shawn Robinson"]]],
    ['SF', 'San Francisco', '49ers', 'NFC', 'West', '#AA0000', '#B3995D', '#B3995D', 12, 6, 1, 0, 197, 139, 'Brock Purdy', 87, 62, '', 'runD rush', 'Quarterback', 'Interior line and rush depth', [['EDGE', 'Nick Bosa'], ['EDGE', 'Mykel Williams'], ['WR', 'Mike Evans']]],
    ['SEA', 'Seattle', 'Seahawks', 'NFC', 'West', '#002244', '#69BE28', '#002244', 4, 4, 3, 0, 168, 125, 'Sam Darnold', 83, 58, 'runD rush', 'rb wr', 'Defensive line', 'Running back and receiver depth', [['DT', 'Leonard Williams'], ['DT', 'Byron Murphy II'], ['WR', 'Jaxon Smith-Njigba']]],
    ['LAR', 'Los Angeles', 'Rams', 'NFC', 'West', '#003594', '#FFA300', '#003594', 1, 3, 4, 0, 170, 159, 'Matthew Stafford', 90, 42, '', 'wr ol', 'Quarterback', 'Tight end and tackle depth', [['EDGE', 'Myles Garrett'], ['WR', 'Puka Nacua'], ['WR', 'Davante Adams']]],
    ['ARI', 'Arizona', 'Cardinals', 'NFC', 'West', '#97233F', '#FFB612', '#FFFFFF', 32, 2, 5, 0, 142, 208, 'Jacoby Brissett', 70, 52, 'wr wr', '', 'Receivers and tight end', 'Quarterback', [['TE', 'Trey McBride'], ['WR', 'Marvin Harrison Jr.'], ['WR', 'Michael Wilson']]],
  ];

  const STAND = { up: 6, down: -6 };
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  const totalGames = RAW.reduce((n, r) => n + r[9] + r[10] + r[11], 0);
  const leaguePts = RAW.reduce((n, r) => n + r[12], 0) / totalGames;

  function build(r) {
    const [abbr, city, name, conf, div, primary, secondary, helmet, fox, w, l, t, pf, pa, qbName, qb, qbRun, up, down, strength, weakness, stars] = r;
    const games = w + l + t;
    const pct = (w + t / 2) / games;
    const margin = (pf - pa) / games;

    // Half what experts expected, half what has actually happened.
    const expected = 88 - (fox - 1) * 0.75;
    const results = 76 + (pct - 0.5) * 22 + margin * 0.7;
    const base = (expected + results) / 2;
    const off = base + (pf / games - leaguePts) * 0.6;
    const def = base + (leaguePts - pa / games) * 0.6;

    const units = { wr: off, rb: off, ol: off, rush: def, runD: def, cover: def };
    up.split(' ').filter(Boolean).forEach((u) => (units[u] += STAND.up));
    down.split(' ').filter(Boolean).forEach((u) => (units[u] += STAND.down));
    Object.keys(units).forEach((u) => (units[u] = Math.round(clamp(units[u], 55, 99))));

    const offPower = qb * 0.4 + units.wr * 0.25 + units.rb * 0.15 + units.ol * 0.2;
    const defPower = units.rush * 0.35 + units.runD * 0.3 + units.cover * 0.35;

    return {
      abbr, city, name, conf, div, primary, secondary, helmet,
      fullName: city + ' ' + name,
      record: t ? `${w}-${l}-${t}` : `${w}-${l}`,
      qbName, qb, qbRun, strength, weakness, stars,
      ...units,
      offPower, defPower,
      ovr: Math.round((offPower + defPower) / 2),
    };
  }

  FB.Teams = RAW.map(build);
  FB.TeamByAbbr = {};
  FB.Teams.forEach((t) => (FB.TeamByAbbr[t.abbr] = t));
  FB.DIVISIONS = ['East', 'North', 'South', 'West'];
  FB.CONFERENCES = ['AFC', 'NFC'];
  FB.UNIT_LABELS = [
    ['qb', 'QB'], ['wr', 'Receivers'], ['rb', 'Running back'], ['ol', 'Off. line'],
    ['rush', 'Pass rush'], ['runD', 'Run defense'], ['cover', 'Coverage'],
  ];
})();
