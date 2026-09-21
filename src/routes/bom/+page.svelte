<script lang="ts">
	import { resolve } from '$app/paths';
	import Callout from '#lib/components/Callout.svelte';
	import PartViewer from '#lib/components/PartViewer.svelte';
	import type { Highlight } from '#lib/sim/viewer.ts';
	import instanceData from '#lib/data/mesh-instances.json';

	// Every mesh instance of the simulation model (body + geom index), so a
	// BOM line can be unfolded into its individual pieces.
	interface Instance { key: string; mesh: string; body: string; geom: number }
	const instances = instanceData as { legs: Instance[]; rollers: Instance[] };
	const bodyLabel: Record<string, string> = {
		trunk_base: 'trunk', yaw2roll: 'left hip yaw bracket', hip_l: 'left hip roll', upper_leg_left: 'left upper leg',
		leg: 'left lower leg', ankle_left: 'left ankle', neck: 'neck', neck_pitch: 'neck pitch link', yaw_roll_motion: 'head yaw link',
		jaw_soft: 'head', bearing_roll: 'right hip yaw bracket', hip_l_2: 'right hip roll', upper_leg_right: 'right upper leg',
		leg_2: 'right lower leg', ankle_right: 'right ankle', ankle_l_v1: 'left roller blade', ankle_r_v1: 'right roller blade',
		tire: 'left front wheel', tire_2: 'left rear wheel', tire_3: 'right front wheel', tire_4: 'right rear wheel'
	};
	const pretty = (mesh: string) => mesh.replace(/\.stl$/, '').replace(/__+/g, ' ').replace(/_/g, ' ');
	const siteLabel: Record<string, string> = {
		imu: 'trunk IMU site', head_imu: 'head IMU site', tof: 'ToF sensor site', head_camera: 'camera site', mouth_tip: 'beak tip site',
		left_foot: 'left foot site', right_foot: 'right foot site'
	};

	type Level = 'official' | 'source' | 'community' | 'inferred';
	const levelLabel: Record<Level, string> = {
		official: 'Official',
		source: 'From official source',
		community: 'Community teardown',
		inferred: 'Inferred'
	};

	interface Row { part: string; model: string; qty: string; evidence: string; level: Level; price?: string; note?: string; viz?: Omit<Highlight, 'label'>; vizNote?: string }

	// Hover / pin state for the 3D part preview.
	let hovered = $state<Highlight | null>(null);
	let pinned = $state<Highlight | null>(null);
	const shown = $derived(hovered ?? pinned);
	const toHighlight = (r: Row): Highlight | null => (r.viz ? { label: r.part, ...r.viz } : { label: r.part });
	const same = (a: Highlight | null, b: Highlight | null) => !!a && !!b && a.label === b.label;
	function pin(r: Row) {
		const h = toHighlight(r);
		pinned = same(pinned, h) ? null : h;
	}
	function pinMesh(mesh: string) {
		const h: Highlight = { label: mesh, meshes: [mesh] };
		pinned = same(pinned, h) ? null : h;
	}

	// Unfold a line into its pieces: one entry per mesh instance (+ one per site).
	interface Piece { label: string; where: string; h: Highlight }
	function piecesOf(r: Row): Piece[] {
		if (!r.viz) return [];
		const variant = r.viz.variant ?? 'legs';
		const set = new Set(r.viz.meshes ?? []);
		const list = instances[variant].filter((i) => set.has(i.mesh));
		// Number repeated meshes (#1, #2 …) in kinematics order.
		const counts = new Map<string, number>();
		for (const i of list) counts.set(i.mesh, (counts.get(i.mesh) ?? 0) + 1);
		const seen = new Map<string, number>();
		const pieces: Piece[] = list.map((i) => {
			const n = (seen.get(i.mesh) ?? 0) + 1;
			seen.set(i.mesh, n);
			const label = counts.get(i.mesh)! > 1 ? `${pretty(i.mesh)} #${n}` : pretty(i.mesh);
			return { label, where: bodyLabel[i.body] ?? i.body, h: { label: `${r.part} · ${label}`, instances: [i.key], variant } };
		});
		for (const site of r.viz.sites ?? []) {
			pieces.push({ label: siteLabel[site] ?? site, where: 'sensor position', h: { label: `${r.part} · ${siteLabel[site] ?? site}`, sites: [site], variant } });
		}
		return pieces;
	}
	let expanded = $state<Set<string>>(new Set());
	function toggleRow(r: Row) {
		const next = new Set(expanded);
		if (next.has(r.part)) next.delete(r.part);
		else next.add(r.part);
		expanded = next;
		pin(r);
	}
	function pinPiece(p: Piece) {
		pinned = same(pinned, p.h) ? null : p.h;
	}

	const electronics: Row[] = [
		{ part: 'Compute board', model: 'Radxa Zero 3W (Rockchip RK3566, 4× Cortex-A55, 0.8 TOPS NPU)', qty: '1', level: 'source', viz: { meshes: ['pcb__raspberry_pi_zero_2_w.stl'] }, vizNote: 'Model shows the prototype\'s Pi Zero 2 W footprint in the same slot.', evidence: 'Press kit: "RK3566 with AI accelerator, 1 GB RAM, 32 GB storage". Official docs: install-dev.md and slice-2-bringup.md target "Radxa Zero 3W"; user home is /home/radxa.', price: '$30–45', note: 'Production units use the 1 GB / 32 GB eMMC variant.' },
		{ part: 'Servo (14 joints + beak)', model: 'ROBOTIS Dynamixel XL330 (M288-T variant per community teardowns)', qty: '15', level: 'source', viz: { meshes: ['xl330.stl'] }, evidence: 'robotd-design.md: "Dynamixel XL330", IDs 10–14, 20–24, 30–34, 1 Mbps TTL. microduck_rl: "BAM M6 model for Dynamixel XL330". MJCF mesh xl330.stl ×15.', price: '$24–42 each', note: 'Exact sub-model (M288 vs M077) is not stated by Pollen.' },
		{ part: 'Body IMU board', model: 'imu_to_dxl v2: STM32G031 + ST LSM6DSV16X, on the Dynamixel bus as ID 200', qty: '1', level: 'source', viz: { sites: ['imu'] }, vizNote: 'Marker = the imu site in the trunk; the board itself has no mesh.', evidence: 'robotd-design.md: "on-chip SFLP quaternion sensor (v2 imu_to_dxl board), IMU ID 200", read in the same sync_read as the servos. Chip identification from community replicas (avanx/microduck_imu_to_ttl).', price: '$15–25' },
		{ part: 'Head IMU', model: 'Second IMU in the head (chip not published)', qty: '1', level: 'official', viz: { sites: ['head_imu'] }, evidence: 'Press kit: "2 IMUs (one in body, one in head)". MJCF has a head_imu site.', note: 'Community replicas use BMI088 or BNO085 here; unconfirmed.' },
		{ part: 'Depth sensor', model: 'ST VL53L5CX or VL53L8CX, 8×8 ToF matrix, I²C 0x29', qty: '1', level: 'source', viz: { sites: ['tof'] }, evidence: 'architecture.md: "VL53L5/8CX depth sensor on HAT\'s I²C bus, 8×8 depth matrix". Press kit: "Compact LiDAR: 8x8 time-of-flight matrix".', price: '$25–50' },
		{ part: 'Camera', model: 'MIPI CSI camera, Sony IMX219 class (Pi Camera v2 compatible), 640×480 @ 30 fps in mediad', qty: '1', level: 'community', viz: { meshes: ['lens.stl', 'm12_lens_holder.stl'], sites: ['head_camera'] }, evidence: 'architecture.md: camera produces 640×480 RGB frames at 30 fps. Radxa Zero 3W has a 22-pin CSI port; community teardowns report an IMX219 module mounted upside down. Press kit: "resolution and field of view still being finalized".', price: '$10–25' },
		{ part: 'HAT (sensor + audio + power board)', model: 'Pollen "RPI Robot HAT" (elec_RPI_Robot_HAT), KiCad 9, Apache-2.0', qty: '1', level: 'official', viz: { meshes: ['elec_rpi_robot_hat_pcb.stl'] }, evidence: 'github.com/pollen-robotics/elec_RPI_Robot_HAT: Pi Zero form factor, Dynamixel TTL/RS-485 bus, MEMS microphone, speaker connector, Qwiic, 5–28 V input via the motor connectors. MJCF mesh elec_rpi_robot_hat_pcb.stl.', price: '~$20–30 as a hand-built board', note: 'Schematics are public; a production BOM for the shipped revision is not.' },
		{ part: 'Audio codec', model: 'TI TLV320AIC3104 (I²C 0x18) on the HAT', qty: '1', level: 'community', viz: { meshes: ['elec_rpi_robot_hat_pcb.stl'] }, vizNote: 'Lives on the HAT PCB.', evidence: 'architecture.md: "audio codec shares I²C bus with the ToF sensor". Part number from the HAT schematic as read by community replicas.', price: '$3–5' },
		{ part: 'Speaker + microphone', model: 'Small speaker on the HAT Wago connector; MEMS mic on the HAT', qty: '1 + 1', level: 'official', viz: { meshes: ['speaker.stl'] }, evidence: 'Press kit: "Microphones and speaker with per-robot generated voice". MJCF mesh speaker.stl. HAT README lists the MEMS microphone.', price: '$3–6' },
		{ part: 'NFC antennas', model: 'Two NFC antennas (head and beak); reader IC not published', qty: '2', level: 'official', viz: { meshes: ['top_head_shell.stl', 'jaw.stl'] }, vizNote: 'Approximate: antennas sit under the head shell and in the beak.', evidence: 'Press kit: "2 NFC antennas (head and beak)". No NFC driver in the public runtime as of September 2026.' },
		{ part: 'Battery', model: 'Sony NP-F550-type camera battery, 2S Li-ion, 2600 mAh, 6.6–8.2 V', qty: '1', level: 'official', viz: { meshes: ['np_f970.stl', 'power_support.stl'] }, vizNote: 'Model carries the prototype\'s taller NP-F970 pack and its holder.', evidence: 'Press kit: "Removable NP-F550 camera battery, 2600 mAh, around one hour". robotd-design.md: 6.6 V empty, 8.2 V full under load. MJCF still carries the prototype\'s np_f970.stl mesh.', price: '$15–35', note: 'Sold separately in the $39 charger pack.' },
		{ part: 'Wi-Fi / Bluetooth', model: 'On the Radxa Zero 3W (AIC8800, Wi-Fi 5 + BT 5.0)', qty: '—', level: 'inferred', viz: { meshes: ['pcb__raspberry_pi_zero_2_w.stl'] }, evidence: 'configd manages Wi-Fi via NetworkManager; btd/padd pair gamepads over BLE. Radio is the board\'s own module.' },
		{ part: 'Game controller', model: 'Bluetooth gamepad (Xbox-style mapping in padd; Switch Pro-class reported by the community)', qty: '1', level: 'official', evidence: 'Press kit: "Game controller in the box". Official docs: pair-a-gamepad.md.', price: '$25–45' },
		{ part: 'Storage', model: 'eMMC on the board (32 GB) or microSD on eMMC-less boards', qty: '1', level: 'official', viz: { meshes: ['pcb__raspberry_pi_zero_2_w.stl'] }, evidence: 'Press kit: "32 GB storage".' }
	];

	const mechanics: Row[] = [
		{ part: 'Printed shells', model: 'Head top and bottom shells, face plate, eye ring, trunk left/right shells, trunk base, upper-leg shells and their two rigidity plates', qty: '11', level: 'inferred', evidence: 'STL meshes referenced by the MJCF / kinematics.json of microduck_rl. Simulation meshes, not manufacturing files: tolerances, threads and cable routing are not modelled.', viz: { meshes: ['top_head_shell.stl', 'bottom_head_shell.stl', 'face_part.stl', 'noenoeil.stl', 'left_shell.stl', 'right_shell.stl', 'trunk_base.stl', 'upper_leg_left.stl', 'upper_leg_right.stl', 'upper_leg_rigidity_plate.stl'] } },
		{ part: 'Printed structure', model: 'Hip yaw/roll brackets, legs, ankles, feet, neck links, motor and battery supports, PCB locker, rigid jaw', qty: '20', level: 'inferred', evidence: 'Same source. Several parts are printed twice (left/right): leg, hip_l, yaw2roll, bearing_roll, neck. Unfold the row for the piece list.', viz: { meshes: ['yaw2roll.stl', 'bearing_roll.stl', 'hip_l.stl', 'leg.stl', 'ankle_left.stl', 'ankle_right.stl', 'foot_left.stl', 'foot_right.stl', 'neck.stl', 'neck_pitch.stl', 'yaw_roll_motion.stl', 'motor_support.stl', 'power_support.stl', 'banana_pcb_locker.stl', 'jaw.stl'] } },
		{ part: 'Printed flexible parts (TPU)', model: 'Soft mouth top, soft jaw pad, left and right soles', qty: '4', level: 'inferred', evidence: 'Mesh names in the MJCF (soft_mouth_top, jaw_soft, sole_left, sole_right). Material is a guess from the names.', viz: { meshes: ['soft_mouth_top.stl', 'jaw_soft.stl', 'sole_left.stl', 'sole_right.stl'] } },
		{ part: 'Ball bearings, hips and neck', model: '22 × 16 × 4 mm (MJCF: seeed_bearing__configuration__22x16x4)', qty: '11', level: 'inferred', viz: { meshes: ['seeed_bearing__configuration__22x16x4.stl'] }, evidence: 'Mesh instances in the MJCF. Community replicas list 11–14 depending on how the neck is counted.', price: '$1–2 each' },
		{ part: 'Ball bearings, small', model: '"seeed_bearing__configuration_default" (dimensions not in the model; replicas use 15 × 10 × 3 mm)', qty: '3', level: 'inferred', viz: { meshes: ['seeed_bearing__configuration_default.stl'] }, evidence: 'Mesh instances in the MJCF.' },
		{ part: 'Fasteners', model: 'M2 screws (Dynamixel XL330 pattern) and M2 heat-set inserts', qty: '~300 screws, 20–30 inserts', level: 'inferred', evidence: 'XL330 horn and case use M2. Screw counts come from community hole-feature scans of the STLs, not from Pollen.', price: '$10–15' },
		{ part: 'Camera lens holder', model: 'M12 lens holder + lens (MJCF: m12_lens_holder.stl, lens.stl)', qty: '1', level: 'inferred', viz: { meshes: ['m12_lens_holder.stl', 'lens.stl'] }, evidence: 'Mesh names in the MJCF.' },
		{ part: 'Roller accessory', model: 'Roller blade + rim + tire per foot (2 wheels per foot, passive)', qty: '2 blades, 4 wheels', level: 'inferred', viz: { variant: 'rollers', meshes: ['roller_blade.stl', 'rim.stl', 'tire.stl', 'ankle_l_v1.stl', 'ankle_r_v1.stl'] }, evidence: 'robot_allcollisions_rollers.xml: bodies tire … tire_4 on passive_LF/LR/RF/RR_wheel hinges; meshes roller_blade.stl, rim.stl, tire.stl.', note: 'Shipped as part of the $39 accessory pack.' }
	];

	const meshList = [
		'ankle_left', 'ankle_right', 'banana_pcb_locker', 'bearing_roll', 'bottom_head_shell', 'elec_rpi_robot_hat_pcb', 'face_part',
		'foot_left', 'foot_right', 'hip_l', 'jaw', 'jaw_soft', 'left_shell', 'leg', 'lens', 'm12_lens_holder', 'motor_support', 'neck',
		'neck_pitch', 'noenoeil', 'np_f970', 'pcb__raspberry_pi_zero_2_w', 'power_support', 'right_shell',
		'seeed_bearing__configuration__22x16x4', 'seeed_bearing__configuration_default', 'soft_mouth_top', 'sole_left', 'sole_right',
		'speaker', 'top_head_shell', 'trunk_base', 'upper_leg_left', 'upper_leg_right', 'upper_leg_rigidity_plate', 'xl330', 'yaw2roll',
		'yaw_roll_motion'
	];
	const rollerMeshList = ['ankle_l_v1', 'ankle_r_v1', 'roller_blade', 'rim', 'tire'];

	const packs = [
		{ name: 'Microduck', price: '$399', contents: 'Robot, game controller, 7 trained moves, autonomous behaviours' },
		{ name: 'Charger pack', price: '$39', contents: 'NP-F550 battery charging accessories' },
		{ name: 'Dev pack', price: '$119', contents: 'Developer add-ons (contents not itemised publicly)' },
		{ name: 'Accessory pack', price: '$39', contents: 'Rollers and props' }
	];
</script>

<svelte:head>
	<title>Microduck bill of materials — what is inside, with evidence</title>
	<meta name="description" content="Bill of materials for the Microduck robot: compute board, servos, sensors, battery, printed parts and bearings, with the evidence level for every row. Pollen has not published an official BOM." />
</svelte:head>

<div class="wrap">
	<section class="top">
		<div class="eyebrow">Hardware</div>
		<h1>Bill of materials</h1>
		<p class="lead">
			Pollen Robotics has <strong>not</strong> published an official BOM, CAD or production schematics for Microduck.
			The software stack is Apache-2.0; the mechanical and electronic design is proprietary. This page assembles what is
			known from the press kit, the official repositories and community teardowns, and labels every row with its
			evidence level.
		</p>
	</section>

	<Callout kind="warn" title="Read the evidence column">
		<p>
			<span class="lvl official">Official</span> = stated by Pollen (press kit, product page, official repos).
			<span class="lvl source">From official source</span> = read out of the public runtime, docs or MJCF.
			<span class="lvl community">Community teardown</span> = reported by people who opened a unit or rebuilt one.
			<span class="lvl inferred">Inferred</span> = mesh names and counts in the simulation model; may differ from the shipped robot.
			Prices are street prices in September 2026 for equivalent parts, not Pollen's costs.
		</p>
	</Callout>

	<div class="split">
		<div class="tables">
			{#snippet bomTable(rows: Row[])}
				<div class="table-wrap">
					<table class="bom">
						<thead><tr><th>Part</th><th>Model / spec</th><th>Qty</th><th>Level</th><th>Evidence</th><th>Est. price</th></tr></thead>
						<tbody>
							{#each rows as r (r.part)}
								<tr
									class="row"
									class:active={same(shown, toHighlight(r))}
									class:pinned={same(pinned, toHighlight(r))}
									class:open={expanded.has(r.part)}
									onmouseenter={() => (hovered = toHighlight(r))}
									onmouseleave={() => (hovered = null)}
									onclick={() => toggleRow(r)}
								>
									<td class="part">
										<button type="button" class="eye" aria-label="Show {r.part} on the robot" aria-expanded={expanded.has(r.part)} onclick={(e) => { e.stopPropagation(); toggleRow(r); }} onfocus={() => (hovered = toHighlight(r))} onblur={() => (hovered = null)}>{r.viz ? (expanded.has(r.part) ? '▾' : '▸') : '◉'}</button>
										{r.part}
										{#if !r.viz}<div class="note">not in the sim model</div>{:else if r.vizNote}<div class="note">{r.vizNote}</div>{/if}
									</td>
									<td>{r.model}{#if r.note}<div class="note">{r.note}</div>{/if}</td>
									<td class="qty">{r.qty}</td>
									<td><span class="lvl {r.level}">{levelLabel[r.level]}</span></td>
									<td class="ev">{r.evidence}</td>
									<td class="price">{r.price ?? '—'}</td>
								</tr>
								{#if expanded.has(r.part) && r.viz}
									{@const pieces = piecesOf(r)}
									<tr class="sub">
										<td colspan="6">
											<div class="pieces-head">{pieces.length} piece{pieces.length === 1 ? '' : 's'} in the simulation model · hover one to see it alone, click to pin</div>
											<ol class="pieces">
												{#each pieces as p, i (p.h.label)}
													<li>
														<button
															type="button"
															class="piece"
															class:on={same(shown, p.h)}
															onmouseenter={() => (hovered = p.h)}
															onmouseleave={() => (hovered = null)}
															onfocus={() => (hovered = p.h)}
															onblur={() => (hovered = null)}
															onclick={(e) => { e.stopPropagation(); pinPiece(p); }}
														>
															<span class="idx">{i + 1}</span>
															<span class="pl">{p.label}</span>
															<span class="pw">{p.where}</span>
														</button>
													</li>
												{/each}
											</ol>
										</td>
									</tr>
								{/if}
							{/each}
						</tbody>
					</table>
				</div>
			{/snippet}

			<section>
				<h2>Electronics</h2>
				<p class="small muted">Hover a row to highlight the part on the robot. Click a row (or its ▸ button) to unfold every individual piece and pin the selection.</p>
				{@render bomTable(electronics)}
			</section>

			<section>
				<h2>Mechanics</h2>
				{@render bomTable(mechanics)}
			</section>
	<section>
				<h3>Printed parts named in the simulation model</h3>
				<p class="small">The 38 mesh files referenced by <code>robot_allcollisions.xml</code> / <code>kinematics.json</code>. Duplicated meshes (e.g. <code>xl330</code>, <code>leg</code>, <code>hip_l</code>) are used on both sides. Hover a name to see it on the robot; click to pin.</p>
				<div class="chips">
					{#each meshList as m (m)}
						<button type="button" class="chip" class:on={same(shown, { label: `${m}.stl` })} onmouseenter={() => (hovered = { label: `${m}.stl`, meshes: [`${m}.stl`] })} onmouseleave={() => (hovered = null)} onclick={() => pinMesh(`${m}.stl`)}>{m}</button>
					{/each}
					<span class="chip-sep">roller variant:</span>
					{#each rollerMeshList as m (m)}
						<button type="button" class="chip roller" class:on={same(shown, { label: `${m}.stl` })} onmouseenter={() => (hovered = { label: `${m}.stl`, meshes: [`${m}.stl`], variant: 'rollers' })} onmouseleave={() => (hovered = null)} onclick={() => (pinned = same(pinned, { label: `${m}.stl` }) ? null : { label: `${m}.stl`, meshes: [`${m}.stl`], variant: 'rollers' })}>{m}</button>
					{/each}
				</div>
				<p class="small muted">
					Two names betray the model's age: <code>pcb__raspberry_pi_zero_2_w</code> and <code>np_f970</code>. The RL model was
					built from an earlier prototype on a Raspberry Pi Zero 2 W with an NP-F970 battery; the shipped robot uses a Radxa
					Zero 3W and an NP-F550. Treat the STLs as the alpha geometry, not the production one.
				</p>
			</section>
		</div>
		<aside class="preview">
			<PartViewer highlight={shown} pinned={!hovered && !!pinned} />
			{#if pinned}
				<button type="button" class="btn small-btn" onclick={() => (pinned = null)}>Clear pin</button>
			{/if}
		</aside>
	</div>



	<section>
		<h2>Wiring, as the runtime sees it</h2>
		<div class="table-wrap">
			<table>
				<thead><tr><th>Bus</th><th>Devices</th><th>Source</th></tr></thead>
				<tbody>
					<tr><td>UART2 (<code>/dev/ttyS2</code>), 1 Mbps TTL half-duplex, Dynamixel protocol 2.0</td><td>15 × XL330 (IDs 10–14 right leg, 20–24 left leg, 30–34 neck/head/mouth) + imu_to_dxl board (ID 200)</td><td>robotd-design.md</td></tr>
					<tr><td>I²C (HAT)</td><td>ToF VL53L5/8CX at 0x29, audio codec at 0x18</td><td>architecture.md</td></tr>
					<tr><td>MIPI CSI</td><td>Camera, 640×480 @ 30 fps into mediad, hardware-encoded by the RK3566 MPP</td><td>architecture.md, microduck-gst-plugins</td></tr>
					<tr><td>Power</td><td>NP-F550 2S pack → HAT regulators → board 5 V and servo bus 6.6–8.2 V; per-servo voltage read on the bus</td><td>robotd-design.md, HAT README</td></tr>
					<tr><td>Radio</td><td>Wi-Fi (NetworkManager via configd), BLE (btd, padd for the gamepad, phone app)</td><td>architecture.md</td></tr>
				</tbody>
			</table>
		</div>
	</section>

	<section>
		<h2>Official packs and pricing</h2>
		<div class="table-wrap">
			<table>
				<thead><tr><th>Item</th><th>Price</th><th>Contents</th></tr></thead>
				<tbody>
					{#each packs as p (p.name)}
						<tr><td>{p.name}</td><td>{p.price}</td><td>{p.contents}</td></tr>
					{/each}
				</tbody>
			</table>
		</div>
		<p class="small muted">Pre-orders opened 27 August 2026; first deliveries targeted before Christmas 2026. Prices before taxes and shipping.</p>
	</section>

	<section>
		<h2>Can you build one?</h2>
		<p>
			Not from official files. The STL/MJCF meshes are CC BY-NC-SA and were exported for simulation; the HAT is open
			(KiCad, Apache-2.0); the IMU board, the shells' production geometry, wiring harness and firmware for the beak are
			not published. Several community projects are reverse-engineering a replica; they are the best starting point if
			you want to try:
		</p>
		<ul>
			<li><a href="https://github.com/pablo-mano/microduck-replica" rel="noopener">pablo-mano/microduck-replica</a>: assembly drawings, CAD assemblies, electronics derived from the MJCF and Rust source, includes an imu_to_dxl schematic.</li>
			<li><a href="https://github.com/prodou/microduck-replica" rel="noopener">prodou/microduck-replica</a>: priced BOM (~¥2 600 with Feetech servos, ~¥12 600 with Dynamixel), confidence levels per row.</li>
			<li><a href="https://github.com/lingzolabs/microduck-hardware-replica" rel="noopener">lingzolabs/microduck-hardware-replica</a>: FreeCAD assemblies and a 39-line BOM draft from the mesh list.</li>
			<li><a href="https://github.com/wslengzhicheng/microduck-diy" rel="noopener">wslengzhicheng/microduck-diy</a>: Chinese DIY build docs (BOM, printing, wiring, assembly) on a Pi Zero 2 W.</li>
			<li><a href="https://github.com/avanx/microduck_imu_to_ttl" rel="noopener">avanx/microduck_imu_to_ttl</a>: open LSM6DSV16X IMU board speaking Dynamixel on the servo bus.</li>
			<li><a href="https://github.com/pollen-robotics/elec_RPI_Robot_HAT" rel="noopener">pollen-robotics/elec_RPI_Robot_HAT</a>: the official HAT design files.</li>
		</ul>
		<p class="small muted">Buying the robot is cheaper than a Dynamixel-based replica: 15 XL330 servos alone cost more than the $399 robot. See the <a href={resolve('/')}>overview</a> for what you get.</p>
		<p>Want to see the replica's print files next to the meshes used here? The <a href={resolve('/printables')}>Printables</a> page compares all 45 STLs (triangles, dimensions, volume, byte-identity with upstream) and shows them side by side in 3D.</p>
	</section>

	<section>
		<h2>Sources</h2>
		<ul class="small">
			<li><a href="https://pollen-robotics.com/microduck/press-kit/" rel="noopener">Pollen Robotics press kit</a> (specs, battery, sensors, packs)</li>
			<li><a href="https://github.com/pollen-robotics/microduck/blob/main/docs/design/robotd-design.md" rel="noopener">robotd-design.md</a>, <a href="https://github.com/pollen-robotics/microduck/blob/main/docs/design/architecture.md" rel="noopener">architecture.md</a>, <a href="https://github.com/pollen-robotics/microduck/blob/main/docs/project/slice-2-bringup.md" rel="noopener">slice-2-bringup.md</a></li>
			<li><a href="https://github.com/pollen-robotics/microduck_rl" rel="noopener">microduck_rl</a> MJCF and mesh set</li>
			<li><a href="https://github.com/pollen-robotics/elec_RPI_Robot_HAT" rel="noopener">elec_RPI_Robot_HAT</a></li>
			<li>Community replicas linked above and the <a href="https://github.com/joeynyc/awesome-microduck" rel="noopener">awesome-microduck</a> hardware section</li>
		</ul>
	</section>
</div>

<style>
	.top { padding-top: 3rem; }
	.split { display: grid; grid-template-columns: minmax(0, 1fr) 360px; gap: 1.5rem; align-items: start; }
	.preview { position: sticky; top: 76px; display: grid; gap: 0.6rem; justify-items: end; }
	.small-btn { padding: 0.35rem 0.8rem; font-size: 0.8rem; }
	.row { cursor: pointer; transition: background 0.12s; }
	.row:hover, .row.active { background: color-mix(in srgb, var(--yellow) 9%, transparent); }
	.row.pinned td:first-child { box-shadow: inset 3px 0 0 var(--yellow); }
	.row.open td { border-bottom-color: transparent; }
	.sub td { padding: 0 0.7rem 0.9rem 2.6rem; background: color-mix(in srgb, var(--yellow) 4%, transparent); }
	.pieces-head { font-size: 0.75rem; color: var(--ink-3); margin: 0.2rem 0 0.5rem; }
	.pieces { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 0.3rem; }
	.piece { width: 100%; display: grid; grid-template-columns: 1.6rem 1fr; grid-template-areas: 'i l' 'i w'; align-items: center; text-align: left; font: inherit; font-size: 0.82rem; color: var(--ink-2); background: var(--bg-2); border: 1px solid var(--line); border-radius: 8px; padding: 0.35rem 0.55rem; cursor: pointer; }
	.piece:hover, .piece.on { color: var(--ink); border-color: var(--yellow); background: color-mix(in srgb, var(--yellow) 10%, var(--bg-2)); }
	.piece .idx { grid-area: i; font-family: var(--mono); font-size: 0.7rem; color: var(--ink-3); }
	.piece .pl { grid-area: l; font-weight: 600; }
	.piece .pw { grid-area: w; font-size: 0.72rem; color: var(--ink-3); }
	.eye { font: inherit; font-size: 0.8rem; line-height: 1; color: var(--ink-3); background: none; border: 1px solid var(--line); border-radius: 50%; width: 1.4rem; height: 1.4rem; margin-right: 0.35rem; cursor: pointer; vertical-align: middle; }
	.eye:hover, .row.active .eye { color: var(--yellow); border-color: var(--yellow); }
	.chips { display: flex; flex-wrap: wrap; gap: 0.35rem; margin: 0.6rem 0 1rem; }
	.chip { font: inherit; font-family: var(--mono); font-size: 0.78rem; color: var(--ink-2); background: var(--bg-2); border: 1px solid var(--line); border-radius: 999px; padding: 0.15rem 0.6rem; cursor: pointer; }
	.chip:hover, .chip.on { color: var(--yellow); border-color: var(--yellow); }
	.chip.roller { color: var(--orange); }
	.chip-sep { font-size: 0.75rem; color: var(--ink-3); align-self: center; margin-left: 0.4rem; }
	@media (max-width: 1000px) {
		.split { grid-template-columns: 1fr; }
		.preview { position: static; justify-items: stretch; }
	}
	.bom td { font-size: 0.9rem; }
	.part { font-weight: 700; color: var(--ink); }
	.qty { white-space: nowrap; }
	.ev { font-size: 0.82rem; color: var(--ink-3); }
	.bom { table-layout: fixed; }
	.bom th:nth-child(1) { width: 12%; } .bom th:nth-child(2) { width: 24%; } .bom th:nth-child(3) { width: 7%; } .bom th:nth-child(4) { width: 13%; } .bom th:nth-child(6) { width: 10%; }
	@media (max-width: 800px) { .bom { table-layout: auto; min-width: 60rem; } }
	.note { font-size: 0.8rem; color: var(--ink-3); margin-top: 0.2rem; }
	.lvl { display: inline-block; font-size: 0.7rem; font-weight: 800; letter-spacing: 0.04em; text-transform: uppercase; padding: 0.15rem 0.5rem; border-radius: 999px; border: 1px solid var(--line); line-height: 1.4; }
	.lvl.official { color: var(--green); }
	.lvl.source { color: var(--blue); }
	.lvl.community { color: var(--yellow); }
	.lvl.inferred { color: var(--ink-2); }
</style>
