export const getTrackingRecording = () => ({ recording: false, points: 0, fileName: null as string | null, error: null as string | null });
export const startTrackingRecording = () => false;
export const stopTrackingRecording = getTrackingRecording;
export const recordTrackingEvent = (_type: string, _data: unknown) => {};
export const exportTrackingRecording = async (): Promise<string | null> => null;
