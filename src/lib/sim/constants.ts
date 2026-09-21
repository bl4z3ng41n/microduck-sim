// Shared simulation constants. Values come from the official Microduck
// sandbox (micro-zoo/microduck-simulator, app/src/game/constants.js), which
// in turn mirror microduck_rl/scripts/infer_policy.py and robotd-params.

export const JOINT_NAMES = [
	'left_hip_yaw', 'left_hip_roll', 'left_hip_pitch', 'left_knee', 'left_ankle',
	'neck_pitch', 'head_pitch', 'head_yaw', 'head_roll',
	'right_hip_yaw', 'right_hip_roll', 'right_hip_pitch', 'right_knee', 'right_ankle'
] as const;

// STAND keyframe from mjlab's scene_walk.xml, in actuator order.
export const DEFAULT_POSE = new Float32Array([
	0, -0.08726646259971647, -0.457924, -0.00494, 0.452984,
	0.3490658503988659, 0.3490658503988659, 0, 0,
	0, 0.08726646259971647, 0.457924, 0.00494, -0.452984
]);

export const NUM_JOINTS = 14;
export const OBS_SIZE = 61;
export const CMD_SIZE = 13;

export const TIMESTEP = 0.005;
export const DECIMATION = 4;
export const CTRL_DT = TIMESTEP * DECIMATION; // 0.02 s -> 50 Hz

// Deployment defaults from robotd-params.
export const WALK_ACTION_SCALE = 0.9;
export const SKILL_ACTION_SCALE = 1.0;
export const STANDING_THRESHOLD = 0.05;

// Velocity command limits (same as infer_policy.py's keyboard mapping used
// by the sandbox). No strafe: the lateral slot stays zero.
export const VEL_FWD = 0.25;
export const VEL_BACK = -0.2;
export const VEL_ANG = 1.0;

export const HEAD_ALPHA = 0.2; // EMA toward head/body targets at 50 Hz

export const GROUND_PICK_PERIOD_S = 4.0;
export const GROUND_PICK_END_PHASE = 0.7;
export const KICK_STEPS = 25; // 0.5 s
export const POST_KICK_LOCK_STEPS = 20; // 0.4 s
export const STAND_UP_MS = 1500; // hand-back delay after a sit -> stand

export const FALL_DEBOUNCE_STEPS = 10; // 0.2 s of gz > -0.5
export const FALL_SETTLE_STEPS = 15; // 0.3 s ctrl freeze
export const RECOVER_UPRIGHT_STEPS = 50; // 1 s of gz < -0.85
export const RECOVER_GIVEUP_STEPS = 300; // 6 s

export type PolicyId = 'walk' | 'stand' | 'sitstand' | 'groundpick' | 'kickL' | 'kickR' | 'roll' | 'drive';

export const POLICY_FILES: Record<PolicyId, string> = {
	walk: 'BEST_alpha_walking.onnx',
	stand: 'BEST_alpha_stand.onnx',
	sitstand: 'BEST_alpha_sitstand.onnx',
	groundpick: 'alpha_ground_pick.onnx',
	kickL: 'ball_kick_left.onnx',
	kickR: 'ball_kick_right.onnx',
	roll: 'roulade.onnx',
	drive: 'BEST_roller.onnx'
};

/** Policies booted with the legged variant; `drive` loads lazily with the rollers. */
export const LEG_POLICY_IDS: PolicyId[] = ['walk', 'stand', 'sitstand', 'groundpick', 'kickL', 'kickR', 'roll'];

export const POLICY_LABELS: Record<PolicyId, string> = {
	walk: 'Walk',
	stand: 'Stand / recover',
	sitstand: 'Sit / stand',
	groundpick: 'Ground pick',
	kickL: 'Kick left',
	kickR: 'Kick right',
	roll: 'Roulade',
	drive: 'Roller drive'
};

// ── Roller variant (4 passive wheels) ──────────────────────────────────
// The roller policy was trained on the XML's own <position> actuator (no
// BAM motor model) with action scale 0.8. Runtime limits from robotd's
// roller branch: asymmetric vx (0.6 push / 0.5 brake), wz clamped to 0.3
// because faster commanded turns tip the robot over.
export const ROLLER_ACTION_SCALE = 0.8;
export const RVEL_FWD = 0.6;
export const RVEL_BACK = -0.5;
export const RVEL_ANG = 0.3;

// ── Pen prop for the ground-pick demo ──────────────────────────────────
// A light capsule the beak can pick up. The mjlab MJCF has no jaw joint and
// the exported policies have no mouth channel (14 actions), so the grab is
// a proximity latch: while the pick policy scoops (phase 0.28–0.50, the
// window where the sandbox snaps the jaw shut) and the mouth_tip site is
// within PEN_GRAB_DIST of the pen, the pen is attached to the head body.
export const PEN_RADIUS = 0.004;
export const PEN_HALF_LENGTH = 0.065;
export const PEN_MASS = 0.008;
export const PEN_PARK = '50 0 0.004';
export const PEN_GRAB_DIST = 0.035;
export const PEN_GRAB_PHASE: [number, number] = [0.28, 0.5];
// Where the beak touches down relative to the trunk, measured in the sim
// (see the pick probe in the headless test): ahead along the heading, on the floor.
export const PEN_AHEAD = 0.08;

// Jaw opening keyframes during the pick, from the official sandbox: open on
// approach (phase 0.10–0.20), hold, snap shut on the scoop (0.40–0.50).
export const PICK_JAW_KEYS: [number, number][] = [[0.1, 0], [0.2, 1], [0.4, 1], [0.5, 0]];
