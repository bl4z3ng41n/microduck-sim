<script lang="ts">
	import { resolve, asset } from '$app/paths';
	import Callout from '#lib/components/Callout.svelte';
	import MeshCompare from '#lib/components/MeshCompare.svelte';
	import PartViewer from '#lib/components/PartViewer.svelte';
	import type { Highlight } from '#lib/sim/viewer.ts';
	import parts from '#lib/data/community-parts.json';

	interface MeshStats { bytes: number; format: string; tris: number; bbox_mm: number[]; volume_cm3: number; area_cm2: number; sha256: string; path?: string }
	interface Part {
		file: string;
		category: 'printable' | 'commercial' | 'roller' | 'removed';
		folder: string;
		communityUrl: string;
		community: MeshStats;
		upstream: MeshStats | null;
		vsUpstream: string;
		vsUpstreamDetail?: { d_bbox_pct: number; d_volume_pct: number; vertex_overlap: number };
		sim: MeshStats | null;
		vsSim: { verdict: string; d_bbox_pct: number; d_volume_pct: number; vertex_overlap: number; decimation: number | null } | null;
		inSim: boolean;
	}
	const all = parts as Part[];
	const categories: { id: Part['category']; title: string; short: string; blurb: string }[] = [
		{ id: 'printable', title: 'Printables', short: 'print', blurb: 'Structural parts you print yourself (print/printables/).' },
		{ id: 'roller', title: 'Roller-skating variant', short: 'rollers', blurb: 'Blades and wheels of the roller accessory (print/variant-roller-skating/). The skate ankles are 10 mm taller than the standard ones and replace them.' },
		{ id: 'removed', title: 'Unused upstream shells', short: 'unused', blurb: "Trunk shells still shipped in microduck_rl's assets folder but no longer referenced by the current MJCF, so absent from the simulation (print/upstream-removed/)." },
		{ id: 'commercial', title: 'Commercial parts (do not print)', short: 'buy', blurb: 'Models of bought parts for fit checking only: servos, bearings, battery, PCBs, lens (print/commercial-parts/). Sourcing is in the table below.' }
	];

	// Print quantities from the replica's BOM.md (counted from upstream robot_walk.xml, 75 instances).
	const printQty: Record<string, number> = {
		'leg.stl': 4, 'hip_l.stl': 2, 'neck.stl': 2, 'power_support.stl': 2, 'sole_left.stl': 2, 'sole_right.stl': 2,
		'upper_leg_rigidity_plate.stl': 2, 'yaw2roll.stl': 2, 'tire.stl': 8, 'rim.stl': 4, 'roller_blade.stl': 2,
		'ankle_l_v1.stl': 1, 'ankle_r_v1.stl': 1
	};
	const tpu = new Set(['jaw_soft.stl', 'soft_mouth_top.stl', 'tire.stl']);
	// Which BOM line each file belongs to (the /bom page highlights the same meshes).
	const bomLine: Record<string, string> = {
		'xl330.stl': 'Servo (14 joints + beak)', 'pcb__raspberry_pi_zero_2_w.stl': 'Compute board', 'np_f970.stl': 'Battery',
		'elec_rpi_robot_hat_pcb.stl': 'HAT (sensor + audio + power board)', 'speaker.stl': 'Speaker + microphone', 'lens.stl': 'Camera',
		'm12_lens_holder.stl': 'Camera lens holder', 'seeed_bearing__configuration__22x16x4.stl': 'Ball bearings, hips and neck',
		'seeed_bearing__configuration_default.stl': 'Ball bearings, small', 'jaw_soft.stl': 'Printed flexible parts (TPU)',
		'soft_mouth_top.stl': 'Printed flexible parts (TPU)', 'sole_left.stl': 'Printed flexible parts (TPU)', 'sole_right.stl': 'Printed flexible parts (TPU)',
		'top_head_shell.stl': 'Printed shells', 'bottom_head_shell.stl': 'Printed shells', 'face_part.stl': 'Printed shells', 'noenoeil.stl': 'Printed shells',
		'left_shell.stl': 'Printed shells', 'right_shell.stl': 'Printed shells', 'trunk_base.stl': 'Printed shells', 'upper_leg_left.stl': 'Printed shells',
		'upper_leg_right.stl': 'Printed shells', 'upper_leg_rigidity_plate.stl': 'Printed shells',
		'roller_blade.stl': 'Roller accessory', 'rim.stl': 'Roller accessory', 'tire.stl': 'Roller accessory', 'ankle_l_v1.stl': 'Roller accessory', 'ankle_r_v1.stl': 'Roller accessory'
	};
	const bomFor = (f: string) => bomLine[f] ?? (all.find((p) => p.file === f)?.category === 'printable' ? 'Printed structure' : '—');

	const simBase = asset('sim/mujoco.js').replace(/mujoco\.js$/, '');
	let selected = $state<Part>(all[0]);
	let filter = $state('');
	const visible = $derived(all.filter((p) => !filter || p.file.toLowerCase().includes(filter.toLowerCase())));
	const robotHighlight = $derived<Highlight | null>(
		selected.inSim ? { label: selected.file, meshes: [selected.file], variant: selected.category === 'roller' ? 'rollers' : 'legs' } : { label: selected.file }
	);
	const simFallback = (p: Part) => (p.inSim ? `${simBase}robot/meshes/${p.file}` : undefined);

	const fmt = (n: number) => n.toLocaleString();
	const kb = (b: number) => (b / 1024).toFixed(0) + ' KB';
	const dims = (m: MeshStats) => m.bbox_mm.map((v) => v.toFixed(1)).join(' × ');
	const pct = (v: number) => (v > 0 ? '+' : '') + v.toFixed(1) + ' %';
	const verdictClass = (v: string) =>
		v === 'byte-identical' || v === 'identical geometry' ? 'ok' : v === 'same shape, remeshed' ? 'ok2' : v === 'minor differences' ? 'warn' : v === 'different' ? 'bad' : 'muted';
	const count = (v: string) => all.filter((p) => p.vsUpstream === v).length;
	const totalBytes = all.reduce((s, p) => s + p.community.bytes, 0);
	const select = (f: string) => {
		const p = all.find((x) => x.file === f);
		if (p) selected = p;
	};

	// Commercial parts, sourced from the replica's BOM.md (checked 2026-09-04) and the official repos.
	interface Buy { part: string; spec: string; qty: string; price: string; links: { label: string; href: string }[]; model?: string; note?: string }
	const buy: Buy[] = [
		{ part: 'Servo', spec: 'ROBOTIS Dynamixel XL330-M288-T (model number inferred; source only says "xl330")', qty: '15', price: '$27.49 each at ROBOTIS US ($412 for 15); €33.50 ex-VAT / €40–42 inc-VAT in the EU', model: 'xl330.stl',
			links: [{ label: 'e-Manual', href: 'https://emanual.robotis.com/docs/en/dxl/x/xl330-m288/' }, { label: 'ROBOTIS US', href: 'https://www.robotis.us/dynamixel-xl330-m288-t/' }, { label: 'Amazon search', href: 'https://www.amazon.com/s?k=Dynamixel+XL330-M288-T' }],
			note: 'Rated 3.7–6.0 V; Microduck runs it at 6.6–8.2 V on purpose.' },
		{ part: 'Compute board', spec: 'Radxa Zero 3W, RK3566. Official robot: 1 GB / 32 GB eMMC; 2 GB / 16 GB recommended for a replica. Needs a Rockchip vendor kernel (Armbian family) for the NPU', qty: '1', price: '$30–45', model: 'pcb__raspberry_pi_zero_2_w.stl',
			links: [{ label: 'Radxa product page', href: 'https://radxa.com/products/zeros/zero3w' }, { label: 'Arace', href: 'https://arace.tech/products/radxa-zero-3w' }, { label: 'AliExpress search', href: 'https://www.aliexpress.com/w/wholesale-radxa-zero-3w.html' }],
			note: 'The sim mesh in that slot is the prototype\'s Pi Zero 2 W; same footprint family.' },
		{ part: 'Camera', spec: 'Raspberry Pi Camera Module v2 (Sony IMX219) or Radxa Camera 8M 219; 15→22-pin ribbon for the Zero 3W', qty: '1', price: '$10–25', model: 'lens.stl',
			links: [{ label: 'Pi Camera v2', href: 'https://www.raspberrypi.com/products/camera-module-v2/' }, { label: 'Radxa Camera 8M 219', href: 'https://radxa.com/products/accessories/camera-8m-219/' }] },
		{ part: 'Depth sensor', spec: 'ST VL53L8CX (or VL53L5CX) 8×8 ToF breakout with Qwiic/Stemma connector, I²C 0x29', qty: '1', price: '$25–50',
			links: [{ label: 'ST VL53L8CX', href: 'https://www.st.com/en/imaging-and-photonics-solutions/vl53l8cx.html' }, { label: 'SparkFun VL53L5CX Qwiic', href: 'https://www.sparkfun.com/products/18642' }, { label: 'Mouser search', href: 'https://www.mouser.com/c/?q=VL53L8CX' }] },
		{ part: 'Battery', spec: 'Sony NP-F550-type camera battery, 2S Li-ion, 2600 mAh (the mesh is misnamed np_f970; a real F970 does not fit)', qty: '1', price: '$15–35', model: 'np_f970.stl',
			links: [{ label: 'Amazon search', href: 'https://www.amazon.com/s?k=NP-F550+battery' }],
			note: 'No charging circuit on the HAT: charge externally.' },
		{ part: 'Battery contacts', spec: 'Commercial NP-F adapter/holder plate. Upstream CAD has only the printed power_support, no contact model', qty: '1', price: '$8–20',
			links: [{ label: 'Amazon search', href: 'https://www.amazon.com/s?k=NP-F+battery+adapter+plate' }] },
		{ part: 'Speaker', spec: 'Small loudspeaker (the HAT carries a PAM8406 class-D amplifier and Wago terminals)', qty: '1', price: '$2–6', model: 'speaker.stl',
			links: [{ label: 'Amazon search', href: 'https://www.amazon.com/s?k=28mm+8+ohm+1W+speaker' }] },
		{ part: 'RPI Robot HAT', spec: 'Fabricate from Pollen\'s KiCad project: 4 layers, 1.0 mm, 65.0 × 30.9 mm, 113 components incl. TLV320AIC3104 codec, PAM8406 amp, BMI088 IMU, SIT3088E RS-485, LM5050-1, AP63205. Not hand-solderable: order with assembly', qty: '1', price: '$60–150 for 2 boards with assembly (replica estimate)', model: 'elec_rpi_robot_hat_pcb.stl',
			links: [{ label: 'elec_RPI_Robot_HAT (Gerbers in production/)', href: 'https://github.com/pollen-robotics/elec_RPI_Robot_HAT' }, { label: 'lib_KiCAD (to open the project)', href: 'https://github.com/pollen-robotics/lib_KiCAD' }, { label: 'JLCPCB', href: 'https://jlcpcb.com/' }, { label: 'PCBWay', href: 'https://www.pcbway.com/' }, { label: 'TLV320AIC3104', href: 'https://www.ti.com/product/TLV320AIC3104' }] },
		{ part: 'imu_to_dxl board', spec: 'No public design from Pollen. Replica reference: STM32G031F8P6 + LSM6DSV16X + SN74LVC2G241 buffer + HT7533-1 LDO (30 V input, the bus reaches 8.4 V), JST EH 3P ×2, 45 × 22 mm', qty: '1', price: '$15–25 assembled',
			links: [{ label: 'Replica design files', href: 'https://github.com/pablo-mano/microduck-replica/tree/master/hardware/imu_to_dxl' }, { label: 'Alternative: microduck_imu_to_ttl', href: 'https://github.com/avanx/microduck_imu_to_ttl' }, { label: 'LSM6DSV16X', href: 'https://www.st.com/en/mems-and-sensors/lsm6dsv16x.html' }, { label: 'LCSC C5267406', href: 'https://www.lcsc.com/search?q=C5267406' }, { label: 'STM32G031F8', href: 'https://www.st.com/en/microcontrollers-microprocessors/stm32g031f8.html' }] },
		{ part: 'Bearings, hips and neck', spec: 'Ø22 × 16 × 4 mm ball bearing', qty: '11', price: '$1–2 each', model: 'seeed_bearing__configuration__22x16x4.stl',
			links: [{ label: 'AliExpress search', href: 'https://www.aliexpress.com/w/wholesale-22x16x4-bearing.html' }, { label: 'Amazon search', href: 'https://www.amazon.com/s?k=16x22x4+bearing' }] },
		{ part: 'Bearings, small', spec: 'Ø15 × 10 × 3 mm ball bearing', qty: '3', price: '$0.5–1 each', model: 'seeed_bearing__configuration_default.stl',
			links: [{ label: 'AliExpress search', href: 'https://www.aliexpress.com/w/wholesale-10x15x3-bearing.html' }] },
		{ part: 'Fasteners', spec: 'M2 socket cap: ×4 (60), ×6 (80), ×8 (40), ×12 (15); M2 nuts (50); M2 heat-set inserts (60); M2.5×6 (20). 237 M2-class holes counted in the assembly', qty: '~325', price: '$15–25',
			links: [{ label: 'Amazon search: M2 socket cap kit', href: 'https://www.amazon.com/s?k=M2+socket+head+cap+screw+assortment' }, { label: 'Amazon search: M2 heat-set inserts', href: 'https://www.amazon.com/s?k=M2+heat+set+inserts' }, { label: 'Fastener reconstruction', href: 'https://github.com/pablo-mano/microduck-replica/blob/master/docs/fastener-reconstruction.en.md' }] },
		{ part: 'Filament', spec: 'PLA/PETG for shells and structure; TPU for jaw_soft, soft_mouth_top and the roller tires', qty: '—', price: '$15–30',
			links: [{ label: 'Printing notes', href: 'https://github.com/pablo-mano/microduck-replica/blob/master/print/README.md' }] },
		{ part: 'Game controller', spec: 'Any Bluetooth gamepad with an Xbox-style layout (padd uses gilrs); Switch Pro-class pads reported working by the community', qty: '1', price: '$25–45',
			links: [{ label: 'Pair a gamepad (official docs)', href: 'https://github.com/pollen-robotics/microduck/blob/main/docs/robot/pair-a-gamepad.md' }] },
		{ part: 'microSD card', spec: '32–64 GB A2, only for eMMC-less Zero 3W SKUs', qty: '1', price: '$8–15',
			links: [{ label: 'Amazon search', href: 'https://www.amazon.com/s?k=64GB+microSD+A2' }] }
	];
</script>

<svelte:head>
	<title>Community print files vs. the simulation meshes — Microduck</title>
	<meta name="description" content="Every STL in pablo-mano/microduck-replica compared with the upstream microduck_rl files and with the meshes this site simulates, viewed side by side and located on the robot, plus where to buy the commercial parts." />
</svelte:head>

<div class="wrap">
	<section class="top">
		<div class="eyebrow">Hardware · community</div>
		<h1>Community print files, compared</h1>
		<p class="lead">
			<a href="https://github.com/pablo-mano/microduck-replica/tree/master/print/printables" rel="noopener">pablo-mano/microduck-replica</a>
			sorts every Microduck STL into <em>print these</em> and <em>buy these</em>. Pick a file: the community STL is
			shown next to the mesh this site simulates, and highlighted where it sits on the robot.
		</p>
	</section>

	<div class="split">
		<aside class="list">
			<input class="filter" type="search" placeholder="Filter files…" bind:value={filter} aria-label="Filter files" />
			{#each categories as cat (cat.id)}
				{@const rows = visible.filter((p) => p.category === cat.id)}
				{#if rows.length}
					<div class="grp">{cat.title} <span class="cnt">{rows.length}</span></div>
					{#each rows as p (p.file)}
						<button type="button" class="item" class:on={selected.file === p.file} onclick={() => (selected = p)} title={p.file}>
							<span class="dot {verdictClass(p.vsSim?.verdict ?? 'none')}" aria-hidden="true"></span>
							<span class="fn">{p.file.replace(/\.stl$/, '')}</span>
							<span class="meta">{printQty[p.file] ? `×${printQty[p.file]}` : ''}{tpu.has(p.file) ? ' TPU' : ''}</span>
						</button>
					{/each}
				{/if}
			{/each}
			<div class="legend small muted">Dot = sim mesh vs file: <span class="dot ok2"></span> same shape · <span class="dot warn"></span> minor · <span class="dot bad"></span> different · <span class="dot muted"></span> none</div>
		</aside>

		<div class="stage">
			<MeshCompare
				leftUrl={selected.communityUrl}
				simMesh={selected.file}
				simFallbackUrl={simFallback(selected)}
				leftLabel={`community · ${selected.file}`}
				rightLabel={selected.inSim ? 'sim mesh as rendered here' : 'sim mesh (not used by the sim)'}
			/>
			<div class="two">
				<PartViewer highlight={robotHighlight} />
				<div class="details card">
					<div class="dtitle"><strong>{selected.file}</strong> <span class="pill">{selected.folder}</span></div>
					<div class="verdicts">
						<span class="v {verdictClass(selected.vsUpstream)}">vs upstream: {selected.vsUpstream}</span>
						{#if selected.vsSim}<span class="v {verdictClass(selected.vsSim.verdict)}">sim mesh: {selected.vsSim.verdict}</span>{:else}<span class="v muted">no sim mesh</span>{/if}
					</div>
					<dl>
						<dt>Size</dt><dd>{dims(selected.community)} mm</dd>
						<dt>Volume</dt><dd>{selected.community.volume_cm3.toFixed(2)} cm³{#if selected.vsSim} <span class="muted">(sim {pct(selected.vsSim.d_volume_pct)})</span>{/if}</dd>
						<dt>Triangles</dt><dd>{fmt(selected.community.tris)} community · {selected.upstream ? fmt(selected.upstream.tris) : '—'} upstream · {selected.sim ? fmt(selected.sim.tris) : '—'} sim{#if selected.vsSim?.decimation} <span class="muted">({selected.vsSim.decimation}× decimated)</span>{/if}</dd>
						<dt>File</dt><dd>{kb(selected.community.bytes)} binary STL · SHA-256 {selected.community.sha256}…</dd>
						{#if selected.category !== 'commercial'}
							<dt>Print</dt><dd>×{printQty[selected.file] ?? 1}{tpu.has(selected.file) ? ' · flexible (TPU)' : ' · rigid (PLA/PETG)'}{#if selected.category === 'removed'} · not needed for the current design{/if}</dd>
						{:else}
							<dt>Buy</dt><dd>See <a href="#buy">where to buy</a> below; this STL is for fit checking only.</dd>
						{/if}
						<dt>BOM line</dt><dd><a href={resolve('/bom')}>{bomFor(selected.file)}</a></dd>
						<dt>Links</dt><dd><a href={selected.communityUrl} rel="noopener">raw STL</a>{#if selected.upstream} · <a href={`https://github.com/pollen-robotics/microduck_rl/blob/main/${selected.upstream.path}`} rel="noopener">upstream file</a>{/if} · <a href={`https://github.com/pablo-mano/microduck-replica/tree/master/print/${selected.folder}`} rel="noopener">folder</a></dd>
					</dl>
				</div>
			</div>
		</div>
	</div>

	<div class="summary grid">
		<div class="card"><div class="big">{count('byte-identical')} / {all.length}</div><div class="small">byte-identical to upstream <code>microduck_rl</code></div></div>
		<div class="card"><div class="big">{all.filter((p) => p.vsSim && (p.vsSim.verdict === 'same shape, remeshed' || p.vsSim.verdict === 'identical geometry')).length}</div><div class="small">sim meshes with the same shape (only decimated)</div></div>
		<div class="card"><div class="big">{all.filter((p) => p.vsSim?.verdict === 'different').length}</div><div class="small">sim meshes with real geometry differences (mostly roller parts)</div></div>
		<div class="card"><div class="big">{(totalBytes / 1048576).toFixed(1)} MB</div><div class="small">of binary STL, streamed from GitHub on demand</div></div>
	</div>

	<Callout kind="note" title="What the three sources are">
		<p>
			<strong>Community</strong>: the file in the replica repo. <strong>Upstream</strong>: the same file name in
			<code>pollen-robotics/microduck_rl/src/mjlab_microduck/robot/microduck/assets/</code>, the CAD export the RL model is built from.
			<strong>Sim mesh</strong>: what this site renders and collides, taken from the Hugging Face sandbox, which
			decimates the meshes for the browser (about 4× fewer triangles). All 45 community files are byte-identical to
			upstream. For the legged parts a "different" sim mesh is decimation, not a design change (volumes within about
			10 %); for the roller-skating parts the sandbox ships visibly different geometry (<code>ankle_r_v1</code> has 80 %
			less volume), so print the upstream files, not the sim ones.
		</p>
	</Callout>

	<section id="buy">
		<h2>Commercial parts: where to buy</h2>
		<p class="small muted">
			Quantities and part numbers from the replica's <a href="https://github.com/pablo-mano/microduck-replica/blob/master/BOM.md" rel="noopener">BOM.md</a>
			(checked 2026-09-04) and the official repos. Prices are order of magnitude. Unofficial: Pollen has published no BOM.
			Rows with a model button load the fit-check STL in the viewer above.
		</p>
		<div class="table-wrap">
			<table class="buy">
				<thead><tr><th>Part</th><th>Specification</th><th>Qty</th><th>Price</th><th>Where</th></tr></thead>
				<tbody>
					{#each buy as b (b.part)}
						<tr>
							<td class="bpart">{b.part}{#if b.model}<button type="button" class="model" onclick={() => select(b.model!)} title="Show {b.model} in the viewer">model ↑</button>{/if}</td>
							<td>{b.spec}{#if b.note}<div class="note">{b.note}</div>{/if}</td>
							<td class="num">{b.qty}</td>
							<td>{b.price}</td>
							<td class="links">{#each b.links as l (l.href)}<a href={l.href} rel="noopener">{l.label}</a>{/each}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
		<Callout kind="warn" title="Two things the public material cannot answer">
			<p>Battery contacts: the CAD has only the printed <code>power_support</code>, no contact or spring model; use a commercial NP-F adapter plate. Cable harness: no drawings for Dynamixel 3P cable lengths or the camera ribbon; measure on the build.</p>
		</Callout>
	</section>

	<section>
		<h2>Full comparison table</h2>
		{#each categories as cat (cat.id)}
			{@const rows = all.filter((p) => p.category === cat.id)}
			{#if rows.length}
				<h3>{cat.title} <span class="pill">{rows.length}</span></h3>
				<p class="small muted">{cat.blurb}</p>
				<div class="table-wrap">
					<table class="parts">
						<thead>
							<tr><th>File</th><th>Size (mm)</th><th>Volume</th><th>Triangles<br /><span class="th-sub">community / upstream / sim</span></th><th>vs upstream</th><th>vs sim mesh</th><th>Print</th></tr>
						</thead>
						<tbody>
							{#each rows as p (p.file)}
								<tr class:selrow={selected.file === p.file} onclick={() => { selected = p; window.scrollTo({ top: 0, behavior: 'smooth' }); }}>
									<td class="file"><code>{p.file}</code>{#if !p.inSim}<div class="note">not in the sim model</div>{/if}</td>
									<td class="num">{dims(p.community)}</td>
									<td class="num">{p.community.volume_cm3.toFixed(2)} cm³</td>
									<td class="num">{fmt(p.community.tris)} / {p.upstream ? fmt(p.upstream.tris) : '—'} / {p.sim ? fmt(p.sim.tris) : '—'}</td>
									<td><span class="v {verdictClass(p.vsUpstream)}">{p.vsUpstream}</span></td>
									<td>
										{#if p.vsSim}
											<span class="v {verdictClass(p.vsSim.verdict)}">{p.vsSim.verdict}</span>
											<div class="note">Δvol {pct(p.vsSim.d_volume_pct)}{p.vsSim.decimation ? ` · ${p.vsSim.decimation}× decimated` : ''}</div>
										{:else}<span class="v muted">no sim mesh</span>{/if}
									</td>
									<td class="num">{p.category === 'commercial' ? 'buy' : `×${printQty[p.file] ?? 1}${tpu.has(p.file) ? ' TPU' : ''}`}</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{/if}
		{/each}
	</section>

	<section>
		<h2>How the comparison was made</h2>
		<ul class="small">
			<li>Each STL was parsed (binary or ASCII) and its triangle count, axis-aligned bounding box, surface area and signed volume computed. Units are metres in all three sources.</li>
			<li><strong>byte-identical</strong>: same SHA-256 as the upstream file. <strong>identical geometry</strong>: same triangle count and ≥ 98 % shared vertices. <strong>same shape, remeshed</strong>: bounding box within 0.5 % and volume within 1.5 %. <strong>minor differences</strong>: within 3 % / 8 %. Beyond that: <strong>different</strong>.</li>
			<li>The sim column compares the Hugging Face sandbox STL (what this site collides with) against the community file. The viewer's right-hand mesh comes from the sandbox GLB, whose triangle count can differ slightly from that STL.</li>
			<li>Licence: the replica's STLs are a renamed redistribution of upstream <code>microduck_rl</code> files under <strong>CC BY-NC-SA 4.0</strong>. They are not mirrored here; the viewer streams them from GitHub, so the 3D part needs internet.</li>
		</ul>
		<p class="small muted">Back to the <a href={resolve('/bom')}>bill of materials</a>.</p>
	</section>
</div>

<style>
	.top { padding-top: 3rem; }
	.split { display: grid; grid-template-columns: 280px minmax(0, 1fr); gap: 1.2rem; align-items: start; margin: 1.5rem 0; }
	.list { position: sticky; top: 72px; max-height: calc(100vh - 88px); overflow-y: auto; border: 1px solid var(--line); border-radius: var(--radius); background: var(--bg-2); padding: 0.5rem; display: grid; gap: 0.15rem; align-content: start; }
	.filter { font: inherit; font-size: 0.85rem; color: var(--ink); background: var(--bg); border: 1px solid var(--line); border-radius: 8px; padding: 0.4rem 0.6rem; margin-bottom: 0.3rem; }
	.grp { font-size: 0.7rem; font-weight: 800; text-transform: uppercase; letter-spacing: 0.08em; color: var(--ink-3); padding: 0.6rem 0.4rem 0.2rem; display: flex; justify-content: space-between; }
	.cnt { font-weight: 600; }
	.item { display: grid; grid-template-columns: 0.6rem 1fr auto; gap: 0.5rem; align-items: center; width: 100%; text-align: left; font: inherit; font-size: 0.82rem; color: var(--ink-2); background: none; border: 1px solid transparent; border-radius: 7px; padding: 0.3rem 0.45rem; cursor: pointer; }
	.item:hover { background: var(--bg-3); color: var(--ink); }
	.item.on { background: color-mix(in srgb, var(--yellow) 12%, var(--bg-3)); border-color: var(--yellow); color: var(--ink); }
	.fn { font-family: var(--mono); font-size: 0.78rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.meta { font-size: 0.7rem; color: var(--ink-3); }
	.dot { display: inline-block; width: 0.55rem; height: 0.55rem; border-radius: 50%; background: var(--ink-3); }
	.dot.ok, .dot.ok2 { background: var(--blue); } .dot.warn { background: var(--yellow); } .dot.bad { background: var(--orange); } .dot.muted { background: var(--ink-3); }
	.legend { padding: 0.6rem 0.4rem 0.2rem; display: flex; flex-wrap: wrap; gap: 0.3rem; align-items: center; }
	.stage { display: grid; gap: 0.9rem; min-width: 0; }
	.two { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.2fr); gap: 0.9rem; align-items: start; }
	.details { font-size: 0.9rem; }
	.dtitle { display: flex; gap: 0.5rem; align-items: center; flex-wrap: wrap; color: var(--ink); }
	.verdicts { display: flex; gap: 0.4rem; flex-wrap: wrap; margin: 0.5rem 0 0.7rem; }
	.details dl { display: grid; grid-template-columns: auto 1fr; gap: 0.35rem 0.8rem; margin: 0; }
	.details dt { color: var(--ink-3); font-size: 0.78rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; padding-top: 0.15rem; }
	.details dd { margin: 0; color: var(--ink-2); }
	.summary { margin: 1.5rem 0; }
	.big { font-size: 1.8rem; font-weight: 800; color: var(--yellow); line-height: 1.1; }
	.buy td { font-size: 0.88rem; vertical-align: top; }
	.bpart { font-weight: 700; color: var(--ink); }
	.model { display: block; font: inherit; font-size: 0.7rem; font-weight: 700; color: var(--yellow); background: none; border: 1px solid var(--line); border-radius: 999px; padding: 0.1rem 0.5rem; margin-top: 0.3rem; cursor: pointer; }
	.model:hover { border-color: var(--yellow); }
	.links { display: flex; flex-direction: column; gap: 0.2rem; font-size: 0.85rem; }
	.parts td { font-size: 0.88rem; }
	.parts tr { cursor: pointer; }
	.parts tr:hover td, .parts tr.selrow td { background: color-mix(in srgb, var(--yellow) 8%, transparent); }
	.file code { white-space: nowrap; }
	.num { font-family: var(--mono); font-size: 0.8rem; }
	.th-sub { font-weight: 400; text-transform: none; letter-spacing: 0; font-size: 0.7rem; }
	.note { font-size: 0.75rem; color: var(--ink-3); margin-top: 0.15rem; }
	.v { display: inline-block; font-size: 0.72rem; font-weight: 800; text-transform: uppercase; letter-spacing: 0.04em; padding: 0.12rem 0.5rem; border-radius: 999px; border: 1px solid var(--line); line-height: 1.4; }
	.v.ok { color: var(--green); } .v.ok2 { color: var(--blue); } .v.warn { color: var(--yellow); } .v.bad { color: var(--orange); } .v.muted { color: var(--ink-3); }
	@media (max-width: 960px) {
		.split { grid-template-columns: 1fr; }
		.list { position: static; max-height: 40vh; }
		.two { grid-template-columns: 1fr; }
	}
</style>
