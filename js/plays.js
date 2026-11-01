// The playbook. Offsets are in yards: dx is downfield from the line of
// scrimmage, dy is across the field from the ball. Routes are measured from
// each player's own starting spot.
(function () {
  const FB = (window.FB = window.FB || {});

  const OFFENSE_SPOTS = {
    QB: [-3.5, 0], RB: [-6.5, 0],
    OL1: [-0.6, -1.8], OL2: [-0.6, 1.8], TE: [-0.6, 4.4],
    WR1: [-0.6, -15], WR2: [-0.6, 15],
  };

  const DEFENSE_SPOTS = {
    DL1: [1, -2.4], DL2: [1, 2.4],
    LB1: [5, -5.5], LB2: [5, 5.5],
    CB1: [6, -15], CB2: [6, 15],
    S: [13, 0],
  };

  const offense = [
    {
      id: 'dive', name: 'HB Dive', type: 'run', depth: 'run', carrier: 'RB',
      blurb: 'Straight up the middle',
      path: [[3.5, 0.6], [15, 0.6]],
    },
    {
      id: 'sweep', name: 'HB Sweep', type: 'run', depth: 'run', carrier: 'RB',
      blurb: 'Race to the outside',
      path: [[-0.5, 8], [2.5, 15], [18, 17]],
    },
    {
      id: 'keeper', name: 'QB Keeper', type: 'keeper', depth: 'run', carrier: 'QB',
      blurb: 'Quarterback keeps it. Best with a mobile QB',
      path: [[1, -2.5], [4, -4], [16, -7]],
      routes: { RB: [[1, 7], [3, 12]] },
    },
    {
      id: 'slants', name: 'Quick Slants', type: 'pass', depth: 'short',
      blurb: 'Fast throws over the middle',
      routes: {
        WR1: [[4, 0], [11, 8], [14, 13]],
        WR2: [[4, 0], [11, -8], [14, -13]],
        TE: [[3, 0], [5, -6]],
        RB: [[1, 5], [3, 10]],
      },
    },
    {
      id: 'curls', name: 'Curls', type: 'pass', depth: 'short',
      blurb: 'Receivers stop and come back',
      routes: {
        WR1: [[9, 0], [7.5, 1.5]],
        WR2: [[9, 0], [7.5, -1.5]],
        TE: [[7, 0], [6, -1.5]],
        RB: [[1, -6], [2, -11]],
      },
    },
    {
      id: 'screen', name: 'RB Screen', type: 'pass', depth: 'short', screen: true,
      blurb: 'Let the rush come, dump it to the back',
      routes: {
        RB: [[-1, 5], [0, 9], [1, 10]],
        WR1: [[16, 0]],
        WR2: [[12, 0]],
      },
    },
    {
      id: 'cross', name: 'Crossers', type: 'pass', depth: 'mid',
      blurb: 'Receivers run across the field',
      routes: {
        WR1: [[7, 0], [10, 14], [11, 30]],
        WR2: [[11, 0], [15, -14], [16, -30]],
        TE: [[12, 0], [18, -1]],
        RB: [[1, 6], [5, 10]],
      },
    },
    {
      id: 'deep', name: 'Deep Shot', type: 'pass', depth: 'deep',
      blurb: 'Go routes. Big gain or big risk',
      routes: {
        WR1: [[42, 0]],
        WR2: [[14, 0], [36, -10]],
        TE: [[10, 0], [18, 7]],
      },
    },
    { id: 'punt', name: 'Punt', type: 'punt', depth: 'kick', special: true, blurb: 'Kick it away' },
    { id: 'fg', name: 'Field Goal', type: 'fg', depth: 'kick', special: true, blurb: 'Three points' },
  ];

  const defense = [
    {
      id: 'man', name: 'Man Coverage', blurb: 'Everyone sticks to a receiver', user: 'LB2',
      assign: {
        DL1: { role: 'rush' }, DL2: { role: 'rush' },
        LB1: { role: 'man', on: 'RB' }, LB2: { role: 'man', on: 'TE' },
        CB1: { role: 'man', on: 'WR1' }, CB2: { role: 'man', on: 'WR2' },
        S: { role: 'zone', at: [17, 0] },
      },
    },
    {
      id: 'zone', name: 'Zone Coverage', blurb: 'Guard areas of the field', user: 'LB1',
      assign: {
        DL1: { role: 'rush' }, DL2: { role: 'rush' },
        LB1: { role: 'zone', at: [8, -8] }, LB2: { role: 'zone', at: [8, 8] },
        CB1: { role: 'zone', at: [15, -17] }, CB2: { role: 'zone', at: [15, 17] },
        S: { role: 'zone', at: [22, 0] },
      },
    },
    {
      id: 'blitz', name: 'Blitz', blurb: 'Send extra rushers at the QB', user: 'LB1',
      assign: {
        DL1: { role: 'rush' }, DL2: { role: 'rush' },
        LB1: { role: 'rush' }, LB2: { role: 'rush' },
        CB1: { role: 'man', on: 'WR1' }, CB2: { role: 'man', on: 'WR2' },
        S: { role: 'man', on: 'TE' },
      },
    },
    {
      id: 'runstop', name: 'Run Stop', blurb: 'Crowd the line, weak against deep passes', user: 'LB1',
      assign: {
        DL1: { role: 'rush' }, DL2: { role: 'rush' },
        LB1: { role: 'rush', delay: 0.5 }, LB2: { role: 'rush', delay: 0.5 },
        CB1: { role: 'man', on: 'WR1' }, CB2: { role: 'man', on: 'WR2' },
        S: { role: 'zone', at: [6, 0] },
      },
    },
  ];

  const byId = {};
  offense.concat(defense).forEach((p) => (byId[p.id] = p));

  FB.Plays = {
    offense,
    defense,
    byId,
    OFFENSE_SPOTS,
    DEFENSE_SPOTS,
    ELIGIBLE: ['WR1', 'WR2', 'TE', 'RB'],
    conversionOffense: offense.filter((p) => !p.special),
  };
})();
