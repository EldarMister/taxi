export const subscribeDriverFix = (_listener: unknown) => () => {};
export const setDriverTrackingSession = async (_session: unknown) => {};
export const startDriverBackgroundTracking = async () => false;
export const requestDriverBackgroundAccess = async () => false;
export const reportDriverPosition = async (_fix: unknown) => {};
export const ingestDriverLocation = (_fix: unknown) => null;
export const getDriverTrackingDiagnostics = () => ({ raw: null, processed: null, ageMs: null, trackingSessionId: null, sequence: 0, transportStatus: 'idle', lastDropReason: '' });
