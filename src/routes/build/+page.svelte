<script lang="ts">
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import Callout from '#lib/components/Callout.svelte';
	import PrinterPanel from '#lib/components/PrinterPanel.svelte';
	import PartViewer from '#lib/components/PartViewer.svelte';
	import type { Highlight } from '#lib/sim/viewer.ts';
	import instanceData from '#lib/data/mesh-instances.json';
	const INSTANCES = (instanceData as { legs: { key: string; mesh: string; body: string }[] }).legs;
	import { STEPS, SHOP, SHOP_BY_ID, COUNTRIES, COUNTRY_BY_CODE, DEFAULT_COUNTRY, linksFor, printHours, type Step, type PrintJob, type ShopItem, type ResolvedLink, type CheckItem } from '#lib/data/build-plan.ts';
	import type { StatusEvent } from '#lib/printer/moonraker.ts';
	import { fmtDuration } from '#lib/printer/moonraker.ts';

	// ── Persistent progress ─────────────────────────────────────────────
	interface Progress {
		checks: Record<string, boolean>; // `${stepId}:${index}`
		printed: Record<string, number>; // `${stepId}:${file}` → pieces done
		vendor: Record<string, number>; // shop item id → chosen link index
		ordered: Record<string, boolean>;
		received: Record<string, boolean>;
		last: { kind: 'print' | 'check' | 'ordered' | 'received'; label: string; keys: string[]; t: number; removed?: boolean } | null;
		startDate: string;
		ratePla: number;
		rateTpu: number;
		printHoursPerDay: number;
		workHoursPerDay: number;
		includeRollers: boolean;
		country: string;
	}
	const today = new Date().toISOString().slice(0, 10);
	let p = $state<Progress>({ checks: {}, printed: {}, vendor: {}, ordered: {}, received: {}, last: null, startDate: today, ratePla: 10, rateTpu: 5, printHoursPerDay: 10, workHoursPerDay: 2, includeRollers: false, country: DEFAULT_COUNTRY });
	let loaded = $state(false);
	onMount(() => {
		try {
			const raw = localStorage.getItem('duck.build.v1');
			if (raw) {
				const saved = JSON.parse(raw) as Partial<Progress> & { region?: string };
				if (!saved.country) saved.country = saved.region === 'US' ? 'US' : saved.region === 'CA' ? 'CA' : DEFAULT_COUNTRY;
				delete saved.region;
				p = { ...p, ...saved };
			}
		} catch { /* ignore */ }
		loaded = true;
	});
	$effect(() => {
		if (!loaded) return;
		const snap = JSON.stringify(p);
		try { localStorage.setItem('duck.build.v1', snap); } catch { /* ignore */ }
	});

	const steps = $derived(STEPS.filter((s) => p.includeRollers || s.id !== 'print-rollers'));
	const key = (s: Step, i: number) => `${s.id}:${i}`;
	const pkey = (s: Step, j: PrintJob) => `${s.id}:${j.file}`;
	const stepChecks = (s: Step) => s.checklist.filter((_, i) => p.checks[key(s, i)]).length;
	const stepPrintsDone = (s: Step) => (s.prints ?? []).every((j) => (p.printed[pkey(s, j)] ?? 0) >= j.qty);
	const stepDone = (s: Step) => stepChecks(s) === s.checklist.length && stepPrintsDone(s);
	const remainingPieces = (s: Step, j: PrintJob) => Math.max(0, j.qty - (p.printed[pkey(s, j)] ?? 0));
	const citems = (c: CheckItem): string[] => (typeof c === 'string' ? [] : c.items);
	// Order-step lines name the vendor chosen for the current country.
	const ctext = (c: CheckItem): string => {
		if (typeof c === 'string') return c;
		const vendors = [...new Set(c.items.map((id) => SHOP_BY_ID.get(id)).filter(Boolean).map((it) => chosenLink(it!).vendor))];
		return vendors.length ? `${c.text} · ${vendors.join(', ')}` : c.text;
	};
	function toggleCheck(s: Step, i: number) {
		const c = s.checklist[i];
		const on = !p.checks[key(s, i)];
		p.checks[key(s, i)] = on;
		const ids = citems(c);
		if (ids.length) {
			// Ticking an order line marks those shop items as ordered (and vice versa).
			for (const id of ids) p.ordered[id] = on;
			const keys = ids.flatMap((id) => SHOP_BY_ID.get(id)?.meshes ?? []);
			p.last = { kind: 'ordered', label: `${on ? 'Ordered' : 'Not ordered'}: ${ids.map((id) => SHOP_BY_ID.get(id)?.name ?? id).join(', ')}`, keys, t: Date.now(), removed: !on };
			return;
		}
		const keys = s.bodies ? INSTANCES.filter((x) => s.bodies!.includes(x.body)).map((x) => x.key) : (s.focus ?? s.adds ?? []);
		p.last = { kind: 'check', label: `${on ? 'Checked' : 'Unchecked'}: ${ctext(c)}`, keys, t: Date.now(), removed: !on };
	}
	function setPrinted(s: Step, j: PrintJob, n: number) {
		const v = Math.max(0, Math.min(j.qty, n));
		const prev = p.printed[pkey(s, j)] ?? 0;
		p.printed[pkey(s, j)] = v;
		const inst = INSTANCES.filter((x) => x.mesh === j.file).map((x) => x.key);
		const idx = Math.max(0, Math.min(inst.length - 1, (v > prev ? v : v + 1) - 1));
		p.last = { kind: 'print', label: `${j.file.replace(/\.stl$/, '')} ${v > prev ? 'printed' : 'un-ticked'} (${v}/${j.qty})`, keys: inst.length ? [inst[idx]] : [j.file], t: Date.now(), removed: v < prev };
	}
	function syncOrderChecks() {
		const order = steps.find((s) => s.phase === 'order');
		if (!order) return;
		order.checklist.forEach((c, i) => {
			const ids = citems(c);
			if (ids.length) p.checks[key(order, i)] = ids.every((id) => !!p.ordered[id]);
		});
	}
	function setOrdered(it: ShopItem, v: boolean) {
		p.ordered[it.id] = v;
		syncOrderChecks();
		p.last = { kind: 'ordered', label: `${v ? 'Ordered' : 'Not ordered'}: ${it.name}`, keys: it.meshes ?? [], t: Date.now(), removed: !v };
	}
	function setReceived(it: ShopItem, v: boolean) {
		p.received[it.id] = v;
		if (v) p.ordered[it.id] = true;
		syncOrderChecks();
		p.last = { kind: 'received', label: `${v ? 'Received' : 'Not received'}: ${it.name}`, keys: it.meshes ?? [], t: Date.now(), removed: !v };
	}

	function resetProgress() {
		if (!confirm('Uncheck everything? Checklists, printed pieces, ordered and received items are cleared. Settings (country, rates, dates) are kept.')) return;
		p = { ...p, checks: {}, printed: {}, ordered: {}, received: {}, last: null };
		openStep = null;
		toast('Progress reset', 'All ticks cleared. Settings kept.');
	}

	// ── Progress overview: on hand / assembled / global / last change ──────
	const printedKeys = $derived.by(() => {
		const keys: string[] = [];
		for (const s of steps) for (const j of s.prints ?? []) {
			if (s.variant === 'rollers') continue;
			const n = p.printed[pkey(s, j)] ?? 0;
			const inst = INSTANCES.filter((x) => x.mesh === j.file).map((x) => x.key);
			keys.push(...inst.slice(0, Math.min(n, inst.length)));
		}
		return keys;
	});
	const receivedKeys = $derived(SHOP.filter((it) => p.received[it.id]).flatMap((it) => it.meshes ?? []));
	const orderedKeys = $derived(SHOP.filter((it) => p.ordered[it.id] && !p.received[it.id]).flatMap((it) => it.meshes ?? []));
	const assembledKeys = $derived.by(() => {
		const bodies = new Set<string>();
		for (const s of steps) if (s.bodies && stepChecks(s) === s.checklist.length) for (const b of s.bodies) bodies.add(b);
		return INSTANCES.filter((x) => bodies.has(x.body)).map((x) => x.key);
	});
	const haveKeys = $derived([...printedKeys, ...receivedKeys]);
	const countInstances = (keys: string[]) => {
		const set = new Set(keys);
		return INSTANCES.filter((x) => set.has(x.key) || set.has(x.mesh)).length;
	};
	const nHave = $derived(countInstances(haveKeys));
	const nAssembled = $derived(countInstances(assembledKeys));
	const nHaveLoose = $derived.by(() => {
		const have = new Set(haveKeys), asm = new Set(assembledKeys);
		return INSTANCES.filter((x) => (have.has(x.key) || have.has(x.mesh)) && !(asm.has(x.key) || asm.has(x.mesh))).length;
	});
	const nOrdered = $derived(countInstances(orderedKeys));
	const haveView = $derived<Highlight>({ label: 'Pieces on hand', solid: haveKeys, others: 'hidden', frame: 'solid' });
	const assembledView = $derived<Highlight>({ label: 'Assembled so far', solid: assembledKeys, others: 'hidden', frame: 'solid' });
	// Removals are not lit in the global view (they would look still present); the Last change view shows them.
	const overviewView = $derived<Highlight>({ label: 'Global view', solid: assembledKeys, secondary: haveKeys, tertiary: orderedKeys, meshes: p.last && !p.last.removed ? p.last.keys : [], others: 'ghost', frame: 'all' });
	const lastView = $derived<Highlight | null>(p.last ? { label: p.last.label, meshes: p.last.keys, solid: assembledKeys, secondary: haveKeys, tertiary: orderedKeys, others: 'ghost', frame: p.last.keys.length ? 'highlight' : 'all' } : null);
	const lastCaption = $derived(p.last ? `${p.last.kind} · ${new Date(p.last.t).toLocaleString()}${p.last.keys.length ? '' : ' · no model part linked to this action'}` : '');

	// ── Estimates ───────────────────────────────────────────────────────
	const jobHours = (j: PrintJob, remainingOnly: number) => printHours({ ...j, qty: remainingOnly }, p.ratePla, p.rateTpu);
	const stepPrintHours = (s: Step) => (s.prints ?? []).reduce((h, j) => h + jobHours(j, remainingOnly(s, j)), 0);
	const remainingOnly = (s: Step, j: PrintJob) => remainingPieces(s, j);
	const totalPrintHours = $derived(steps.reduce((h, s) => h + stepPrintHours(s), 0));
	const totalPrintHoursAll = $derived(steps.reduce((h, s) => h + (s.prints ?? []).reduce((x, j) => x + printHours(j, p.ratePla, p.rateTpu), 0), 0));
	const handsOnHours = $derived(steps.filter((s) => !stepDone(s)).reduce((h, s) => h + s.humanHours, 0));
	const country = $derived(COUNTRY_BY_CODE.get(p.country) ?? COUNTRY_BY_CODE.get(DEFAULT_COUNTRY)!);
	const links = (item: ShopItem): ResolvedLink[] => linksFor(item, p.country);
	const buyable = (item: ShopItem) => links(item).filter((l) => l.leadDays[1] > 0);
	const chosenLink = (item: ShopItem): ResolvedLink => {
		const opts = buyable(item);
		return opts[p.vendor[`${p.country}:${item.id}`] ?? 0] ?? opts[0] ?? { vendor: '—', url: '#', kind: 'intl', leadDays: [0, 0] };
	};
	const leadRange = $derived.by(() => {
		let lo = 0, hi = 0;
		for (const it of SHOP.filter((i) => i.critical)) {
			const l = chosenLink(it).leadDays;
			lo = Math.max(lo, l[0]);
			hi = Math.max(hi, l[1]);
		}
		return [lo, hi] as [number, number];
	});
	const printDays = $derived(Math.ceil(totalPrintHours / Math.max(1, p.printHoursPerDay)));
	const buildWorkHours = $derived(steps.filter((s) => !stepDone(s) && s.phase !== 'print' && s.phase !== 'order').reduce((h, s) => h + s.humanHours, 0));
	const workDays = $derived(Math.ceil(buildWorkHours / Math.max(0.5, p.workHoursPerDay)));
	const addDays = (iso: string, d: number) => { const t = new Date(iso + 'T12:00:00'); t.setDate(t.getDate() + d); return t; };
	const fmtDate = (d: Date) => d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
	const partsBy = $derived([addDays(p.startDate, leadRange[0]), addDays(p.startDate, leadRange[1])]);
	const printsBy = $derived(addDays(p.startDate, 1 + printDays));
	const gateDays = $derived([Math.max(leadRange[0], 1 + printDays), Math.max(leadRange[1], 1 + printDays)]);
	const doneBy = $derived([addDays(p.startDate, gateDays[0] + workDays), addDays(p.startDate, gateDays[1] + workDays)]);
	const budget = $derived(SHOP.reduce<[number, number]>((a, s) => [a[0] + s.priceUsd[0], a[1] + s.priceUsd[1]], [0, 0]));

	// ── Printer link: auto-tick finished prints ─────────────────────────
	let toasts = $state<{ id: number; text: string; human: string }[]>([]);
	let toastId = 0;
	function toast(text: string, human: string) {
		const id = ++toastId;
		toasts = [...toasts, { id, text, human }];
		setTimeout(() => (toasts = toasts.filter((t) => t.id !== id)), 12000);
	}
	function onPrinterEvent(e: StatusEvent) {
		if (e.kind === 'print_complete') {
			const stl = (e.filename.split('/').pop() ?? '').replace(/\.g(code)?$/i, '.stl').toLowerCase();
			for (const s of steps) {
				const j = (s.prints ?? []).find((x) => x.file.toLowerCase() === stl);
				if (j && remainingPieces(s, j) > 0) {
					setPrinted(s, j, (p.printed[pkey(s, j)] ?? 0) + 1);
					toast(`${j.file} printed (${p.printed[pkey(s, j)]}/${j.qty}) in ${fmtDuration(e.durationS)}`, `Remove it from the bed, check the M2 holes, then start the next file. Step: ${s.title}.`);
					return;
				}
			}
			toast(`Print complete: ${e.filename}`, 'Remove the part from the bed. Not matched to a build step (name the G-code after its STL to auto-tick).');
		} else if (e.kind === 'print_paused') {
			toast(`Printer paused${e.message ? `: ${e.message}` : ''}`, 'Check filament, then Resume from the printer panel.');
		} else if (e.kind === 'print_error') {
			toast(`Printer error${e.message ? `: ${e.message}` : ''}`, 'Inspect the printer before continuing.');
		} else if (e.kind === 'print_started') {
			toast(`Printing ${e.filename}`, 'Check the first layer in a few minutes.');
		}
	}
	const expectedFiles = $derived(steps.flatMap((s) => (s.prints ?? []).map((j) => j.file)));

	// ── Shopping list ───────────────────────────────────────────────────
	const phaseLabel: Record<Step['phase'], string> = { order: 'Order', print: 'Print', electronics: 'Electronics', assembly: 'Assembly', software: 'Software' };
	let openStep = $state<string | null>(null);
	async function copyList() {
		const lines = SHOP.map((it) => `- ${it.name} ×${it.qty} — ${it.spec}\n    ${links(it).map((l) => `${l.vendor}: ${l.url}`).join('\n    ')}`);
		try { await navigator.clipboard.writeText(`Microduck replica shopping list (${country.name})\n\n${lines.join('\n')}`); toast('Shopping list copied', 'Paste it into your notes or an order sheet.'); } catch { /* ignore */ }
	}
	const money = (r: [number, number]) => `$${r[0]}–${r[1]}`;
</script>

<svelte:head>
	<title>Build a Microduck replica — plan, printer link, shopping list</title>
	<meta name="description" content="Step-by-step Microduck replica build plan with live 3D-printer status (Klipper/Moonraker), what-to-do-now notifications, print time and delivery estimates, and a North-American shopping list." />
</svelte:head>

<div class="wrap wide">
	<section class="top">
		<div class="eyebrow">Build</div>
		<h1>Build a replica, step by step</h1>
		<p class="lead">
			Order the long-lead parts, print while you wait, assemble, bring the software up. The printer panel talks to a
			Klipper/Moonraker printer (Elegoo Neptune 4 Pro included) and tells you when a hand is needed. Progress and
			settings stay in this browser.
		</p>
	</section>

	<Callout kind="warn" title="Unofficial">
		<p>Pollen has published no assembly guide, BOM or CAD. This plan is reconstructed from the open simulation files, the official software docs and the community replica projects. Quantities are counted from the model; times and prices are estimates you can edit.</p>
	</Callout>

	<div class="split">
		<div class="main">
			<section class="card est">
				<h3>Estimates</h3>
				<div class="knobs">
					<label class="country">Ship to
						<select bind:value={p.country} aria-label="Country">
							{#each COUNTRIES as c (c.code)}
								<option value={c.code}>{c.flag} {c.name}</option>
							{/each}
						</select>
					</label>
					<label>Start <input type="date" bind:value={p.startDate} /></label>
					<label>PLA/PETG rate <input type="number" min="3" max="40" step="1" bind:value={p.ratePla} /> cm³/h</label>
					<label>TPU rate <input type="number" min="1" max="20" step="1" bind:value={p.rateTpu} /> cm³/h</label>
					<label>Printer hours/day <input type="number" min="1" max="24" step="1" bind:value={p.printHoursPerDay} /></label>
					<label>Your hours/day <input type="number" min="0.5" max="12" step="0.5" bind:value={p.workHoursPerDay} /></label>
					<label class="chk"><input type="checkbox" bind:checked={p.includeRollers} /> include roller skates</label>
				</div>
				<div class="grid stats">
					<div><div class="big">{fmtDuration(totalPrintHours * 3600)}</div><div class="small muted">printing left ({fmtDuration(totalPrintHoursAll * 3600)} total) → about {printDays} day{printDays === 1 ? '' : 's'}</div></div>
					<div><div class="big">{fmtDate(partsBy[0])} – {fmtDate(partsBy[1])}</div><div class="small muted">long-lead parts delivered (max lead {leadRange[0]}–{leadRange[1]} days: servos, board, PCBs)</div></div>
					<div><div class="big">{handsOnHours} h</div><div class="small muted">hands-on work left ({buildWorkHours} h after printing → {workDays} day{workDays === 1 ? '' : 's'} at {p.workHoursPerDay} h/day)</div></div>
					<div><div class="big">{fmtDate(doneBy[0])} – {fmtDate(doneBy[1])}</div><div class="small muted">estimated first stand · budget {money(budget)} + printer time</div></div>
				</div>
				<p class="small muted">Vendors and delivery estimates follow the "Ship to" country; the <a href="#shop">shopping list</a> below lists them. Model: printing starts the day after ordering; assembly starts when both the last long-lead part and the last print are done; software bring-up follows. Print time = volume ÷ deposition rate + 12 min handling per piece.</p>
			</section>

			<section>
				<h2>Steps</h2>
				<ol class="steps-list">
					{#each steps as s, idx (s.id)}
						{@const done = stepDone(s)}
						{@const open = openStep === s.id || (openStep === null && !done && idx === steps.findIndex((x) => !stepDone(x)))}
						<li class="step card" class:done class:open>
							<button type="button" class="step-head" onclick={() => (openStep = open ? '__none__' : s.id)} aria-expanded={open}>
								<span class="num">{done ? '✓' : idx + 1}</span>
								<span class="titles">
									<span class="phase">{phaseLabel[s.phase]}</span>
									<span class="title">{s.title}</span>
								</span>
								<span class="meta">
									{#if s.prints?.length}<span>{fmtDuration(stepPrintHours(s) * 3600)} print</span>{/if}
									<span>{s.humanHours} h hands-on</span>
									<span>{stepChecks(s)}/{s.checklist.length}</span>
								</span>
							</button>
							{#if open}
								<div class="body">
									<p>{s.summary}</p>
									{#if s.waitsFor?.length}
										<div class="gate small">Waits for delivery of: {s.waitsFor.map((id) => SHOP_BY_ID.get(id)?.name).join(', ')} ({leadRange[0]}–{leadRange[1]} days from order).</div>
									{/if}
									{#if s.prints?.length}
										<h4>Print queue</h4>
										<div class="table-wrap">
											<table class="pq">
												<thead><tr><th>File</th><th>Material</th><th>Pieces</th><th>Est. time left</th><th>Done</th></tr></thead>
												<tbody>
													{#each s.prints as j (j.file)}
														{@const n = p.printed[pkey(s, j)] ?? 0}
														<tr class:ok={n >= j.qty}>
															<td><code>{j.file.replace(/\.stl$/, '.gcode')}</code></td>
															<td>{j.material}</td>
															<td>{n} / {j.qty}</td>
															<td>{fmtDuration(jobHours(j, remainingPieces(s, j)) * 3600)}</td>
															<td class="ctr">
																<button type="button" class="mini" onclick={() => setPrinted(s, j, n - 1)} disabled={n <= 0} aria-label="one less">−</button>
																<button type="button" class="mini" onclick={() => setPrinted(s, j, n + 1)} disabled={n >= j.qty} aria-label="one more">+</button>
															</td>
														</tr>
													{/each}
												</tbody>
											</table>
										</div>
										<p class="small muted">Name G-code after the STL (<code>leg.gcode</code>). When the printer reports a completed file with that name, the piece is ticked here automatically.</p>
									{/if}
									<h4>Human actions</h4>
									<ul class="checks">
										{#each s.checklist as c, i (i)}
											<li><label><input type="checkbox" checked={!!p.checks[key(s, i)]} onchange={() => toggleCheck(s, i)} /> <span>{ctext(c)}</span></label></li>
										{/each}
									</ul>
									{#if s.shop?.length}
										<h4>{s.phase === 'order' ? 'Buy now' : 'Needed for this step'}</h4>
										<ul class="need">
											{#each s.shop as id (id)}
												{@const it = SHOP_BY_ID.get(id)}
												{#if it}
													<li>
														<label class="ord"><input type="checkbox" checked={!!p.ordered[it.id]} onchange={(e) => setOrdered(it, (e.currentTarget as HTMLInputElement).checked)} /> <b>{it.name}</b> ×{it.qty}</label>
														<span class="links">{#each buyable(it).slice(0, 3) as l (l.url)}<a class="buy" href={l.url} rel="noopener">Buy · {l.vendor}</a>{/each}</span>
													</li>
												{/if}
											{/each}
										</ul>
									{/if}
									{#if s.links?.length}
										<div class="small">{#each s.links as l (l.href)}<a href={l.href} rel="noopener">{l.label}</a>{' '}{/each}</div>
									{/if}
								</div>
							{/if}
						</li>
					{/each}
				</ol>
			</section>

			<section id="shop">
				<h2>Shopping list</h2>
				<div class="shop-head">
					<label class="country">
						<span class="small muted">Ship to</span>
						<select bind:value={p.country} aria-label="Country">
							{#each COUNTRIES as c (c.code)}
								<option value={c.code}>{c.flag} {c.name}</option>
							{/each}
						</select>
					</label>
					<button type="button" class="copy" onclick={copyList}>Copy list</button>
					<span class="small muted">{country.vendors.length} vendors for {country.name}: {country.vendors.map((v) => v.name).join(', ')}. Total {money(budget)} + printer time. The vendor chosen per line drives the delivery estimate.</span>
				</div>
				<div class="table-wrap">
					<table class="shop">
						<thead><tr><th>Ordered</th><th>Received</th><th>Item</th><th>Qty</th><th>Price</th><th>Vendor (for the estimate)</th><th>Links</th></tr></thead>
						<tbody>
							{#each SHOP as it (it.id)}
								<tr class:ordered={p.ordered[it.id]} class:received={p.received[it.id]}>
									<td><input type="checkbox" checked={!!p.ordered[it.id]} onchange={(e) => setOrdered(it, (e.currentTarget as HTMLInputElement).checked)} aria-label="ordered" /></td>
									<td><input type="checkbox" checked={!!p.received[it.id]} onchange={(e) => setReceived(it, (e.currentTarget as HTMLInputElement).checked)} aria-label="received" /></td>
									<td><b>{it.name}</b>{#if it.critical}<span class="crit">long lead</span>{/if}<div class="note">{it.spec}{#if it.note} · {it.note}{/if}</div></td>
									<td class="num">{it.qty}</td>
									<td class="num">{money(it.priceUsd)}</td>
									<td>
										{#if buyable(it).length}
											<select bind:value={p.vendor[`${p.country}:${it.id}`]} aria-label="vendor">
												{#each buyable(it) as l, i (l.url)}
													<option value={i}>{l.vendor} · {l.leadDays[0]}–{l.leadDays[1]} d</option>
												{/each}
											</select>
										{:else}<span class="small muted">—</span>{/if}
									</td>
									<td class="links col">{#each links(it) as l (l.url)}<a href={l.url} rel="noopener">{l.vendor} <span class="rg">{l.kind}</span></a>{/each}</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
				<p class="small muted">Search links open each vendor's results for the part in your country; exact SKUs vary. Links tagged <span class="rg">robotics</span> point to exact product or documentation pages. Prices in USD, order of magnitude, from the <a href="https://github.com/pablo-mano/microduck-replica/blob/master/BOM.md" rel="noopener">replica BOM</a>; local prices, taxes and import duties differ. Details and evidence per part on the <a href={resolve('/bom')}>BOM</a> and <a href={resolve('/printables')}>Printables</a> pages.</p>
			</section>
		</div>

		<aside class="side">
			<section class="progress card">
				<div class="phead">
					<h3>Progress</h3>
					<button type="button" class="reset" onclick={resetProgress} title="Uncheck all checklists, prints, orders and receipts">Reset progress</button>
				</div>
				<div class="legend small">
					<span><i class="sw solid"></i> assembled ({nAssembled}/{INSTANCES.length})</span>
					<span><i class="sw have"></i> on hand, not assembled ({nHaveLoose})</span>
					<span><i class="sw ordered"></i> ordered, in transit ({nOrdered})</span>
					<span><i class="sw last"></i> last addition</span>
					<span><i class="sw ghost"></i> missing</span>
				</div>
				<div class="pviews">
					<div class="view">
						<div class="vlabel">Pieces on hand</div>
						{#if nHave}<PartViewer highlight={haveView} compact captionBelow caption={`${nHave} of ${INSTANCES.length} instances printed or received`} />{:else}<div class="empty small muted">Nothing yet. Tick printed pieces in the steps and received items in the shopping list.</div>{/if}
					</div>
					<div class="view">
						<div class="vlabel">Assembled so far</div>
						{#if nAssembled}<PartViewer highlight={assembledView} compact captionBelow caption={`${nAssembled} instances in completed assembly steps`} />{:else}<div class="empty small muted">Nothing assembled. Completing an assembly step's checklist marks its bodies as built.</div>{/if}
					</div>
					<div class="view">
						<div class="vlabel">Global view</div>
						<PartViewer highlight={overviewView} compact captionBelow caption={`${nAssembled} assembled · ${nHaveLoose} on hand · ${nOrdered} ordered`} />
					</div>
					<div class="view">
						<div class="vlabel">Last change</div>
						{#if lastView && p.last}<PartViewer highlight={lastView} compact captionBelow caption={lastCaption} />{:else}<div class="empty small muted">Your last tick, print or order shows up here.</div>{/if}
					</div>
				</div>
			</section>

			<PrinterPanel onEvent={onPrinterEvent} {expectedFiles} />
			<div class="card small">
				<b>Connecting a Neptune 4 Pro</b>
				<ol>
					<li>Find the printer IP on its screen (Settings → Network) or in your router.</li>
					<li>Enter <code>http://&lt;ip&gt;</code> (stock firmware proxies Moonraker on port 80; Fluidd is on :4408).</li>
					<li>If the browser blocks the request (CORS), open Fluidd → Configuration → <code>moonraker.conf</code> and add this page's origin to <code>cors_domains</code>, then restart Moonraker. <code>localhost</code> origins are allowed by default.</li>
				</ol>
			</div>
		</aside>
	</div>
</div>

<div class="toasts" aria-live="polite">
	{#each toasts as t (t.id)}
		<div class="toast">
			<div class="tt">{t.text}</div>
			<div class="th">{t.human}</div>
			<button type="button" onclick={() => (toasts = toasts.filter((x) => x.id !== t.id))} aria-label="dismiss">×</button>
		</div>
	{/each}
</div>

<style>
	.top { padding-top: 3rem; }
	.wide { max-width: 1280px; }
	.split { display: grid; grid-template-columns: minmax(0, 1fr) 400px; gap: 1.5rem; align-items: start; margin-top: 1.5rem; }
	.pviews { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0.6rem; }
	.legend { display: flex; flex-wrap: wrap; gap: 0.4rem 1rem; color: var(--ink-2); margin: 0.3rem 0 0.8rem; }
	.sw { display: inline-block; width: 0.75rem; height: 0.75rem; border-radius: 3px; vertical-align: -1px; margin-right: 0.3rem; border: 1px solid var(--line); }
	.sw.solid { background: var(--cream); } .sw.have { background: var(--blue); } .sw.ordered { background: color-mix(in srgb, var(--orange) 45%, transparent); } .sw.last { background: var(--yellow); } .sw.ghost { background: rgba(139,147,167,0.2); }
	@media (max-width: 1000px) { .pviews { grid-template-columns: repeat(4, minmax(0, 1fr)); } }
	@media (max-width: 700px) { .pviews { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
	.vlabel { font-size: 0.7rem; font-weight: 800; text-transform: uppercase; letter-spacing: 0.08em; color: var(--ink-3); margin-bottom: 0.3rem; }
	.empty { aspect-ratio: 1 / 1; border: 1px dashed var(--line); border-radius: var(--radius); display: grid; place-items: center; padding: 1rem; text-align: center; }
	.buy { display: inline-block; font-size: 0.78rem; font-weight: 700; color: var(--yellow); border: 1px solid var(--line); border-radius: 999px; padding: 0.1rem 0.55rem; margin: 0.1rem 0.3rem 0.1rem 0; }
	.buy:hover { border-color: var(--yellow); text-decoration: none; }

	.side { position: sticky; top: 76px; display: grid; gap: 0.8rem; max-height: calc(100vh - 88px); overflow-y: auto; padding-right: 2px; }
	.progress h3 { margin-top: 0; }
	.phead { display: flex; justify-content: space-between; align-items: center; gap: 0.5rem; }
	.reset { font: inherit; font-size: 0.75rem; font-weight: 700; color: var(--orange); background: none; border: 1px solid var(--line); border-radius: 999px; padding: 0.2rem 0.6rem; cursor: pointer; }
	.reset:hover { border-color: var(--orange); }
	.est h3 { margin-top: 0; }
	.knobs { display: flex; flex-wrap: wrap; gap: 0.5rem 1rem; font-size: 0.85rem; color: var(--ink-2); margin-bottom: 0.8rem; }
	.knobs label { display: inline-flex; align-items: center; gap: 0.35rem; }
	.knobs input[type='number'] { width: 4.2rem; } .knobs input { font: inherit; font-size: 0.85rem; color: var(--ink); background: var(--bg); border: 1px solid var(--line); border-radius: 6px; padding: 0.2rem 0.4rem; }
	.stats > div { background: var(--bg); border: 1px solid var(--line); border-radius: 10px; padding: 0.7rem 0.9rem; }
	.big { font-size: 1.15rem; font-weight: 800; color: var(--yellow); line-height: 1.2; }
	.steps-list { list-style: none; padding: 0; margin: 0; display: grid; gap: 0.6rem; }
	.step { padding: 0; overflow: hidden; }
	.step.done { opacity: 0.75; }
	.step-head { width: 100%; display: grid; grid-template-columns: 2.2rem 1fr auto; gap: 0.8rem; align-items: center; text-align: left; font: inherit; color: var(--ink); background: none; border: 0; padding: 0.9rem 1.1rem; cursor: pointer; }
	.step-head:hover { background: var(--bg-3); }
	.num { width: 2.2rem; height: 2.2rem; border-radius: 50%; background: var(--yellow); color: #14120a; font-weight: 800; display: grid; place-items: center; }
	.step.done .num { background: var(--green); }
	.titles { display: grid; }
	.phase { font-size: 0.7rem; font-weight: 800; text-transform: uppercase; letter-spacing: 0.08em; color: var(--ink-3); }
	.title { font-weight: 700; }
	.meta { display: flex; flex-wrap: wrap; gap: 0.4rem; justify-content: flex-end; font-family: var(--mono); font-size: 0.72rem; color: var(--ink-3); }
	.meta span { border: 1px solid var(--line); border-radius: 999px; padding: 0.1rem 0.5rem; }
	.body { padding: 0 1.1rem 1.1rem 1.1rem; border-top: 1px solid var(--line); }
	.body h4 { margin: 1rem 0 0.4rem; font-size: 0.85rem; text-transform: uppercase; letter-spacing: 0.06em; color: var(--ink-3); }
	.gate { color: var(--orange); }
	.pq td, .pq th { padding: 0.35rem 0.6rem; font-size: 0.85rem; }
	.pq tr.ok td { color: var(--green); }
	.ctr { white-space: nowrap; }
	.mini { font: inherit; font-size: 0.8rem; width: 1.6rem; height: 1.6rem; border-radius: 6px; border: 1px solid var(--line); background: var(--bg-3); color: var(--ink); cursor: pointer; }
	.mini[disabled] { opacity: 0.4; cursor: default; }
	.checks { list-style: none; padding: 0; margin: 0; display: grid; gap: 0.3rem; }
	.checks label { display: flex; gap: 0.5rem; align-items: flex-start; cursor: pointer; color: var(--ink-2); }
	.checks input { margin-top: 0.3rem; }
	.checks input:checked + span { text-decoration: line-through; color: var(--ink-3); }
	.need { list-style: none; padding: 0; margin: 0; display: grid; gap: 0.3rem; font-size: 0.9rem; }
	.need li { display: flex; flex-wrap: wrap; gap: 0.3rem 0.8rem; align-items: baseline; }
	.ord { color: var(--ink-2); display: inline-flex; gap: 0.4rem; align-items: center; }
	.links a { margin-right: 0.6rem; font-size: 0.85rem; }
	.links.col { display: flex; flex-direction: column; gap: 0.15rem; }
	.rg { font-size: 0.65rem; color: var(--ink-3); border: 1px solid var(--line); border-radius: 999px; padding: 0 0.35rem; margin-left: 0.2rem; }
	.shop-head { display: flex; flex-wrap: wrap; gap: 0.8rem; align-items: center; margin-bottom: 0.6rem; }
	.country { display: inline-flex; align-items: center; gap: 0.5rem; }
	.country select { font-size: 0.95rem; font-weight: 700; max-width: none; padding: 0.4rem 0.6rem; }
	.copy { font: inherit; font-size: 0.82rem; font-weight: 700; color: var(--ink); background: var(--bg-2); border: 1px solid var(--line); border-radius: 8px; padding: 0.35rem 0.8rem; cursor: pointer; }
	.shop td { font-size: 0.88rem; vertical-align: top; }
	.shop tr.ordered td { opacity: 0.6; }
	.crit { margin-left: 0.4rem; font-size: 0.65rem; font-weight: 800; text-transform: uppercase; color: var(--orange); border: 1px solid var(--line); border-radius: 999px; padding: 0.05rem 0.4rem; }
	.note { font-size: 0.78rem; color: var(--ink-3); margin-top: 0.15rem; }
	.num { font-family: var(--mono); font-size: 0.82rem; white-space: nowrap; }
	select { font: inherit; font-size: 0.8rem; color: var(--ink); background: var(--bg); border: 1px solid var(--line); border-radius: 6px; padding: 0.25rem 0.4rem; max-width: 16rem; }
	.toasts { position: fixed; right: 1rem; bottom: 1rem; display: grid; gap: 0.5rem; z-index: 50; max-width: 24rem; }
	.toast { position: relative; background: var(--bg-2); border: 1px solid var(--yellow); border-radius: 10px; padding: 0.7rem 2rem 0.7rem 0.9rem; box-shadow: 0 8px 30px rgba(0,0,0,0.5); }
	.tt { font-weight: 700; color: var(--yellow); font-size: 0.9rem; }
	.th { font-size: 0.85rem; color: var(--ink-2); margin-top: 0.2rem; }
	.toast button { position: absolute; top: 0.3rem; right: 0.4rem; font: inherit; color: var(--ink-3); background: none; border: 0; cursor: pointer; font-size: 1rem; }
	@media (max-width: 1000px) { .split { grid-template-columns: 1fr; } .side { position: static; max-height: none; } }
</style>
