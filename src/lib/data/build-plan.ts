// Build plan for a Microduck replica: steps, print batches, shopping list
// with North-American vendors first, lead-time and effort assumptions.
// Quantities follow pablo-mano/microduck-replica BOM.md (2026-09-04) and the
// official docs. Everything with a number is an estimate you can edit in the UI.

import parts from './community-parts.json';
import type { FixedLink, Queries, VendorKind } from './vendors.ts';
export { COUNTRIES, COUNTRY_BY_CODE, DEFAULT_COUNTRY, linksFor, type ResolvedLink } from './vendors.ts';

export interface PrintJob {
	file: string; // STL name in the replica repo (slice it to <name>.gcode)
	qty: number;
	material: 'PLA/PETG' | 'TPU';
	volumeCm3: number; // per piece, from the STL
	note?: string;
}

export interface ShopItem {
	id: string;
	name: string;
	spec: string;
	qty: string;
	priceUsd: [number, number]; // order of magnitude, total for the quantity
	queries: Queries; // per-vendor-kind search terms, resolved per country by linksFor()
	kinds?: VendorKind[]; // restrict which vendor kinds apply
	fixed?: FixedLink[]; // exact product / repo pages
	critical?: boolean; // on the critical path (long lead time)
	note?: string;
	/** Mesh files this purchase corresponds to in the model (for the progress views). */
	meshes?: string[];
}

/** A checklist entry: plain text, or text tied to shop items (ticking it marks them ordered and highlights their parts). */
export type CheckItem = string | { text: string; items: string[] };

export interface Step {
	id: string;
	title: string;
	phase: 'order' | 'print' | 'electronics' | 'assembly' | 'software';
	summary: string;
	humanHours: number; // hands-on time, excluding printing and shipping
	checklist: CheckItem[];
	prints?: PrintJob[];
	shop?: string[]; // ShopItem ids needed before this step can start
	links?: { label: string; href: string }[];
	waitsFor?: string[]; // ShopItem ids whose delivery gates this step
	/** Mesh files that physically exist after this step (printed, bought, or fitted). Cumulative across steps. */
	adds?: string[];
	/** Mesh files this step works on (highlighted); defaults to `adds`. */
	focus?: string[];
	/** Rig used for the 3D views of this step. */
	variant?: 'legs' | 'rollers';
	/** Assembly steps: MJCF bodies whose parts count as assembled once the checklist is complete. */
	bodies?: string[];
}

export const LEG_MESHES = ['yaw2roll.stl', 'bearing_roll.stl', 'hip_l.stl', 'upper_leg_left.stl', 'upper_leg_right.stl', 'upper_leg_rigidity_plate.stl', 'leg.stl', 'ankle_left.stl', 'ankle_right.stl', 'foot_left.stl', 'foot_right.stl', 'sole_left.stl', 'sole_right.stl'];
export const TRUNK_MESHES = ['trunk_base.stl', 'left_shell.stl', 'right_shell.stl', 'power_support.stl', 'banana_pcb_locker.stl', 'motor_support.stl'];
export const HEAD_MESHES = ['top_head_shell.stl', 'bottom_head_shell.stl', 'face_part.stl', 'noenoeil.stl', 'jaw.stl', 'neck.stl', 'neck_pitch.stl', 'yaw_roll_motion.stl', 'm12_lens_holder.stl', 'jaw_soft.stl', 'soft_mouth_top.stl'];
export const ROLLER_MESHES = ['roller_blade.stl', 'rim.stl', 'tire.stl', 'ankle_l_v1.stl', 'ankle_r_v1.stl'];
export const ELECTRONICS_MESHES = ['xl330.stl', 'pcb__raspberry_pi_zero_2_w.stl', 'elec_rpi_robot_hat_pcb.stl', 'lens.stl', 'speaker.stl', 'np_f970.stl'];
export const BEARINGS_BIG = ['seeed_bearing__configuration__22x16x4.stl'];
export const BEARINGS_SMALL = ['seeed_bearing__configuration_default.stl'];

const vol = new Map<string, number>((parts as { file: string; community: { volume_cm3: number } }[]).map((p) => [p.file, p.community.volume_cm3]));
const job = (file: string, qty: number, material: PrintJob['material'] = 'PLA/PETG', note?: string): PrintJob => ({
	file, qty, material, volumeCm3: vol.get(file) ?? 0, note
});

// ── Shopping list ───────────────────────────────────────────────────────
const doc = (vendor: string, url: string): FixedLink => ({ vendor, url, countries: 'all', leadDays: [0, 0], kind: 'robotics' });

export const SHOP: ShopItem[] = [
	{
		id: 'servos', meshes: ['xl330.stl'], name: 'Dynamixel XL330-M288-T', spec: 'ROBOTIS smart servo, TTL, 3P JST EH cables included', qty: '15', priceUsd: [360, 630], critical: true,
		queries: { marketplace: 'Dynamixel XL330-M288-T', robotics: 'XL330-M288-T', distributor: 'XL330-M288-T' }, kinds: ['marketplace', 'robotics', 'intl'],
		fixed: [
			{ vendor: 'ROBOTIS US (product page, ships worldwide)', url: 'https://www.robotis.us/dynamixel-xl330-m288-t/', countries: 'all', leadDays: [7, 14] },
			doc('ROBOTIS e-Manual (spec)', 'https://emanual.robotis.com/docs/en/dxl/x/xl330-m288/')
		],
		note: 'Model number inferred by the community; the source only says "xl330". Rated 3.7–6 V, Microduck runs it at 6.6–8.2 V on purpose.'
	},
	{
		id: 'board', meshes: ['pcb__raspberry_pi_zero_2_w.stl'], name: 'Radxa Zero 3W', spec: 'RK3566, 2 GB RAM / 16 GB eMMC recommended for a replica (official robot: 1 GB / 32 GB), with pin headers', qty: '1', priceUsd: [35, 55], critical: true,
		queries: { marketplace: 'Radxa Zero 3W', maker: 'Radxa Zero 3W', distributor: 'Radxa Zero 3W' }, kinds: ['marketplace', 'maker', 'intl'],
		fixed: [
			{ vendor: 'Arace (official distributor)', url: 'https://arace.tech/products/radxa-zero-3w', countries: 'all', leadDays: [10, 20], kind: 'maker' },
			doc('Radxa product page', 'https://radxa.com/products/zeros/zero3w')
		]
	},
	{
		id: 'camera', meshes: ['lens.stl', 'm12_lens_holder.stl'], name: 'Camera IMX219', spec: 'Raspberry Pi Camera Module v2 (or Radxa Camera 8M 219) + 15→22-pin ribbon', qty: '1', priceUsd: [15, 35],
		queries: { marketplace: 'Raspberry Pi Camera Module v2 IMX219', maker: 'Camera Module v2', distributor: 'Raspberry Pi Camera Module V2', robotics: 'Raspberry Pi Camera V2' },
		fixed: [doc('Radxa Camera 8M 219', 'https://radxa.com/products/accessories/camera-8m-219/')]
	},
	{
		id: 'tof', name: 'ToF 8×8 sensor VL53L8CX / VL53L5CX', spec: 'Breakout with Qwiic/Stemma connector, I²C 0x29', qty: '1', priceUsd: [25, 50],
		queries: { marketplace: 'VL53L5CX breakout', distributor: 'VL53L8CX', maker: 'VL53L5CX', robotics: 'VL53L5CX' },
		fixed: [
			{ vendor: 'SparkFun VL53L5CX Qwiic', url: 'https://www.sparkfun.com/products/18642', countries: ['US', 'CA', 'MX'], leadDays: [4, 10], kind: 'maker' },
			doc('ST VL53L8CX product page', 'https://www.st.com/en/imaging-and-photonics-solutions/vl53l8cx.html')
		]
	},
	{
		id: 'battery', meshes: ['np_f970.stl'], name: 'NP-F550 battery + charger', spec: 'Sony NP-F550-type 2S Li-ion 2600 mAh (NP-F970 does not fit); external charger, no charger on the HAT', qty: '1 (+1 spare)', priceUsd: [25, 50],
		queries: { marketplace: 'NP-F550 battery charger' }, kinds: ['marketplace', 'intl']
	},
	{
		id: 'npf-plate', name: 'NP-F adapter / contact plate', spec: 'Commercial NP-F holder with DC leads; upstream CAD has no contact model', qty: '1', priceUsd: [8, 20],
		queries: { marketplace: 'NP-F battery adapter plate DC' }, kinds: ['marketplace', 'intl']
	},
	{
		id: 'speaker', meshes: ['speaker.stl'], name: 'Speaker 8 Ω ~1 W, ~28 mm', spec: 'Wired to the HAT Wago terminals (PAM8406 amp on board)', qty: '1', priceUsd: [3, 8],
		queries: { marketplace: '28mm 8 ohm 1W speaker', distributor: 'speaker 8 ohm 1W 28mm', maker: '8 ohm speaker' }
	},
	{
		id: 'hat', meshes: ['elec_rpi_robot_hat_pcb.stl'], name: 'RPI Robot HAT (fabricate + assemble)', spec: '4-layer 1.0 mm, 65.0 × 30.9 mm, 113 components; Gerbers/BOM/CPL in the repo production/ folder. Not hand-solderable', qty: '1 (min. order 2–5)', priceUsd: [60, 150], critical: true,
		queries: {}, kinds: ['pcb'],
		fixed: [doc('pollen-robotics/elec_RPI_Robot_HAT', 'https://github.com/pollen-robotics/elec_RPI_Robot_HAT')]
	},
	{
		id: 'imu', name: 'imu_to_dxl board (build)', spec: 'Community reference design: STM32G031F8P6 + LSM6DSV16X + SN74LVC2G241 + HT7533-1, 45 × 22 mm, Dynamixel ID 200', qty: '1', priceUsd: [15, 40], critical: true,
		queries: { distributor: 'LSM6DSV16XTR' }, kinds: ['distributor', 'pcb'],
		fixed: [
			doc('Replica design files', 'https://github.com/pablo-mano/microduck-replica/tree/master/hardware/imu_to_dxl'),
			doc('avanx/microduck_imu_to_ttl (alternative)', 'https://github.com/avanx/microduck_imu_to_ttl')
		]
	},
	{
		id: 'bearings-big', meshes: ['seeed_bearing__configuration__22x16x4.stl'], name: 'Bearings 22 × 16 × 4 mm', spec: 'Ball bearing, 16 mm bore, 22 mm OD, 4 mm wide (hips, neck)', qty: '11 (buy 12)', priceUsd: [10, 25],
		queries: { marketplace: '16x22x4 bearing' }, kinds: ['marketplace', 'intl']
	},
	{
		id: 'bearings-small', meshes: ['seeed_bearing__configuration_default.stl'], name: 'Bearings 15 × 10 × 3 mm', spec: 'Ball bearing, 10 mm bore, 15 mm OD, 3 mm wide', qty: '3 (buy 5)', priceUsd: [4, 10],
		queries: { marketplace: '10x15x3 bearing' }, kinds: ['marketplace', 'intl']
	},
	{
		id: 'fasteners', name: 'M2 fasteners', spec: 'Socket cap M2×4 (60), M2×6 (80), M2×8 (40), M2×12 (15); M2 nuts (50); M2.5×6 (20)', qty: '~265', priceUsd: [15, 30],
		queries: { marketplace: 'M2 socket head cap screw assortment stainless' }, kinds: ['marketplace', 'intl']
	},
	{
		id: 'inserts', name: 'M2 heat-set inserts', spec: 'Brass, M2 × 3 mm, plus a soldering-iron insert tip', qty: '60 (buy 100)', priceUsd: [8, 20],
		queries: { marketplace: 'M2 heat set inserts brass' }, kinds: ['marketplace', 'intl']
	},
	{
		id: 'filament', name: 'Filament', spec: '1 kg PLA or PETG (shells + structure, ~0.4 kg used) and 0.5 kg TPU 95A (soles, mouth, jaw pad, tires)', qty: '1 + 1', priceUsd: [30, 60],
		queries: { marketplace: 'PETG filament 1.75mm 1kg', maker: 'TPU 95A filament 1.75mm' }, kinds: ['marketplace', 'maker']
	},
	{
		id: 'gamepad', name: 'Bluetooth gamepad', spec: 'Xbox-style layout; Switch Pro-class pads reported working with padd', qty: '1', priceUsd: [25, 60],
		queries: { marketplace: 'bluetooth gamepad xbox layout' }, kinds: ['marketplace']
	},
	{
		id: 'tools', name: 'Tools & consumables', spec: 'U2D2 or the HAT itself to set servo IDs, JST EH crimp kit or pre-made 3P Dynamixel cables, USB-C cable, microSD (for eMMC-less boards), thread locker', qty: '—', priceUsd: [30, 90],
		queries: { marketplace: 'JST EH 2.5mm connector kit', robotics: 'Dynamixel X3P cable', distributor: 'JST EH 3 position' }
	}
];

// ── Steps ───────────────────────────────────────────────────────────────
export const STEPS: Step[] = [
	{
		id: 'order', title: 'Order everything with a lead time', phase: 'order', humanHours: 2,
		summary: 'Servos, the Radxa board and the two PCBs gate the build by weeks. Order them first, then print while you wait.',
		checklist: [
			{ text: 'Order 15 × Dynamixel XL330-M288-T', items: ['servos'] },
			{ text: 'Order the Radxa Zero 3W (2 GB / 16 GB) and a Pi Camera v2 with a 15→22-pin ribbon', items: ['board', 'camera'] },
			{ text: 'Send elec_RPI_Robot_HAT production/ files to JLCPCB or PCBWay for assembly', items: ['hat'] },
			{ text: 'Send the imu_to_dxl reference design for assembly (or order avanx/microduck_imu_to_ttl parts)', items: ['imu'] },
			{ text: 'Order the ToF breakout, NP-F550 + charger and NP-F plate', items: ['tof', 'battery', 'npf-plate'] },
			{ text: 'Order speaker, bearings, M2 kit, heat-set inserts, filament, gamepad, tools', items: ['speaker', 'bearings-big', 'bearings-small', 'fasteners', 'inserts', 'filament', 'gamepad', 'tools'] }
		],
		shop: SHOP.map((s) => s.id),
		links: [{ label: 'Replica BOM.md', href: 'https://github.com/pablo-mano/microduck-replica/blob/master/BOM.md' }]
	},
	{
		id: 'printer', title: 'Prepare the printer', phase: 'print', humanHours: 2,
		summary: 'Level, tune a PETG/PLA and a TPU profile, then slice the replica STLs. Name each G-code after its STL (leg.gcode) so this page can match prints to parts.',
		checklist: [
			'Connect this page to the printer (panel on the right); on a Neptune 4 Pro the API is http://<printer-ip> (port 80)',
			'Bed level / Z-offset check, print a 20 mm cube in PETG and one in TPU',
			'Slice the STLs from print/printables at 0.16 mm shells / 0.2 mm structure, 4 perimeters on load-bearing legs',
			'Upload the G-code files to the printer (panel → Upload) and keep the STL names'
		],
		links: [{ label: 'print/README.md (printing notes)', href: 'https://github.com/pablo-mano/microduck-replica/blob/master/print/README.md' }]
	},
	{
		id: 'print-legs', title: 'Print batch A: legs and feet', phase: 'print', humanHours: 1.5,
		summary: 'Everything below the hips. Legs are load-bearing: more perimeters and infill. Soles in TPU.',
		checklist: ['Remove each part from the bed and check M2 holes', 'Install M2 heat-set inserts in leg, upper_leg_left/right, ankle_*', 'Press the 22 × 16 × 4 bearings into yaw2roll / bearing_roll'],
		prints: [job('leg.stl', 4), job('upper_leg_left.stl', 1), job('upper_leg_right.stl', 1), job('upper_leg_rigidity_plate.stl', 2), job('hip_l.stl', 2), job('yaw2roll.stl', 2), job('bearing_roll.stl', 2), job('ankle_left.stl', 1), job('ankle_right.stl', 1), job('foot_left.stl', 1), job('foot_right.stl', 1), job('sole_left.stl', 2, 'TPU'), job('sole_right.stl', 2, 'TPU')],
		shop: ['filament', 'inserts', 'bearings-big'],
		adds: LEG_MESHES
	},
	{
		id: 'print-trunk', title: 'Print batch B: trunk', phase: 'print', humanHours: 1,
		summary: 'Trunk base and shells, battery holder, PCB locker, motor support.',
		checklist: ['Remove parts, deburr the shell seams', 'Test-fit the Radxa board in banana_pcb_locker and the HAT on power_support', 'Test-fit an NP-F550 in power_support'],
		prints: [job('trunk_base.stl', 1), job('left_shell.stl', 1), job('right_shell.stl', 1), job('power_support.stl', 2), job('banana_pcb_locker.stl', 1), job('motor_support.stl', 1)],
		shop: ['filament'],
		adds: TRUNK_MESHES
	},
	{
		id: 'print-head', title: 'Print batch C: head and neck', phase: 'print', humanHours: 1,
		summary: 'Head shells, face, eye ring, jaw, neck links, lens holder. Mouth parts in TPU.',
		checklist: ['Remove parts; the head shells are cosmetic, sand if needed', 'Press the 15 × 10 × 3 bearings into the neck links', 'Fit lens + m12_lens_holder on the camera'],
		prints: [job('top_head_shell.stl', 1), job('bottom_head_shell.stl', 1), job('face_part.stl', 1), job('noenoeil.stl', 1), job('jaw.stl', 1), job('neck.stl', 2), job('neck_pitch.stl', 1), job('yaw_roll_motion.stl', 1), job('m12_lens_holder.stl', 1), job('jaw_soft.stl', 1, 'TPU'), job('soft_mouth_top.stl', 1, 'TPU')],
		shop: ['filament', 'bearings-small'],
		adds: HEAD_MESHES
	},
	{
		id: 'print-rollers', title: 'Print batch D (optional): roller skates', phase: 'print', humanHours: 0.5,
		summary: 'Replaces the standard ankles with 10 mm taller skate ankles. Tires must be TPU or they slip.',
		checklist: ['Remove parts, press rims into tires, check wheels spin freely on their axles'],
		prints: [job('roller_blade.stl', 2), job('rim.stl', 4), job('tire.stl', 8, 'TPU'), job('ankle_l_v1.stl', 1), job('ankle_r_v1.stl', 1)],
		shop: ['filament'],
		adds: ROLLER_MESHES, variant: 'rollers'
	},
	{
		id: 'electronics', title: 'Electronics bench work', phase: 'electronics', humanHours: 5,
		summary: 'Flash the board, bring up the HAT and IMU board, set servo IDs. Needs the delivered boards and servos.',
		checklist: [
			'Flash the Radxa Zero 3W with the image from the official docs (install-dev.md), boot, join Wi-Fi',
			'Mount the HAT, check 5 V and the servo-bus voltage with the NP-F550',
			'Set servo IDs: right leg 10–14, left leg 20–24, neck/head/mouth 30–34 (Dynamixel Wizard 2 via U2D2, or over the HAT bus)',
			'Set the imu_to_dxl board to ID 200 and read a quaternion from it',
			'Wire speaker and ToF (Qwiic) to the HAT, camera ribbon to the board'
		],
		shop: ['board', 'hat', 'imu', 'servos', 'battery', 'tof', 'camera', 'speaker', 'tools'],
		waitsFor: ['servos', 'board', 'hat', 'imu'],
		adds: ELECTRONICS_MESHES,
		links: [
			{ label: 'install-dev.md', href: 'https://github.com/pollen-robotics/microduck/blob/main/docs/robot/install-dev.md' },
			{ label: 'robotd-design.md (IDs, bus)', href: 'https://github.com/pollen-robotics/microduck/blob/main/docs/design/robotd-design.md' }
		]
	},
	{
		id: 'assemble-legs', title: 'Assemble both legs', phase: 'assembly', humanHours: 5,
		summary: 'Five servos per leg: hip yaw, hip roll, hip pitch, knee, ankle. Follow the kinematic tree; the /bom page shows where each part sits.',
		checklist: ['Left leg: yaw2roll → hip_l → upper_leg_left → leg → ankle_left → foot_left + sole', 'Right leg: bearing_roll → hip_l → upper_leg_right → leg → ankle_right → foot_right + sole', 'Route the 3P cables inside the upper legs before closing', 'Check every joint moves through its MJCF range by hand'],
		shop: ['servos', 'fasteners', 'inserts', 'bearings-big'],
		waitsFor: ['servos'],
		adds: BEARINGS_BIG, focus: [...LEG_MESHES, ...BEARINGS_BIG, 'xl330.stl'],
		bodies: ['yaw2roll', 'hip_l', 'upper_leg_left', 'leg', 'ankle_left', 'bearing_roll', 'hip_l_2', 'upper_leg_right', 'leg_2', 'ankle_right'],
		links: [{ label: 'Assembly drawings (replica)', href: 'https://github.com/pablo-mano/microduck-replica/tree/master/assembly-drawings' }]
	},
	{
		id: 'assemble-trunk', title: 'Assemble the trunk', phase: 'assembly', humanHours: 3,
		summary: 'Board, HAT, battery holder and both hip yaw servos into the trunk base, then the shells.',
		checklist: ['Mount Radxa + HAT stack in banana_pcb_locker', 'Fit power_support pair and the NP-F contact plate', 'Attach both legs to the trunk base (hip yaw servos)', 'Close left_shell / right_shell'],
		shop: ['fasteners', 'npf-plate'],
		focus: [...TRUNK_MESHES, 'pcb__raspberry_pi_zero_2_w.stl', 'elec_rpi_robot_hat_pcb.stl', 'np_f970.stl'],
		bodies: ['trunk_base']
	},
	{
		id: 'assemble-head', title: 'Assemble head and neck', phase: 'assembly', humanHours: 3,
		summary: 'Neck pitch, head pitch, head yaw, head roll, plus the 15th servo for the jaw. Camera, ToF and speaker go in the head.',
		checklist: ['Neck links with the small bearings, four head servos', 'Camera in m12_lens_holder behind face_part; ToF next to it', 'Jaw servo and linkage, jaw_soft and soft_mouth_top', 'Head shells last; leave the ribbon slack'],
		shop: ['fasteners', 'camera', 'tof'],
		adds: BEARINGS_SMALL, focus: [...HEAD_MESHES, ...BEARINGS_SMALL, 'lens.stl', 'speaker.stl'],
		bodies: ['neck', 'neck_pitch', 'yaw_roll_motion', 'jaw_soft']
	},
	{
		id: 'software', title: 'Software bring-up and first stand', phase: 'software', humanHours: 4,
		summary: 'Install the daemons, check health, load the policies, pair the gamepad, stand it up.',
		checklist: [
			'Install robotd / configd / padd / mediad / tofd (install-by-hand.md) and run robotctl health',
			'robotctl robot init, then robotctl monitor: every servo and the IMU report',
			'robotctl policy list / policy check; pair the gamepad (pair-a-gamepad.md)',
			'First stand on a soft surface, hand on the trunk; then walk with the gamepad'
		],
		shop: ['gamepad'],
		links: [
			{ label: 'install-by-hand.md', href: 'https://github.com/pollen-robotics/microduck/blob/main/docs/robot/install-by-hand.md' },
			{ label: 'cheatsheet.md', href: 'https://github.com/pollen-robotics/microduck/blob/main/docs/robot/cheatsheet.md' }
		]
	}
];

export const SHOP_BY_ID = new Map(SHOP.map((s) => [s.id, s]));

/** Print time estimate: volume / deposition rate + per-piece overhead. */
export function printHours(j: PrintJob, ratePlaCm3PerH: number, rateTpuCm3PerH: number, overheadH = 0.2): number {
	const rate = j.material === 'TPU' ? rateTpuCm3PerH : ratePlaCm3PerH;
	return j.qty * (j.volumeCm3 / rate + overheadH);
}
