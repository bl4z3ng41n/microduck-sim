<script lang="ts">
	import { resolve } from '$app/paths';
	import Code from '#lib/components/Code.svelte';
</script>

<svelte:head>
	<title>Microduck — simulate and run the tiny biped duck robot</title>
	<meta name="description" content="What Microduck is, how its MuJoCo simulation works, and how to run the simulator locally. Live in-browser simulation included." />
</svelte:head>

<section class="hero wrap">
	<div>
		<div class="eyebrow">Pollen Robotics × Hugging Face</div>
		<h1>Microduck, simulated.</h1>
		<p class="lead">
			Microduck is a 25 cm, roughly 800 g open-source biped duck robot. Every move it makes is a neural
			network trained in MuJoCo and exported to ONNX. This site explains how that simulation works,
			how to run it on your machine, and lets you drive the real trained policies in your browser.
		</p>
		<div class="cta">
			<a class="btn primary" href={resolve('/sim')}>▶ Run the live simulation</a>
			<a class="btn" href={resolve('/simulate')}>How simulation works</a>
			<a class="btn" href={resolve('/run-locally')}>Run it locally</a>
			<a class="btn" href={resolve('/bom')}>Bill of materials</a>
		</div>
	</div>
	<div class="specs card">
		<h3>Spec sheet</h3>
		<dl>
			<dt>Height / mass</dt><dd>25 cm / ~800 g</dd>
			<dt>Motors</dt><dd>15 Dynamixel XL330 servos (14 in the RL model: 5 per leg, 4 neck and head; plus the beak)</dd>
			<dt>Sensors</dt><dd>Camera, 8×8 ToF depth sensor, two IMUs</dd>
			<dt>Compute</dt><dd>Rockchip RK3566 (with NPU) running Linux</dd>
			<dt>Control loop</dt><dd>50 Hz, ONNX policies on-device</dd>
			<dt>Software</dt><dd>Rust daemons, Apache-2.0</dd>
			<dt>Price</dt><dd>$399 (pre-orders opened 27 Aug 2026)</dd>
		</dl>
	</div>
</section>

<section class="wrap">
	<h2>What Microduck is</h2>
	<p>
		Microduck is a small walking robot shaped like a duck. It was announced by Pollen Robotics and Hugging Face
		on 27 August 2026, with first units expected before the end of 2026. It walks with a gamepad, rolls on
		optional wheels, picks up objects with its beak, sits, kicks a ball, stands up after a fall, and quacks.
	</p>
	<p>
		The interesting part is <strong>how</strong> it moves. There is no hand-written gait. Each behaviour
		(walk, stand and recover, sit and stand, ground pick, kick left and right, roulade, roller skating) is a
		separate reinforcement-learning policy trained with PPO in MuJoCo, exported to ONNX and run on the robot
		at 50 Hz. The whole sim-to-real stack is open: the robot firmware, the training environments, the
		simulator, and the trained policy files.
	</p>

	<div class="grid">
		<div class="card">
			<h3>Robot runtime</h3>
			<p>
				A Rust workspace of Linux daemons talking JSON-RPC over Unix sockets. <code>robotd</code> owns the 50 Hz
				control loop and the motor bus, <code>updaterd</code> handles signed updates, <code>configd</code> Wi-Fi and
				identity, <code>padd</code> the gamepad, <code>mediad</code> the camera over WebRTC, <code>tofd</code> the depth sensor.
			</p>
		</div>
		<div class="card">
			<h3>Training stack</h3>
			<p>
				<code>microduck_rl</code> builds on mjlab (MuJoCo Warp + rsl_rl). Policies train on a CUDA GPU with domain
				randomisation of battery voltage, command delay and friction, then export to ONNX with the observation
				normaliser baked into the graph.
			</p>
		</div>
		<div class="card">
			<h3>Simulators</h3>
			<p>
				A browser sandbox (MuJoCo compiled to WebAssembly, policies run by ONNX Runtime Web), a digital twin
				that runs the real daemons against a MuJoCo body, and a growing list of community ports (Genesis,
				Isaac Lab, MJX, Unity).
			</p>
		</div>
	</div>
</section>

<section class="wrap">
	<h2>One pipeline, three places to run the same policy</h2>
	<figure>
		<svg class="diagram" viewBox="0 0 960 250" role="img" aria-labelledby="pipe-title">
			<title id="pipe-title">Train in MuJoCo, export ONNX, run in browser, digital twin or real robot</title>
			<defs>
				<marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
					<path d="M0 0L10 5L0 10z" fill="#6d7486" />
				</marker>
			</defs>
			<g font-family="system-ui, sans-serif" font-size="14">
				<rect x="20" y="70" width="230" height="110" rx="12" fill="#12151d" stroke="#262b38" />
				<text x="135" y="100" text-anchor="middle" fill="#ffc93c" font-weight="700">1 · Train</text>
				<text x="135" y="125" text-anchor="middle" fill="#e9ecf2">microduck_rl · mjlab</text>
				<text x="135" y="147" text-anchor="middle" fill="#a6adbd" font-size="12">PPO, 4096 envs, MuJoCo Warp</text>
				<text x="135" y="166" text-anchor="middle" fill="#a6adbd" font-size="12">domain randomisation</text>

				<line x1="250" y1="125" x2="330" y2="125" stroke="#6d7486" stroke-width="2" marker-end="url(#arr)" />

				<rect x="335" y="70" width="230" height="110" rx="12" fill="#12151d" stroke="#262b38" />
				<text x="450" y="100" text-anchor="middle" fill="#ffc93c" font-weight="700">2 · Export</text>
				<text x="450" y="125" text-anchor="middle" fill="#e9ecf2">scripts/export.py → .onnx</text>
				<text x="450" y="147" text-anchor="middle" fill="#a6adbd" font-size="12">obs 61 → actions 14</text>
				<text x="450" y="166" text-anchor="middle" fill="#a6adbd" font-size="12">normaliser baked in</text>

				<line x1="565" y1="125" x2="640" y2="40" stroke="#6d7486" stroke-width="2" marker-end="url(#arr)" />
				<line x1="565" y1="125" x2="640" y2="125" stroke="#6d7486" stroke-width="2" marker-end="url(#arr)" />
				<line x1="565" y1="125" x2="640" y2="210" stroke="#6d7486" stroke-width="2" marker-end="url(#arr)" />

				<rect x="645" y="12" width="295" height="56" rx="10" fill="#1a1e29" stroke="#262b38" />
				<text x="660" y="35" fill="#e9ecf2" font-weight="700">Browser</text>
				<text x="660" y="55" fill="#a6adbd" font-size="12">MuJoCo WASM + ONNX Runtime Web, 50 Hz</text>

				<rect x="645" y="97" width="295" height="56" rx="10" fill="#1a1e29" stroke="#262b38" />
				<text x="660" y="120" fill="#e9ecf2" font-weight="700">Digital twin · scripts/duck-sim</text>
				<text x="660" y="140" fill="#a6adbd" font-size="12">real robotd daemon ↔ MuJoCo body over TCP</text>

				<rect x="645" y="182" width="295" height="56" rx="10" fill="#1a1e29" stroke="#262b38" />
				<text x="660" y="205" fill="#e9ecf2" font-weight="700">Real robot · RK3566</text>
				<text x="660" y="225" fill="#a6adbd" font-size="12">robotd, 15 XL330 servos, Dynamixel bus</text>
			</g>
		</svg>
		<figcaption>The same ONNX file is byte-for-byte identical in the browser sandbox and on the robot.</figcaption>
	</figure>
</section>

<section class="wrap">
	<h2>Shipped behaviours</h2>
	<div class="table-wrap">
		<table>
			<thead><tr><th>Behaviour</th><th>Policy file</th><th>Trigger in the browser sim</th></tr></thead>
			<tbody>
				<tr><td>Walk / turn</td><td><code>BEST_alpha_walking.onnx</code></td><td>Arrows or <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd></td></tr>
				<tr><td>Stand still, recover after a fall</td><td><code>BEST_alpha_stand.onnx</code></td><td>Automatic when the twist command is ≤ 0.05</td></tr>
				<tr><td>Sit down / stand up</td><td><code>BEST_alpha_sitstand.onnx</code></td><td><kbd>R</kbd></td></tr>
				<tr><td>Ground pick (peck and rise)</td><td><code>alpha_ground_pick.onnx</code></td><td><kbd>G</kbd> (<kbd>B</kbd> places a pen to pick up)</td></tr>
				<tr><td>Kick left / right</td><td><code>ball_kick_left.onnx</code>, <code>ball_kick_right.onnx</code></td><td><kbd>Q</kbd> / <kbd>E</kbd></td></tr>
				<tr><td>Roulade (forward roll)</td><td><code>roulade.onnx</code></td><td><kbd>X</kbd></td></tr>
				<tr><td>Roller skating</td><td><code>BEST_roller.onnx</code></td><td><kbd>M</kbd> switches to the roller variant</td></tr>
			</tbody>
		</table>
	</div>
</section>

<section class="wrap">
	<h2>Fastest way in</h2>
	<p>No hardware, no GPU. Open the <a href={resolve('/sim')}>live simulation</a> on this site, or run the official sandbox locally:</p>
	<Code title="official browser sandbox, local" code={`git clone https://huggingface.co/spaces/pollen-robotics/microduck-simulator
cd microduck-simulator && git lfs install --local && git lfs pull
cd app && npm ci && npm run dev      # http://localhost:5173`} />
	<p>Full instructions, including the digital twin and the training stack, are on the <a href={resolve('/run-locally')}>Run locally</a> page.</p>
</section>

<section class="wrap">
	<h2>Official links</h2>
	<ul>
		<li><a href="https://pollen-robotics.com/microduck/" rel="noopener">Product page</a> and <a href="https://store.pollen-robotics.com/products/microduck" rel="noopener">store</a></li>
		<li><a href="https://github.com/pollen-robotics/microduck" rel="noopener">pollen-robotics/microduck</a>: robot runtime, docs, <code>scripts/duck-sim</code></li>
		<li><a href="https://github.com/pollen-robotics/microduck_rl" rel="noopener">pollen-robotics/microduck_rl</a>: training environments, export, <code>infer_policy.py</code></li>
		<li><a href="https://huggingface.co/spaces/pollen-robotics/microduck-simulator" rel="noopener">Microduck Sandbox</a> on Hugging Face (source mirrored at <a href="https://github.com/micro-zoo/microduck-simulator" rel="noopener">micro-zoo/microduck-simulator</a>)</li>
		<li><a href="https://huggingface.co/pollen-robotics/microduck-policies" rel="noopener">microduck-policies</a>: the official ONNX policy set</li>
		<li><a href="https://github.com/joeynyc/awesome-microduck" rel="noopener">awesome-microduck</a>: community simulators, policies and tools</li>
	</ul>
</section>

<style>
	.hero { display: grid; grid-template-columns: 1.4fr 1fr; gap: 2.5rem; align-items: start; padding-top: 4rem; padding-bottom: 1rem; }
	.cta { display: flex; flex-wrap: wrap; gap: 0.7rem; margin-top: 1.6rem; }
	.specs dl { display: grid; grid-template-columns: auto 1fr; gap: 0.45rem 1rem; margin: 0; font-size: 0.92rem; }
	.specs dt { color: var(--ink-3); font-weight: 600; }
	.specs dd { margin: 0; color: var(--ink-2); }
	@media (max-width: 800px) { .hero { grid-template-columns: 1fr; padding-top: 2.5rem; } }
</style>
