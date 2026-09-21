<script lang="ts">
	import type { Snippet } from 'svelte';
	let { kind = 'note', title = '', children }: { kind?: 'note' | 'warn' | 'tip'; title?: string; children: Snippet } = $props();
	const labels = { note: 'Note', warn: 'Warning', tip: 'Tip' };
</script>

<aside class="callout {kind}">
	<div class="label">{title || labels[kind]}</div>
	<div class="body">{@render children()}</div>
</aside>

<style>
	.callout { border: 1px solid var(--line); border-left: 4px solid var(--blue); border-radius: 10px; padding: 0.8rem 1rem; margin: 1.2rem 0; background: var(--bg-2); }
	.callout.warn { border-left-color: var(--orange); }
	.callout.tip { border-left-color: var(--green); }
	.label { font-size: 0.75rem; font-weight: 800; text-transform: uppercase; letter-spacing: 0.1em; color: var(--ink-3); margin-bottom: 0.2rem; }
	.body :global(p) { margin: 0.2rem 0; }
	.body :global(p:last-child) { margin-bottom: 0; }
</style>
