<script lang="ts">
	import { onMount } from 'svelte';
	import { asset } from '$app/paths';
	import type { BootLine, Telemetry, DuckSim as Engine, Action } from '#lib/sim/engine.ts';
	import { POLICY_LABELS } from '#lib/sim/constants.ts';

	let canvas: HTMLCanvasElement;
	let frame: HTMLDivElement;
	let engine: Engine | null = null;

	type Phase = 'idle' | 'booting' | 'ready' | 'error';
	let phase = $state<Phase>('idle');
	let bootLines = $state<BootLine[]>([]);
	let error = $state('');
	let tel = $state<Telemetry | null>(null);
	let running = $state(false);
	let focused = $state(false);
	let webgl = $state(true);
	let notice = $state<string | null>(null);

	const simBase = asset('sim/mujoco.js').replace(/mujoco\.js$/, '');
	const ortBase = asset('ort/ort-wasm-simd-threaded.wasm').replace(/ort-wasm-simd-threaded\.wasm$/, '');

	function pushBoot(line: BootLine) {
		const i = bootLines.findIndex((l) => l.label === line.label);
		if (i >= 0) bootLines[i] = line;
		else bootLines.push(line);
	}

	async function boot() {
		if (phase !== 'idle') return;
		phase = 'booting';
		bootLines = [];
		error = '';
		try {
			const { DuckSim } = await import('#lib/sim/engine.ts');
			engine = new DuckSim(canvas, {
				simBase,
				ortBase,
				onBoot: pushBoot,
				onTelemetry: (t) => (tel = t),
				onNotice: (m) => (notice = m),
				onError: (m) => {
					error = m;
					phase = 'error';
					running = false;
				}
			});
			await engine.boot();
			(window as unknown as { __duckSim?: Engine }).__duckSim = engine; // debug / tests
			phase = 'ready';
			engine.start();
			running = true;
			frame?.focus();
		} catch (e) {
			if (!error) error = e instanceof Error ? e.message : String(e);
			phase = 'error';
		}
	}

	function toggleRun() {
		if (!engine) return;
		if (running) engine.pause();
		else engine.start();
		running = engine.isRunning;
	}

	function act(a: Action) {
		engine?.trigger(a);
	}

	function onKeyDown(e: KeyboardEvent) {
		if (!engine || !focused || e.repeat && e.code !== 'Space') {
			if (!engine || !focused) return;
		}
		if (e.repeat) return;
		if (engine.onKey(e.code, true)) e.preventDefault();
	}
	function onKeyUp(e: KeyboardEvent) {
		if (!engine || !focused) return;
		if (engine.onKey(e.code, false)) e.preventDefault();
	}

	// On-screen d-pad: press-and-hold.
	let held = $state<string | null>(null);
	function hold(dir: 'fwd' | 'back' | 'left' | 'right' | null) {
		held = dir;
		if (!engine) return;
		if (!dir) return engine.setTouch(null);
		const map = { fwd: [1, 0], back: [-1, 0], left: [0, 1], right: [0, -1] } as const;
		engine.setTouch(map[dir][0], map[dir][1]);
	}

	onMount(() => {
		try {
			const test = document.createElement('canvas');
			webgl = !!(test.getContext('webgl2') || test.getContext('webgl') || test.getContext('experimental-webgl'));
		} catch {
			webgl = false;
		}
		return () => engine?.dispose();
	});

	const modeLabel = (t: Telemetry) => {
		if (t.recovering === 'settle') return 'Fell · settling';
		if (t.recovering === 'standing') return 'Fell · standing up';
		if (t.mode === 'sitstand') return t.sitting ? 'Sitting' : 'Sit ↔ stand';
		if (t.mode === 'groundpick') return 'Ground pick';
		if (t.mode === 'kickL') return 'Kick left';
		if (t.mode === 'kickR') return 'Kick right';
		if (t.mode === 'roll') return 'Roulade';
		if (t.loco === 'rollers') return t.speed > 0.03 || Math.abs(t.cmd[0]) + Math.abs(t.cmd[2]) > 0 ? 'Skating' : 'Rollers · idle';
		return t.policy === 'stand' ? 'Standing' : 'Walking';
	};
</script>

<svelte:window onkeydown={onKeyDown} onkeyup={onKeyUp} />

<div class="sim">
	<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
	<div
		class="frame"
		bind:this={frame}
		tabindex="0"
		role="application"
		aria-label="Microduck simulation viewport. Click to focus, then use the keyboard."
		onfocusin={() => (focused = true)}
		onfocusout={() => (focused = false)}
		onpointerdown={() => frame.focus()}
	>
		<canvas bind:this={canvas}></canvas>

		{#if phase === 'idle'}
			<div class="overlay center">
				<div class="start">
					<div class="eyebrow">In-browser · MuJoCo WASM + ONNX Runtime Web</div>
					<h3>Run the real Microduck policies</h3>
					<p class="small">Downloads about 26 MB once (MuJoCo 10 MB, ONNX Runtime 13 MB, robot + 7 policies 8 MB). Chrome recommended.</p>
					{#if !webgl}
						<p class="small warn">WebGL is unavailable in this browser. Physics and policies still run; the view falls back to a 2D side view. See the note below to enable WebGL.</p>
					{/if}
					<button class="btn primary" type="button" onclick={boot}>▶ Load and start{webgl ? '' : ' (2D view)'}</button>
				</div>
			</div>
		{:else if phase === 'booting' || phase === 'error'}
			<div class="overlay">
				<div class="bios">
					<div class="bios-title">MICRODUCK SIM · BOOT</div>
					{#each bootLines as l (l.label)}
						<div class="line">
							<span class="lbl">{l.label}</span>
							<span class="dots"></span>
							<span class="st {l.state}">{l.state === 'ok' ? 'OK' : l.state === 'fail' ? 'FAILED' : (l.detail ?? '…')}</span>
						</div>
					{/each}
					{#if phase === 'error'}
						<div class="halt">
							<strong>SYSTEM HALTED</strong>
							<div>{error}</div>
							<button class="btn" type="button" onclick={() => { phase = 'idle'; }}>Try again</button>
						</div>
					{/if}
				</div>
			</div>
		{/if}

		{#if phase === 'ready' && tel}
			<div class="hud top">
				<span class="badge mode">{modeLabel(tel)}</span>
				<span class="badge">policy <b>{POLICY_LABELS[tel.policy]}</b></span>
				<span class="badge">{tel.ctrlHz.toFixed(0)} Hz</span>
				<span class="badge">t {tel.simTime.toFixed(1)} s</span>
				<span class="badge">v {tel.speed.toFixed(2)} m/s</span>
				<span class="badge">cmd {tel.cmd[0].toFixed(2)} / {tel.cmd[2].toFixed(2)}</span>
				<span class="badge">{tel.loco === 'rollers' ? '🛼 rollers' : '🦶 legs'}</span>
				{#if tel.pen !== 'parked'}
					<span class="badge pen">pen {tel.pen === 'held' ? 'in beak ✓' : 'on floor'}</span>
				{/if}
				{#if tel.render === 'canvas2d'}
					<span class="badge warn2d">2D fallback · no WebGL</span>
				{/if}
			</div>
			{#if notice}
				<div class="hud hint notice">{notice}</div>
			{:else if !focused}
				<div class="hud hint">Click the scene to grab the keyboard</div>
			{/if}
		{/if}
	</div>

	{#if !webgl}
		<aside class="nogl">
			<strong>WebGL is off in this browser.</strong> The simulation still runs (MuJoCo and the ONNX policies do not need a GPU); only the 3D view is replaced by a 2D side view. To get the 3D view:
			<ul class="small">
				<li><strong>VS Code Simple Browser / IDE webviews</strong> have no WebGL. Open <code>{typeof location !== 'undefined' ? location.href : 'this page'}</code> in Chrome, Edge or Firefox.</li>
				<li><strong>Chrome / Edge:</strong> Settings → System → enable "Use graphics acceleration when available", or set <code>chrome://flags/#ignore-gpu-blocklist</code> to Enabled, then restart.</li>
				<li><strong>Firefox:</strong> in <code>about:config</code> set <code>webgl.disabled</code> to <code>false</code> (and <code>webgl.force-enabled</code> to <code>true</code> on blocklisted GPUs).</li>
				<li><strong>Remote desktop, VMs, headless:</strong> no GPU; Chrome can still render with software (SwiftShader) when the blocklist is ignored.</li>
			</ul>
		</aside>
	{/if}

	{#if phase === 'ready'}
		<div class="controls">
			<div class="dpad" aria-label="Movement">
				<button type="button" class:on={held === 'fwd'} onpointerdown={() => hold('fwd')} onpointerup={() => hold(null)} onpointerleave={() => held === 'fwd' && hold(null)} aria-label="Forward">▲</button>
				<div class="row">
					<button type="button" class:on={held === 'left'} onpointerdown={() => hold('left')} onpointerup={() => hold(null)} onpointerleave={() => held === 'left' && hold(null)} aria-label="Turn left">◀</button>
					<button type="button" class:on={held === 'back'} onpointerdown={() => hold('back')} onpointerup={() => hold(null)} onpointerleave={() => held === 'back' && hold(null)} aria-label="Backward">▼</button>
					<button type="button" class:on={held === 'right'} onpointerdown={() => hold('right')} onpointerup={() => hold(null)} onpointerleave={() => held === 'right' && hold(null)} aria-label="Turn right">▶</button>
				</div>
			</div>
			<div class="actions">
				<button type="button" class="loco" onclick={() => act('loco')} disabled={tel?.switching}>
					<kbd>M</kbd> {tel?.switching ? 'Switching…' : tel?.loco === 'rollers' ? 'Switch to legs' : 'Switch to rollers'}
				</button>
				{#if tel?.loco !== 'rollers'}
					<button type="button" onclick={() => act('pen')}><kbd>B</kbd> {tel?.pen === 'held' ? 'Drop pen' : 'Place pen'}</button>
					<button type="button" onclick={() => act('groundpick')}><kbd>G</kbd> Ground pick</button>
					<button type="button" onclick={() => act('sit')}><kbd>R</kbd> {tel?.sitting ? 'Stand up' : 'Sit'}</button>
					<button type="button" onclick={() => act('kickL')}><kbd>Q</kbd> Kick L</button>
					<button type="button" onclick={() => act('kickR')}><kbd>E</kbd> Kick R</button>
					<button type="button" onclick={() => act('roll')}><kbd>X</kbd> Roulade</button>
				{/if}
				<button type="button" onclick={() => act('push')}><kbd>P</kbd> Push</button>
				{#if tel?.render !== 'canvas2d'}
					<button type="button" onclick={() => act('chase')}><kbd>C</kbd> Chase cam {tel?.chase ? 'on' : 'off'}</button>
				{/if}
				<button type="button" onclick={toggleRun}>{running ? '⏸ Pause' : '▶ Resume'}</button>
				<button type="button" class="danger" onclick={() => act('reset')}><kbd>Space</kbd> Reset</button>
			</div>
		</div>
	{/if}
</div>

<style>
	.sim { display: grid; gap: 0.8rem; }
	.frame { position: relative; aspect-ratio: 16 / 10; border-radius: var(--radius); overflow: hidden; border: 1px solid var(--line); background: #0b0d12; outline: none; }
	.frame:focus-visible { border-color: var(--yellow); box-shadow: 0 0 0 3px color-mix(in srgb, var(--yellow) 35%, transparent); }
	canvas { display: block; width: 100%; height: 100%; touch-action: none; }
	.overlay { position: absolute; inset: 0; display: grid; padding: 1rem; background: color-mix(in srgb, var(--bg) 80%, transparent); }
	.overlay.center { place-items: center; text-align: center; }
	.start { max-width: 34rem; }
	.start h3 { margin-top: 0.4rem; }
	.start .btn { margin-top: 0.5rem; }
	.warn { color: var(--orange); }
	.bios { font-family: var(--mono); font-size: 0.85rem; color: #b9e3a6; align-self: start; }
	.bios-title { color: var(--yellow); font-weight: 700; margin-bottom: 0.6rem; letter-spacing: 0.08em; }
	.line { display: flex; gap: 0.5rem; align-items: baseline; margin: 0.15rem 0; }
	.dots { flex: 1; border-bottom: 1px dotted #3a4a3a; transform: translateY(-4px); }
	.st.ok { color: var(--green); }
	.st.fail { color: var(--red); }
	.st.run { color: var(--ink-2); }
	.st.warn { color: var(--orange); }
	.badge.warn2d { color: var(--orange); }
	.badge.pen { color: var(--blue); }
	.hud.hint.notice { color: var(--yellow); }
	.actions button.loco { color: var(--yellow); }
	.actions button[disabled] { opacity: 0.6; cursor: wait; }
	.nogl { border: 1px solid var(--line); border-left: 4px solid var(--orange); border-radius: 10px; padding: 0.8rem 1rem; background: var(--bg-2); color: var(--ink-2); font-size: 0.95rem; }
	.nogl ul { margin: 0.5rem 0 0; }
	.halt { margin-top: 1rem; color: var(--red); display: grid; gap: 0.5rem; justify-items: start; }
	.halt div { color: var(--ink-2); white-space: pre-wrap; }
	.hud { position: absolute; left: 0.7rem; right: 0.7rem; display: flex; gap: 0.4rem; flex-wrap: wrap; pointer-events: none; }
	.hud.top { top: 0.7rem; }
	.hud.hint { bottom: 0.7rem; justify-content: center; color: var(--ink-2); font-size: 0.85rem; text-shadow: 0 1px 2px #000; }
	.badge { font-family: var(--mono); font-size: 0.75rem; padding: 0.2rem 0.5rem; border-radius: 6px; background: color-mix(in srgb, var(--bg) 70%, transparent); color: var(--ink-2); border: 1px solid var(--line); }
	.badge b { color: var(--ink); }
	.badge.mode { color: var(--yellow); font-weight: 700; }
	.controls { display: flex; gap: 1rem; align-items: flex-start; flex-wrap: wrap; }
	.dpad { display: grid; gap: 0.3rem; justify-items: center; }
	.dpad .row { display: flex; gap: 0.3rem; }
	.dpad button { width: 3rem; height: 3rem; border-radius: 10px; background: var(--bg-2); border: 1px solid var(--line); color: var(--ink); font-size: 1rem; cursor: pointer; touch-action: none; user-select: none; }
	.dpad button.on, .dpad button:active { background: var(--yellow); color: #14120a; }
	.actions { display: flex; flex-wrap: wrap; gap: 0.4rem; flex: 1; }
	.actions button { font: inherit; font-size: 0.88rem; font-weight: 600; color: var(--ink); background: var(--bg-2); border: 1px solid var(--line); border-radius: 8px; padding: 0.45rem 0.7rem; cursor: pointer; display: inline-flex; gap: 0.4rem; align-items: center; }
	.actions button:hover { background: var(--bg-3); }
	.actions button.danger { color: var(--orange); }
	.actions kbd { font-size: 0.7rem; }
</style>
