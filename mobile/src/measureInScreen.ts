import { findNodeHandle, NativeModules, Platform } from 'react-native';

type Measurable = { measureInWindow: (callback: (x: number, y: number, width: number, height: number) => void) => void };
type FrameCallback = (x: number, y: number, width: number, height: number) => void;

// Android keyboard screenY includes the status bar/cutout; legacy RN
// measureInWindow subtracts it. Compare both frames in screen coordinates.
export function measureInScreen(view: Measurable | null, callback: FrameCallback) {
  if (!view) return;
  const measure = NativeModules?.AtlasNumberPicker?.measureOnScreen;
  const tag = Platform.OS === 'android' && measure ? findNodeHandle(view as unknown as Parameters<typeof findNodeHandle>[0]) : null;
  if (tag !== null) {
    measure(tag, (x?: number, y?: number, width?: number, height?: number) => {
      if ([x, y, width, height].every(value => typeof value === 'number' && Number.isFinite(value))) callback(x!, y!, width!, height!);
    });
  } else view.measureInWindow(callback);
}
