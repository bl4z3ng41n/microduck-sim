<script lang="ts">
	import { onMount } from 'svelte';
	import type { MoonrakerClient, PrinterStatus, StatusEvent, GcodeFile } from '#lib/printer/moonraker.ts';
	import { EMPTY_STATUS, fmtDuration } from '#lib/printer/moonraker.ts';

	let {
		onEvent = undefined,
		onStatus = undefined,
		expectedFiles = []
	}: { onEvent?: (e: StatusEvent) => void; onStatus?: (s: PrinterStatus) => void; expectedFiles?: string[] } = $props();

	let host = $state('http://192.168.1.50');
	let client: MoonrakerClient | null = null;
	let status = $state<PrinterStatus>({ ...EMPTY_STATUS });
	let phase = $state<'idle' | 'connecting' | 'live' | 'error'>('idle');
	let error = $state('');
	let log = $state<{ t: number; text: string; kind: string }[]>([]);
	let files = $state<GcodeFile[]>([]);
	let notify = $state(false);
	let printerName = $state('');
	let busy = $state('');
	let fileInput = $state<HTMLInputElement>();

	onMount(() => {
		try {
			const saved = localStorage.getItem('duck.printer.host');
			if (saved) host = saved;
			notify = localStorage.getItem('duck.printer.notify') === '1' && 'Notification' in window && Notification.permission === 'granted';
		} catch { /* ignore */ }
		return () => client?.stop();
	});

	function addLog(text: string, kind = 'info') {
		log = [{ t: Date.now(), text, kind }, ...log].slice(0, 40);
	}

	function describe(e: StatusEvent): { text: string; kind: string; human?: string } | null {
		switch (e.kind) {
			case 'connected': return { text: `Connected to ${printerName || 'printer'}`, kind: 'ok' };
			case 'disconnected': return { text: `Disconnected (${e.reason})`, kind: 'warn' };
			case 'print_started': return { text: `Print started: ${e.filename}`, kind: 'ok', human: 'Nothing to do. Check the first layer after a few minutes.' };
			case 'print_paused': return { text: `Print paused: ${e.filename}${e.message ? ` · ${e.message}` : ''}`, kind: 'warn', human: 'Printer is waiting for you: check filament (runout?), then Resume.' };
			case 'print_resumed': return { text: `Print resumed: ${e.filename}`, kind: 'ok' };
			case 'print_complete': return { text: `Print complete: ${e.filename} (${fmtDuration(e.durationS)})`, kind: 'ok', human: 'Remove the part from the bed, remove supports, check the M2 holes, tick it in the step.' };
			case 'print_cancelled': return { text: `Print cancelled: ${e.filename}`, kind: 'warn', human: 'Clear the bed before starting the next file.' };
			case 'print_error': return { text: `Print error: ${e.filename}${e.message ? ` · ${e.message}` : ''}`, kind: 'bad', human: 'Inspect the printer; a Klipper error needs a firmware restart from Fluidd.' };
			case 'klippy': return { text: `Klipper ${e.state}`, kind: e.state === 'ready' ? 'ok' : 'warn' };
		}
	}

	function handleEvent(e: StatusEvent) {
		const d = describe(e);
		if (d) {
			addLog(d.human ? `${d.text} → ${d.human}` : d.text, d.kind);
			if (notify && d.human && 'Notification' in window && Notification.permission === 'granted') {
				try { new Notification(`Microduck build · ${d.text}`, { body: d.human }); } catch { /* ignore */ }
			}
		}
		onEvent?.(e);
	}

	async function connect() {
		client?.stop();
		phase = 'connecting';
		error = '';
		try {
			const { MoonrakerClient } = await import('#lib/printer/moonraker.ts');
			const c = new MoonrakerClient(host.trim());
			const info = await c.info();
			printerName = info.hostname || host;
			try { localStorage.setItem('duck.printer.host', host.trim()); } catch { /* ignore */ }
			c.onStatus = (s) => { status = s; onStatus?.(s); };
			c.onEvent = handleEvent;
			client = c;
			c.start(3000);
			phase = 'live';
			addLog(`Connected: ${printerName} · Klipper ${info.state}`, 'ok');
			void refreshFiles();
		} catch (e) {
			phase = 'error';
			const msg = e instanceof Error ? e.message : String(e);
			error = /Failed to fetch|NetworkError|Load failed/.test(msg)
				? `Cannot reach ${host}. Check the IP/port (Neptune 4: port 80), that you are on the same network, and that moonraker.conf cors_domains allows this page's origin (${location.origin}).`
				: msg;
		}
	}

	function disconnect() {
		client?.stop();
		client = null;
		phase = 'idle';
		status = { ...EMPTY_STATUS };
	}

	async function refreshFiles() {
		if (!client) return;
		try {
			files = (await client.listGcodes()).filter((f) => /\.g(code)?$/i.test(f.path)).sort((a, b) => b.modified - a.modified);
		} catch (e) {
			addLog(`File list failed: ${e instanceof Error ? e.message : e}`, 'warn');
		}
	}

	async function act(name: string, fn: () => Promise<unknown>) {
		if (!client || busy) return;
		busy = name;
		try {
			await fn();
			addLog(`${name} sent`, 'info');
		} catch (e) {
			addLog(`${name} failed: ${e instanceof Error ? e.message : e}`, 'bad');
		} finally {
			busy = '';
		}
	}

	async function uploadFiles(list: FileList | null) {
		if (!client || !list?.length) return;
		for (const f of Array.from(list)) {
			await act(`Upload ${f.name}`, () => client!.upload(f, false));
		}
		await refreshFiles();
	}

	async function requestNotify() {
		if (!('Notification' in window)) return;
		const p = await Notification.requestPermission();
		notify = p === 'granted';
		try { localStorage.setItem('duck.printer.notify', notify ? '1' : '0'); } catch { /* ignore */ }
	}

	const stateLabel = (s: PrinterStatus) =>
		!s.connected ? 'offline' : s.klippyState && s.klippyState !== 'ready' && s.klippyState !== 'unknown' ? `klipper ${s.klippyState}` : s.state;
	const expected = $derived(new Set(expectedFiles.map((f) => f.toLowerCase())));
	const isExpected = (path: string) => expected.has(path.toLowerCase().replace(/\.g(code)?$/i, '.stl').split('/').pop() ?? '');
</script>

<div class="panel card">
	<div class="head">
		<h3>3D printer</h3>
		<span class="state {status.connected ? (status.state === 'printing' ? 'printing' : status.state === 'paused' || status.state === 'error' ? 'warn' : 'ok') : 'off'}">{stateLabel(status)}</span>
	</div>

	<div class="row">
		<input type="text" bind:value={host} placeholder="http://192.168.1.50  (Neptune 4: port 80)" aria-label="Moonraker host" onkeydown={(e) => e.key === 'Enter' && connect()} />
		{#if phase === 'live'}
			<button type="button" onclick={disconnect}>Disconnect</button>
		{:else}
			<button type="button" class="primary" onclick={connect} disabled={phase === 'connecting'}>{phase === 'connecting' ? 'Connecting…' : 'Connect'}</button>
		{/if}
	</div>
	{#if phase === 'error'}<div class="err">{error}</div>{/if}
	{#if phase === 'idle'}
		<p class="small muted">Klipper / Moonraker printers (Elegoo Neptune 4 family, Creality K1, Voron…). Stock Neptune 4 Pro: <code>http://&lt;printer-ip&gt;</code>. Self-built Klipper: <code>http://&lt;ip&gt;:7125</code>. Reads status live, uploads G-code, starts prints, tells you when a hand is needed.</p>
	{/if}

	{#if phase === 'live'}
		<div class="status">
			<div class="file">{status.filename || 'no file loaded'}</div>
			<div class="bar"><div class="fill" style="width:{(status.progress * 100).toFixed(1)}%"></div></div>
			<div class="nums">
				<span>{(status.progress * 100).toFixed(0)} %</span>
				<span>elapsed {fmtDuration(status.printDurationS)}</span>
				<span>ETA {fmtDuration(status.etaS)}</span>
				{#if status.layer != null}<span>layer {status.layer}{status.totalLayers ? ` / ${status.totalLayers}` : ''}</span>{/if}
			</div>
			<div class="nums temps">
				<span>bed {status.bedTemp.toFixed(0)} / {status.bedTarget.toFixed(0)} °C</span>
				<span>nozzle {status.extruderTemp.toFixed(0)} / {status.extruderTarget.toFixed(0)} °C</span>
				{#if status.message}<span class="msg">{status.message}</span>{/if}
			</div>
			<div class="actions">
				{#if status.state === 'printing'}
					<button type="button" onclick={() => act('Pause', () => client!.pausePrint())} disabled={!!busy}>Pause</button>
				{:else if status.state === 'paused'}
					<button type="button" class="primary" onclick={() => act('Resume', () => client!.resumePrint())} disabled={!!busy}>Resume</button>
				{/if}
				{#if status.state === 'printing' || status.state === 'paused'}
					<button type="button" class="danger" onclick={() => confirm('Cancel the running print?') && act('Cancel', () => client!.cancelPrint())} disabled={!!busy}>Cancel</button>
				{/if}
				<button type="button" onclick={() => fileInput?.click()} disabled={!!busy}>Upload G-code…</button>
				<input bind:this={fileInput} type="file" accept=".gcode,.g" multiple hidden onchange={(e) => uploadFiles((e.currentTarget as HTMLInputElement).files)} />
				<button type="button" onclick={refreshFiles}>↻ Files</button>
				<label class="notify"><input type="checkbox" checked={notify} onchange={requestNotify} /> Desktop notifications</label>
			</div>
		</div>

		{#if files.length}
			<div class="files">
				<div class="small muted">G-code on the printer · <b>bold</b> = matches a part of this build</div>
				<ul>
					{#each files.slice(0, 40) as f (f.path)}
						<li class:hit={isExpected(f.path)}>
							<span class="fname">{f.path}</span>
							<button type="button" class="start" disabled={status.state === 'printing' || status.state === 'paused' || !!busy} onclick={() => act(`Start ${f.path}`, () => client!.startPrint(f.path))}>▶ Print</button>
						</li>
					{/each}
				</ul>
			</div>
		{/if}
	{/if}

	{#if log.length}
		<div class="log">
			{#each log as l (l.t + l.text)}
				<div class="line {l.kind}"><span class="t">{new Date(l.t).toLocaleTimeString()}</span> {l.text}</div>
			{/each}
		</div>
	{/if}
</div>

<style>
	.panel { display: grid; gap: 0.7rem; }
	.head { display: flex; justify-content: space-between; align-items: center; }
	.head h3 { margin: 0; }
	.state { font-family: var(--mono); font-size: 0.75rem; font-weight: 700; text-transform: uppercase; padding: 0.15rem 0.55rem; border-radius: 999px; border: 1px solid var(--line); color: var(--ink-3); }
	.state.ok { color: var(--green); } .state.printing { color: var(--yellow); } .state.warn { color: var(--orange); }
	.row { display: flex; gap: 0.4rem; }
	.row input { flex: 1; font: inherit; font-size: 0.88rem; font-family: var(--mono); color: var(--ink); background: var(--bg); border: 1px solid var(--line); border-radius: 8px; padding: 0.4rem 0.6rem; min-width: 0; }
	button { font: inherit; font-size: 0.82rem; font-weight: 700; color: var(--ink); background: var(--bg-3); border: 1px solid var(--line); border-radius: 8px; padding: 0.4rem 0.7rem; cursor: pointer; white-space: nowrap; }
	button.primary { background: var(--yellow); color: #14120a; border-color: var(--yellow); }
	button.danger { color: var(--orange); }
	button[disabled] { opacity: 0.5; cursor: not-allowed; }
	.err { color: var(--orange); font-size: 0.85rem; }
	.status { display: grid; gap: 0.4rem; }
	.file { font-family: var(--mono); font-size: 0.85rem; color: var(--ink); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.bar { height: 8px; background: var(--bg); border: 1px solid var(--line); border-radius: 999px; overflow: hidden; }
	.fill { height: 100%; background: var(--yellow); transition: width 0.5s; }
	.nums { display: flex; flex-wrap: wrap; gap: 0.3rem 0.9rem; font-family: var(--mono); font-size: 0.78rem; color: var(--ink-2); }
	.temps { color: var(--ink-3); }
	.msg { color: var(--orange); }
	.actions { display: flex; flex-wrap: wrap; gap: 0.4rem; align-items: center; margin-top: 0.2rem; }
	.notify { font-size: 0.8rem; color: var(--ink-2); display: inline-flex; gap: 0.3rem; align-items: center; margin-left: auto; }
	.files ul { list-style: none; margin: 0.3rem 0 0; padding: 0; max-height: 12rem; overflow: auto; display: grid; gap: 0.2rem; }
	.files li { display: flex; justify-content: space-between; align-items: center; gap: 0.5rem; font-family: var(--mono); font-size: 0.78rem; color: var(--ink-3); padding: 0.15rem 0.3rem; border-radius: 6px; }
	.files li.hit { color: var(--ink); font-weight: 700; background: color-mix(in srgb, var(--yellow) 8%, transparent); }
	.fname { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.start { font-size: 0.72rem; padding: 0.15rem 0.5rem; }
	.log { max-height: 10rem; overflow: auto; font-size: 0.78rem; display: grid; gap: 0.15rem; border-top: 1px solid var(--line); padding-top: 0.5rem; }
	.line { color: var(--ink-2); } .line.ok { color: var(--green); } .line.warn { color: var(--orange); } .line.bad { color: var(--red); }
	.t { font-family: var(--mono); color: var(--ink-3); margin-right: 0.4rem; }
</style>
