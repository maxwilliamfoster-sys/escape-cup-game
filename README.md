# Escape Cup

A versus ring-escape web game built for Poki. Your flag-ball and a rival nation's ball
bounce inside spinning rings, and a ring shatters when either ball gets through its gap.
Rings are worth 1 point and the final ring is worth 2. Win five matches to lift the cup.

**Play:** https://maxwilliamfoster-sys.github.io/escape-cup-game/

- **Drag** sideways to spin the rings.
- **Tap** to kick your ball towards where you tapped.
- **Keyboard:** arrow keys or A/D to spin, Space to kick.

## Layout
- `docs/`: the game itself (no build step). GitHub Pages serves this folder.
- `tools/build_flags.py`: bakes the flag PNGs from `../escape-cup` into `docs/flags.js`.
- `tools/balance.js`: headless bot-vs-AI balance harness.

The real Poki SDK only loads on Poki or with `?poki` in the URL. Everywhere else a
no-ad shim is used.
