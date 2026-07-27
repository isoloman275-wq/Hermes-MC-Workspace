import * as THREE from 'three';

// Behavior-state definitions for Mission Control "toa" (agent warriors).
// Each state describes how a toa should look and behave.
export const TOA_STATES = {
  idle: {
    label: 'idle',
    color: 0x888888,
    emissive: 0x888888,
    emissiveIntensity: 0.25,
    pulse: false,
    scale: 1.0
  },
  thinking: {
    label: 'thinking',
    color: 0xb478ff,
    emissive: 0xb478ff,
    emissiveIntensity: 0.6,
    pulse: true,
    scale: 1.05
  },
  working: {
    label: 'working',
    color: 0x4a9bff,
    emissive: 0x4a9bff,
    emissiveIntensity: 0.95,
    pulse: true,
    scale: 1.1
  },
  reviewing: {
    label: 'reviewing',
    color: 0x2ee6c9,
    emissive: 0x2ee6c9,
    emissiveIntensity: 0.8,
    pulse: true,
    scale: 1.05
  },
  done: {
    label: 'done',
    color: 0x39ff9e,
    emissive: 0x39ff9e,
    emissiveIntensity: 1.2,
    pulse: false,
    scale: 1.15
  },
  blocked: {
    label: 'blocked',
    color: 0xff4d4d,
    emissive: 0xff4d4d,
    emissiveIntensity: 1.0,
    pulse: true,
    scale: 0.95
  }
};

// Pulse speed multiplier per state (blocked pulses fast, others slow).
const PULSE_SPEED = {
  thinking: 2.5,
  working: 2.5,
  reviewing: 2.5,
  blocked: 6
};

// Apply a named state to a toa group.
export function setToaState(toaGroup, stateName) {
  if (!toaGroup || !toaGroup.children || !toaGroup.children[0]) return;

  const state = TOA_STATES[stateName] || TOA_STATES.idle;

  // Core emissive intensity (children[0] is the octahedron core).
  const core = toaGroup.children[0];
  if (core.material) {
    core.material.emissiveIntensity = state.emissiveIntensity;
    if (core.material.emissive && typeof core.material.emissive.setHex === 'function') {
      core.material.emissive.setHex(state.emissive);
    }
  }

  // Ring color + opacity (stored on userData.ring).
  const ring = toaGroup.userData && toaGroup.userData.ring;
  if (ring && ring.material) {
    if (ring.material.color && typeof ring.material.color.setHex === 'function') {
      ring.material.color.setHex(state.color);
    }
    ring.material.opacity = 0.85;
  }

  // Overall scale.
  toaGroup.scale.setScalar(state.scale);

  // Record state + base intensity for pulsing.
  toaGroup.userData = toaGroup.userData || {};
  toaGroup.userData.state = stateName in TOA_STATES ? stateName : 'idle';
  toaGroup.userData._baseEmissive = state.emissiveIntensity;
  if (toaGroup.userData._phase === undefined) toaGroup.userData._phase = 0;
}

// Per-frame animation for a toa group.
export function tickToa(toaGroup, dt) {
  if (!toaGroup || !toaGroup.children || !toaGroup.children[0]) return;

  const stateName = (toaGroup.userData && toaGroup.userData.state) || 'idle';
  const state = TOA_STATES[stateName] || TOA_STATES.idle;

  if (!state.pulse) return; // idle / done do nothing

  const core = toaGroup.children[0];
  if (!core.material) return;

  const base = (toaGroup.userData && toaGroup.userData._baseEmissive) !== undefined
    ? toaGroup.userData._baseEmissive
    : state.emissiveIntensity;

  const speed = PULSE_SPEED[stateName] || 2.5;

  toaGroup.userData = toaGroup.userData || {};
  if (toaGroup.userData._phase === undefined) toaGroup.userData._phase = 0;
  toaGroup.userData._phase += dt * speed;

  // Gentle breathing between base and base*1.4.
  const s = (Math.sin(toaGroup.userData._phase) + 1) / 2; // 0..1
  core.material.emissiveIntensity = base + (base * 1.4 - base) * s;
}

// Map a kanban task status to a toa state name.
export function stateForTaskStatus(status) {
  const map = {
    todo: 'idle',
    claimed: 'thinking',
    in_progress: 'working',
    review: 'reviewing',
    done: 'done',
    crashed: 'blocked'
  };
  return map[status] || 'idle';
}
