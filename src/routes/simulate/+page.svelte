<script lang="ts">
	import { resolve } from '$app/paths';
	import Code from '#lib/components/Code.svelte';
	import Callout from '#lib/components/Callout.svelte';
</script>

<svelte:head>
	<title>How to simulate Microduck — browser, digital twin, training</title>
	<meta name="description" content="The three ways to simulate Microduck: MuJoCo WebAssembly in the browser, the duck-sim digital twin, and mjlab training in microduck_rl. Control loop, observation and actuator model explained." />
</svelte:head>

<div class="wrap">
	<section class="top">
		<div class="eyebrow">Guide</div>
		<h1>How to simulate Microduck</h1>
		<p class="lead">
			Every Microduck simulator is the same idea: MuJoCo steps the robot's MJCF model with a 5 ms timestep,
			and every 4 steps (50 Hz) a trained ONNX policy reads a 61-value observation and writes 14 joint targets.
			What changes is <em>where</em> MuJoCo runs and <em>what</em> sits on top of it.
		</p>
	</section>

	<section>
		<h2>Three ways to simulate</h2>
		<div class="table-wrap">
			<table>
				<thead><tr><th>Path</th><th>What runs</th><th>Good for</th><th>Needs</th></tr></thead>
				<tbody>
					<tr>
						<td><strong>1. Browser sandbox</strong><br /><span class="small muted">this site's <a href={resolve('/sim')}>live sim</a>, the official <a href="https://huggingface.co/spaces/pollen-robotics/microduck-simulator" rel="noopener">Hugging Face Space</a></span></td>
						<td>MuJoCo compiled to WebAssembly + ONNX Runtime Web, all client-side</td>
						<td>Trying policies, demos, teaching, testing a new ONNX before deploying</td>
						<td>A browser (Chrome recommended)</td>
					</tr>
					<tr>
						<td><strong>2. Digital twin</strong><br /><span class="small muted"><code>scripts/duck-sim</code> in pollen-robotics/microduck</span></td>
						<td>The <em>real</em> Rust daemons (<code>robotd</code>, <code>tofd</code>, <code>mediad</code>, <code>configd</code>, <code>updaterd</code>) against a MuJoCo body over TCP</td>
						<td>Developing robot software: control loop, IPC, clients, updater, multi-robot fleets</td>
						<td>Rust 1.89+, Python venv of microduck_rl, Linux or macOS</td>
					</tr>
					<tr>
						<td><strong>3. Training environments</strong><br /><span class="small muted">pollen-robotics/microduck_rl</span></td>
						<td>mjlab: MuJoCo Warp physics, thousands of parallel envs, PPO via rsl_rl</td>
						<td>Training new skills, exporting ONNX, CPU playback with <code>infer_policy.py</code></td>
						<td>CUDA GPU for training (or Hugging Face Jobs); CPU is enough for inference</td>
					</tr>
				</tbody>
			</table>
		</div>
	</section>

	<section>
		<h2>Inside the 50 Hz loop</h2>
		<p>
			This is the loop the browser sandbox, <code>infer_policy.py</code> and <code>robotd</code> all implement. The
			live simulation on this site is a TypeScript port of the official sandbox's core.
		</p>
		<figure>
			<svg class="diagram" viewBox="0 0 960 300" role="img" aria-labelledby="loop-title">
				<title id="loop-title">Observation from MuJoCo, ONNX policy, joint targets, actuator model, four physics steps</title>
				<defs>
					<marker id="arr2" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="#6d7486" /></marker>
				</defs>
				<g font-family="system-ui, sans-serif" font-size="13">
					<rect x="20" y="40" width="200" height="120" rx="12" fill="#12151d" stroke="#262b38" />
					<text x="120" y="68" text-anchor="middle" fill="#ffc93c" font-weight="700">Observation · 61</text>
					<text x="34" y="92" fill="#a6adbd" font-size="12">gyro (3) · projected gravity (3)</text>
					<text x="34" y="110" fill="#a6adbd" font-size="12">joint pos − default (14) · joint vel (14)</text>
					<text x="34" y="128" fill="#a6adbd" font-size="12">last action (14) · command (13)</text>
					<text x="34" y="148" fill="#6d7486" font-size="11">from MuJoCo qpos / qvel / sensordata</text>

					<line x1="220" y1="100" x2="270" y2="100" stroke="#6d7486" stroke-width="2" marker-end="url(#arr2)" />

					<rect x="275" y="40" width="190" height="120" rx="12" fill="#12151d" stroke="#262b38" />
					<text x="370" y="68" text-anchor="middle" fill="#ffc93c" font-weight="700">ONNX policy</text>
					<text x="370" y="92" text-anchor="middle" fill="#e9ecf2">onnxruntime-web (wasm)</text>
					<text x="370" y="112" text-anchor="middle" fill="#a6adbd" font-size="12">input "obs" [1, 61]</text>
					<text x="370" y="130" text-anchor="middle" fill="#a6adbd" font-size="12">output "actions" [1, 14]</text>

					<line x1="465" y1="100" x2="515" y2="100" stroke="#6d7486" stroke-width="2" marker-end="url(#arr2)" />

					<rect x="520" y="40" width="200" height="120" rx="12" fill="#12151d" stroke="#262b38" />
					<text x="620" y="68" text-anchor="middle" fill="#ffc93c" font-weight="700">Joint targets · 14</text>
					<text x="620" y="92" text-anchor="middle" fill="#e9ecf2" font-size="12">target = default_pose</text>
					<text x="620" y="110" text-anchor="middle" fill="#e9ecf2" font-size="12">+ action × scale</text>
					<text x="620" y="132" text-anchor="middle" fill="#a6adbd" font-size="12">scale 0.9 walk · 1.0 skills</text>

					<line x1="720" y1="100" x2="770" y2="100" stroke="#6d7486" stroke-width="2" marker-end="url(#arr2)" />

					<rect x="775" y="40" width="165" height="120" rx="12" fill="#1a1e29" stroke="#262b38" />
					<text x="857" y="68" text-anchor="middle" fill="#ffc93c" font-weight="700">×4 physics steps</text>
					<text x="857" y="92" text-anchor="middle" fill="#e9ecf2" font-size="12">BAM XL330 motor model</text>
					<text x="857" y="110" text-anchor="middle" fill="#e9ecf2" font-size="12">→ torque → mj_step</text>
					<text x="857" y="132" text-anchor="middle" fill="#a6adbd" font-size="12">dt 0.005 s → 0.02 s</text>

					<path d="M857 160 L857 220 L120 220 L120 160" fill="none" stroke="#6d7486" stroke-width="2" stroke-dasharray="6 5" marker-end="url(#arr2)" />
					<text x="490" y="242" text-anchor="middle" fill="#a6adbd" font-size="12">next control step, 20 ms of simulated time later</text>

					<rect x="300" y="262" width="360" height="26" rx="6" fill="#12151d" stroke="#262b38" />
					<text x="480" y="280" text-anchor="middle" fill="#a6adbd" font-size="12">command = keyboard / gamepad twist [vx, vy, wz] + head + body pose</text>
				</g>
			</svg>
			<figcaption>Timestep 0.005 s, decimation 4, so the policy runs every 20 ms of simulated time. Matches <code>microduck_rl/scripts/infer_policy.py</code>.</figcaption>
		</figure>

		<h3>The observation vector (61 values)</h3>
		<div class="table-wrap">
			<table>
				<thead><tr><th>Index</th><th>Contents</th><th>Source in MuJoCo</th></tr></thead>
				<tbody>
					<tr><td>0–2</td><td>Base angular velocity</td><td><code>gyro</code> sensor on the trunk <code>imu</code> site (<code>imu_ang_vel</code>)</td></tr>
					<tr><td>3–5</td><td>Projected gravity: world −Z rotated into the trunk frame</td><td>trunk <code>xquat</code>, conjugated, applied to (0, 0, −1)</td></tr>
					<tr><td>6–19</td><td>Joint positions relative to the default standing pose</td><td><code>qpos[jnt.qposadr] − DEFAULT_POSE</code></td></tr>
					<tr><td>20–33</td><td>Joint velocities</td><td><code>qvel[jnt.dofadr]</code></td></tr>
					<tr><td>34–47</td><td>Previous action (raw policy output)</td><td>kept by the loop</td></tr>
					<tr><td>48–60</td><td>Command: twist (vx, vy, wz), head pose (4), body pose (6)</td><td>operator input, smoothed with an EMA (α = 0.2) at 50 Hz</td></tr>
				</tbody>
			</table>
		</div>
		<p>
			Joint order is fixed by the MJCF actuators: <code>left_hip_yaw, left_hip_roll, left_hip_pitch, left_knee, left_ankle,
			neck_pitch, head_pitch, head_yaw, head_roll, right_hip_yaw, right_hip_roll, right_hip_pitch, right_knee, right_ankle</code>.
			The command slots are reused by skills: sit/stand puts a 0/1 flag in <code>cmd[0]</code>, ground pick puts a phase
			encoding <code>[cos φ, sin φ]</code> in <code>cmd[0..1]</code>, kicks and stand-recovery run with an all-zero command.
		</p>

		<h3>Policy scheduling</h3>
		<ul>
			<li><strong>Stand vs walk.</strong> With legs, if the commanded twist magnitude is ≤ 0.05 the <em>stand</em> policy runs (scale 1.0); otherwise <em>walk</em> (scale 0.9).</li>
			<li><strong>One-shots.</strong> Kicks own the loop for 25 control steps (0.5 s) with zeroed commands, then walk resumes. Ground pick advances a phase over a 4 s period and exits at phase 0.7 (about 2.8 s). A roulade hands back once the trunk has tipped and is upright again.</li>
			<li><strong>Fall recovery.</strong> If projected gravity z rises above −0.5 for 10 steps (0.2 s), controls freeze for 15 steps (0.3 s), then the stand policy runs until the trunk is upright (gz &lt; −0.85) for 50 consecutive steps (1 s). After 300 steps (6 s) it gives up and resets.</li>
		</ul>

		<h3>The actuator model matters</h3>
		<p>
			The leg policies were <em>not</em> trained against MuJoCo's stock <code>&lt;position&gt;</code> actuator. They were
			trained with BAM's identified model of the Dynamixel XL330 (the "m6" model): a firmware position loop
			(kp 200 in encoder units) producing a PWM duty, a 1.75 A current limit, back-EMF, supply-voltage sag under load
			(7.35 V nominal, floor 6.0 V), Coulomb + Stribeck + viscous friction, and a random 3 to 6 physics-step bus delay.
			The sandbox rewrites the MJCF's position actuators into torque <code>&lt;motor&gt;</code>s and computes that torque in
			JavaScript at every 5 ms step. Skip this and the same ONNX file walks badly.
		</p>
		<Code lang="ts" title="torque per joint, every physics step (BAM m6, simplified)" code={`duty  = (target - q) * firmwareKp * 4096 / (2π · 256 · 885)
duty  = clamp(duty, backEmf ± R·Imax / V)      // current limit around back-EMF duty
duty  = clamp(duty, -1, 1)
tau   = kt · V · duty / R  -  kt² · qdot / R   // motor torque minus back-EMF drag
tau   = clamp(tau, ±8.2·kt/R)
V     = max(6.0, 7.35 - 0.1 · Σ|previous torques|)   // bus sag under load`} />
	</section>

	<section>
		<h2>Path 1: the browser sandbox</h2>
		<p>
			The official <strong>Microduck Sandbox</strong> is a Vite + React app. Its framework-agnostic core
			(<code>app/src/game/</code>) does the following at boot, and the <a href={resolve('/sim')}>live sim</a> here does the same:
		</p>
		<ol>
			<li>Load <code>@mujoco/mujoco</code> (MuJoCo 3.11 WebAssembly, single-threaded, so no COOP/COEP headers needed) and <code>onnxruntime-web</code> with the wasm execution provider.</li>
			<li>Fetch <code>robot_allcollisions.xml</code>, the mjlab MJCF with body and shell collision geoms. In the DOM: swap <code>&lt;position&gt;</code> actuators for <code>&lt;motor&gt;</code>s, strip <code>class="visual"</code> geoms and unused meshes, add <code>&lt;option timestep="0.005"&gt;</code>, a floor plane and a <code>STAND</code> keyframe.</li>
			<li>Put the 9 collision meshes into a MuJoCo virtual file system (<code>MjVFS.addBuffer</code>) as binary STL, rebuilt from the visual GLB so nothing downloads twice, then <code>MjModel.from_xml_string(xml, vfs)</code>.</li>
			<li>Create one ONNX Runtime session per policy (<code>BEST_alpha_walking</code>, <code>BEST_alpha_stand</code>, <code>BEST_alpha_sitstand</code>, <code>alpha_ground_pick</code>, <code>ball_kick_left/right</code>, <code>roulade</code>).</li>
			<li>Build a three.js rig from <code>kinematics.json</code> (15 bodies, 14 hinge joints) and drive it straight from <code>qpos</code> every frame.</li>
			<li>Run the async 50 Hz loop above. Rendering runs at display refresh rate; the policy rate is simulated time, not frames per second.</li>
		</ol>
		<h3>Roller variant</h3>
		<p>
			Roller skating is a second MJCF, <code>robot_allcollisions_rollers.xml</code>: the feet are replaced by blades with
			two passive wheels each (<code>passive_LF/LR/RF/RR_wheel</code> hinges). The wheel angles appear in <code>qpos</code> but not in
			the observation, so the policy contract stays 61 → 14. The drive policy <code>BEST_roller.onnx</code> was trained on the
			XML's own <code>&lt;position&gt;</code> actuator, not the BAM motor model, with action scale 0.8, and the runtime clamps
			commands to 0.6 m/s forward, 0.5 m/s braking and 0.3 rad/s turning (faster turns tip it over). Roller mode is one
			self-contained skill: no stand, sit, pick or recovery policy runs on wheels. Press <kbd>M</kbd> in the
			<a href={resolve('/sim')}>live sim</a>.
		</p>
		<h3>Picking something up</h3>
		<p>
			The real robot's ground pick is a 15-motor policy: the beak is part of its action space and closes on the object.
			Every exported ONNX in the public set has 14 outputs, so in simulation the beak does not move and the MJCF has no jaw
			joint at all (<code>jaw.stl</code> is a rigid geom of the head body). The official sandbox re-creates the beak motion
			visually from the pick phase (open 0.10–0.20, shut 0.40–0.50). The live sim here adds a pen prop and a proximity
			latch: when the scoop phase runs and the <code>mouth_tip</code> site is within 3.5 cm of the pen, the pen is attached to
			the head body and carried until you drop it. It demonstrates the motion and reach of the pick, not contact grasping.
		</p>
		<Callout kind="tip" title="Sim-to-sim check">
			<p>The ONNX files in the sandbox are byte-for-byte the deployment assets from <code>microduck/robotd-params</code>. If a new policy walks in the sandbox with the BAM actuator model, it is a reasonable candidate for the robot. Contact surfaces, calibration and timing still differ on hardware.</p>
		</Callout>
	</section>

	<section>
		<h2>Path 2: the digital twin (<code>scripts/duck-sim</code>)</h2>
		<p>
			The robot daemon <code>robotd</code> talks to hardware through a single Rust trait, <code>RobotIo</code>:
			<code>read()</code> sensors, <code>write()</code> joint targets, <code>set_gain()</code>, <code>set_torque()</code>, <code>slow_sensors()</code>.
			On the robot the implementation is <code>DynamixelIo</code>. In the twin it is <code>RemoteIo</code>, which speaks
			newline-delimited JSON over TCP to a MuJoCo process (<code>duck-body</code>, from the <code>microduck_rl</code> venv).
			Everything above the trait, the 50 Hz loop, ONNX policies, safety, fall detection, odometry, kinematics and every
			IPC call, is the unmodified robot binary.
		</p>
		<div class="table-wrap">
			<table>
				<thead><tr><th>Detail</th><th>Value</th></tr></thead>
				<tbody>
					<tr><td>Protocol</td><td>TCP, one JSON object per line: <code>{`{"op":"hello"|"read"|"write"|"gain"|"torque"|"slow", …}`}</code>, <code>TCP_NODELAY</code> on</td></tr>
					<tr><td>Units</td><td>Radians, rad/s, mA, the robot's native units</td></tr>
					<tr><td>Tick</td><td>50 Hz, ~1 KB per transaction (~50 KB/s per duck)</td></tr>
					<tr><td>Ports</td><td>Body 7801 (+1 per duck), camera frames 7901 (+1 per camera)</td></tr>
					<tr><td>Sockets</td><td><code>~/.cache/duck-sim/duck-a.sock</code> (robotd), <code>duck-a-tof.sock</code> (ToF)</td></tr>
					<tr><td>Multi-duck</td><td><code>scripts/duck-sim boot N</code>: one MuJoCo scene, N <code>systemd-nspawn</code> containers on a shared Debian 13 rootfs, plus <code>duck-ether</code> simulating radio latency and loss</td></tr>
					<tr><td>Real-time</td><td>Must hold &gt; 1.0× real time or the health gate trips. Fewer ducks or cameras if it drops.</td></tr>
				</tbody>
			</table>
		</div>
		<p>Use <code>duck-sim up</code> for control loop, policies, IPC and client work; <code>duck-sim boot N</code> when you need systemd, the updater, provisioning or several robots at once. Commands are on the <a href={resolve('/run-locally')}>Run locally</a> page.</p>
	</section>

	<section>
		<h2>Path 3: training in <code>microduck_rl</code></h2>
		<p>
			<code>microduck_rl</code> registers the tasks with mjlab, which runs MuJoCo Warp on the GPU and trains with
			rsl_rl's PPO. A usable walking gait takes about 1 to 2 hours at 4096 environments. Each task also has a
			<em>Backlash</em> variant with ±1° of gear play per joint for robustness.
		</p>
		<div class="table-wrap">
			<table>
				<thead><tr><th>Task family</th><th>Variants</th><th>What it learns</th></tr></thead>
				<tbody>
					<tr><td>Velocity</td><td>Flat, Rough</td><td>Main walking task: track twist + head pose commands</td></tr>
					<tr><td>VelStand</td><td>Flat, Rough</td><td>Walking plus fall recovery</td></tr>
					<tr><td>StandUp, SitStand, GroundPick</td><td>Flat, Rough</td><td>Postural transitions</td></tr>
					<tr><td>BallKick, Roulade</td><td>Flat</td><td>One-shot tricks</td></tr>
					<tr><td>Roller</td><td>Flat, Slope</td><td>Skating on 4 passive wheels</td></tr>
					<tr><td>Spin</td><td>Flat</td><td>Fast in-place rotation</td></tr>
				</tbody>
			</table>
		</div>
		<p>
			Per-environment domain randomisation covers battery voltage and sag, command delay and friction, using the
			same BAM XL330 model described above. <code>scripts/export.py</code> bakes the observation normaliser into the ONNX
			graph. Always deploy the ONNX produced by that script, never a raw checkpoint export.
		</p>
		<Code title="train → export → play on CPU" code={`uv run train Mjlab-Velocity-Flat-MicroDuck --env.scene.num-envs 4096
uv run scripts/export.py Mjlab-Velocity-Flat-MicroDuck --wandb-run-path <entity/project/run_id>
uv run scripts/infer_policy.py --walking output.onnx --standing BEST_alpha_stand.onnx`} />
	</section>

	<section>
		<h2>Other simulators from the community</h2>
		<p>The MJCF and ONNX contracts are open, so the robot has been ported widely. A few from <a href="https://github.com/joeynyc/awesome-microduck" rel="noopener">awesome-microduck</a>:</p>
		<ul>
			<li><a href="https://github.com/noahfarr/microdux" rel="noopener">microdux</a>: JAX / MJX port for MuJoCo Playground</li>
			<li><a href="https://github.com/Macmachi/microduck-rl-genesis" rel="noopener">microduck-rl-genesis</a>: Genesis physics, AMD ROCm friendly</li>
			<li><a href="https://github.com/5usu/IsaacLab" rel="noopener">Isaac Lab Microduck</a> and <a href="https://github.com/kabilankb/isaaclab-microduck" rel="noopener">isaaclab-microduck</a>: NVIDIA Isaac Lab ports</li>
			<li><a href="https://github.com/sgyli7/MicroDuck-Unity-Sim2Sim" rel="noopener">MicroDuck Unity Sim2Sim</a>: Unity with native MuJoCo</li>
			<li><a href="https://github.com/ngxson/wicroduck" rel="noopener">Wicroduck</a> and <a href="https://github.com/TonyRuan/microduck-web" rel="noopener">Microduck Web</a>: other in-browser MuJoCo WebAssembly builds</li>
			<li><a href="https://github.com/jonathanhawkins/microduck-lab" rel="noopener">microduck-lab</a>: training on Apple Silicon without CUDA</li>
		</ul>
	</section>
</div>

<style>
	.top { padding-top: 3rem; }
</style>
