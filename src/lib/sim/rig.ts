// three.js render rig for the Microduck: one Group per MJCF body from
// kinematics.json, meshes from microduck.glb, joints driven from MuJoCo qpos.
// Port of the official sandbox's duck.js (colourway logic simplified).

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { mergeVertices, toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';

export interface KinGeom {
	type?: string;
	mesh?: string;
	pos?: [number, number, number];
	quat?: [number, number, number, number];
	color?: [number, number, number, number?];
}
export interface KinJoint {
	name: string;
	axis: [number, number, number];
	type?: string;
	range?: [number, number];
}
export interface KinBody {
	name: string;
	parent: string | null;
	pos: [number, number, number];
	quat: [number, number, number, number];
	joint?: KinJoint | null;
	geoms: KinGeom[];
}
export interface Kinematics {
	bodies: KinBody[];
	actuated_joints: string[];
	mesh_dir: string;
}

export interface GeomEntry {
	display: THREE.BufferGeometry;
	welded: THREE.BufferGeometry;
}

export interface Rig {
	placer: THREE.Group;
	root: THREE.Group;
	bodies: Map<string, THREE.Group>;
	joints: Map<string, { body: THREE.Group; axis: THREE.Vector3; baseQuat: THREE.Quaternion; range: [number, number] | null }>;
}

const CREASE = Math.PI / 5;

export async function loadGlbGeometries(url: string): Promise<Map<string, GeomEntry>> {
	const gltf = await new GLTFLoader().loadAsync(url);
	const map = new Map<string, GeomEntry>();
	gltf.scene.traverse((o) => {
		const mesh = o as THREE.Mesh;
		if (!mesh.isMesh || !mesh.geometry) return;
		const name = (mesh.userData?.meshFile as string) || mesh.name || mesh.geometry.name;
		if (!name || map.has(name)) return;
		const welded = mesh.geometry;
		welded.deleteAttribute('normal');
		// toCreasedNormals hashes on a 0.01-unit grid; meshes are in metres,
		// so crease on a mm-scaled clone.
		const scaled = welded.clone();
		scaled.scale(1000, 1000, 1000);
		const display = toCreasedNormals(scaled, CREASE);
		display.scale(1e-3, 1e-3, 1e-3);
		const entry = { display, welded };
		map.set(name, entry);
		if (mesh.name && mesh.name !== name) map.set(mesh.name, entry);
	});
	return map;
}

// MuJoCo's compiler wants binary STL in its VFS. Rebuild it from the GLB
// geometry so the mesh bytes are downloaded once.
export function geometryToBinaryStl(geometry: THREE.BufferGeometry): ArrayBuffer {
	const pos = geometry.attributes.position as THREE.BufferAttribute;
	const idx = geometry.index;
	const triCount = (idx ? idx.count : pos.count) / 3;
	const buf = new ArrayBuffer(84 + triCount * 50);
	const view = new DataView(buf);
	view.setUint32(80, triCount, true);
	let off = 84;
	const vx = (i: number): [number, number, number] => {
		const j = idx ? idx.getX(i) : i;
		return [pos.getX(j), pos.getY(j), pos.getZ(j)];
	};
	for (let t = 0; t < triCount; t++) {
		const a = vx(t * 3), b = vx(t * 3 + 1), c = vx(t * 3 + 2);
		const nx = (b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]);
		const ny = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]);
		const nz = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
		const len = Math.hypot(nx, ny, nz) || 1;
		view.setFloat32(off, nx / len, true);
		view.setFloat32(off + 4, ny / len, true);
		view.setFloat32(off + 8, nz / len, true);
		const pts = [a, b, c];
		for (let p = 0; p < 3; p++) {
			view.setFloat32(off + 12 + p * 12, pts[p][0], true);
			view.setFloat32(off + 16 + p * 12, pts[p][1], true);
			view.setFloat32(off + 20 + p * 12, pts[p][2], true);
		}
		view.setUint16(off + 48, 0, true);
		off += 50;
	}
	return buf;
}

// Simple "classic" colourway: cream shells, orange beak and shoes, dark
// mechanics. Keyed on the mesh file name.
type Spec = { color: [number, number, number]; roughness: number; metalness: number };
const CREAM: Spec = { color: [0.888, 0.86, 0.798], roughness: 0.35, metalness: 0 };
const ORANGE: Spec = { color: [1.0, 0.144, 0.008], roughness: 0.45, metalness: 0 };
const AMBER: Spec = { color: [1.0, 0.413, 0.007], roughness: 0.4, metalness: 0 };
const YELLOW: Spec = { color: [1.0, 0.608, 0.021], roughness: 0.4, metalness: 0 };
const WARM_GRAY: Spec = { color: [0.328, 0.312, 0.283], roughness: 0.35, metalness: 0 };
const DARK: Spec = { color: [0.012, 0.012, 0.014], roughness: 0.55, metalness: 0.3 };
const GRAY: Spec = { color: [0.256, 0.256, 0.279], roughness: 0.5, metalness: 0.35 };
const LENS: Spec = { color: [0.01, 0.012, 0.02], roughness: 0.05, metalness: 0 };

export function materialSpecFor(mesh: string): Spec {
	switch (mesh) {
		case 'top_head_shell.stl':
		case 'trunk_base.stl':
		case 'left_shell.stl':
		case 'right_shell.stl':
		case 'upper_leg_left.stl':
		case 'upper_leg_right.stl':
			return CREAM;
		case 'face_part.stl':
		case 'bottom_head_shell.stl':
			return WARM_GRAY;
		case 'jaw.stl':
		case 'foot_left.stl':
		case 'foot_right.stl':
		case 'ankle_left.stl':
		case 'ankle_right.stl':
		case 'ankle_l_v1.stl':
		case 'ankle_r_v1.stl':
		case 'roller_blade.stl':
			return ORANGE;
		case 'tire.stl':
			return DARK;
		case 'rim.stl':
			return YELLOW;
		case 'soft_mouth_top.stl':
		case 'jaw_soft.stl':
		case 'noenoeil.stl':
			return AMBER;
		case 'sole_left.stl':
		case 'sole_right.stl':
			return YELLOW;
		case 'lens.stl':
			return LENS;
		case 'hip_l.stl':
		case 'yaw2roll.stl':
		case 'bearing_roll.stl':
		case 'yaw_roll_motion.stl':
		case 'neck.stl':
		case 'neck_pitch.stl':
		case 'leg.stl':
		case 'motor_support.stl':
			return GRAY;
		default:
			return DARK;
	}
}

export async function buildRig(
	k: Kinematics,
	geoms: Map<string, GeomEntry>,
	stlUrl: (file: string) => string
): Promise<Rig> {
	const placer = new THREE.Group();
	placer.name = 'duck_placer';
	// MJCF is Z-up, three.js is Y-up.
	const root = new THREE.Group();
	root.name = 'duck_root';
	root.rotation.x = -Math.PI / 2;
	placer.add(root);

	const bodies = new Map<string, THREE.Group>();
	const joints: Rig['joints'] = new Map();
	const extra = new Map<string, Promise<GeomEntry>>();
	const loadMesh = (name: string): Promise<GeomEntry> => {
		const e = geoms.get(name);
		if (e) return Promise.resolve(e);
		if (!extra.has(name)) {
			extra.set(
				name,
				new STLLoader().loadAsync(stlUrl(name)).then((raw) => {
					raw.deleteAttribute('normal');
					const welded = mergeVertices(raw, 1e-4);
					welded.scale(1000, 1000, 1000);
					const display = toCreasedNormals(welded, CREASE);
					display.scale(1e-3, 1e-3, 1e-3);
					welded.scale(1e-3, 1e-3, 1e-3);
					return { display, welded };
				})
			);
		}
		return extra.get(name)!;
	};

	for (const b of k.bodies) {
		const g = new THREE.Group();
		g.name = b.name;
		g.position.set(b.pos[0], b.pos[1], b.pos[2]);
		g.quaternion.set(b.quat[1], b.quat[2], b.quat[3], b.quat[0]);
		bodies.set(b.name, g);
	}
	for (const b of k.bodies) {
		const g = bodies.get(b.name)!;
		if (b.parent && bodies.has(b.parent)) bodies.get(b.parent)!.add(g);
		else root.add(g);
	}
	for (const b of k.bodies) {
		if (!b.joint || (b.joint.type && b.joint.type !== 'hinge')) continue;
		const g = bodies.get(b.name)!;
		joints.set(b.joint.name, {
			body: g,
			axis: new THREE.Vector3(...b.joint.axis).normalize(),
			baseQuat: g.quaternion.clone(),
			range: b.joint.range ?? null
		});
	}

	const matCache = new Map<string, THREE.MeshStandardMaterial>();
	const matFor = (spec: Spec) => {
		const key = `${spec.color.join(',')}|${spec.roughness}|${spec.metalness}`;
		let m = matCache.get(key);
		if (!m) {
			m = new THREE.MeshStandardMaterial({ color: new THREE.Color(...spec.color), roughness: spec.roughness, metalness: spec.metalness });
			matCache.set(key, m);
		}
		return m;
	};

	const pending: Promise<void>[] = [];
	const seen = new Set<string>();
	for (const b of k.bodies) {
		const g = bodies.get(b.name)!;
		for (const [gi, geom] of b.geoms.entries()) {
			if ((geom.type && geom.type !== 'mesh') || !geom.mesh) continue;
			const dupKey = `${b.name}|${geom.mesh}|${geom.pos}|${geom.quat}`;
			if (seen.has(dupKey)) continue;
			seen.add(dupKey);
			pending.push(
				loadMesh(geom.mesh).then(({ display }) => {
					const m = new THREE.Mesh(display, matFor(materialSpecFor(geom.mesh!)));
					m.castShadow = true;
					m.receiveShadow = false;
					m.userData.meshName = geom.mesh;
					// Instance identity: body name + geom index in kinematics.json (matches src/lib/data/mesh-instances.json).
					m.userData.bodyName = b.name;
					m.userData.instanceKey = `${b.name}|${gi}`;
					if (geom.pos) m.position.set(...geom.pos);
					if (geom.quat) m.quaternion.set(geom.quat[1], geom.quat[2], geom.quat[3], geom.quat[0]);
					g.add(m);
				})
			);
		}
	}
	await Promise.all(pending);
	const rig: Rig = { placer, root, bodies, joints };
	setupJawPivot(rig);
	return rig;
}

// ── Jaw hinge (visual only) ───────────────────────────────────────────
// The mjlab model has no jaw joint: jaw.stl / jaw_soft.stl are rigid geoms
// of the head body. Re-create the hinge in the render rig so the beak can
// open during the ground pick. Hinge point fitted on the STL's axle bosses
// (from the official sandbox), axis = robot left-right.
const JAW_MESH_NAMES = new Set(['jaw.stl', 'jaw_soft.stl']);
export const JAW_MAX_OPEN = 0.32; // rad
const JAW_HINGE_LOCAL = new THREE.Vector3(0, 0.00004, 0.0075);

function setupJawPivot(rig: Rig) {
	const meshes: THREE.Mesh[] = [];
	rig.root.traverse((o) => {
		const m = o as THREE.Mesh;
		if (m.isMesh && JAW_MESH_NAMES.has(m.userData.meshName)) meshes.push(m);
	});
	if (!meshes.length) return;
	const body = meshes[0].parent as THREE.Object3D;
	rig.placer.updateWorldMatrix(true, true);
	const jawMesh = meshes.find((m) => m.userData.meshName === 'jaw.stl') ?? meshes[0];
	const hingeW = jawMesh.localToWorld(JAW_HINGE_LOCAL.clone());
	const axisW = new THREE.Vector3(0, 0, -1);
	const bodyQuatInv = body.getWorldQuaternion(new THREE.Quaternion()).invert();
	const hingeL = body.worldToLocal(hingeW.clone());
	const axisL = axisW.applyQuaternion(bodyQuatInv).normalize();
	const pivot = new THREE.Group();
	pivot.name = 'jaw_pivot';
	pivot.position.copy(hingeL);
	pivot.userData.jawAxis = axisL.toArray();
	body.add(pivot);
	for (const m of meshes) {
		m.position.sub(hingeL);
		pivot.add(m);
	}
}

const _jawAxis = new THREE.Vector3();
/** 0 = closed, 1 = fully open. */
export function setJawOpen(rig: Rig, open: number) {
	const pivot = rig.placer.getObjectByName('jaw_pivot');
	if (!pivot) return;
	_jawAxis.fromArray(pivot.userData.jawAxis as number[]);
	pivot.quaternion.setFromAxisAngle(_jawAxis, JAW_MAX_OPEN * Math.max(0, Math.min(1, open)));
}

const _q = new THREE.Quaternion();
export function setJoint(rig: Rig, name: string, angle: number) {
	const j = rig.joints.get(name);
	if (!j) return;
	let a = angle;
	if (j.range) a = Math.min(j.range[1], Math.max(j.range[0], a));
	j.body.quaternion.copy(j.baseQuat).multiply(_q.setFromAxisAngle(j.axis, a));
}
