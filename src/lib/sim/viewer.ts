// Static part viewer for the BOM page: the Microduck render rig in its STAND
// pose, with a set of meshes / sensor sites highlighted and everything else
// ghosted. No physics. Renders on demand.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { buildRig, loadGlbGeometries, materialSpecFor, setJoint, type GeomEntry, type Kinematics, type Rig } from './rig.ts';
import { DEFAULT_POSE, JOINT_NAMES } from './constants.ts';

export type ViewerVariant = 'legs' | 'rollers';

export interface Highlight {
	label: string;
	/** Mesh file names: every instance of these meshes is highlighted. */
	meshes?: string[];
	/** Single instances, keyed `body|geomIndex` (see src/lib/data/mesh-instances.json). */
	instances?: string[];
	sites?: string[];
	variant?: ViewerVariant;
	/** Assembly mode: meshes drawn in their normal colours (already built). Entries may be mesh names or instance keys. */
	solid?: string[];
	/** Drawn in blue: on hand but not assembled. Mesh names or instance keys. */
	secondary?: string[];
	/** Drawn dim orange: ordered / in transit. Mesh names or instance keys. */
	tertiary?: string[];
	/** What happens to meshes that are neither highlighted nor solid: ghosted (default) or hidden. */
	others?: 'ghost' | 'hidden';
	/** What the camera frames: the highlighted set (default), the solid+highlighted set, or the whole robot. */
	frame?: 'highlight' | 'solid' | 'all';
}

export interface HighlightStats {
	meshInstances: number;
	solidInstances: number;
	secondaryInstances: number;
	tertiaryInstances: number;
	sites: number;
	variant: ViewerVariant;
}

interface Variant {
	rig: Rig;
	meshes: THREE.Mesh[];
	baseMaterials: Map<THREE.Mesh, THREE.Material>;
	markers: Map<string, THREE.Mesh>;
}

const HIGHLIGHT = new THREE.MeshStandardMaterial({ color: 0xffc93c, emissive: 0xff8a00, emissiveIntensity: 0.55, roughness: 0.35, metalness: 0.1 });
const GHOST = new THREE.MeshStandardMaterial({ color: 0x8b93a7, transparent: true, opacity: 0.13, depthWrite: false, roughness: 0.9 });
const MARKER = new THREE.MeshStandardMaterial({ color: 0x6fb3ff, emissive: 0x2a7fff, emissiveIntensity: 0.9 });
const SECONDARY = new THREE.MeshStandardMaterial({ color: 0x6fb3ff, emissive: 0x1c4f9c, emissiveIntensity: 0.35, roughness: 0.45, metalness: 0.05 });
const TERTIARY = new THREE.MeshStandardMaterial({ color: 0xff7a2f, transparent: true, opacity: 0.35, depthWrite: false, roughness: 0.6 });

export class PartViewer {
	private canvas: HTMLCanvasElement;
	private simBase: string;
	private renderer!: THREE.WebGLRenderer;
	private scene = new THREE.Scene();
	private camera!: THREE.PerspectiveCamera;
	private controls!: OrbitControls;
	private resizeObs?: ResizeObserver;
	private raf = 0;
	private needsRender = true;
	private disposed = false;
	private geoms!: Map<string, GeomEntry>;
	private variants: Partial<Record<ViewerVariant, Variant>> = {};
	private loading: Partial<Record<ViewerVariant, Promise<Variant>>> = {};
	private shown: ViewerVariant = 'legs';
	private pending: Highlight | null = null;
	private tween: { t0: number; dur: number; fromPos: THREE.Vector3; toPos: THREE.Vector3; fromTgt: THREE.Vector3; toTgt: THREE.Vector3 } | null = null;
	private _box = new THREE.Box3();
	private _v = new THREE.Vector3();
	onStats?: (s: HighlightStats | null) => void;

	constructor(canvas: HTMLCanvasElement, simBase: string) {
		this.canvas = canvas;
		this.simBase = simBase;
	}

	static webglAvailable(): boolean {
		try {
			const c = document.createElement('canvas');
			return !!(c.getContext('webgl2') || c.getContext('webgl'));
		} catch {
			return false;
		}
	}

	async mount(): Promise<void> {
		const c = this.canvas;
		this.renderer = new THREE.WebGLRenderer({ canvas: c, antialias: true, alpha: true });
		this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
		this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
		this.renderer.shadowMap.enabled = true;
		this.camera = new THREE.PerspectiveCamera(32, 1, 0.01, 20);
		this.camera.position.set(0.42, 0.3, 0.5);
		this.controls = new OrbitControls(this.camera, c);
		this.controls.target.set(0, 0.12, 0);
		this.controls.enableDamping = true;
		this.controls.dampingFactor = 0.1;
		this.controls.minDistance = 0.08;
		this.controls.maxDistance = 2;
		this.controls.addEventListener('change', () => (this.needsRender = true));
		this.controls.addEventListener('start', () => (this.tween = null));

		this.scene.add(new THREE.HemisphereLight(0xdfe7ff, 0x2a2118, 1.2));
		const key = new THREE.DirectionalLight(0xfff1d6, 2.8);
		key.position.set(1, 1.8, 1.2);
		key.castShadow = true;
		key.shadow.mapSize.set(1024, 1024);
		key.shadow.camera.near = 0.2; key.shadow.camera.far = 5;
		key.shadow.camera.left = -0.6; key.shadow.camera.right = 0.6; key.shadow.camera.top = 0.6; key.shadow.camera.bottom = -0.6;
		this.scene.add(key);
		const rim = new THREE.DirectionalLight(0x8fb4ff, 0.9);
		rim.position.set(-1.2, 0.8, -1);
		this.scene.add(rim);
		const floor = new THREE.Mesh(new THREE.CircleGeometry(0.6, 48), new THREE.MeshStandardMaterial({ color: 0x151923, roughness: 1 }));
		floor.rotation.x = -Math.PI / 2;
		floor.receiveShadow = true;
		this.scene.add(floor);
		const grid = new THREE.GridHelper(1.2, 12, 0x2c3344, 0x1d222d);
		grid.position.y = 0.0005;
		this.scene.add(grid);

		const resize = () => {
			const w = c.clientWidth || 400, h = c.clientHeight || 400;
			this.renderer.setSize(w, h, false);
			this.camera.aspect = w / h;
			this.camera.updateProjectionMatrix();
			this.needsRender = true;
		};
		resize();
		this.resizeObs = new ResizeObserver(resize);
		this.resizeObs.observe(c);

		this.geoms = await loadGlbGeometries(`${this.simBase}robot/microduck.glb`);
		const legs = await this.ensureVariant('legs');
		this.scene.add(legs.rig.placer);
		this.applyHighlight(this.pending);
		this.loop();
	}

	private async ensureVariant(name: ViewerVariant): Promise<Variant> {
		if (this.variants[name]) return this.variants[name]!;
		this.loading[name] ??= (async () => {
			const kinFile = name === 'legs' ? 'kinematics.json' : 'kinematics_rollers.json';
			const xmlFile = name === 'legs' ? 'robot_allcollisions.xml' : 'robot_allcollisions_rollers.xml';
			const [kin, xml] = await Promise.all([
				fetch(`${this.simBase}robot/${kinFile}`).then((r) => r.json() as Promise<Kinematics>),
				fetch(`${this.simBase}robot/${xmlFile}`).then((r) => r.text())
			]);
			const rig = await buildRig(kin, this.geoms, (f) => `${this.simBase}robot/meshes/${f}`);
			for (let j = 0; j < JOINT_NAMES.length; j++) setJoint(rig, JOINT_NAMES[j], DEFAULT_POSE[j]);
			// Ground the rig: the STAND keyframe puts the trunk at z = 0.12 for the
			// legged model; the roller blades and wheels hang lower, so lift the
			// whole rig until its lowest point sits on the floor.
			rig.placer.updateWorldMatrix(true, true);
			const bounds = new THREE.Box3().setFromObject(rig.placer);
			if (Number.isFinite(bounds.min.y)) rig.placer.position.y -= bounds.min.y;
			rig.placer.updateWorldMatrix(true, true);
			const meshes: THREE.Mesh[] = [];
			const baseMaterials = new Map<THREE.Mesh, THREE.Material>();
			rig.root.traverse((o) => {
				const m = o as THREE.Mesh;
				if (m.isMesh && m.userData.meshName) {
					meshes.push(m);
					baseMaterials.set(m, m.material as THREE.Material);
					m.castShadow = true;
				}
			});
			// Sensor sites from the MJCF: small markers parented to their body.
			const markers = new Map<string, THREE.Mesh>();
			const doc = new DOMParser().parseFromString(xml, 'text/xml');
			for (const site of [...doc.querySelectorAll('body > site')]) {
				const name = site.getAttribute('name');
				const bodyName = site.parentElement?.getAttribute('name');
				const pos = (site.getAttribute('pos') ?? '0 0 0').split(/\s+/).map(Number);
				const body = bodyName ? rig.bodies.get(bodyName) : null;
				if (!name || !body) continue;
				const marker = new THREE.Mesh(new THREE.SphereGeometry(0.0065, 16, 12), MARKER);
				marker.position.set(pos[0], pos[1], pos[2]);
				marker.visible = false;
				body.add(marker);
				markers.set(name, marker);
			}
			const v: Variant = { rig, meshes, baseMaterials, markers };
			this.variants[name] = v;
			return v;
		})();
		return this.loading[name]!;
	}

	/** Highlight a part (meshes and/or sites); null shows the whole robot. */
	async setHighlight(h: Highlight | null) {
		this.pending = h;
		const want: ViewerVariant = h?.variant ?? 'legs';
		if (want !== this.shown || !this.variants[want]) {
			const v = await this.ensureVariant(want);
			if (this.pending !== h) return; // superseded while loading
			for (const other of Object.values(this.variants)) if (other && other !== v) this.scene.remove(other.rig.placer);
			this.scene.add(v.rig.placer);
			this.shown = want;
		}
		this.applyHighlight(h);
	}

	private applyHighlight(h: Highlight | null) {
		const v = this.variants[this.shown];
		if (!v || !this.renderer) return;
		const meshSet = new Set([...(h?.meshes ?? []), ...(h?.instances ?? [])]);
		const siteSet = new Set(h?.sites ?? []);
		const solidSet = new Set(h?.solid ?? []);
		const secSet = new Set(h?.secondary ?? []);
		const terSet = new Set(h?.tertiary ?? []);
		const hidden = h?.others === 'hidden';
		// An explicit `others` mode means assembly semantics: with nothing built, everything is ghosted/hidden.
		const active = meshSet.size > 0 || siteSet.size > 0 || solidSet.size > 0 || secSet.size > 0 || terSet.size > 0 || h?.others !== undefined;
		let count = 0, solidCount = 0, secCount = 0, terCount = 0;
		this._box.makeEmpty();
		const solidBox = new THREE.Box3();
		v.rig.placer.updateWorldMatrix(true, true);
		const inSet = (set: Set<string>, m: THREE.Mesh) => set.has(m.userData.meshName as string) || set.has(m.userData.instanceKey as string);
		for (const m of v.meshes) {
			const hit = inSet(meshSet, m);
			const solid = !hit && inSet(solidSet, m);
			const sec = !hit && !solid && inSet(secSet, m);
			const ter = !hit && !solid && !sec && inSet(terSet, m);
			const shown = hit || solid || sec || ter;
			m.visible = !active || shown || !hidden;
			m.material = !active ? v.baseMaterials.get(m)! : hit ? HIGHLIGHT : solid ? v.baseMaterials.get(m)! : sec ? SECONDARY : ter ? TERTIARY : GHOST;
			m.castShadow = !active || hit || solid || sec;
			if (hit) {
				count++;
				this._box.expandByObject(m);
				solidBox.expandByObject(m);
			} else if (solid || sec) {
				if (solid) solidCount++; else secCount++;
				solidBox.expandByObject(m);
			} else if (ter) terCount++;
		}
		let sites = 0;
		for (const [name, marker] of v.markers) {
			const hit = siteSet.has(name);
			marker.visible = hit;
			if (hit) {
				sites++;
				marker.getWorldPosition(this._v);
				this._box.expandByPoint(this._v);
			}
		}
		this.onStats?.(active ? { meshInstances: count, solidInstances: solidCount, secondaryInstances: secCount, tertiaryInstances: terCount, sites, variant: this.shown } : null);
		const whole = new THREE.Box3().setFromCenterAndSize(new THREE.Vector3(0, 0.125, 0), new THREE.Vector3(0.2, 0.26, 0.2));
		const mode = h?.frame ?? 'highlight';
		if (mode === 'all' || !active) this.frame(whole, 2.0);
		else if (mode === 'solid') this.frame(solidBox.isEmpty() ? whole : solidBox, 2.2);
		else this.frame(this._box.isEmpty() ? (solidBox.isEmpty() ? whole : solidBox) : this._box, 2.4);
		this.needsRender = true;
	}

	private frame(box: THREE.Box3, factor: number) {
		const center = box.getCenter(new THREE.Vector3());
		const size = box.getSize(new THREE.Vector3()).length();
		// Never closer than 0.22 m: a lone sensor site still shows the head around it.
		const dist = Math.min(1.2, Math.max(0.22, size * factor + 0.05));
		const dir = this.camera.position.clone().sub(this.controls.target).normalize();
		if (dir.lengthSq() < 1e-6) dir.set(0.6, 0.45, 0.7).normalize();
		if (dir.y < 0.12) dir.y = 0.12; // keep the camera above the floor
		const toPos = center.clone().add(dir.normalize().multiplyScalar(dist));
		this.tween = {
			t0: performance.now(), dur: 420,
			fromPos: this.camera.position.clone(), toPos,
			fromTgt: this.controls.target.clone(), toTgt: center
		};
		this.needsRender = true;
	}

	private loop() {
		const tick = () => {
			if (this.disposed) return;
			this.raf = requestAnimationFrame(tick);
			if (this.tween) {
				const k = Math.min(1, (performance.now() - this.tween.t0) / this.tween.dur);
				const e = 1 - Math.pow(1 - k, 3);
				this.camera.position.lerpVectors(this.tween.fromPos, this.tween.toPos, e);
				this.controls.target.lerpVectors(this.tween.fromTgt, this.tween.toTgt, e);
				if (k >= 1) this.tween = null;
				this.needsRender = true;
			}
			if (this.controls.update() || this.needsRender) {
				this.needsRender = false;
				this.renderer.render(this.scene, this.camera);
			}
		};
		tick();
	}

	dispose() {
		this.disposed = true;
		cancelAnimationFrame(this.raf);
		this.resizeObs?.disconnect();
		this.controls?.dispose();
		this.renderer?.dispose();
	}
}
