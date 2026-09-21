<script lang="ts">
	import { resolve } from '$app/paths';
	import DuckSim from '#lib/components/DuckSim.svelte';
	import Callout from '#lib/components/Callout.svelte';
</script>

<svelte:head>
	<title>Live Microduck simulation — MuJoCo WebAssembly in your browser</title>
	<meta name="description" content="Drive the real trained Microduck policies in your browser. MuJoCo WebAssembly steps the physics, ONNX Runtime Web runs the policy network at 50 Hz." />
</svelte:head>

<div class="wrap">
	<section class="top">
		<div class="eyebrow">Live</div>
		<h1>Simulate Microduck in your browser</h1>
		<p class="lead">
			The real trained policies, not an animation. MuJoCo compiled to WebAssembly steps the mjlab robot model
			every 5 ms; ONNX Runtime Web runs the policy at 50 Hz. Everything runs in this tab. No server.
		</p>
	</section>

	<DuckSim />

	<section class="grid">
		<div class="card">
			<h3>Keyboard</h3>
			<div class="table-wrap">
				<table>
					<tbody>
						<tr><td><kbd>↑</kbd> <kbd>↓</kbd> or <kbd>W</kbd> <kbd>S</kbd></td><td>Walk forward (0.25 m/s) / back (0.2 m/s)</td></tr>
						<tr><td><kbd>←</kbd> <kbd>→</kbd> or <kbd>A</kbd> <kbd>D</kbd></td><td>Turn (1.0 rad/s)</td></tr>
						<tr><td><kbd>R</kbd></td><td>Sit down / stand up</td></tr>
						<tr><td><kbd>G</kbd></td><td>Ground pick (grabs the pen if the beak reaches it)</td></tr>
						<tr><td><kbd>B</kbd></td><td>Place a pen in front of the duck / drop the held pen</td></tr>
						<tr><td><kbd>M</kbd></td><td>Switch legs ↔ rollers (roller model and drive policy load on first use)</td></tr>
						<tr><td><kbd>Q</kbd> / <kbd>E</kbd></td><td>Kick left / right</td></tr>
						<tr><td><kbd>X</kbd></td><td>Roulade</td></tr>
						<tr><td><kbd>P</kbd></td><td>Random push (watch the recovery)</td></tr>
						<tr><td><kbd>C</kbd></td><td>Chase camera on/off (drag to orbit, wheel to zoom)</td></tr>
						<tr><td><kbd>Space</kbd></td><td>Reset to the STAND keyframe</td></tr>
					</tbody>
				</table>
			</div>
			<p class="small muted">Key positions are physical (<code>e.code</code>), so ZQSD works on AZERTY.</p>
		</div>
		<div class="card">
			<h3>What you are watching</h3>
			<ul class="small">
				<li><strong>Standing</strong> uses <code>BEST_alpha_stand.onnx</code> whenever the twist command is ≤ 0.05; it also owns fall recovery.</li>
				<li><strong>Walking</strong> uses <code>BEST_alpha_walking.onnx</code> with action scale 0.9.</li>
				<li>Every 5 ms the <strong>BAM XL330 motor model</strong> converts each joint target into torque, with bus delay, current limit and voltage sag.</li>
				<li>The HUD Hz is the achieved control rate in wall time. Simulated time always advances 20 ms per step.</li>
				<li>A fall (gravity z above −0.5 for 0.2 s) freezes control for 0.3 s and then runs the stand policy until upright for 1 s.</li>
				<li><strong>Rollers</strong> swap in <code>robot_allcollisions_rollers.xml</code> (4 passive wheel hinges, not in the observation) and run <code>BEST_roller.onnx</code> with the XML's own position actuator, scale 0.8, limits 0.6 / −0.5 m/s and 0.3 rad/s. Rollers have no recovery: a fall resets after 1 s.</li>
				<li><strong>Pen pick.</strong> The mjlab model has no jaw joint and the exported policies have no mouth channel, so the grab is a proximity latch: during the scoop (phase 0.28–0.50) with the <code>mouth_tip</code> site within 3.5 cm of the pen, the pen attaches to the head body. The beak animation follows the sandbox's phase keys.</li>
			</ul>
		</div>
	</section>

	<Callout kind="note" title="Differences from the official sandbox">
		<p>
			This port keeps the legged Skills stack (walk, stand, sit, pick, kicks, roulade), the roller variant and the
			BAM actuator model, byte-for-byte the same ONNX files. It adds a pen prop for the pick. It leaves out
			whole-body-control tracking, the ball, scenes, gamepad, audio and multiplayer ghosts. For all of that, use the
			<a href="https://huggingface.co/spaces/pollen-robotics/microduck-simulator" rel="noopener">official Space</a>
			or run it locally as described on the <a href={resolve('/run-locally')}>Run locally</a> page.
		</p>
	</Callout>

	<section>
		<h2>How this page works</h2>
		<ol>
			<li><code>mujoco.js</code> + <code>mujoco.wasm</code> (npm <code>@mujoco/mujoco</code> 3.11.0) are served from <code>static/sim/</code> and imported on demand.</li>
			<li><code>robot_allcollisions.xml</code> is rewritten in the DOM: position actuators → torque motors, visual geoms stripped, timestep 0.005, floor plane, STAND keyframe.</li>
			<li>The 9 collision meshes are rebuilt as binary STL from <code>microduck.glb</code> and added to an <code>MjVFS</code>; then <code>MjModel.from_xml_string</code> compiles.</li>
			<li>7 ONNX sessions are created with <code>onnxruntime-web</code> (wasm provider, single thread, sidecars in <code>static/ort/</code>); the roller drive policy loads on the first <kbd>M</kbd>.</li>
			<li>An async loop builds the 61-value observation, runs the active policy, writes targets, applies the BAM torque model and calls <code>mj_step</code> 4 times, paced to 20 ms.</li>
			<li>three.js draws the rig from <code>kinematics.json</code>, reading <code>qpos</code> each animation frame.</li>
		</ol>
		<p>Source: <code>src/lib/sim/engine.ts</code>, <code>bam.ts</code>, <code>mjcf.ts</code>, <code>rig.ts</code> and <code>src/lib/components/DuckSim.svelte</code>. See <a href={resolve('/simulate')}>How to simulate</a> for the theory.</p>
	</section>
</div>

<style>
	.top { padding-top: 3rem; }
	.grid { margin-top: 2rem; }
	.card table td { padding: 0.35rem 0.5rem; font-size: 0.9rem; }
	.card table td:first-child { white-space: nowrap; }
</style>
