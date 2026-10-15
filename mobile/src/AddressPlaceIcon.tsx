import React from 'react';
import Svg, { Path } from 'react-native-svg';
import type { AddressPlaceIconName } from './addressSearchPresentation';

/** Compact filled silhouettes, with cut-outs instead of thin outline details. */
export const addressPlaceIconPaths: Record<AddressPlaceIconName, string> = {
  location: 'M12 1.8a9.2 9.2 0 0 0-9.2 9.2c0 5.5 5.9 7.4 7.7 10.3l1.5 2.5 1.5-2.5c1.8-2.9 7.7-4.8 7.7-10.3A9.2 9.2 0 0 0 12 1.8Zm0 5.7a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7Z',
  supermarket: 'M8 2.6a1 1 0 0 1 .8 1.6L5.4 9H3l4.2-6a1 1 0 0 1 .8-.4Zm8 0a1 1 0 0 1 .8.4L21 9h-2.4l-3.4-4.8a1 1 0 0 1 .8-1.6ZM2.5 10h19a1 1 0 0 1 0 2h-19a1 1 0 0 1 0-2Zm1 3.5h17l-2 7a1.8 1.8 0 0 1-1.7 1.3H7.2a1.8 1.8 0 0 1-1.7-1.3l-2-7Zm3.2 1.8.9 4.3h1.5l-.8-4.3H6.7Zm4.6 0v4.3h1.4v-4.3h-1.4Zm4.4 0-.8 4.3h1.5l.9-4.3h-1.6Z',
  hotel: 'M1 5h2v9h18a2 2 0 0 1 2 2v4h-2v-3H3v3H1V5Zm10 8v-2a2 2 0 0 1 2-2h5a3 3 0 0 1 3 3v1H11ZM7 6.3a2.7 2.7 0 1 0 0 5.4 2.7 2.7 0 0 0 0-5.4Z',
  building: 'M6 2h12a1 1 0 0 1 1 1v19h-5v-5h-4v5H5V3a1 1 0 0 1 1-1Zm2 3v2h2V5H8Zm6 0v2h2V5h-2ZM8 9v2h2V9H8Zm6 0v2h2V9h-2ZM8 13v2h2v-2H8Zm6 0v2h2v-2h-2Z',
  shop: 'M5 3h14l3 6v2a2 2 0 0 1-4 0 2 2 0 0 1-4 0 2 2 0 0 1-4 0 2 2 0 0 1-4 0 2 2 0 0 1-4 0V9l3-6Zm.5 10.2A4.1 4.1 0 0 1 3 12.6V21h18v-8.4a4.1 4.1 0 0 1-2.5.6 4 4 0 0 1-2.5-.8 4 4 0 0 1-4 0 4 4 0 0 1-4 0 4 4 0 0 1-2.5.8ZM6 15h5v4H6v-4Zm8 0h4v6h-4v-6Z',
  office: 'M8 3h8a2 2 0 0 1 2 2v2h3a1 1 0 0 1 1 1v5l-9 2v-2h-2v2l-9-2V8a1 1 0 0 1 1-1h3V5a2 2 0 0 1 2-2Zm0 2v2h8V5H8ZM2 15l9 2v1h2v-1l9-2v5a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1v-5Z',
  school: 'M12 2 22 8H2l10-6Zm-8 8h16v12h-6v-6h-4v6H4V10Zm2 2v3h2v-3H6Zm10 0v3h2v-3h-2Zm-5-7v2h2V5h-2Z',
  kindergarten: 'M7 2a3 3 0 0 0-2.7 4.3 7.2 7.2 0 0 0 .9 9.2L3.7 19a2.2 2.2 0 0 0 4 1.8l.8-1.8a8.3 8.3 0 0 0 7 0l.8 1.8a2.2 2.2 0 0 0 4-1.8l-1.5-3.5a7.2 7.2 0 0 0 .9-9.2A3 3 0 0 0 17 2a3 3 0 0 0-2.7 1.7 8 8 0 0 0-4.6 0A3 3 0 0 0 7 2Zm1.2 6.5a1.1 1.1 0 1 1 0 2.2 1.1 1.1 0 0 1 0-2.2Zm7.6 0a1.1 1.1 0 1 1 0 2.2 1.1 1.1 0 0 1 0-2.2ZM12 11c-1.8 0-3 1-3 2.3S10.2 16 12 16s3-1.4 3-2.7-1.2-2.3-3-2.3Z',
  hospital: 'M6 2h12a1 1 0 0 1 1 1v5h3v14h-8v-5h-4v5H2V8h3V3a1 1 0 0 1 1-1Zm5 2v2H9v2h2v2h2V8h2V6h-2V4h-2ZM5 12v2h2v-2H5Zm12 0v2h2v-2h-2ZM5 17v2h2v-2H5Zm12 0v2h2v-2h-2Z',
  stadium: 'M12 4C5.9 4 1 7.6 1 12s4.9 8 11 8 11-3.6 11-8S18.1 4 12 4Zm0 4c-4.4 0-8 1.8-8 4s3.6 4 8 4 8-1.8 8-4-3.6-4-8-4ZM2 3h2v4H2V3Zm18 0h2v4h-2V3ZM6.4 11.2h4.8v1.6H6.4v-1.6Zm6.4 0h4.8v1.6h-4.8v-1.6Z',
  home: 'M12 2 1 11l1.7 2L5 11.1V21h5v-7h4v7h5v-9.9l2.3 1.9 1.7-2L12 2Z',
  pharmacy: 'M9 2h6v7h7v6h-7v7H9v-7H2V9h7V2Z',
  restaurant: 'M3 2h1.5v5h1.3V2h1.4v5h1.3V2H10v7a3 3 0 0 1-2.5 3v10h-2V12A3 3 0 0 1 3 9V2Zm16 0h2v20h-2v-8h-4V8a6 6 0 0 1 4-6Z',
  cafe: 'M3 5h14v1h2a4 4 0 0 1 0 8h-2.6A6.6 6.6 0 0 1 10 18a7 7 0 0 1-7-7V5Zm14 3v4h2a2 2 0 0 0 0-4h-2ZM2 20h18v2H2v-2Z',
  bank: 'M12 2 1 7v2h22V7L12 2ZM3 11h3v8H3v-8Zm7.5 0h3v8h-3v-8Zm7.5 0h3v8h-3v-8ZM1 21h22v2H1v-2Z',
  park: 'M12 2a5 5 0 0 0-4.9 4.1 5.5 5.5 0 0 0-3.4 9.8 5.5 5.5 0 0 0 5.2 1.9L11 16v6h2v-6l2.1 1.8a5.5 5.5 0 0 0 5.2-1.9 5.5 5.5 0 0 0-3.4-9.8A5 5 0 0 0 12 2Z',
  transport: 'M6 2h12a3 3 0 0 1 3 3v14a2 2 0 0 1-2 2v2h-3v-2H8v2H5v-2a2 2 0 0 1-2-2V5a3 3 0 0 1 3-3Zm0 4v7h12V6H6Zm1 10a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Zm10 0a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Z',
};

export function AddressPlaceIcon({ name, size = 25, color = '#555C63' }: {
  name: AddressPlaceIconName; size?: number; color?: string;
}) {
  return <Svg width={size} height={size} viewBox="0 0 24 24" accessible={false}>
    <Path d={addressPlaceIconPaths[name]} fill={color} fillRule="evenodd" clipRule="evenodd" />
  </Svg>;
}
