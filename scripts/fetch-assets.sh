#!/usr/bin/env bash
# Re-download the simulation assets (MJCF, kinematics, GLB, collision STLs,
# ONNX policies) from the official Hugging Face Space into static/sim/.
# The Space stores binaries in Git LFS; the /resolve/ endpoint serves real bytes.
set -euo pipefail
cd "$(dirname "$0")/.."
BASE="https://huggingface.co/spaces/pollen-robotics/microduck-simulator/resolve/main/app/public"
mkdir -p static/sim/policies static/sim/robot/meshes

for p in BEST_alpha_walking BEST_alpha_stand BEST_alpha_sitstand alpha_ground_pick ball_kick_left ball_kick_right roulade BEST_roller; do
  curl -fsSL -o "static/sim/policies/$p.onnx" "$BASE/policies/$p.onnx" &
done
curl -fsSL -o static/sim/robot/robot_allcollisions.xml "$BASE/robot/mjlab/robot_allcollisions.xml" &
curl -fsSL -o static/sim/robot/kinematics.json "$BASE/robot/mjlab/kinematics.json" &
curl -fsSL -o static/sim/robot/robot_allcollisions_rollers.xml "$BASE/robot/mjlab/robot_allcollisions_rollers.xml" &
curl -fsSL -o static/sim/robot/kinematics_rollers.json "$BASE/robot/mjlab/kinematics_rollers.json" &
curl -fsSL -o static/sim/robot/microduck.glb "$BASE/robot/mjlab/microduck.glb" &
# Meshes referenced by collision geoms (visual geoms are stripped before compile).
for f in sole_left sole_right leg top_head_shell bottom_head_shell np_f970 hip_l power_support jaw tire rim roller_blade ankle_l_v1 ankle_r_v1; do
  curl -fsSL -o "static/sim/robot/meshes/$f.stl" "$BASE/robot/mjlab/meshes/$f.stl" &
done
wait

# Runtime sidecars from node_modules (run `npm install` first).
mkdir -p static/ort
cp node_modules/@mujoco/mujoco/mujoco.js node_modules/@mujoco/mujoco/mujoco.wasm static/sim/
cp node_modules/onnxruntime-web/dist/ort.wasm.min.mjs node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.mjs static/ort/
du -sh static/sim static/ort
