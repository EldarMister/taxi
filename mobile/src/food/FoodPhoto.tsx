import React, { memo, useState } from 'react';
import { Image, View, type ImageProps, type LayoutChangeEvent } from 'react-native';
import { foodImage } from './assets';
import { foodPhotoRegion } from './foodPhotography';

type Props = Omit<ImageProps, 'source'> & {
  imageKey?: string | null;
  imageUrl?: string | null;
  fallbackKey?: string | null;
};

/** Locally bundled camera photographs, with optional non-destructive framing. */
export const FoodPhoto = memo(function FoodPhoto({ imageKey, imageUrl, fallbackKey, style, resizeMode = 'cover', onLayout, ...props }: Props) {
  const [size, setSize] = useState({ width: 0, height: 0 });
  const region = !imageUrl?.trim() ? foodPhotoRegion(imageKey, fallbackKey) : undefined;
  // Decode at the card's measured size on Android. Full camera-resolution
  // bitmaps and simultaneous image fades compete with screen transitions.
  if (!region) return <Image resizeMethod="resize" fadeDuration={0} {...props} source={foodImage(imageKey, imageUrl, fallbackKey)} style={style} resizeMode={resizeMode} onLayout={onLayout}/>;
  const { source, atlasWidth, atlasHeight, x, y, width, height } = region;
  const mode = region.fit ?? resizeMode;
  if (x === 0 && y === 0 && width === atlasWidth && height === atlasHeight) {
    return <Image resizeMethod="resize" fadeDuration={0} {...props} source={source} style={style} resizeMode={mode} onLayout={onLayout}/>;
  }
  const scale = size.width && size.height ? (mode === 'contain' ? Math.min : Math.max)(size.width / width, size.height / height) : 0;
  const measure = (event: LayoutChangeEvent) => {
    const { width: nextWidth, height: nextHeight } = event.nativeEvent.layout;
    setSize(current => current.width === nextWidth && current.height === nextHeight ? current : { width: nextWidth, height: nextHeight });
    onLayout?.(event);
  };
  return <View testID={props.testID} style={[style, { overflow: 'hidden' }]} onLayout={measure}>
    {scale > 0 && <View pointerEvents="none" style={{ position: 'absolute', overflow: 'hidden', width: width * scale, height: height * scale, left: (size.width - width * scale) / 2, top: (size.height - height * scale) / 2 }}>
      <Image resizeMethod="resize" {...props} testID={undefined} source={source} resizeMode="stretch" fadeDuration={0} style={{
        position: 'absolute', width: atlasWidth * scale, height: atlasHeight * scale, left: -x * scale, top: -y * scale,
      }}/>
    </View>}
  </View>;
});
