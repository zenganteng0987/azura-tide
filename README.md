# Azura Tide

[![make.fun · gta6-01](https://make.fun/badge/gta6-01.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![rank](https://make.fun/badge/gta6-01/zenganteng0987/azura-tide/rank.svg)](https://make.fun/bounty/gta6-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![reward](https://make.fun/badge/gta6-01/zenganteng0987/azura-tide/reward.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)

Azura Tide is an original open-world crime game set in Port Azura, a sun-soaked
coastal city of pastel towers, palm-lined avenues and a working marina. You are a
small-time runner with big debts and a borrowed name: explore the city on foot and
by car, take jobs from the people who run its docks and back streets, build your
cash and your reputation — and when a job goes loud, outrun the Port Azura Police
through the avenues you have learned by heart. The city is generated from a fixed
seed, so every player walks the same streets; a full day passes in four minutes,
from turquoise noon to an orange dusk over the bay.

The game is plain static files — one HTML page and a handful of ES modules, no
libraries, no build step, no network requests. Everything on screen is drawn with
canvas at runtime: the city, the water, the traffic and you.

## Controls

- **WASD / Arrow keys** — move (on foot) / steer and drive (in a car)
- **Shift** — sprint on foot
- **E** — talk to a contact / advance dialogue / enter / exit a car
- **Enter** — start or continue a game / advance dialogue / walk out of the Police HQ or the hospital
- **Mouse** — aim
- **Mouse click** — shoot (with the pistol) / swing (with fists)
- **Space** — punch (with fists)
- **Q** or **1 / 2** — switch weapon: fists / pistol
- **R** — reload the pistol
- **V** — sound on / off
- **N** — new game (on the title screen, when a save exists)
- **P** — pause
- **M** — toggle the minimap

## Story

You play Rafi, newly arrived in Port Azura with empty pockets and a name he
borrowed. Mira Solano, who runs the Marina Pier, gives him his first job; Old
Tomas at the Old Market Square and Vega at the Hillcrest Lookout have more.
Five story missions — a first run, a stolen taxi, a lesson in vanishing, a
timed courier route and one grand job — stand between Rafi and a life of his
own, and quick courier work around the city pays the rent in between. Your
progress is saved in the browser, so the story picks up where you left it.

## Run

Serve the game folder and open it in a desktop browser:

```
node serve.ts
```

then visit http://localhost:8080 — the title screen appears first; press Enter to
step into Port Azura.

## Entry plumbing

`main.ts` at the repository root is the make.fun entry program: it copies `game/`
and `screenshots/` to the output directory and writes `dossier.json` with the
vendored library in `vendor/`. Run it with:

```
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
```

## License

MIT — see the `LICENSE` file at the repository root.
