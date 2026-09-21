<script lang="ts">
	import '../app.css';
	import favicon from '#lib/assets/favicon.svg';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';

	let { children } = $props();

	const nav = [
		{ href: resolve('/'), label: 'Overview' },
		{ href: resolve('/simulate'), label: 'How to simulate' },
		{ href: resolve('/run-locally'), label: 'Run locally' },
		{ href: resolve('/bom'), label: 'BOM' },
		{ href: resolve('/printables'), label: 'Printables' },
		{ href: resolve('/sim'), label: 'Live sim', hot: true }
	];
	const active = (href: string) =>
		href === resolve('/') ? page.url.pathname === href : page.url.pathname.startsWith(href);
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

<header>
	<div class="wrap bar">
		<a class="brand" href={resolve('/')}>
			<img class="duck" src={favicon} alt="" width="26" height="26" />
			<span>microduck<span class="dot">.sim</span></span>
		</a>
		<nav aria-label="Main">
			{#each nav as item (item.href)}
				<a href={item.href} class:active={active(item.href)} class:hot={item.hot}>{item.label}</a>
			{/each}
		</nav>
	</div>
</header>

<main>
	{@render children()}
</main>

<footer>
	<div class="wrap foot">
		<p class="small">
			Unofficial guide. Microduck is made by
			<a href="https://pollen-robotics.com/microduck/" rel="noopener">Pollen Robotics</a> and
			<a href="https://huggingface.co/pollen-robotics" rel="noopener">Hugging Face</a>.
			Robot model, meshes and ONNX policies come from the Apache-2.0
			<a href="https://github.com/pollen-robotics/microduck" rel="noopener">microduck</a>,
			<a href="https://github.com/pollen-robotics/microduck_rl" rel="noopener">microduck_rl</a> and
			<a href="https://huggingface.co/spaces/pollen-robotics/microduck-simulator" rel="noopener">microduck-simulator</a> repositories.
		</p>
		<p class="small muted">Built with SvelteKit 3 (release candidate), MuJoCo 3.11 WebAssembly and ONNX Runtime Web 1.27.</p>
	</div>
</footer>

<style>
	header { position: sticky; top: 0; z-index: 10; backdrop-filter: blur(10px); background: color-mix(in srgb, var(--bg) 85%, transparent); border-bottom: 1px solid var(--line); }
	.bar { display: flex; align-items: center; justify-content: space-between; gap: 1rem; height: 60px; }
	.brand { display: flex; align-items: center; gap: 0.5rem; font-weight: 800; color: var(--ink); letter-spacing: -0.01em; }
	.brand:hover { text-decoration: none; }
	.dot { color: var(--yellow); }
	.duck { width: 26px; height: 26px; border-radius: 6px; }
	nav { display: flex; gap: 0.25rem; overflow-x: auto; }
	nav a { color: var(--ink-2); padding: 0.4rem 0.75rem; border-radius: 8px; font-weight: 600; font-size: 0.93rem; white-space: nowrap; }
	nav a:hover { color: var(--ink); background: var(--bg-3); text-decoration: none; }
	nav a.active { color: var(--ink); background: var(--bg-3); }
	nav a.hot { color: var(--yellow); }
	main { min-height: 70vh; }
	footer { border-top: 1px solid var(--line); margin-top: 4rem; }
	.foot { padding: 2rem 1.25rem; }
	@media (max-width: 640px) { .brand span:last-child { display: none; } }
</style>
