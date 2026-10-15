import type { User } from './types';

// A profile read started before a local save must not overwrite that save.
export function isCurrentProfileResponse(accountId: string, revision: number, currentUser: User | null, currentRevision: number, response: User) {
  return currentUser?.id === accountId && response.id === accountId && revision === currentRevision;
}

// Existing named clients keep their profile; new/unfinished registrations must
// complete their name even after restoring a saved session.
export function needsClientName(user: User, variant: 'client' | 'driver') {
  return variant === 'client' && user.role === 'CLIENT' && !user.name.trim();
}

export function needsDriverRegistration(user: User, variant: 'client' | 'driver', page: string) {
  return variant === 'driver' && user.role === 'DRIVER' && (!user.driverProfile || page === 'registration');
}
