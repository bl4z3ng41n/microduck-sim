<script lang="ts">
	import { resolve } from '$app/paths';
	import Code from '#lib/components/Code.svelte';
	import Callout from '#lib/components/Callout.svelte';
</script>

<svelte:head>
	<title>Run Microduck locally — browser sandbox, this site, duck-sim, microduck_rl</title>
	<meta name="description" content="Step-by-step commands to run the Microduck simulator locally: the official browser sandbox, this SvelteKit site, the scripts/duck-sim digital twin, and the microduck_rl training stack." />
</svelte:head>

<div class="wrap">
	<section class="top">
		<div class="eyebrow">Guide</div>
		<h1>Run it locally</h1>
		<p class="lead">
			Four setups, from zero-install to full training. Pick the one that matches what you want to do.
			Commands are copied from the official repositories as of September 2026.
		</p>
		<div class="jump">
			<a class="btn" href="#site">A · This site</a>
			<a class="btn" href="#sandbox">B · Official sandbox</a>
			<a class="btn" href="#twin">C · Digital twin</a>
			<a class="btn" href="#rl">D · Training</a>
			<a class="btn" href="#trouble">Troubleshooting</a>
		</div>
	</section>

	<section id="site">
		<h2>A · This site (SvelteKit 3 + live sim)</h2>
		<p>Static SvelteKit 3 site. The <a href={resolve('/sim')}>live sim</a> ships its own copy of MuJoCo WebAssembly, ONNX Runtime Web and the robot assets, so it works offline once built.</p>
		<ol class="steps">
			<li>
				<h4>Prerequisites</h4>
				<p>Node.js 22.12 or newer (Vite 8 requirement) and npm. <code>curl</code> if you want to refresh the assets.</p>
			</li>
			<li>
				<h4>Install and start the dev server</h4>
				<Code code={`cd microduck
npm install
npm run dev -- --open      # http://localhost:5173`} />
			</li>
			<li>
				<h4>Build the static site and preview it</h4>
				<Code code={`npm run build              # prerenders every page into build/
npm run preview            # serves build/ on http://localhost:4173`} />
				<p>Deploy <code>build/</code> to any static host. No server code, no headers required.</p>
			</li>
			<li>
				<h4>Refresh the simulation assets (optional)</h4>
				<p>Policies, MJCF, kinematics, GLB and collision meshes live in <code>static/sim/</code>; the wasm sidecars in <code>static/sim/</code> and <code>static/ort/</code>. Re-download them from the official Space and copy the runtimes from <code>node_modules</code>:</p>
				<Code code={`./scripts/fetch-assets.sh`} />
			</li>
		</ol>
		<div class="table-wrap">
			<table>
				<thead><tr><th>Path</th><th>Purpose</th></tr></thead>
				<tbody>
					<tr><td><code>src/lib/sim/engine.ts</code></td><td>Boot, MJCF preparation, 50 Hz control loop, policy scheduler, fall recovery</td></tr>
					<tr><td><code>src/lib/sim/bam.ts</code></td><td>BAM XL330 m6 actuator model applied at every physics step</td></tr>
					<tr><td><code>src/lib/sim/rig.ts</code></td><td>three.js rig built from <code>kinematics.json</code> + <code>microduck.glb</code></td></tr>
					<tr><td><code>src/lib/components/DuckSim.svelte</code></td><td>Canvas, HUD, keyboard and touch controls</td></tr>
					<tr><td><code>static/sim/</code>, <code>static/ort/</code></td><td>MJCF, meshes, ONNX policies, <code>mujoco.js</code> + <code>mujoco.wasm</code>, ONNX Runtime wasm</td></tr>
				</tbody>
			</table>
		</div>
	</section>

	<section id="sandbox">
		<h2>B · The official browser sandbox</h2>
		<p>The Hugging Face Space is a Vite + React app with all features: two locomotion variants (legs and rollers), whole-body-control motion tracking, scenes, multiplayer ghosts, gamepad.</p>
		<ol class="steps">
			<li>
				<h4>Prerequisites</h4>
				<p>Git, <strong>Git LFS</strong> (the meshes, policies and audio are LFS objects), Node.js 22.12 or newer.</p>
			</li>
			<li>
				<h4>Clone the Space and pull LFS files</h4>
				<Code code={`git clone https://huggingface.co/spaces/pollen-robotics/microduck-simulator
cd microduck-simulator
git lfs install --local
git lfs pull`} />
				<p class="small muted">The source is also mirrored at <a href="https://github.com/micro-zoo/microduck-simulator" rel="noopener">github.com/micro-zoo/microduck-simulator</a>; LFS works there too.</p>
			</li>
			<li>
				<h4>Install and run</h4>
				<Code code={`cd app
npm ci
npm run dev        # http://localhost:5173
npm run build      # production bundle in app/dist/`} />
				<p>MuJoCo and ONNX Runtime are loaded from the jsDelivr CDN at runtime in this app, so it needs internet on first load.</p>
			</li>
			<li>
				<h4>Or run the production container</h4>
				<Code code={`docker build -t microduck-sim .
docker run --rm -p 8080:8080 microduck-sim     # nginx-unprivileged on :8080`} />
			</li>
		</ol>
		<h3>Controls</h3>
		<div class="table-wrap">
			<table>
				<thead><tr><th>Keyboard</th><th>Gamepad</th><th>Action</th></tr></thead>
				<tbody>
					<tr><td>Arrows / <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> (ZQSD on AZERTY)</td><td>Left stick</td><td>Forward / back, turn</td></tr>
					<tr><td><kbd>R</kbd></td><td>D-pad down</td><td>Sit / stand</td></tr>
					<tr><td><kbd>G</kbd></td><td>A</td><td>Ground pick</td></tr>
					<tr><td><kbd>Q</kbd> / <kbd>E</kbd></td><td>LB / RB</td><td>Kick left / right</td></tr>
					<tr><td><kbd>X</kbd></td><td>X</td><td>Roulade</td></tr>
					<tr><td><kbd>M</kbd></td><td>Hold D-pad up ~1 s</td><td>Switch legs ↔ rollers</td></tr>
					<tr><td><kbd>C</kbd></td><td>R3</td><td>Chase camera toggle</td></tr>
					<tr><td><kbd>Space</kbd></td><td>—</td><td>Reset</td></tr>
					<tr><td>—</td><td>Right trigger</td><td>Open beak, quack</td></tr>
				</tbody>
			</table>
		</div>
		<p class="small muted">Add <code>?boot=1</code> to the URL to skip the intro and watch the loader; a boot failure stops on a <code>SYSTEM HALTED</code> screen with the error.</p>
	</section>

	<section id="twin">
		<h2>C · The digital twin: <code>scripts/duck-sim</code></h2>
		<p>Runs the real robot daemons on your machine against a MuJoCo body. Same binaries, same 50 Hz loop, same IPC; only the physics driver differs.</p>
		<ol class="steps">
			<li>
				<h4>Prerequisites</h4>
				<ul>
					<li>Rust <strong>1.89+</strong> (stable).</li>
					<li>Linux build deps: <code>libudev</code> (for the gamepad daemon) and GStreamer (for the camera daemon). macOS needs nothing extra.</li>
					<li>A checkout of <code>microduck_rl</code> with its venv, next to the <code>microduck</code> repo (or point <code>DUCK_SIM_RL</code> at it). The MuJoCo body process comes from there.</li>
					<li>For container mode (<code>boot</code>): <code>sudo</code>, <code>systemd-nspawn</code>, <code>mmdebstrap</code>.</li>
				</ul>
				<Code code={`# Debian / Ubuntu
sudo apt-get install -y libudev-dev libgstreamer1.0-dev \\
  libgstreamer-plugins-base1.0-dev libgstreamer-plugins-bad1.0-dev`} />
			</li>
			<li>
				<h4>Build the robot workspace</h4>
				<Code code={`git clone https://github.com/pollen-robotics/microduck
cd microduck
cargo build
cargo test --workspace      # no hardware needed`} />
			</li>
			<li>
				<h4>Set up the RL repo beside it (provides the MuJoCo body)</h4>
				<Code code={`cd ..
git clone https://github.com/pollen-robotics/microduck_rl
cd microduck_rl && uv sync         # ARM machines: UV_HTTP_TIMEOUT=600 uv sync
cd ../microduck
export DUCK_SIM_RL=$PWD/../microduck_rl   # default is ~/Pollen/microduck_rl`} />
			</li>
			<li>
				<h4>One duck in a MuJoCo window</h4>
				<Code code={`scripts/duck-sim                 # start MuJoCo + daemons
scripts/duck-sim status          # health check
scripts/duck-sim drive 0.15 0    # walk forward: vx vyaw
scripts/duck-sim ctl health      # any robotctl command
scripts/duck-sim monitor         # joints, IMU, ToF, inputs
scripts/duck-sim log             # robotd logs
scripts/duck-sim simlog          # MuJoCo logs
scripts/duck-sim realtime        # real-time factor (must stay > 1.0)
scripts/duck-sim down`} />
			</li>
			<li>
				<h4>Several ducks as machines you log into</h4>
				<Code code={`scripts/duck-sim boot 4          # four ducks, one systemd container each
scripts/duck-sim shell           # SSH into duck-a
scripts/duck-sim shell duck-c
DUCK_SIM_SCENE=apartment DUCK_SIM_CAMERAS=a scripts/duck-sim boot 2
scripts/duck-sim down`} />
			</li>
		</ol>
		<h3>Environment variables</h3>
		<div class="table-wrap">
			<table>
				<thead><tr><th>Variable</th><th>Default</th><th>Purpose</th></tr></thead>
				<tbody>
					<tr><td><code>DUCK_SIM_RL</code></td><td><code>~/Pollen/microduck_rl</code></td><td>Where the RL repo and its venv live</td></tr>
					<tr><td><code>DUCK_SIM_STATE</code></td><td><code>~/.cache/duck-sim</code></td><td>Sockets, logs, container rootfs</td></tr>
					<tr><td><code>DUCK_SIM_DUCKS</code></td><td><code>1</code></td><td>Number of ducks</td></tr>
					<tr><td><code>DUCK_SIM_SCENE</code></td><td>bare floor</td><td><code>apartment</code> or a path to a <code>scene_*.xml</code></td></tr>
					<tr><td><code>DUCK_SIM_CAMERAS</code></td><td>none</td><td><code>a</code>, <code>a,c</code> or <code>all</code> (about 12 ms per rendered frame)</td></tr>
					<tr><td><code>DUCK_SIM_KEYFRAME</code></td><td><code>SIT</code></td><td>Start pose: <code>HOME</code>, <code>STAND</code>, <code>FOLD</code></td></tr>
					<tr><td><code>DUCK_SIM_VIEWER</code></td><td><code>1</code></td><td><code>0</code> for headless</td></tr>
					<tr><td><code>DUCK_SIM_PORT</code></td><td><code>7801</code></td><td>First body port</td></tr>
					<tr><td><code>DUCK_SIM_FRAME_PORT</code></td><td><code>7901</code></td><td>First camera port</td></tr>
				</tbody>
			</table>
		</div>
		<h3>Manual launch (what the script does)</h3>
		<Code code={`# MuJoCo body, from the RL venv
duck-body --ducks 1 --port 7801 --keyframe SIT

# ToF daemon
target/debug/tofd --sim 127.0.0.1:7801 --socket /tmp/d/duck-a-tof.sock

# Control daemon
DUCK_RUNTIME_DIR=/tmp/d ORT_DYLIB_PATH=<libonnxruntime.so> \\
  target/debug/robotd --sim 127.0.0.1:7801 --params <params.toml> --socket /tmp/d/duck-a.sock

# Identity daemon
target/debug/configd --socket /tmp/d/duck-a-config.sock \\
  --state-dir /tmp/d/duck-a --simulated sim-duck-a --fake-net --fake-pads`} />
		<Callout kind="note">
			<p><code>--sim</code> runs physics; <code>--fake</code> is a no-op stub for tests. They are mutually exclusive. A simulated duck can log into Hugging Face (<code>scripts/duck-sim ctl account login</code>) and shows up in the robot list flagged "simulated", one duck per account.</p>
		</Callout>
	</section>

	<section id="rl">
		<h2>D · Training and inference: <code>microduck_rl</code></h2>
		<ol class="steps">
			<li>
				<h4>Install</h4>
				<p>Needs <a href="https://docs.astral.sh/uv/" rel="noopener">uv</a>. Training needs a CUDA GPU (MuJoCo Warp). Inference and tests run on CPU.</p>
				<Code code={`git clone https://github.com/pollen-robotics/microduck_rl
cd microduck_rl
uv sync
uv run list-envs                       # all registered tasks
uv run --with pytest pytest tests/     # CPU-only regression tests`} />
			</li>
			<li>
				<h4>Train</h4>
				<Code code={`uv run train Mjlab-Velocity-Flat-MicroDuck --env.scene.num-envs 4096
# resume
uv run train Mjlab-Velocity-Flat-MicroDuck --agent.load-checkpoint model_29999.pt --agent.resume True
# no GPU? run on Hugging Face Jobs
uv run train Mjlab-Velocity-Flat-MicroDuck --hf-jobs`} />
			</li>
			<li>
				<h4>Play in the viewer, export to ONNX</h4>
				<Code code={`uv run play Mjlab-Velocity-Flat-MicroDuck --wandb-run-path <entity/project/run_id>
uv run scripts/export.py Mjlab-Velocity-Flat-MicroDuck --wandb-run-path <entity/project/run_id>`} />
			</li>
			<li>
				<h4>Drive the ONNX on CPU with the keyboard</h4>
				<Code code={`uv run scripts/infer_policy.py --walking output.onnx --standing stand.onnx \\
  --sitstand sitstand.onnx --ground-pick pick.onnx --kick-left kl.onnx --kick-right kr.onnx --roulade roll.onnx`} />
				<p class="small">Keys: arrows for velocity, <kbd>A</kbd>/<kbd>E</kbd> turn, <kbd>Space</kbd> coast, <kbd>G</kbd> ground pick, <kbd>Y</kbd> sit, <kbd>K</kbd>/<kbd>L</kbd> kicks, <kbd>R</kbd> roulade, <kbd>P</kbd> random push, <kbd>B</kbd> body-pose mode, <kbd>H</kbd> head mode, <kbd>T</kbd> pause, <kbd>Q</kbd> quit.</p>
			</li>
			<li>
				<h4>Load it on a robot</h4>
				<Code code={`robotctl policy list
robotctl policy load walk /home/radxa/my_walking.onnx
robotctl policy reset walk`} />
			</li>
		</ol>
	</section>

	<section id="trouble">
		<h2>Troubleshooting</h2>
		<div class="grid">
			<div class="card">
				<h3>Browser: nothing loads</h3>
				<p>Check the Network tab for a blocked <code>.wasm</code> or <code>.onnx</code>. ONNX files must be ~790 KB; a 131-byte file is a Git LFS pointer, run <code>git lfs pull</code>. Chrome is faster than Firefox for the wasm build.</p>
			</div>
			<div class="card">
				<h3>Browser: "WebGL is unavailable"</h3>
				<p>IDE embedded browsers (VS Code Simple Browser) and some remote-desktop sessions have no WebGL. Open the page in Chrome, Edge or Firefox. Chrome: enable graphics acceleration or <code>chrome://flags/#ignore-gpu-blocklist</code>. Firefox: <code>about:config</code> → <code>webgl.disabled = false</code>. This site's live sim falls back to a 2D view; the official sandbox needs WebGL.</p>
			</div>
			<div class="card">
				<h3>Browser: keys do nothing</h3>
				<p>Click inside the canvas first. Try the arrow keys to rule out layout issues. Wait for one-shot actions (sit, pick, recovery) to finish.</p>
			</div>
			<div class="card">
				<h3>Browser: slow or jittery</h3>
				<p>Close other GPU-heavy tabs, keep the tab in the foreground. The policy rate is simulated time; the HUD shows the achieved control rate.</p>
			</div>
			<div class="card">
				<h3>duck-sim: unhealthy daemons</h3>
				<p>Run <code>scripts/duck-sim realtime</code>. Below 1.0× the health gate trips. Reduce duck count or disable cameras. Changing the duck count restarts MuJoCo; daemons reconnect.</p>
			</div>
			<div class="card">
				<h3>duck-sim: camera off Linux</h3>
				<p>Build <code>mediad</code> with GStreamer: <code>cargo build -p mediad --features gstreamer</code>. On macOS: <code>brew install gstreamer libnice-gstreamer</code>.</p>
			</div>
			<div class="card">
				<h3>microduck_rl: uv sync times out</h3>
				<p>On ARM machines set <code>UV_HTTP_TIMEOUT=600</code>. Training itself requires CUDA; use <code>--hf-jobs</code> otherwise.</p>
			</div>
		</div>
	</section>
</div>

<style>
	.top { padding-top: 3rem; }
	.jump { display: flex; flex-wrap: wrap; gap: 0.5rem; margin-top: 1rem; }
	.jump .btn { padding: 0.45rem 0.85rem; font-size: 0.88rem; }
</style>
