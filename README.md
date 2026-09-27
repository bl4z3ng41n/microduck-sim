# microduck.sim

A static SvelteKit 3 (release candidate) site about the Pollen Robotics / Hugging Face **Microduck** robot:
what it is, how it is simulated, how to run the simulators locally, and a live in-browser simulation
that runs the real trained ONNX policies on MuJoCo compiled to WebAssembly.

## Run

```sh
npm install
npm run dev -- --open   # http://localhost:5173
npm run build           # static output in build/
npm run preview         # serve build/
```

Node.js 22.12 or newer.

## Layout

| Path | Purpose |
|------|---------|
| `src/routes/` | Pages: overview (`/`), `/simulate`, `/run-locally`, `/bom` (BOM with 3D part highlighter), `/printables` (community STL comparison), `/build` (build plan, Moonraker printer panel, shopping list), `/sim` |
| `src/lib/sim/engine.ts` | Boot, 50 Hz control loop, policy scheduler, fall recovery, legs ↔ rollers switch, pen prop, 2D fallback view |
| `src/lib/sim/bam.ts` | BAM XL330 "m6" actuator model applied at every physics step |
| `src/lib/sim/mjcf.ts` | Rewrites `robot_allcollisions.xml` for the browser (motors, floor, keyframe) |
| `src/lib/sim/rig.ts` | three.js rig from `kinematics.json` + `microduck.glb` |
| `src/lib/sim/viewer.ts`, `compare.ts` | BOM part highlighter and community-STL comparison viewers |
| `src/lib/data/` | Generated: mesh instances per body, community-vs-upstream-vs-sim mesh statistics; hand-written build plan and shopping list |
| `src/lib/printer/moonraker.ts` | Browser client for Klipper/Moonraker printers (status websocket, upload, start/pause/cancel) |
| `src/lib/components/DuckSim.svelte` | Canvas, HUD, keyboard and touch controls |
| `static/sim/` | `mujoco.js`, `mujoco.wasm`, robot MJCF (legs + rollers), meshes, GLB, 8 ONNX policies |
| `static/ort/` | ONNX Runtime Web wasm sidecars |
| `scripts/fetch-assets.sh` | Re-download assets from the official Hugging Face Space |

## Live sim controls

Arrows / WASD move, `R` sit, `G` ground pick, `B` place / drop pen, `Q`/`E` kicks, `X` roulade, `M` legs ↔ rollers,
`P` push, `C` chase camera, `Space` reset. Without WebGL the view falls back to a 2D side view; physics is unchanged.

## Credits

Robot model, meshes and policies: [pollen-robotics/microduck](https://github.com/pollen-robotics/microduck),
[pollen-robotics/microduck_rl](https://github.com/pollen-robotics/microduck_rl) and the
[Microduck Sandbox](https://huggingface.co/spaces/pollen-robotics/microduck-simulator) (Apache-2.0; 3D models CC BY-NC-SA).
The simulation core is a TypeScript port of the sandbox's `app/src/game/` modules.
