export const subscribeDriverFix = (_listener: unknown) => () => {};
export const setDriverTrackingSession = async (_session: unknown) => {};
export const startDriverBackgroundTracking = async () => false;
export const requestDriverBackgroundAccess = async () => false;
export const reportDriverPosition = async (_fix: unknown) => {};
export const ingestDriverLocation = (_fix: unknown) => null;
export const getDriverTrackingDiagnostics = () => ({ raw: null, processed: null, ageMs: null, trackingSessionId: null, sequence: 0,
  assignmentId: null, protocol: 'legacy', transportStatus: 'idle', lastDropReason: '', diagnosticMode: 'off', recordedFixCount: 0 });
export const startDriverGpsRecording = () => false;
export const stopDriverGpsRecording = () => [];
export const freezeDriverGps = () => false;
export const replayDriverGps = (_trace: unknown[]) => false;
export const stopDriverGpsDiagnostic = () => {};
