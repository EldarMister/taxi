import React, { useCallback, useMemo, useRef, useState } from 'react';
import { useSharedValue, type SharedValue } from 'react-native-reanimated';

type Layout = {
  height: number;
  ready: boolean;
  animatedInset: SharedValue<number>;
  onHeight: (height: number) => void;
};

/** Each mounted map owns its panel measurements; late layouts belong to their original order. */
export function MapPanelLayout({ session, children }: { session: string; children: (layout: Layout) => React.ReactNode }) {
  const scope = useMemo(() => ({ session }), [session]);
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const [measurement, setMeasurement] = useState({ scope, height: 0 });
  const animatedInset = useSharedValue(0);
  const onHeight = useCallback((height: number) => {
    if (currentScope.current !== scope || !Number.isFinite(height)) return;
    const next = Math.max(0, height);
    setMeasurement(previous => previous.scope === scope && previous.height === next
      ? previous : { scope, height: next });
  }, [scope]);
  const height = measurement.scope === scope ? measurement.height : 0;
  return <>{children({ height, ready: height > 0, animatedInset, onHeight })}</>;
}
