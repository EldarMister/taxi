export type PermissionStep = 'notifications' | 'overlay' | 'location' | 'battery';
export type PermissionIntroState = PermissionStep | 'done';
export type PermissionRole = 'CLIENT' | 'DRIVER';

const clientSteps: readonly PermissionStep[] = ['notifications', 'location'];
const driverSteps: readonly PermissionStep[] = ['notifications', 'overlay', 'location', 'battery'];

export function permissionSteps(role: PermissionRole): readonly PermissionStep[] {
  return role === 'DRIVER' ? driverSteps : clientSteps;
}

export function nextPermissionStep(step: PermissionStep, role: PermissionRole): PermissionIntroState {
  const steps = permissionSteps(role);
  const index = steps.indexOf(step);
  return index >= 0 ? steps[index + 1] ?? 'done' : steps[0];
}

export function savedPermissionStep(value: unknown, role: PermissionRole): PermissionIntroState {
  const steps = permissionSteps(role);
  return value === 'done' || steps.includes(value as PermissionStep) ? value as PermissionIntroState : steps[0];
}
