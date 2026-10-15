import React from 'react';
import { Image } from 'expo-image';

/** Original Atlas artwork, copied into this application's own assets. */
export function AtlasLogo({ width = 200 }: { width?: number }) {
  return (
    <Image
      source={require('../../assets/brand/atlas-logo.png')}
      accessibilityLabel="ATLAS"
      contentFit="contain"
      style={{ width, height: width / 3 }}
    />
  );
}
