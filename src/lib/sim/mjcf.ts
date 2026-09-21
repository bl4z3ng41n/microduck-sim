// MJCF preparation for the browser physics model. Port of buildPhysicsXml()
// from the official sandbox, minus the arena, ball and terrain extras.
//
// robot_allcollisions.xml carries body/shell collision geoms (needed by the
// sit policy: a sit rests the trunk on the ground). Visual geoms are
// irrelevant to the dynamics: every body has an explicit <inertial> and the
// visual class has contype=0 conaffinity=0, so they are stripped and only
// the ~9 meshes referenced by collision geoms go into the MuJoCo VFS.

import { BAM_M6 } from './bam.ts';
import { DEFAULT_POSE, JOINT_NAMES, PEN_HALF_LENGTH, PEN_MASS, PEN_PARK, PEN_RADIUS, TIMESTEP } from './constants.ts';

export interface PhysicsXml {
	xml: string;
	meshFiles: string[];
}

export interface PhysicsXmlOptions {
	/** Convert <position> actuators to torque <motor>s driven by the BAM model (legs). */
	bamMotors?: boolean;
	/** Append the pen prop (free capsule, floor-only collisions). */
	pen?: boolean;
	spawn?: [number, number];
}

export function buildPhysicsXml(src: string, opts: PhysicsXmlOptions = {}): PhysicsXml {
	const { bamMotors = true, pen = false, spawn = [0, 0] } = opts;
	const doc = new DOMParser().parseFromString(src, 'text/xml');
	const parseError = doc.querySelector('parsererror');
	if (parseError) throw new Error(`MJCF parse error: ${parseError.textContent}`);

	// Leg policies were trained with BAM's voltage-controlled XL330 model, not
	// MuJoCo's position actuator. Convert to torque motors; bam.ts drives them.
	if (bamMotors) {
		const chosen = [...doc.querySelectorAll('default[class="chosen_actuator"]')]
			.map((d) => d.querySelector('joint'))
			.find(Boolean);
		if (!chosen) throw new Error('BAM physics requires the chosen_actuator joint default');
		chosen.setAttribute('armature', String(BAM_M6.armature));
		chosen.setAttribute('damping', '0');
		chosen.setAttribute('frictionloss', '0');
		const limit = (8.2 * BAM_M6.kt) / BAM_M6.resistance;
		for (const position of [...doc.querySelectorAll('actuator > position')]) {
			const motor = doc.createElement('motor');
			motor.setAttribute('name', position.getAttribute('name') ?? '');
			motor.setAttribute('joint', position.getAttribute('joint') ?? '');
			motor.setAttribute('forcelimited', 'true');
			motor.setAttribute('forcerange', `${-limit} ${limit}`);
			position.replaceWith(motor);
		}
	}

	for (const g of [...doc.querySelectorAll('geom[class="visual"]')]) g.remove();
	const usedMeshes = new Set([...doc.querySelectorAll('geom[mesh]')].map((g) => g.getAttribute('mesh')));
	for (const m of [...doc.querySelectorAll('asset > mesh')]) {
		const name = m.getAttribute('name') ?? m.getAttribute('file')!.replace(/\.stl$/i, '');
		if (!usedMeshes.has(name)) m.remove();
	}

	const root = doc.documentElement;
	const el = (tag: string, attrs: Record<string, string>) => {
		const e = doc.createElement(tag);
		for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
		return e;
	};
	root.appendChild(el('option', { timestep: String(TIMESTEP) }));
	const worldbody = doc.querySelector('worldbody')!;
	// Floor collides with the robot (bit 1) and with the pen (bit 4).
	worldbody.appendChild(el('geom', { name: 'floor', type: 'plane', size: '0 0 0.05', pos: '0 0 0', contype: '1', conaffinity: '5' }));
	if (pen) {
		// Free capsule lying along its body x axis, parked far away. Collides
		// with the floor only, so the beak cannot knock it around before the grab.
		const body = el('body', { name: 'pen', pos: PEN_PARK });
		body.appendChild(el('freejoint', { name: 'pen_freejoint' }));
		body.appendChild(
			el('geom', {
				name: 'pen_geom', type: 'capsule', size: `${PEN_RADIUS} ${PEN_HALF_LENGTH}`,
				quat: '0.7071068 0 0.7071068 0', mass: String(PEN_MASS),
				contype: '4', conaffinity: '4', friction: '0.8 0.01 0.001', condim: '4'
			})
		);
		worldbody.appendChild(body);
	}

	// STAND keyframe: free joint + every hinge in document order (14 actuated
	// hinges take DEFAULT_POSE by name, anything else zero).
	const poseByName = new Map(JOINT_NAMES.map((n, i) => [n, DEFAULT_POSE[i]]));
	const qposJoints = [...doc.querySelectorAll('body > joint')]
		.map((j) => poseByName.get(j.getAttribute('name') as (typeof JOINT_NAMES)[number]) ?? 0)
		.join(' ');
	const penQpos = pen ? ` ${PEN_PARK} 1 0 0 0` : '';
	const kf = doc.createElement('keyframe');
	kf.appendChild(
		el('key', {
			name: 'STAND',
			qpos: `${spawn[0]} ${spawn[1]} 0.12 1 0 0 0 ${qposJoints}${penQpos}`,
			ctrl: Array.from(DEFAULT_POSE).join(' ')
		})
	);
	root.appendChild(kf);

	const meshFiles = [...doc.querySelectorAll('asset > mesh')].map((m) => m.getAttribute('file')!);
	return { xml: new XMLSerializer().serializeToString(doc), meshFiles };
}
