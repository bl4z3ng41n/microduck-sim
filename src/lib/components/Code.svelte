<script lang="ts">
	let { code, title = '', lang = 'sh' }: { code: string; title?: string; lang?: string } = $props();
	let copied = $state(false);
	async function copy() {
		try {
			await navigator.clipboard.writeText(code);
			copied = true;
			setTimeout(() => (copied = false), 1400);
		} catch {
			/* clipboard blocked: ignore */
		}
	}
</script>

<div class="code">
	<div class="head">
		<span class="title">{title || lang}</span>
		<button type="button" onclick={copy} aria-label="Copy to clipboard">{copied ? 'Copied' : 'Copy'}</button>
	</div>
	<pre><code>{code}</code></pre>
</div>

<style>
	.code { border: 1px solid var(--line); border-radius: var(--radius); background: #070910; margin: 0.8rem 0 1.4rem; overflow: hidden; }
	.head { display: flex; justify-content: space-between; align-items: center; padding: 0.35rem 0.6rem 0.35rem 0.9rem; border-bottom: 1px solid var(--line); background: var(--bg-2); }
	.title { font-family: var(--mono); font-size: 0.75rem; color: var(--ink-3); }
	button { font: inherit; font-size: 0.75rem; font-weight: 700; color: var(--ink-2); background: var(--bg-3); border: 1px solid var(--line); border-radius: 6px; padding: 0.2rem 0.6rem; cursor: pointer; }
	button:hover { color: var(--ink); }
	pre { margin: 0; padding: 0.9rem 1rem; overflow-x: auto; font-family: var(--mono); font-size: 0.86rem; line-height: 1.55; color: var(--cream); }
</style>
