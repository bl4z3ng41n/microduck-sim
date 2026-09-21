<script lang="ts">
	import { onMount } from 'svelte';
	import { asset } from '$app/paths';
	import type { CompareMode, CompareStats, MeshCompare as Viewer } from '#lib/sim/compare.ts';

	let {
		leftUrl,
		simMesh,
		simFallbackUrl = undefined,
		leftLabel = 'community STL',
		rightLabel = 'simulation mesh'
	}: { leftUrl: string | null; simMesh: string | null; simFallbackUrl?: string; leftLabel?: string; rightLabel?: string } = $props();

	let canvas: HTMLCanvasElement;
	let viewer: Viewer | null = null;
	let status = $state<'init' | 'ready' | 'nogl' | 'error'>('init');
	let loading = $state(false);
	let error = $state('');
	let stats = $state<CompareStats | null>(null);
	let mode = $state<CompareMode>('side');
	let wire = $state(false);
	const simBase = asset('sim/mujoco.js').replace(/mujoco\.js$/, '');

	onMount(() => {
		let disposed = false;
		(async () => {
			const { MeshCompare } = await import('#lib/sim/compare.ts');
			try {
				const probe = document.createElement('canvas');
				if (!(probe.getContext('webgl2') || probe.getContext('webgl'))) {
					status = 'nogl';
					return;
				}
				viewer = new MeshCompare(canvas, simBase);
				viewer.onStats = (s) => (stats = s);
				viewer.mount();
				if (disposed) return;
				status = 'ready';
			} catch (e) {
				error = e instanceof Error ? e.message : String(e);
				status = 'error';
			}
		})();
		return () => {
			disposed = true;
			viewer?.dispose();
		};
	});

	$effect(() => {
		// Read every reactive input before any early return, so the effect
		// keeps tracking them even while the viewer is not ready yet.
		const url = leftUrl, mesh = simMesh, fb = simFallbackUrl, ready = status === 'ready';
		if (!viewer || !ready || !url) return;
		loading = true;
		error = '';
		viewer
			.load(url, mesh ?? '', fb)
			.catch((e) => (error = `Could not load: ${e instanceof Error ? e.message : String(e)}`))
			.finally(() => (loading = false));
	});
	$effect(() => {
		const m = mode, ready = status === 'ready';
		if (ready) viewer?.setMode(m);
	});
	$effect(() => {
		const w = wire, ready = status === 'ready';
		if (ready) viewer?.setWireframe(w);
	});
</script>

<div class="cmp">
	<canvas bind:this={canvas}></canvas>
	{#if status === 'nogl'}
		<div class="msg">Mesh comparison needs WebGL.</div>
	{:else if status === 'error' || error}
		<div class="msg err">{error}</div>
	{:else if !leftUrl}
		<div class="msg">Pick a file in the table to compare it with the simulation mesh.</div>
	{:else if loading}
		<div class="msg">Loading STL from GitHub…</div>
	{/if}
	<div class="bar">
		<span class="lg left">■ {leftLabel}{stats ? ` · ${stats.leftTris.toLocaleString()} tris` : ''}</span>
		<span class="lg right">■ {rightLabel}{stats ? (stats.rightTris ? ` · ${stats.rightTris.toLocaleString()} tris` : ' · none') : ''}</span>
		{#if stats}<span class="lg muted">{stats.sizeMm.map((v) => v.toFixed(1)).join(' × ')} mm</span>{/if}
		<span class="spacer"></span>
		<button type="button" class:on={mode === 'side'} onclick={() => (mode = 'side')}>Side by side</button>
		<button type="button" class:on={mode === 'overlay'} onclick={() => (mode = 'overlay')}>Overlay</button>
		<button type="button" class:on={wire} onclick={() => (wire = !wire)}>Wireframe</button>
	</div>
</div>

<style>
	.cmp { position: relative; aspect-ratio: 16 / 9; border: 1px solid var(--line); border-radius: var(--radius); overflow: hidden; background: radial-gradient(ellipse at 50% 40%, #171b26 0%, #0b0d12 75%); }
	canvas { display: block; width: 100%; height: 100%; touch-action: none; }
	.msg { position: absolute; inset: 0 0 2.6rem 0; display: grid; place-items: center; padding: 1rem; text-align: center; color: var(--ink-2); font-size: 0.9rem; pointer-events: none; }
	.msg.err { color: var(--red); }
	.bar { position: absolute; left: 0; right: 0; bottom: 0; display: flex; flex-wrap: wrap; gap: 0.4rem 0.8rem; align-items: center; padding: 0.45rem 0.7rem; background: color-mix(in srgb, var(--bg) 85%, transparent); border-top: 1px solid var(--line); font-size: 0.78rem; }
	.lg.left { color: #6fb3ff; }
	.lg.right { color: var(--cream); }
	.spacer { flex: 1; }
	.bar button { font: inherit; font-size: 0.75rem; font-weight: 700; color: var(--ink-2); background: var(--bg-2); border: 1px solid var(--line); border-radius: 6px; padding: 0.2rem 0.55rem; cursor: pointer; }
	.bar button.on { color: var(--yellow); border-color: var(--yellow); }
</style>
