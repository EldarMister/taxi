export type RegistrationAttention = {
  status: 'CORRECTION_REQUIRED' | 'REJECTED' | 'BLOCKED';
  hasOperational: boolean;
  message: string;
};

function records(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => !!item && typeof item === 'object' && !Array.isArray(item))
    : [];
}

export function registrationAttentionFromResponse(value: unknown): RegistrationAttention | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const envelope = value as Record<string, unknown>;
  const raw = envelope.application && typeof envelope.application === 'object' && !Array.isArray(envelope.application)
    ? envelope.application
    : envelope;
  const application = raw as Record<string, unknown>;
  const roleStatuses = records(application.roleStatuses);
  const embeddedUploads = application.data && typeof application.data === 'object' && !Array.isArray(application.data)
    ? (application.data as Record<string, unknown>).uploads
    : undefined;
  const uploadStatuses = records(Array.isArray(application.uploads)
    ? application.uploads
    : embeddedUploads && typeof embeddedUploads === 'object' && !Array.isArray(embeddedUploads)
      ? Object.values(embeddedUploads as Record<string, unknown>)
      : []).map(item => String(item.status || ''));
  const aggregateStatus = String(application.status || '');
  const blocked = aggregateStatus === 'BLOCKED'
    || roleStatuses.some(item => item.status === 'BLOCKED')
    || uploadStatuses.includes('BLOCKED');
  const correction = aggregateStatus === 'CORRECTION_REQUIRED'
    || roleStatuses.some(item => item.status === 'CORRECTION_REQUIRED')
    || uploadStatuses.some(status => ['CORRECTION_REQUIRED', 'EXPIRED'].includes(status));
  const rejected = aggregateStatus === 'REJECTED'
    || roleStatuses.some(item => item.status === 'REJECTED')
    || uploadStatuses.includes('REJECTED');
  const status = blocked ? 'BLOCKED' : correction ? 'CORRECTION_REQUIRED' : rejected ? 'REJECTED' : null;
  if (!status) return null;
  const hasOperational = roleStatuses.some(item => item.operational === true);
  const message = status === 'BLOCKED'
    ? 'Одно из направлений временно ограничено'
    : status === 'CORRECTION_REQUIRED'
      ? 'Документы требуют исправления'
      : 'Анкета отклонена — откройте детали';
  return { status, hasOperational, message };
}
