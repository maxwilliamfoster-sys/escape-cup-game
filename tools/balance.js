// Balance harness: served temporarily as docs/_balance.js and injected into the game
// page. Plays matches headlessly with a bot "player" and reports win rate and match
// length per difficulty level d (d = (cup-1)*5 + round).
// Policies:
//   idle    - never touches anything (what does the physics alone give you?)
//   casual  - slow reactions (0.4s), slow drags, sloppy kicks
//   decent  - 0.22s reactions, quicker drags, kicks when the gap is close
// Both active bots have a FINGER BUDGET: one swipe turns the rings at most
// ~1.3 rad (a screen width), then the finger needs ~0.25s to re-grab, like a human.
window.runBalance = function (policy = "decent", perLevel = 60, levels = [0, 1, 2, 4, 6, 9, 12]) {
  const saved = JSON.parse(JSON.stringify(save));
  const cfg = { casual: { react: 0.4, rot: 2.6, kickWin: 0.45, noise: 0.5 },
                decent: { react: 0.22, rot: 4.2, kickWin: 0.7, noise: 0.2 } }[policy];
  const out = [];
  for (const d of levels) {
    const durs = [], wins = [], margin = [];
    for (let n = 0; n < perLevel; n++) {
      save.cup = Math.floor(d / 5) + 1; save.round = d % 5; save.kick = 0; save.recharge = 0;
      newMatch(); G.state = "play"; releaseBalls();
      let think = 0, rotSpeed = 0, swipe = 0, regrab = 0;
      while (G.state === "play" && G.t < 90) {
        if (cfg) {
          think -= STEP; regrab -= STEP;
          if (think <= 0) {
            think = cfg.react;
            const p = G.balls[0], ring = G.rings[G.current];
            const gap = ring.angle + G.rot, ball = Math.atan2(p.y, p.x);
            const diff = wrap(ball - gap);
            rotSpeed = clamp(diff * 4, -cfg.rot, cfg.rot);
            if (Math.abs(diff) < cfg.kickWin && p.kickCd <= 0) {
              const a = gap + (Math.random() - 0.5) * 2 * cfg.noise;
              kick(p, Math.cos(a) * (ring.r + 30), Math.sin(a) * (ring.r + 30));
            }
          }
          if (regrab > 0) rotSpeed = 0;
          swipe += Math.abs(rotSpeed) * STEP;
          if (swipe > 1.3) { swipe = 0; regrab = 0.25; }
        }
        aiThink(STEP);
        physicsStep(STEP, (cfg ? rotSpeed : 0) * STEP, cfg ? rotSpeed : 0);
      }
      durs.push(G.t); wins.push(G.winner === 0 ? 1 : 0); margin.push(G.balls[0].breaks - G.balls[1].breaks);
    }
    durs.sort((a, b) => a - b);
    const q = (p) => +durs[Math.floor(p * (durs.length - 1))].toFixed(1);
    out.push({ d, rings: G.rings.length, win: +(wins.reduce((a, b) => a + b, 0) / wins.length).toFixed(2),
               p10: q(0.1), med: q(0.5), p90: q(0.9), timeouts: durs.filter(x => x >= 90).length });
  }
  Object.assign(save, saved); persist(); newMatch(); G.state = "ready";
  return out;
};
