<script lang="ts">
	import { onMount } from 'svelte';
	import { asset } from '$app/paths';
	import type { Highlight, HighlightStats, PartViewer as Viewer } from '#lib/sim/viewer.ts';

	let { highlight = null, pinned = false }: { highlight: Highlight | null; pinned?: boolean } = $props();

	let canvas: HTMLCanvasElement;
	let viewer: Viewer | null = null;
	let status = $state<'loading' | 'ready' | 'nogl' | 'error'>('loading');
	let error = $state('');
	let stats = $state<HighlightStats | null>(null);
	const simBase = asset('sim/mujoco.js').replace(/mujoco\.js$/, '');

	onMount(() => {
		let disposed = false;
		(async () => {
			const { PartViewer } = await import('#lib/sim/viewer.ts');
			if (!PartViewer.webglAvailable()) {
				status = 'nogl';
				return;
			}
			try {
				viewer = new PartViewer(canvas, simBase);
				viewer.onStats = (s) => (stats = s);
				await viewer.mount();
				if (disposed) return;
				status = 'ready';
				void viewer.setHighlight(highlight);
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
		const h = highlight;
		if (viewer && status === 'ready') void viewer.setHighlight(h);
	});
</script>

<div class="viewer">
	<canvas bind:this={canvas}></canvas>
	{#if status === 'loading'}
		<div class="msg">Loading robot model…</div>
	{:else if status === 'nogl'}
		<div class="msg">3D part preview needs WebGL. Enable graphics acceleration in the browser to see parts highlighted on the robot.</div>
	{:else if status === 'error'}
		<div class="msg err">Preview failed: {error}</div>
	{/if}
	<div class="caption">
		{#if highlight}
			<div class="name">{highlight.label}{#if pinned}<span class="pin">pinned</span>{/if}</div>
			{#if stats}
				<div class="small muted">
					{stats.meshInstances} mesh instance{stats.meshInstances === 1 ? '' : 's'}{stats.sites ? ` · ${stats.sites} sensor site${stats.sites === 1 ? '' : 's'}` : ''} highlighted
					{stats.variant === 'rollers' ? ' · roller variant' : ''}
				</div>
			{:else}
				<div class="small muted">Not represented in the simulation model</div>
			{/if}
		{:else}
			<div class="name">Microduck, STAND pose</div>
			<div class="small muted">Hover or tap a row to highlight that part. Drag to orbit, wheel to zoom.</div>
		{/if}
	</div>
</div>

<style>
	.viewer { position: relative; aspect-ratio: 1 / 1.05; border: 1px solid var(--line); border-radius: var(--radius); overflow: hidden; background: radial-gradient(ellipse at 50% 40%, #171b26 0%, #0b0d12 75%); }
	canvas { display: block; width: 100%; height: 100%; touch-action: none; }
	.msg { position: absolute; inset: 0; display: grid; place-items: center; padding: 1.5rem; text-align: center; color: var(--ink-2); font-size: 0.9rem; background: color-mix(in srgb, var(--bg) 60%, transparent); }
	.msg.err { color: var(--red); }
	.caption { position: absolute; left: 0; right: 0; bottom: 0; padding: 0.6rem 0.8rem; background: linear-gradient(transparent, color-mix(in srgb, var(--bg) 92%, transparent) 40%); pointer-events: none; }
	.name { font-weight: 800; color: var(--yellow); display: flex; gap: 0.5rem; align-items: center; }
	.pin { font-size: 0.65rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: var(--ink-3); border: 1px solid var(--line); border-radius: 999px; padding: 0.05rem 0.45rem; }
</style>
