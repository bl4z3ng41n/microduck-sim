// Microduck browser simulation core: MuJoCo (WebAssembly) steps the mjlab
// MJCF at 5 ms; the trained ONNX policies (onnxruntime-web) run at 50 Hz on
// a 61-value observation and output 14 joint targets, exactly like
// microduck_rl/scripts/infer_policy.py and robotd. TypeScript port of the
// official sandbox core (micro-zoo/microduck-simulator, app/src/game/game.js):
// legged Skills stack + roller variant, plus a pen prop for the ground pick.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type * as OrtNs from 'onnxruntime-web';
import type { MainModule } from '@mujoco/mujoco';
import { BamM6Actuator } from './bam.ts';
import { buildPhysicsXml } from './mjcf.ts';
import {
	buildRig, geometryToBinaryStl, loadGlbGeometries, setJawOpen, setJoint,
	type GeomEntry, type Kinematics, type Rig
} from './rig.ts';
import {
	CMD_SIZE, CTRL_DT, DECIMATION, DEFAULT_POSE, FALL_DEBOUNCE_STEPS, FALL_SETTLE_STEPS, GROUND_PICK_END_PHASE,
	GROUND_PICK_PERIOD_S, HEAD_ALPHA, JOINT_NAMES, KICK_STEPS, LEG_POLICY_IDS, NUM_JOINTS, OBS_SIZE, PEN_AHEAD,
	PEN_GRAB_DIST, PEN_GRAB_PHASE, PEN_HALF_LENGTH, PEN_RADIUS, PICK_JAW_KEYS, POLICY_FILES, POST_KICK_LOCK_STEPS,
	RECOVER_GIVEUP_STEPS, RECOVER_UPRIGHT_STEPS, ROLLER_ACTION_SCALE, RVEL_ANG, RVEL_BACK, RVEL_FWD,
	SKILL_ACTION_SCALE, STANDING_THRESHOLD, STAND_UP_MS, VEL_ANG, VEL_BACK, VEL_FWD, WALK_ACTION_SCALE,
	type PolicyId
} from './constants.ts';

type Ort = typeof OrtNs;

export type Mode = 'walk' | 'sitstand' | 'groundpick' | 'kickL' | 'kickR' | 'roll';
export type LocoName = 'legs' | 'rollers';
export type PenState = 'parked' | 'floor' | 'held';
export type RenderMode = 'webgl' | 'canvas2d';
export type Action = 'sit' | 'groundpick' | 'kickL' | 'kickR' | 'roll' | 'reset' | 'push' | 'chase' | 'loco' | 'pen';

export interface Telemetry {
	mode: Mode;
	policy: PolicyId;
	loco: LocoName;
	switching: boolean;
	pen: PenState;
	sitting: boolean;
	recovering: 'none' | 'settle' | 'standing';
	ctrlHz: number;
	simTime: number;
	speed: number;
	gz: number;
	cmd: [number, number, number];
	chase: boolean;
	steps: number;
	render: RenderMode;
}

export interface BootLine {
	label: string;
	state: 'run' | 'ok' | 'warn' | 'fail';
	detail?: string;
}

export interface DuckSimOptions {
	/** Directory holding mujoco.js + mujoco.wasm, robot/, policies/ (trailing slash). */
	simBase: string;
	/** Directory holding ort.wasm.min.mjs + ort-wasm-simd-threaded.{mjs,wasm} (trailing slash). */
	ortBase: string;
	onBoot?: (line: BootLine) => void;
	onTelemetry?: (t: Telemetry) => void;
	onNotice?: (message: string | null) => void;
	onError?: (message: string) => void;
}

// Loose structural types for the embind objects we touch; the generated
// .d.ts types most fields as `any`.
type MjModel = any;
type MjData = any;

interface Loco {
	name: LocoName;
	model: MjModel;
	data: MjData;
	rig: Rig | null;
	trunk: THREE.Group | null;
	qposAdr: number[];
	dofAdr: number[];
	ctrlAdr: number[];
	gyroAdr: number;
	trunkId: number;
	standKeyId: number;
	extraJoints: { name: string; adr: number }[];
	bam: BamM6Actuator | null;
	bodyParent: number[];
	bodyNames: string[];
	collGeoms: { id: number; body: number; rbound: number }[];
	pen: { qposAdr: number; dofAdr: number; bodyId: number; mouthSiteId: number; headBodyId: number } | null;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const JOINT_SET = new Set<string>(JOINT_NAMES);

export class DuckSim {
	private opts: DuckSimOptions;
	private canvas: HTMLCanvasElement;

	// three.js
	private renderer!: THREE.WebGLRenderer;
	private scene = new THREE.Scene();
	private camera!: THREE.PerspectiveCamera;
	private controls!: OrbitControls;
	private resizeObs?: ResizeObserver;
	private raf = 0;
	private chase = true;
	private penMesh: THREE.Mesh | null = null;

	// 2D fallback (no WebGL): stick-figure view drawn from MuJoCo body poses.
	private renderMode: RenderMode = 'webgl';
	private ctx2d: CanvasRenderingContext2D | null = null;
	private viewYaw = 0;

	// mujoco (shared)
	private mujoco!: MainModule;
	private vfs: any;
	private vfsFiles = new Set<string>();
	private geoms!: Map<string, GeomEntry>;

	// active locomotion variant (fields mirrored from `this.active`)
	private locos: Partial<Record<LocoName, Loco>> = {};
	private active!: Loco;
	private locoName: LocoName = 'legs';
	private switching = false;
	private rollersLoading: Promise<Loco> | null = null;
	private model!: MjModel;
	private data!: MjData;
	private rig: Rig | null = null;
	private trunk: THREE.Group | null = null;
	private qposAdr: number[] = [];
	private dofAdr: number[] = [];
	private gyroAdr = 0;
	private trunkId = 0;
	private standKeyId = 0;
	private extraJoints: { name: string; adr: number }[] = [];
	private bam: BamM6Actuator | null = null;

	// policies
	private ort!: Ort;
	private sessions = {} as Record<PolicyId, OrtNs.InferenceSession>;
	private ioNames = {} as Record<PolicyId, { input: string; output: string }>;

	// control state
	private obs = new Float32Array(OBS_SIZE);
	private cmd = new Float32Array(CMD_SIZE);
	private lastAction = new Float32Array(NUM_JOINTS);
	private headTarget = new Float32Array(4);
	private headSmooth = new Float32Array(4);
	private keys = { fwd: false, back: false, left: false, right: false };
	private touchCmd: [number, number] | null = null;
	private mode: Mode = 'walk';
	private sitFlag = 0;
	private sitTimer: ReturnType<typeof setTimeout> | null = null;
	private standTimer: ReturnType<typeof setTimeout> | null = null;
	private pickRun: { phase: number } | null = null;
	private kickRun: { steps: number } | null = null;
	private rollRun: { steps: number; tipped: boolean } | null = null;
	private postKickLock = 0;
	private fallDebounce = 0;
	private fallenSince: number | null = null;
	private recovery: { state: 'fallen' | 'recovering'; steps: number; uprightSteps: number } | null = null;
	private epoch = 0;

	// pen prop
	private penState: PenState = 'parked';
	private penRelPos = new THREE.Vector3();
	private penRelQuat = new THREE.Quaternion();

	// loop
	private running = false;
	private booted = false;
	private disposed = false;
	private simTime = 0;
	private steps = 0;
	private ctrlHz = 0;
	private lastTelemetry = 0;
	private activePolicyId: PolicyId = 'stand';

	private _q = new THREE.Quaternion();
	private _q2 = new THREE.Quaternion();
	private _g = new THREE.Vector3();
	private _v = new THREE.Vector3();
	private _target = new THREE.Vector3();
	private _delta = new THREE.Vector3();

	constructor(canvas: HTMLCanvasElement, opts: DuckSimOptions) {
		this.canvas = canvas;
		this.opts = opts;
	}

	// ── Boot ────────────────────────────────────────────────────────────
	private async step<T>(label: string, p: () => Promise<T> | T): Promise<T> {
		this.opts.onBoot?.({ label, state: 'run' });
		try {
			const v = await p();
			this.opts.onBoot?.({ label, state: 'ok' });
			return v;
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			this.opts.onBoot?.({ label, state: 'fail', detail: msg });
			this.opts.onError?.(`${label}: ${msg}`);
			throw err;
		}
	}

	async boot(): Promise<void> {
		const { simBase, ortBase } = this.opts;

		if (DuckSim.webglAvailable()) {
			try {
				this.setupThree();
			} catch (err) {
				console.warn('[duck-sim] WebGL renderer failed, using 2D fallback', err);
				this.setup2D();
			}
		} else {
			this.setup2D();
		}
		this.opts.onBoot?.(
			this.renderMode === 'canvas2d'
				? { label: 'WebGL renderer', state: 'warn', detail: 'UNAVAILABLE → 2D VIEW' }
				: { label: 'WebGL renderer', state: 'ok' }
		);

		this.mujoco = await this.step('MuJoCo 3.11 WebAssembly', async () => {
			const mod = await import(/* @vite-ignore */ `${simBase}mujoco.js`);
			const factory = mod.default as (o?: unknown) => Promise<MainModule>;
			return factory();
		});
		this.vfs = new this.mujoco.MjVFS();

		// ONNX Runtime Web is loaded from static/ort/ the same way, so Vite does
		// not bundle a second copy of its 13 MB wasm.
		this.ort = await this.step('ONNX Runtime Web 1.27', async () => {
			const mod = (await import(/* @vite-ignore */ `${ortBase}ort.wasm.min.mjs`)) as Ort;
			mod.env.wasm.wasmPaths = ortBase;
			mod.env.wasm.numThreads = 1; // static hosting: no COOP/COEP headers
			return mod;
		});

		this.geoms = await this.step('Robot meshes (microduck.glb)', () => loadGlbGeometries(`${simBase}robot/microduck.glb`));

		const legs = await this.step('Legged model: MJCF → MuJoCo, render rig', () => this.buildLoco('legs'));
		this.locos.legs = legs;

		await this.step(`ONNX policies (${LEG_POLICY_IDS.length} × onnxruntime-web)`, async () => {
			let n = 0;
			await Promise.all(
				LEG_POLICY_IDS.map(async (id) => {
					await this.loadPolicy(id);
					n++;
					this.opts.onBoot?.({ label: `ONNX policies (${LEG_POLICY_IDS.length} × onnxruntime-web)`, state: 'run', detail: `${n}/${LEG_POLICY_IDS.length}` });
				})
			);
		});

		this.activateLoco('legs');
		this.booted = true;
		this.startRender();
	}

	private async loadPolicy(id: PolicyId) {
		const s = await this.ort.InferenceSession.create(`${this.opts.simBase}policies/${POLICY_FILES[id]}`, {
			executionProviders: ['wasm']
		});
		this.sessions[id] = s;
		this.ioNames[id] = { input: s.inputNames[0], output: s.outputNames[0] };
	}

	private async addMeshes(files: string[]) {
		const { simBase } = this.opts;
		await Promise.all(
			files.map(async (f) => {
				if (this.vfsFiles.has(f)) return;
				this.vfsFiles.add(f);
				const entry = this.geoms.get(f);
				const buf = entry
					? geometryToBinaryStl(entry.welded)
					: await fetch(`${simBase}robot/meshes/${f}`).then((r) => {
							if (!r.ok) throw new Error(`mesh ${f} ${r.status}`);
							return r.arrayBuffer();
						});
				// meshdir="assets" in the MJCF, so the compiler looks up "assets/<f>".
				this.vfs.addBuffer(`assets/${f}`, new Uint8Array(buf));
			})
		);
	}

	private async buildLoco(name: LocoName): Promise<Loco> {
		const { simBase } = this.opts;
		const xmlFile = name === 'legs' ? 'robot_allcollisions.xml' : 'robot_allcollisions_rollers.xml';
		const kinFile = name === 'legs' ? 'kinematics.json' : 'kinematics_rollers.json';
		const [xmlSrc, kin] = await Promise.all([
			fetch(`${simBase}robot/${xmlFile}`).then((r) => {
				if (!r.ok) throw new Error(`${xmlFile} ${r.status}`);
				return r.text();
			}),
			fetch(`${simBase}robot/${kinFile}`).then((r) => {
				if (!r.ok) throw new Error(`${kinFile} ${r.status}`);
				return r.json() as Promise<Kinematics>;
			})
		]);
		// Leg policies: BAM torque motors + the pen prop. Roller policy: the
		// XML's own position actuator, as trained.
		const physics = buildPhysicsXml(xmlSrc, { bamMotors: name === 'legs', pen: name === 'legs' });
		await this.addMeshes(physics.meshFiles);
		const mj = this.mujoco;
		const model = mj.MjModel.from_xml_string(physics.xml, this.vfs);
		const data = new mj.MjData(model);

		let rig: Rig | null = null;
		let trunk: THREE.Group | null = null;
		if (this.renderMode === 'webgl') {
			rig = await buildRig(kin, this.geoms, (f) => `${simBase}robot/meshes/${f}`);
			trunk = rig.bodies.get('trunk_base') ?? null;
		}

		const obj = mj.mjtObj;
		const qposAdr = JOINT_NAMES.map((n) => Number(model.jnt(n).qposadr));
		const dofAdr = JOINT_NAMES.map((n) => Number(model.jnt(n).dofadr));
		const ctrlAdr = JOINT_NAMES.map((n) => Number(model.actuator(n).id));
		const standKeyId = mj.mj_name2id(model, obj.mjOBJ_KEY.value, 'STAND');
		if (standKeyId < 0) throw new Error('STAND keyframe missing');
		const collGeoms: Loco['collGeoms'] = [];
		for (let g = 0; g < (model.ngeom as number); g++) {
			if (Number(model.geom_contype[g]) === 0 || Number(model.geom_bodyid[g]) === 0) continue;
			collGeoms.push({ id: g, body: Number(model.geom_bodyid[g]), rbound: Number(model.geom_rbound[g]) });
		}
		let pen: Loco['pen'] = null;
		if (name === 'legs') {
			pen = {
				qposAdr: Number(model.jnt('pen_freejoint').qposadr),
				dofAdr: Number(model.jnt('pen_freejoint').dofadr),
				bodyId: mj.mj_name2id(model, obj.mjOBJ_BODY.value, 'pen'),
				mouthSiteId: mj.mj_name2id(model, obj.mjOBJ_SITE.value, 'mouth_tip'),
				headBodyId: mj.mj_name2id(model, obj.mjOBJ_BODY.value, 'jaw_soft')
			};
		}
		return {
			name, model, data, rig, trunk, qposAdr, dofAdr, ctrlAdr, standKeyId,
			gyroAdr: Number(model.sensor('imu_ang_vel').adr),
			trunkId: mj.mj_name2id(model, obj.mjOBJ_BODY.value, 'trunk_base'),
			extraJoints: kin.bodies
				.filter((b) => b.joint && b.joint.type === 'hinge' && !JOINT_SET.has(b.joint.name))
				.map((b) => ({ name: b.joint!.name, adr: Number(model.jnt(b.joint!.name).qposadr) })),
			bam: name === 'legs' ? new BamM6Actuator(qposAdr, dofAdr, ctrlAdr) : null,
			bodyParent: Array.from(model.body_parentid as ArrayLike<number>, Number),
			bodyNames: Array.from({ length: model.nbody as number }, (_, i) => String(model.body(i).name)),
			collGeoms,
			pen
		};
	}

	private activateLoco(name: LocoName) {
		const L = this.locos[name];
		if (!L) return;
		if (this.rig) this.scene.remove(this.rig.placer);
		this.active = L;
		this.locoName = name;
		this.model = L.model;
		this.data = L.data;
		this.rig = L.rig;
		this.trunk = L.trunk;
		this.qposAdr = L.qposAdr;
		this.dofAdr = L.dofAdr;
		this.gyroAdr = L.gyroAdr;
		this.trunkId = L.trunkId;
		this.standKeyId = L.standKeyId;
		this.extraJoints = L.extraJoints;
		this.bam = L.bam;
		if (this.rig) this.scene.add(this.rig.placer);
		if (this.penMesh) this.penMesh.visible = false;
		this.resetSim();
	}

	private ensureRollers(): Promise<Loco> {
		this.rollersLoading ??= (async () => {
			const [loco] = await Promise.all([this.buildLoco('rollers'), this.loadPolicy('drive')]);
			this.locos.rollers = loco;
			return loco;
		})().catch((err) => {
			this.rollersLoading = null;
			throw err;
		});
		return this.rollersLoading;
	}

	async setLoco(name: LocoName) {
		if (!this.booted || this.switching || this.locoName === name) return;
		if (this.rollRun || this.kickRun || this.pickRun || this.standTimer || this.recovery) return;
		this.switching = true;
		try {
			if (name === 'rollers' && !this.locos.rollers) {
				this.opts.onNotice?.('Loading roller variant (model, wheels, drive policy)…');
				await this.ensureRollers();
				this.opts.onNotice?.(null);
			}
			this.activateLoco(name);
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			this.opts.onNotice?.(`Roller variant failed to load: ${msg}`);
		} finally {
			this.switching = false;
		}
	}

	// ── Renderers ───────────────────────────────────────────────────────
	static webglAvailable(): boolean {
		try {
			const c = document.createElement('canvas');
			return !!(c.getContext('webgl2') || c.getContext('webgl') || c.getContext('experimental-webgl'));
		} catch {
			return false;
		}
	}

	get render(): RenderMode { return this.renderMode; }

	private setup2D() {
		this.renderMode = 'canvas2d';
		const c = this.canvas;
		const ctx = c.getContext('2d');
		if (!ctx) throw new Error('Neither WebGL nor a 2D canvas context is available in this browser.');
		this.ctx2d = ctx;
		const resize = () => {
			const dpr = Math.min(window.devicePixelRatio || 1, 2);
			c.width = Math.round((c.clientWidth || 800) * dpr);
			c.height = Math.round((c.clientHeight || 500) * dpr);
		};
		resize();
		this.resizeObs = new ResizeObserver(resize);
		this.resizeObs.observe(c);
	}

	private setupThree() {
		const c = this.canvas;
		this.renderer = new THREE.WebGLRenderer({ canvas: c, antialias: true, alpha: false, powerPreference: 'high-performance' });
		this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
		this.renderer.shadowMap.enabled = true;
		this.renderer.shadowMap.type = THREE.PCFShadowMap;
		this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
		this.renderer.toneMappingExposure = 1.05;
		this.scene.background = new THREE.Color(0x0b0d12);
		this.scene.fog = new THREE.Fog(0x0b0d12, 4, 12);

		this.camera = new THREE.PerspectiveCamera(38, 16 / 10, 0.02, 60);
		this.camera.position.set(0.55, 0.42, 0.7);
		this.controls = new OrbitControls(this.camera, c);
		this.controls.target.set(0, 0.12, 0);
		this.controls.enableDamping = true;
		this.controls.dampingFactor = 0.08;
		this.controls.minDistance = 0.25;
		this.controls.maxDistance = 4;
		this.controls.maxPolarAngle = Math.PI / 2 - 0.02;
		// Detach the chase camera only on a real drag (a plain click keeps it).
		let downAt: [number, number] | null = null;
		c.addEventListener('pointerdown', (e) => (downAt = [e.clientX, e.clientY]));
		c.addEventListener('pointermove', (e) => {
			if (downAt && Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 6) {
				this.chase = false;
				downAt = null;
			}
		});
		c.addEventListener('pointerup', () => (downAt = null));
		c.addEventListener('wheel', () => (this.chase = false), { passive: true });

		this.scene.add(new THREE.HemisphereLight(0xdfe7ff, 0x2a2118, 1.1));
		const key = new THREE.DirectionalLight(0xfff1d6, 3.2);
		key.position.set(1.2, 2.2, 1.0);
		key.castShadow = true;
		key.shadow.mapSize.set(2048, 2048);
		key.shadow.camera.near = 0.5;
		key.shadow.camera.far = 6;
		const s = 1.6;
		key.shadow.camera.left = -s; key.shadow.camera.right = s; key.shadow.camera.top = s; key.shadow.camera.bottom = -s;
		key.shadow.bias = -0.0005;
		this.scene.add(key);
		const rim = new THREE.DirectionalLight(0x8fb4ff, 1.0);
		rim.position.set(-1.5, 1.0, -1.2);
		this.scene.add(rim);

		const floor = new THREE.Mesh(
			new THREE.PlaneGeometry(40, 40),
			new THREE.MeshStandardMaterial({ color: 0x151923, roughness: 0.95, metalness: 0 })
		);
		floor.rotation.x = -Math.PI / 2;
		floor.receiveShadow = true;
		this.scene.add(floor);
		const grid = new THREE.GridHelper(40, 200, 0x2c3344, 0x1d222d);
		grid.position.y = 0.0005;
		this.scene.add(grid);
		const grid2 = new THREE.GridHelper(40, 40, 0x3a4256, 0x3a4256);
		grid2.position.y = 0.001;
		this.scene.add(grid2);

		// Pen prop: capsule along local x, like the MuJoCo geom.
		const penGeo = new THREE.CapsuleGeometry(PEN_RADIUS, PEN_HALF_LENGTH * 2, 6, 14);
		penGeo.rotateZ(Math.PI / 2);
		this.penMesh = new THREE.Mesh(penGeo, new THREE.MeshStandardMaterial({ color: 0x6fb3ff, roughness: 0.35, metalness: 0.1 }));
		this.penMesh.castShadow = true;
		this.penMesh.visible = false;
		this.scene.add(this.penMesh);

		const resize = () => {
			const w = c.clientWidth || 800;
			const h = c.clientHeight || 500;
			this.renderer.setSize(w, h, false);
			this.camera.aspect = w / h;
			this.camera.updateProjectionMatrix();
		};
		resize();
		this.resizeObs = new ResizeObserver(resize);
		this.resizeObs.observe(c);
	}

	// ── Public control surface ──────────────────────────────────────────
	get isRunning() { return this.running; }
	get isBooted() { return this.booted; }
	get loco() { return this.locoName; }

	start() {
		if (!this.booted || this.running || this.disposed) return;
		this.running = true;
		void this.loop();
	}

	pause() { this.running = false; }

	dispose() {
		this.disposed = true;
		this.running = false;
		cancelAnimationFrame(this.raf);
		this.resizeObs?.disconnect();
		this.clearTimers();
		this.controls?.dispose();
		this.renderer?.dispose();
		for (const s of Object.values(this.sessions)) void s.release?.();
	}

	/** Physical key codes (e.code). Returns true when handled. */
	onKey(code: string, down: boolean): boolean {
		switch (code) {
			case 'ArrowUp': case 'KeyW': this.keys.fwd = down; return true;
			case 'ArrowDown': case 'KeyS': this.keys.back = down; return true;
			case 'ArrowLeft': case 'KeyA': this.keys.left = down; return true;
			case 'ArrowRight': case 'KeyD': this.keys.right = down; return true;
		}
		if (!down) return false;
		switch (code) {
			case 'Space': this.trigger('reset'); return true;
			case 'KeyR': this.trigger('sit'); return true;
			case 'KeyG': this.trigger('groundpick'); return true;
			case 'KeyQ': this.trigger('kickL'); return true;
			case 'KeyE': this.trigger('kickR'); return true;
			case 'KeyX': this.trigger('roll'); return true;
			case 'KeyP': this.trigger('push'); return true;
			case 'KeyC': this.trigger('chase'); return true;
			case 'KeyM': this.trigger('loco'); return true;
			case 'KeyB': this.trigger('pen'); return true;
		}
		return false;
	}

	/** Continuous command from on-screen controls: vx in [-1, 1], wz in [-1, 1]; null releases. */
	setTouch(vx: number | null, wz = 0) {
		this.touchCmd = vx === null ? null : [vx, wz];
	}

	trigger(action: Action) {
		if (!this.booted) return;
		switch (action) {
			case 'reset': this.resetSim(); break;
			case 'chase': this.chase = !this.chase; break;
			case 'push': this.push(); break;
			case 'loco': void this.setLoco(this.locoName === 'legs' ? 'rollers' : 'legs'); break;
			case 'pen': this.togglePen(); break;
			case 'sit': {
				if (this.locoName !== 'legs') return;
				const sitting = this.mode === 'sitstand' && this.sitFlag === 1;
				this.setMode(sitting ? 'walk' : 'sit');
				break;
			}
			case 'roll': this.startOneShot('roll'); break;
			case 'groundpick': this.startOneShot('groundpick'); break;
			case 'kickL': this.startOneShot('kickL'); break;
			case 'kickR': this.startOneShot('kickR'); break;
		}
	}

	/** Debug probe: mouth_tip position relative to the trunk (along heading, lateral, height). */
	mouthRelative(): [number, number, number] | null {
		const pen = this.active?.pen;
		if (!pen) return null;
		const q = this.data.qpos as Float64Array;
		const s = this.data.site_xpos as Float64Array;
		const yaw = this.trunkYaw();
		const dx = s[pen.mouthSiteId * 3] - q[0], dy = s[pen.mouthSiteId * 3 + 1] - q[1];
		return [dx * Math.cos(yaw) + dy * Math.sin(yaw), -dx * Math.sin(yaw) + dy * Math.cos(yaw), s[pen.mouthSiteId * 3 + 2]];
	}

	/** Debug probe for the pen grab: distance mouth_tip ↔ pen, pick phase, states. */
	penDebug() {
		const pen = this.active?.pen;
		if (!pen) return null;
		const s = this.data.site_xpos as Float64Array;
		const xp = this.data.xpos as Float64Array;
		const m = pen.mouthSiteId * 3, b = pen.bodyId * 3;
		return {
			dist: Math.hypot(s[m] - xp[b], s[m + 1] - xp[b + 1], s[m + 2] - xp[b + 2]),
			mouth: [s[m], s[m + 1], s[m + 2]],
			pen: [xp[b], xp[b + 1], xp[b + 2]],
			phase: this.pickRun?.phase ?? null,
			mode: this.mode,
			penState: this.penState,
			ids: { site: pen.mouthSiteId, body: pen.bodyId, head: pen.headBodyId }
		};
	}

	// ── Mode machine (mirrors the sandbox's setMode / trigger* helpers) ──
	private clearTimers() {
		if (this.sitTimer) clearTimeout(this.sitTimer);
		if (this.standTimer) clearTimeout(this.standTimer);
		this.sitTimer = null;
		this.standTimer = null;
	}

	private canStartOneShot() {
		return this.locoName === 'legs' && !this.switching && this.mode === 'walk' && !this.standTimer && !this.recovery && this.postKickLock === 0;
	}

	private startOneShot(next: 'roll' | 'groundpick' | 'kickL' | 'kickR') {
		if (!this.canStartOneShot()) return;
		this.clearTimers();
		this.sitFlag = 0;
		this.mode = next;
		if (next === 'roll') this.rollRun = { steps: 0, tipped: false };
		else if (next === 'groundpick') this.pickRun = { phase: 0 };
		else this.kickRun = { steps: 0 };
		// lastAction deliberately kept: the runtime keeps one continuous action history.
	}

	private setMode(next: 'walk' | 'sit') {
		if (this.recovery) return;
		if ((this.mode === 'roll' && this.rollRun) || (this.kickRun && (this.mode === 'kickL' || this.mode === 'kickR')) ||
			(this.mode === 'groundpick' && this.pickRun)) return;
		this.clearTimers();
		this.rollRun = null;
		this.pickRun = null;
		if (next === 'walk') {
			if (this.mode === 'sitstand' && this.sitFlag === 1) {
				// Leaving a sit: let the sitstand policy stand the duck up first.
				this.sitFlag = 0;
				this.standTimer = setTimeout(() => {
					this.standTimer = null;
					this.mode = 'walk';
					this.lastAction.fill(0);
				}, STAND_UP_MS);
				return;
			}
			this.mode = 'walk';
			this.lastAction.fill(0);
		} else {
			// Hold the stand under the sitstand policy briefly before sitting.
			this.mode = 'sitstand';
			this.sitFlag = 0;
			this.lastAction.fill(0);
			this.sitTimer = setTimeout(() => {
				this.sitTimer = null;
				if (this.mode === 'sitstand') this.sitFlag = 1;
			}, 800);
		}
	}

	resetSim() {
		this.epoch++;
		this.clearTimers();
		this.rollRun = null;
		this.pickRun = null;
		this.kickRun = null;
		this.postKickLock = 0;
		this.fallenSince = null;
		this.fallDebounce = 0;
		this.recovery = null;
		this.mode = 'walk';
		this.sitFlag = 0;
		this.headTarget.fill(0);
		this.headSmooth.fill(0);
		this.mujoco.mj_resetDataKeyframe(this.model, this.data, this.standKeyId);
		const q = this.data.qpos;
		q[0] = 0; q[1] = 0; q[3] = 1; q[4] = 0; q[5] = 0; q[6] = 0;
		this.penState = 'parked';
		this.mujoco.mj_forward(this.model, this.data);
		this.bam?.reset(this.data);
		this.lastAction.fill(0);
		this.simTime = 0;
		this.steps = 0;
		this.chase = true;
	}

	private push() {
		const qvel = this.data.qvel;
		const a = Math.random() * Math.PI * 2;
		const mag = 0.6 + Math.random() * 0.5;
		qvel[0] += Math.cos(a) * mag;
		qvel[1] += Math.sin(a) * mag;
		qvel[5] += (Math.random() - 0.5) * 6;
	}

	// ── Pen prop ────────────────────────────────────────────────────────
	private togglePen() {
		const pen = this.active?.pen;
		if (!pen) return; // rollers: no pen
		if (this.penState === 'held') {
			this.penState = 'floor';
			const qvel = this.data.qvel;
			for (let i = 0; i < 6; i++) qvel[pen.dofAdr + i] = 0;
			return;
		}
		// Spawn (or re-spawn) on the floor ahead of the beak, lying across the heading.
		const q = this.data.qpos, qvel = this.data.qvel;
		const yaw = this.trunkYaw();
		const a = pen.qposAdr;
		q[a] = q[0] + Math.cos(yaw) * PEN_AHEAD;
		q[a + 1] = q[1] + Math.sin(yaw) * PEN_AHEAD;
		q[a + 2] = PEN_RADIUS + 0.002;
		const th = yaw + Math.PI / 2;
		q[a + 3] = Math.cos(th / 2); q[a + 4] = 0; q[a + 5] = 0; q[a + 6] = Math.sin(th / 2);
		for (let i = 0; i < 6; i++) qvel[pen.dofAdr + i] = 0;
		this.mujoco.mj_forward(this.model, this.data);
		this.penState = 'floor';
	}

	private trunkYaw(): number {
		const q = this.data.qpos;
		return Math.atan2(2 * (q[3] * q[6] + q[4] * q[5]), 1 - 2 * (q[5] * q[5] + q[6] * q[6]));
	}

	/** During the scoop, latch the pen to the head when the mouth tip reaches it. */
	private tryGrabPen() {
		const pen = this.active.pen;
		if (!pen || this.penState !== 'floor' || this.mode !== 'groundpick' || !this.pickRun) return;
		const ph = this.pickRun.phase;
		if (ph < PEN_GRAB_PHASE[0] || ph > PEN_GRAB_PHASE[1]) return;
		const s = this.data.site_xpos as Float64Array;
		const xp = this.data.xpos as Float64Array;
		const m = pen.mouthSiteId * 3, b = pen.bodyId * 3;
		const dist = Math.hypot(s[m] - xp[b], s[m + 1] - xp[b + 1], s[m + 2] - xp[b + 2]);
		if (dist > PEN_GRAB_DIST) return;
		// Pen pose in the head body frame, frozen for the hold.
		const xq = this.data.xquat as Float64Array;
		const h = pen.headBodyId;
		const headQ = this._q.set(xq[h * 4 + 1], xq[h * 4 + 2], xq[h * 4 + 3], xq[h * 4]);
		const penQ = this._q2.set(xq[pen.bodyId * 4 + 1], xq[pen.bodyId * 4 + 2], xq[pen.bodyId * 4 + 3], xq[pen.bodyId * 4]);
		this.penRelPos.set(xp[b] - xp[h * 3], xp[b + 1] - xp[h * 3 + 1], xp[b + 2] - xp[h * 3 + 2]).applyQuaternion(headQ.clone().invert());
		this.penRelQuat.copy(headQ).invert().multiply(penQ);
		this.penState = 'held';
	}

	/** Kinematic follow: the held pen rides on the head body. */
	private followPen() {
		const pen = this.active.pen;
		if (!pen || this.penState !== 'held') return;
		const xp = this.data.xpos as Float64Array, xq = this.data.xquat as Float64Array;
		const h = pen.headBodyId;
		const headQ = this._q.set(xq[h * 4 + 1], xq[h * 4 + 2], xq[h * 4 + 3], xq[h * 4]);
		const pos = this._v.copy(this.penRelPos).applyQuaternion(headQ);
		const rot = this._q2.copy(headQ).multiply(this.penRelQuat).normalize();
		const q = this.data.qpos, qvel = this.data.qvel, a = pen.qposAdr;
		q[a] = xp[h * 3] + pos.x; q[a + 1] = xp[h * 3 + 1] + pos.y; q[a + 2] = xp[h * 3 + 2] + pos.z;
		q[a + 3] = rot.w; q[a + 4] = rot.x; q[a + 5] = rot.y; q[a + 6] = rot.z;
		for (let i = 0; i < 6; i++) qvel[pen.dofAdr + i] = 0;
	}

	// ── Observation ─────────────────────────────────────────────────────
	private effectiveCmd(): [number, number, number] {
		const [fwd, back, ang] = this.locoName === 'rollers' ? [RVEL_FWD, RVEL_BACK, RVEL_ANG] : [VEL_FWD, VEL_BACK, VEL_ANG];
		if (this.touchCmd) {
			const [vx, wz] = this.touchCmd;
			return [vx >= 0 ? vx * fwd : -vx * back, 0, wz * ang];
		}
		const k = this.keys;
		const vx = k.fwd && !k.back ? fwd : k.back && !k.fwd ? back : 0;
		const wz = k.left && !k.right ? ang : k.right && !k.left ? -ang : 0;
		return [vx, 0, wz];
	}

	private projGravZ(): number {
		const xq = this.data.body(this.trunkId).xquat; // [w, x, y, z]
		this._q.set(xq[1], xq[2], xq[3], xq[0]).conjugate();
		this._g.set(0, 0, -1).applyQuaternion(this._q);
		return this._g.z;
	}

	private buildObs(): Float32Array {
		const { qpos, qvel, sensordata } = this.data;
		const obs = this.obs, cmd = this.cmd;
		let i = 0;
		for (let a = 0; a < 3; a++) obs[i++] = sensordata[this.gyroAdr + a];
		const xq = this.data.body(this.trunkId).xquat;
		this._q.set(xq[1], xq[2], xq[3], xq[0]).conjugate();
		this._g.set(0, 0, -1).applyQuaternion(this._q);
		obs[i++] = this._g.x; obs[i++] = this._g.y; obs[i++] = this._g.z;
		for (let j = 0; j < NUM_JOINTS; j++) obs[i++] = qpos[this.qposAdr[j]] - DEFAULT_POSE[j];
		for (let j = 0; j < NUM_JOINTS; j++) obs[i++] = qvel[this.dofAdr[j]];
		for (let j = 0; j < NUM_JOINTS; j++) obs[i++] = this.lastAction[j];

		cmd.fill(0);
		if (this.mode === 'sitstand') {
			cmd[0] = this.sitFlag;
		} else if (this.mode === 'groundpick' && this.pickRun) {
			const a = 2 * Math.PI * this.pickRun.phase;
			cmd[0] = Math.cos(a);
			cmd[1] = Math.sin(a);
		} else if (this.mode === 'walk') {
			const c = this.effectiveCmd();
			cmd[0] = c[0]; cmd[1] = c[1]; cmd[2] = c[2];
		}
		for (let h = 0; h < 4; h++) this.headSmooth[h] += HEAD_ALPHA * (this.headTarget[h] - this.headSmooth[h]);
		const zero = this.mode === 'groundpick' || this.recovery !== null;
		for (let h = 0; h < 4; h++) cmd[3 + h] = zero ? 0 : this.headSmooth[h];
		for (let c = 0; c < CMD_SIZE; c++) obs[i++] = cmd[c];
		return obs;
	}

	private activePolicy(): { id: PolicyId; scale: number } {
		if (this.locoName === 'rollers') return { id: 'drive', scale: ROLLER_ACTION_SCALE };
		if (this.recovery?.state === 'recovering') return { id: 'stand', scale: SKILL_ACTION_SCALE };
		if (this.mode === 'walk') {
			const c = this.cmd;
			if (Math.hypot(c[0], c[1], c[2]) <= STANDING_THRESHOLD) return { id: 'stand', scale: SKILL_ACTION_SCALE };
			return { id: 'walk', scale: WALK_ACTION_SCALE };
		}
		return { id: this.mode, scale: SKILL_ACTION_SCALE };
	}

	// ── 50 Hz control step ──────────────────────────────────────────────
	private async controlStep() {
		const epoch = this.epoch;
		const model = this.model, data = this.data;
		if (this.recovery?.state !== 'fallen') {
			const obs = this.buildObs();
			const policy = this.activePolicy();
			this.activePolicyId = policy.id;
			const session = this.sessions[policy.id];
			const names = this.ioNames[policy.id];
			const out = await session.run({ [names.input]: new this.ort.Tensor('float32', obs, [1, OBS_SIZE]) });
			if (epoch !== this.epoch || this.disposed || model !== this.model) return; // reset / switch mid-inference
			const act = out[names.output].data as Float32Array;
			this.lastAction.set(act);
			const ctrl = data.ctrl;
			for (let j = 0; j < NUM_JOINTS; j++) ctrl[j] = DEFAULT_POSE[j] + act[j] * policy.scale;
			this.bam?.setTarget(ctrl);
		}
		for (let s = 0; s < DECIMATION; s++) {
			this.followPen();
			this.bam?.apply(model, data);
			this.mujoco.mj_step(model, data);
		}
		this.followPen();
		this.tryGrabPen();
		this.simTime += CTRL_DT;
		this.steps++;
		this.afterStep();
	}

	private poseIsDead(): 'exploded' | 'fallen' | null {
		const z = this.data.qpos[2];
		const gz = this.projGravZ();
		if (!Number.isFinite(z) || !Number.isFinite(gz)) return 'exploded';
		if (gz > -0.5 || z < 0.02) return 'fallen';
		return null;
	}

	private afterStep() {
		const death = this.poseIsDead();
		if (death === 'exploded') {
			this.resetSim();
			return;
		}
		if (this.recovery) {
			this.recovery.steps++;
			if (this.recovery.state === 'fallen') {
				if (this.recovery.steps >= FALL_SETTLE_STEPS) {
					this.recovery = { state: 'recovering', steps: 0, uprightSteps: 0 };
					this.lastAction.fill(0);
				}
			} else {
				this.recovery.uprightSteps = this.projGravZ() < -0.85 ? this.recovery.uprightSteps + 1 : 0;
				if (this.recovery.uprightSteps >= RECOVER_UPRIGHT_STEPS) {
					this.recovery = null;
					this.mode = 'walk';
					this.lastAction.fill(0);
				} else if (this.recovery.steps >= RECOVER_GIVEUP_STEPS) {
					this.resetSim();
					return;
				}
			}
		} else if (death === 'fallen') {
			// Legs in walk mode: recovery state machine. Rollers, sit and
			// one-shots: grace period, then reset (as in the sandbox).
			const recoverable = this.locoName === 'legs' && this.mode === 'walk' && this.postKickLock === 0 && !this.standTimer;
			if (recoverable) {
				this.fallenSince = null;
				if (++this.fallDebounce >= FALL_DEBOUNCE_STEPS) {
					this.fallDebounce = 0;
					this.recovery = { state: 'fallen', steps: 0, uprightSteps: 0 };
				}
			} else {
				this.fallDebounce = 0;
				const now = performance.now();
				const graceMs = this.mode === 'roll' ? 5000 : 1000;
				this.fallenSince ??= now;
				if (now - this.fallenSince > graceMs) {
					this.resetSim();
					return;
				}
			}
		} else {
			this.fallDebounce = 0;
			this.fallenSince = null;
		}

		if (this.postKickLock > 0 && this.mode === 'walk') this.postKickLock--;

		if ((this.mode === 'kickL' || this.mode === 'kickR') && this.kickRun) {
			if (++this.kickRun.steps >= KICK_STEPS) {
				this.kickRun = null;
				this.mode = 'walk';
				this.postKickLock = POST_KICK_LOCK_STEPS;
			}
		}
		if (this.mode === 'groundpick' && this.pickRun) {
			this.pickRun.phase += CTRL_DT / GROUND_PICK_PERIOD_S;
			if (this.pickRun.phase >= GROUND_PICK_END_PHASE) {
				this.pickRun = null;
				this.mode = 'walk';
			}
		}
		if (this.mode === 'roll' && this.rollRun) {
			this.rollRun.steps++;
			const gz = this.obs[5];
			if (gz > -0.3) this.rollRun.tipped = true;
			const upright = gz < -0.85;
			const done = this.rollRun.tipped && upright && this.rollRun.steps >= 40;
			const expired = this.rollRun.steps >= 150;
			if (done || expired) {
				this.rollRun = null;
				this.mode = 'walk';
				this.lastAction.fill(0);
				if (!upright) this.resetSim();
			}
		}
	}

	private async loop() {
		let next = performance.now();
		let windowStart = next;
		let windowSteps = 0;
		while (this.running && !this.disposed) {
			if (this.switching) {
				await sleep(20);
				next = performance.now();
				continue;
			}
			try {
				await this.controlStep();
			} catch (err) {
				this.running = false;
				this.opts.onError?.(err instanceof Error ? err.message : String(err));
				return;
			}
			const now = performance.now();
			windowSteps++;
			if (now - windowStart >= 500) {
				this.ctrlHz = (windowSteps * 1000) / (now - windowStart);
				windowStart = now;
				windowSteps = 0;
			}
			// Pace to 20 ms of wall time per control step; if the tab fell far
			// behind (throttled), drop the backlog instead of bursting.
			next += CTRL_DT * 1000;
			const wait = next - performance.now();
			if (wait > 0) await sleep(wait);
			else if (wait < -200) next = performance.now();
			if (now - this.lastTelemetry > 100) {
				this.lastTelemetry = now;
				this.emitTelemetry();
			}
		}
	}

	private emitTelemetry() {
		if (!this.opts.onTelemetry) return;
		const qvel = this.data.qvel;
		this.opts.onTelemetry({
			mode: this.mode,
			policy: this.activePolicyId,
			loco: this.locoName,
			switching: this.switching,
			pen: this.penState,
			sitting: this.mode === 'sitstand' && this.sitFlag === 1,
			recovering: this.recovery ? (this.recovery.state === 'fallen' ? 'settle' : 'standing') : 'none',
			ctrlHz: this.ctrlHz,
			simTime: this.simTime,
			speed: Math.hypot(qvel[0], qvel[1]),
			gz: this.projGravZ(),
			cmd: [this.cmd[0], this.cmd[1], this.cmd[2]],
			chase: this.chase,
			steps: this.steps,
			render: this.renderMode
		});
	}

	// ── Jaw animation during the pick (visual; from the sandbox) ─────────
	private pickJawNow(): number {
		if (this.mode !== 'groundpick' || !this.pickRun) return 0;
		const phase = this.pickRun.phase;
		const K = PICK_JAW_KEYS;
		if (phase <= K[0][0] || phase >= K[K.length - 1][0]) return 0;
		for (let i = 1; i < K.length; i++) {
			if (phase > K[i][0]) continue;
			const [p0, v0] = K[i - 1];
			const [p1, v1] = K[i];
			const t = (phase - p0) / (p1 - p0);
			return v0 + ((v1 - v0) * (1 - Math.cos(Math.PI * t))) / 2;
		}
		return 0;
	}

	// ── Render loop ─────────────────────────────────────────────────────
	private startRender() {
		const tick = () => {
			if (this.disposed) return;
			this.raf = requestAnimationFrame(tick);
			if (this.renderMode === 'canvas2d') {
				this.draw2D();
				return;
			}
			this.syncRig();
			this.controls.update();
			this.renderer.render(this.scene, this.camera);
		};
		tick();
	}

	private syncRig() {
		const q = this.data.qpos;
		const rig = this.rig, trunk = this.trunk;
		if (!rig || !trunk) return;
		// The rig root already applies Z-up → Y-up, so the trunk takes raw MJCF pose.
		trunk.position.set(q[0], q[1], q[2]);
		trunk.quaternion.set(q[4], q[5], q[6], q[3]);
		for (let j = 0; j < NUM_JOINTS; j++) setJoint(rig, JOINT_NAMES[j], q[this.qposAdr[j]]);
		for (const ej of this.extraJoints) setJoint(rig, ej.name, q[ej.adr]); // passive wheels
		setJawOpen(rig, this.pickJawNow());
		// Pen: MJCF Z-up → three Y-up is (x, y, z) → (x, z, -y); quaternion likewise.
		const pen = this.active.pen;
		if (this.penMesh) {
			this.penMesh.visible = !!pen && this.penState !== 'parked';
			if (pen && this.penMesh.visible) {
				const a = pen.qposAdr;
				this.penMesh.position.set(q[a], q[a + 2], -q[a + 1]);
				this.penMesh.quaternion.set(q[a + 4], q[a + 6], -q[a + 5], q[a + 3]);
			}
		}
		if (this.chase) {
			this._target.set(q[0], Math.max(0.06, q[2]), -q[1]);
			this._delta.copy(this._target).sub(this.controls.target).multiplyScalar(0.18);
			this.controls.target.add(this._delta);
			this.camera.position.add(this._delta);
		}
	}

	// ── 2D fallback: side view following the trunk heading ─────────────
	private draw2D() {
		const ctx = this.ctx2d!;
		const c = this.canvas;
		const W = c.width, H = c.height;
		const dpr = Math.min(window.devicePixelRatio || 1, 2);
		const q = this.data.qpos as Float64Array;
		const xpos = this.data.xpos as Float64Array;
		const gxpos = this.data.geom_xpos as Float64Array;
		const L = this.active;

		const yaw = this.trunkYaw();
		let d = yaw - this.viewYaw;
		d = Math.atan2(Math.sin(d), Math.cos(d));
		this.viewYaw += d * 0.08;
		const hx = Math.cos(this.viewYaw), hy = Math.sin(this.viewYaw);
		const ppm = (H * 0.6) / 0.3;
		const cx = W * 0.5, groundY = H * 0.8;
		const along0 = q[0] * hx + q[1] * hy;
		const depth0 = -q[0] * hy + q[1] * hx;
		const px = (x: number, y: number) => cx + (x * hx + y * hy - along0) * ppm;
		const py = (z: number) => groundY - z * ppm;
		const depthOf = (x: number, y: number) => -x * hy + y * hx - depth0;

		ctx.setTransform(1, 0, 0, 1, 0, 0);
		ctx.fillStyle = '#0b0d12';
		ctx.fillRect(0, 0, W, H);
		const grad = ctx.createLinearGradient(0, groundY, 0, H);
		grad.addColorStop(0, '#151923');
		grad.addColorStop(1, '#0b0d12');
		ctx.fillStyle = grad;
		ctx.fillRect(0, groundY, W, H - groundY);
		ctx.strokeStyle = '#3a4256';
		ctx.lineWidth = 2 * dpr;
		ctx.beginPath(); ctx.moveTo(0, groundY); ctx.lineTo(W, groundY); ctx.stroke();
		ctx.strokeStyle = '#262b38';
		ctx.lineWidth = 1 * dpr;
		const tick = 0.1 * ppm;
		const phase = ((along0 * ppm) % tick + tick) % tick;
		for (let x = cx - phase - Math.ceil(cx / tick) * tick; x < W + tick; x += tick) {
			const k = Math.round((x - cx + phase) / tick + along0 / 0.1);
			ctx.beginPath(); ctx.moveTo(x, groundY); ctx.lineTo(x, groundY + (k % 5 === 0 ? 14 : 7) * dpr); ctx.stroke();
		}
		ctx.fillStyle = 'rgba(0,0,0,0.45)';
		ctx.beginPath();
		ctx.ellipse(px(q[0], q[1]), groundY, 0.09 * ppm, 0.018 * ppm, 0, 0, Math.PI * 2);
		ctx.fill();

		// Pen: segment between its two ends.
		if (L.pen && this.penState !== 'parked') {
			const b = L.pen.bodyId;
			const xq = this.data.xquat as Float64Array;
			const ax = this._v.set(1, 0, 0).applyQuaternion(this._q.set(xq[b * 4 + 1], xq[b * 4 + 2], xq[b * 4 + 3], xq[b * 4]));
			const p0 = [xpos[b * 3] - ax.x * PEN_HALF_LENGTH, xpos[b * 3 + 1] - ax.y * PEN_HALF_LENGTH, xpos[b * 3 + 2] - ax.z * PEN_HALF_LENGTH];
			const p1 = [xpos[b * 3] + ax.x * PEN_HALF_LENGTH, xpos[b * 3 + 1] + ax.y * PEN_HALF_LENGTH, xpos[b * 3 + 2] + ax.z * PEN_HALF_LENGTH];
			ctx.strokeStyle = '#6fb3ff';
			ctx.lineWidth = Math.max(3 * dpr, PEN_RADIUS * 2 * ppm);
			ctx.lineCap = 'round';
			ctx.beginPath(); ctx.moveTo(px(p0[0], p0[1]), py(p0[2])); ctx.lineTo(px(p1[0], p1[1]), py(p1[2])); ctx.stroke();
		}

		const discs = L.collGeoms
			.filter((g) => g.body !== L.pen?.bodyId)
			.map((g) => ({
				x: px(gxpos[g.id * 3], gxpos[g.id * 3 + 1]),
				y: py(gxpos[g.id * 3 + 2]),
				r: Math.max(2 * dpr, g.rbound * ppm * 0.6),
				depth: depthOf(gxpos[g.id * 3], gxpos[g.id * 3 + 1]),
				color: this.bodyColor(L.bodyNames[g.body])
			}));
		discs.sort((a, b) => b.depth - a.depth);
		for (const dsc of discs) {
			ctx.fillStyle = dsc.color;
			ctx.globalAlpha = Math.max(0.55, Math.min(1, 1 - dsc.depth * 3));
			ctx.beginPath(); ctx.arc(dsc.x, dsc.y, dsc.r, 0, Math.PI * 2); ctx.fill();
		}
		ctx.globalAlpha = 1;

		ctx.lineCap = 'round';
		for (let b = 1; b < L.bodyNames.length; b++) {
			const p = L.bodyParent[b];
			if (p <= 0 || b === L.pen?.bodyId) continue;
			ctx.strokeStyle = '#1d1d1f';
			ctx.lineWidth = 5 * dpr;
			ctx.beginPath();
			ctx.moveTo(px(xpos[p * 3], xpos[p * 3 + 1]), py(xpos[p * 3 + 2]));
			ctx.lineTo(px(xpos[b * 3], xpos[b * 3 + 1]), py(xpos[b * 3 + 2]));
			ctx.stroke();
		}
		for (let b = 1; b < L.bodyNames.length; b++) {
			if (b === L.pen?.bodyId) continue;
			ctx.fillStyle = '#8b8b90';
			ctx.beginPath();
			ctx.arc(px(xpos[b * 3], xpos[b * 3 + 1]), py(xpos[b * 3 + 2]), 3.5 * dpr, 0, Math.PI * 2);
			ctx.fill();
		}
		const head = L.bodyNames.indexOf('jaw_soft');
		if (head > 0) {
			ctx.fillStyle = '#ffc93c';
			ctx.beginPath();
			ctx.arc(px(xpos[head * 3], xpos[head * 3 + 1]) + 0.02 * ppm, py(xpos[head * 3 + 2]) - 0.01 * ppm, 4.5 * dpr, 0, Math.PI * 2);
			ctx.fill();
		}
		ctx.fillStyle = '#6d7486';
		ctx.font = `${11 * dpr}px ui-monospace, monospace`;
		ctx.textAlign = 'right';
		ctx.fillText(`2D fallback view · WebGL unavailable · ${this.locoName} · side view along heading, 10 cm ticks`, W - 10 * dpr, H - 10 * dpr);
	}

	private bodyColor(name: string): string {
		switch (name) {
			case 'jaw_soft': case 'yaw_roll_motion': case 'neck_pitch': case 'trunk_base':
			case 'upper_leg_left': case 'upper_leg_right':
				return '#f2efe8';
			case 'ankle_left': case 'ankle_right': case 'ankle_l_v1': case 'ankle_r_v1':
				return '#ff7a2f';
			case 'tire': case 'tire_2': case 'tire_3': case 'tire_4':
				return '#3c3c40';
			case 'leg': case 'leg_2': case 'neck':
				return '#8b8b90';
			default:
				return '#3c3c40';
		}
	}
}
