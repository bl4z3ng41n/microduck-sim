// Browser-side BAM "m6" model of the Dynamixel XL330 used to train the leg
// policies. Port of the official sandbox's bam-actuator.js. MuJoCo's stock
// <position> actuator cannot model the firmware PWM loop, current limit,
// back-EMF, load-dependent friction or bus delay the policies were trained
// with, so the MJCF actuators are converted to torque <motor>s and this class
// supplies the torque at every 5 ms physics step.

export const BAM_M6 = Object.freeze({
	kt: 0.36601349688984386,
	resistance: 2.8113923539223227,
	armature: 0.0018077432831600838,
	firmwareKp: 200,
	maxCurrent: 1.75,
	supplyVoltage: 7.35,
	voltageDropGain: 0.1,
	minVoltage: 6.0,
	minDelaySteps: 3,
	maxDelaySteps: 6,
	frictionBase: 0.004771183165566,
	frictionStribeck: 0.004676345799486616,
	loadFrictionMotor: 0.2667860954283698,
	loadFrictionExternal: 8.515871897059342e-6,
	loadFrictionMotorStribeck: 1.0722918395099123e-5,
	loadFrictionExternalStribeck: 0.08077928978935671,
	loadFrictionMotorQuad: 0.009972471242139415,
	loadFrictionExternalQuad: 0.004902565732332559,
	stribeckVelocity: 2.890372094130307,
	stribeckAlpha: 8.683259907618984,
	viscousFriction: 0.005359668274599504
});

// XL330 encoder/PWM conversion used by BAM's VoltageControlledActuator.
const FIRMWARE_ERROR_GAIN = 4096 / (2 * Math.PI * 256 * 885);
export const MAX_MOTOR_TORQUE = (8.2 * BAM_M6.kt) / BAM_M6.resistance;

export function computeBamTorque(target: number, position: number, velocity: number, voltage: number): number {
	const { kt, resistance, firmwareKp, maxCurrent } = BAM_M6;
	let duty = (target - position) * firmwareKp * FIRMWARE_ERROR_GAIN;
	const backEmfDuty = (kt * velocity) / voltage;
	const currentDutySpan = (resistance * maxCurrent) / voltage;
	duty = Math.max(backEmfDuty - currentDutySpan, Math.min(backEmfDuty + currentDutySpan, duty));
	duty = Math.max(-1, Math.min(1, duty));
	const torque = (kt * voltage * duty) / resistance - (kt * kt * velocity) / resistance;
	return Math.max(-MAX_MOTOR_TORQUE, Math.min(MAX_MOTOR_TORQUE, torque));
}

export function computeBamFriction(motorTorque: number, externalTorque: number, velocity: number): number {
	const p = BAM_M6;
	const stribeck = Math.exp(-((Math.abs(velocity) / p.stribeckVelocity) ** p.stribeckAlpha));
	const gearboxTorque = Math.abs(externalTorque * p.loadFrictionExternal - motorTorque * p.loadFrictionMotor);
	const gearboxTorqueStribeck = Math.abs(
		externalTorque * p.loadFrictionExternalStribeck - motorTorque * p.loadFrictionMotorStribeck
	);
	const motorDrives = Math.abs(motorTorque) > Math.abs(externalTorque);
	const quadratic = motorDrives
		? p.loadFrictionExternalQuad * externalTorque ** 2
		: p.loadFrictionMotorQuad * motorTorque ** 2;
	return p.frictionBase + stribeck * p.frictionStribeck + gearboxTorque + stribeck * gearboxTorqueStribeck + stribeck * quadratic;
}

// xorshift32: deterministic 3..6 step bus delays so replays are stable.
function nextRandom(state: number): number {
	let x = state >>> 0;
	x ^= x << 13;
	x ^= x >>> 17;
	x ^= x << 5;
	return x >>> 0;
}

// Minimal structural typing of the MuJoCo WASM objects we touch.
export interface MjDataLike {
	qpos: Float64Array;
	qvel: Float64Array;
	ctrl: Float64Array;
	qfrc_bias: Float64Array;
	qfrc_constraint: Float64Array;
	qfrc_actuator: Float64Array;
	efc_type?: Int32Array;
	efc_id?: Int32Array;
	efc_force?: Float64Array;
	nefc?: number;
}
export interface MjModelLike {
	dof_frictionloss: Float64Array;
	dof_damping: Float64Array;
}

export class BamM6Actuator {
	private targets: Float64Array[];
	private pendingTarget: Float64Array;
	private previousTorque: Float64Array;
	private frictionConstraint: Float64Array;
	private bufferIndex = 0;
	private seed: number;
	private static SEED = 0x4d445543;

	constructor(
		private qposAdr: number[],
		private dofAdr: number[],
		private ctrlAdr: number[]
	) {
		const n = qposAdr.length;
		this.targets = Array.from({ length: BAM_M6.maxDelaySteps + 1 }, () => new Float64Array(n));
		this.pendingTarget = new Float64Array(n);
		this.previousTorque = new Float64Array(n);
		this.frictionConstraint = new Float64Array(n);
		this.seed = BamM6Actuator.SEED;
	}

	reset(data: MjDataLike) {
		for (let j = 0; j < this.qposAdr.length; j++) {
			const q = data.qpos[this.qposAdr[j]];
			this.pendingTarget[j] = q;
			this.previousTorque[j] = 0;
			for (const t of this.targets) t[j] = q;
		}
		this.bufferIndex = 0;
		this.seed = BamM6Actuator.SEED;
	}

	setTarget(target: ArrayLike<number>) {
		for (let j = 0; j < this.pendingTarget.length; j++) this.pendingTarget[j] = target[j];
	}

	private nextDelay(): number {
		this.seed = nextRandom(this.seed);
		const count = BAM_M6.maxDelaySteps - BAM_M6.minDelaySteps + 1;
		return BAM_M6.minDelaySteps + (this.seed % count);
	}

	private frictionConstraintForces(data: MjDataLike) {
		this.frictionConstraint.fill(0);
		if (!data.efc_type || !data.efc_id || !data.efc_force) return;
		const nefc = Number(data.nefc) || 0;
		for (let i = 0; i < nefc; i++) {
			if (data.efc_type[i] !== 1) continue; // mjCNSTR_FRICTION_DOF
			const dof = data.efc_id[i];
			for (let j = 0; j < this.dofAdr.length; j++) {
				if (this.dofAdr[j] === dof) this.frictionConstraint[j] += data.efc_force[i];
			}
		}
	}

	apply(model: MjModelLike, data: MjDataLike) {
		this.targets[this.bufferIndex].set(this.pendingTarget);
		const delay = this.nextDelay();
		const readIndex = (this.bufferIndex - delay + this.targets.length) % this.targets.length;
		const target = this.targets[readIndex];
		this.bufferIndex = (this.bufferIndex + 1) % this.targets.length;

		let load = 0;
		for (const t of this.previousTorque) load += Math.abs(t);
		const voltage = Math.max(BAM_M6.minVoltage, BAM_M6.supplyVoltage - BAM_M6.voltageDropGain * load);
		this.frictionConstraintForces(data);

		const qpos = data.qpos, qvel = data.qvel, ctrl = data.ctrl;
		for (let j = 0; j < this.dofAdr.length; j++) {
			const dof = this.dofAdr[j];
			const torque = computeBamTorque(target[j], qpos[this.qposAdr[j]], qvel[dof], voltage);
			const externalTorque = -data.qfrc_bias[dof] + data.qfrc_constraint[dof] - this.frictionConstraint[j];
			model.dof_frictionloss[dof] = computeBamFriction(data.qfrc_actuator[dof], externalTorque, qvel[dof]);
			model.dof_damping[dof] = BAM_M6.viscousFriction;
			ctrl[this.ctrlAdr[j]] = torque;
			this.previousTorque[j] = torque;
		}
	}
}
