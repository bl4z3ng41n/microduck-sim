// Side-by-side / overlay viewer for two meshes of the same part: a community
// print file (STL streamed from GitHub) and the simulation mesh this site
// ships (from microduck.glb or the roller STLs). Renders on demand.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { mergeVertices, toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';
import { loadGlbGeometries, type GeomEntry } from './rig.ts';

export type CompareMode = 'side' | 'overlay';

export interface CompareStats {
	leftTris: number;
	rightTris: number;
	sizeMm: [number, number, number];
}

const LEFT_MAT = new THREE.MeshStandardMaterial({ color: 0x6fb3ff, roughness: 0.45, metalness: 0.05 });
const RIGHT_MAT = new THREE.MeshStandardMaterial({ color: 0xf2efe8, roughness: 0.45, metalness: 0.0 });
const LEFT_OVERLAY = new THREE.MeshStandardMaterial({ color: 0x6fb3ff, roughness: 0.45, transparent: true, opacity: 0.55, depthWrite: false });
const WIRE_L = new THREE.LineBasicMaterial({ color: 0x6fb3ff, transparent: true, opacity: 0.35 });
const WIRE_R = new THREE.LineBasicMaterial({ color: 0xffc93c, transparent: true, opacity: 0.35 });

function prepare(raw: THREE.BufferGeometry): THREE.BufferGeometry {
	raw.deleteAttribute('normal');
	const welded = mergeVertices(raw, 1e-4);
	welded.scale(1000, 1000, 1000);
	const display = toCreasedNormals(welded, Math.PI / 5);
	display.scale(1e-3, 1e-3, 1e-3);
	return display;
}

export class MeshCompare {
	private renderer!: THREE.WebGLRenderer;
	private scene = new THREE.Scene();
	private camera!: THREE.PerspectiveCamera;
	private controls!: OrbitControls;
	private resizeObs?: ResizeObserver;
	private raf = 0;
	private needsRender = true;
	private disposed = false;
	private group = new THREE.Group();
	private left: THREE.Mesh | null = null;
	private right: THREE.Mesh | null = null;
	private wires: THREE.LineSegments[] = [];
	private mode: CompareMode = 'side';
	private wire = false;
	private geoms: Promise<Map<string, GeomEntry>> | null = null;
	private token = 0;
	onStats?: (s: CompareStats | null) => void;

	constructor(private canvas: HTMLCanvasElement, private simBase: string) {}

	mount() {
		const c = this.canvas;
		this.renderer = new THREE.WebGLRenderer({ canvas: c, antialias: true, alpha: true });
		this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
		this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
		this.camera = new THREE.PerspectiveCamera(30, 1, 0.001, 20);
		this.camera.position.set(0.12, 0.09, 0.16);
		this.controls = new OrbitControls(this.camera, c);
		this.controls.enableDamping = true;
		this.controls.dampingFactor = 0.1;
		this.controls.addEventListener('change', () => (this.needsRender = true));
		this.scene.add(new THREE.HemisphereLight(0xdfe7ff, 0x2a2118, 1.3));
		const key = new THREE.DirectionalLight(0xfff1d6, 2.6);
		key.position.set(1, 1.6, 1.2);
		this.scene.add(key);
		const rim = new THREE.DirectionalLight(0x8fb4ff, 0.9);
		rim.position.set(-1.2, 0.6, -1);
		this.scene.add(rim);
		this.scene.add(this.group);
		const resize = () => {
			const w = c.clientWidth || 400, h = c.clientHeight || 300;
			this.renderer.setSize(w, h, false);
			this.camera.aspect = w / h;
			this.camera.updateProjectionMatrix();
			this.needsRender = true;
		};
		resize();
		this.resizeObs = new ResizeObserver(resize);
		this.resizeObs.observe(c);
		const tick = () => {
			if (this.disposed) return;
			this.raf = requestAnimationFrame(tick);
			if (this.controls.update() || this.needsRender) {
				this.needsRender = false;
				this.renderer.render(this.scene, this.camera);
			}
		};
		tick();
	}

	setMode(mode: CompareMode) {
		this.mode = mode;
		this.layout();
	}

	setWireframe(on: boolean) {
		this.wire = on;
		this.layout();
	}

	/** Load the community STL (`leftUrl`) and the sim mesh (`simMesh` file name, e.g. "leg.stl"). */
	async load(leftUrl: string, simMesh: string, simFallbackUrl?: string): Promise<void> {
		const token = ++this.token;
		this.onStats?.(null);
		this.geoms ??= loadGlbGeometries(`${this.simBase}robot/microduck.glb`);
		const [leftGeo, geoms] = await Promise.all([
			new STLLoader().loadAsync(leftUrl).then(prepare),
			this.geoms
		]);
		let rightGeo: THREE.BufferGeometry | null = geoms.get(simMesh)?.display ?? null;
		if (!rightGeo && simFallbackUrl) rightGeo = await new STLLoader().loadAsync(simFallbackUrl).then(prepare);
		if (token !== this.token || this.disposed) return;
		this.clear();
		this.left = new THREE.Mesh(leftGeo, LEFT_MAT);
		this.right = rightGeo ? new THREE.Mesh(rightGeo, RIGHT_MAT) : null;
		// Centre each mesh on its own bounding box so they line up.
		for (const m of [this.left, this.right]) {
			if (!m) continue;
			m.geometry.computeBoundingBox();
			const c = m.geometry.boundingBox!.getCenter(new THREE.Vector3());
			m.position.copy(c.negate());
			this.group.add(m);
		}
		this.layout();
		const size = leftGeo.boundingBox!.getSize(new THREE.Vector3());
		this.onStats?.({
			leftTris: (leftGeo.index ? leftGeo.index.count : leftGeo.attributes.position.count) / 3,
			rightTris: rightGeo ? (rightGeo.index ? rightGeo.index.count : rightGeo.attributes.position.count) / 3 : 0,
			sizeMm: [size.x * 1000, size.y * 1000, size.z * 1000]
		});
		this.frame(size.length());
	}

	private clear() {
		for (const w of this.wires) this.group.remove(w);
		this.wires = [];
		if (this.left) this.group.remove(this.left);
		if (this.right) this.group.remove(this.right);
		this.left = this.right = null;
	}

	private layout() {
		if (!this.left) return;
		for (const w of this.wires) this.group.remove(w);
		this.wires = [];
		const size = this.left.geometry.boundingBox!.getSize(new THREE.Vector3());
		const gap = Math.max(size.x, size.y, size.z) * 0.55;
		const base = this.left.geometry.boundingBox!.getCenter(new THREE.Vector3()).negate();
		if (this.mode === 'side') {
			this.left.position.copy(base).add(new THREE.Vector3(-gap, 0, 0));
			this.left.material = LEFT_MAT;
			if (this.right) {
				const c = this.right.geometry.boundingBox!.getCenter(new THREE.Vector3()).negate();
				this.right.position.copy(c).add(new THREE.Vector3(gap, 0, 0));
				this.right.visible = true;
			}
		} else {
			this.left.position.copy(base);
			this.left.material = LEFT_OVERLAY;
			if (this.right) {
				this.right.position.copy(this.right.geometry.boundingBox!.getCenter(new THREE.Vector3()).negate());
				this.right.visible = true;
			}
		}
		if (this.wire) {
			const wl = new THREE.LineSegments(new THREE.WireframeGeometry(this.left.geometry), WIRE_L);
			wl.position.copy(this.left.position);
			this.group.add(wl);
			this.wires.push(wl);
			if (this.right) {
				const wr = new THREE.LineSegments(new THREE.WireframeGeometry(this.right.geometry), WIRE_R);
				wr.position.copy(this.right.position);
				this.group.add(wr);
				this.wires.push(wr);
			}
		}
		this.needsRender = true;
	}

	private frame(diag: number) {
		const dist = Math.max(0.05, diag * (this.mode === 'side' ? 2.1 : 1.7));
		const dir = new THREE.Vector3(0.55, 0.45, 0.7).normalize();
		this.controls.target.set(0, 0, 0);
		this.camera.position.copy(dir.multiplyScalar(dist));
		this.camera.near = dist / 100;
		this.camera.far = dist * 50;
		this.camera.updateProjectionMatrix();
		this.needsRender = true;
	}

	dispose() {
		this.disposed = true;
		cancelAnimationFrame(this.raf);
		this.resizeObs?.disconnect();
		this.controls?.dispose();
		this.renderer?.dispose();
	}
}
