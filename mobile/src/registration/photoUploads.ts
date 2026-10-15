import type { RegistrationUpload } from './types';

export function uploadedPhoto(upload?: RegistrationUpload): boolean {
  if (!upload || upload.pendingDelete) return false;
  if (upload.previousUpload) return uploadedPhoto(upload.previousUpload);
  return !!(upload.id || upload.remoteUrl) && !['NOT_UPLOADED', 'UPLOADING', 'QUEUED'].includes(upload.status);
}

export function previousPhoto(upload?: RegistrationUpload): RegistrationUpload | undefined {
  return upload?.previousUpload || (uploadedPhoto(upload) ? { ...upload!, previousUpload: undefined } : undefined);
}
