const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

// Keep this patch tied to the exact installed native implementation. An SDK
// upgrade must be reviewed rather than silently reusing old native assumptions.
const SDK_VERSION = '10.4.2';
const JAVA_ROOT = 'android/src/main/java/org/maplibre/reactnative';
const annotationFieldsBefore = `    private String mChildBitmapId;
`;
const annotationFieldsAfter = `    private String mChildBitmapId;

    // Atlas stable PointAnnotation: crop hit bounds without moving the ground.
    private int mChildBitmapOriginalWidth;
    private int mChildBitmapOriginalHeight;
    private int mChildBitmapCropLeft;
    private int mChildBitmapCropTop;
    private int mChildBitmapRevision;
`;
const refreshBefore = `    private void refreshBitmap(View v, int left, int top, int right, int bottom) {
        Bitmap bitmap = BitmapUtils.viewToBitmap(v, left, top, right, bottom);
        String bitmapId = Integer.toString(v.getId());
        addBitmapToStyle(bitmap, bitmapId);
        if (v instanceof MLRNCallout) {
            mCalloutBitmap = bitmap;
            mCalloutBitmapId = bitmapId;
        } else {
            if (bitmap != null) {
                mChildBitmap = bitmap;
                mChildBitmapId = bitmapId;
                updateOptions();
            }
        }
    }`;
const refreshAfter = `    private void refreshBitmap(View v, int left, int top, int right, int bottom) {
        Bitmap bitmap = BitmapUtils.viewToBitmap(v, left, top, right, bottom);
        final String bitmapId = Integer.toString(v.getId());
        if (v instanceof MLRNCallout) {
            addBitmapToStyle(bitmap, bitmapId);
            mCalloutBitmap = bitmap;
            mCalloutBitmapId = bitmapId;
            return;
        }
        if (bitmap == null) {
            return;
        }

        final int originalWidth = bitmap.getWidth();
        final int originalHeight = bitmap.getHeight();
        int[] pixels = new int[originalWidth * originalHeight];
        bitmap.getPixels(pixels, 0, originalWidth, 0, 0, originalWidth, originalHeight);
        final int[] bounds = atlasVisibleBounds(pixels, originalWidth, originalHeight);
        final Bitmap cropped = Bitmap.createBitmap(bitmap, bounds[0], bounds[1],
            bounds[2] - bounds[0], bounds[3] - bounds[1]);
        cropped.setDensity(bitmap.getDensity());
        final int revision = ++mChildBitmapRevision;

        if (mMap == null) {
            applyChildBitmap(cropped, bitmapId, originalWidth, originalHeight, bounds[0], bounds[1]);
        } else {
            mMap.getStyle(new Style.OnStyleLoaded() {
                @Override
                public void onStyleLoaded(@NonNull Style style) {
                    if (revision != mChildBitmapRevision) {
                        return;
                    }
                    // Replace image and its compensated anchor in one UI task.
                    style.addImage(bitmapId, cropped);
                    applyChildBitmap(cropped, bitmapId, originalWidth, originalHeight, bounds[0], bounds[1]);
                }
            });
        }
    }

    private void applyChildBitmap(Bitmap bitmap, String bitmapId, int originalWidth,
            int originalHeight, int cropLeft, int cropTop) {
        mChildBitmap = bitmap;
        mChildBitmapId = bitmapId;
        mChildBitmapOriginalWidth = originalWidth;
        mChildBitmapOriginalHeight = originalHeight;
        mChildBitmapCropLeft = cropLeft;
        mChildBitmapCropTop = cropTop;
        updateOptions();
    }

    // These pure pixel helpers are exercised by the patch's Java regression test.
    private static int[] atlasVisibleBounds(int[] pixels, int width, int height) {
        int left = width, top = height, right = -1, bottom = -1;
        for (int y = 0; y < height; y++) {
            for (int x = 0; x < width; x++) {
                if ((pixels[y * width + x] >>> 24) != 0) {
                    left = Math.min(left, x);
                    top = Math.min(top, y);
                    right = Math.max(right, x);
                    bottom = Math.max(bottom, y);
                }
            }
        }
        // A not-yet-drawn child must not leave a large invisible touch target.
        return right < 0 ? new int[]{0, 0, 1, 1}
            : new int[]{left, top, right + 1, bottom + 1};
    }

    private static float[] atlasAnchorOffset(int originalWidth, int originalHeight,
            int cropLeft, int cropTop, float anchorX, float anchorY, float density) {
        return new float[]{(cropLeft - originalWidth * anchorX) / density,
            (cropTop - originalHeight * anchorY) / density};
    }`;
const anchorBefore = `            int w = mChildBitmap.getWidth();
            int h = mChildBitmap.getHeight();
            final float scale = getResources().getDisplayMetrics().density;
            w = (int) (w / scale);
            h = (int) (h / scale);
            mAnnotation.setIconAnchor("top-left");
            mAnnotation.setIconOffset(new PointF(w * mAnchor[0] * -1, h * mAnchor[1] * -1));`;
const anchorAfter = `            final float density = getResources().getDisplayMetrics().density;
            float[] offset = atlasAnchorOffset(mChildBitmapOriginalWidth, mChildBitmapOriginalHeight,
                mChildBitmapCropLeft, mChildBitmapCropTop, mAnchor[0], mAnchor[1], density);
            mAnnotation.setIconAnchor("top-left");
            mAnnotation.setIconOffset(new PointF(offset[0], offset[1]));`;
const removeBefore = `    public void removeView(View childView) {
        if (mChildView != null) {`;
const removeAfter = `    public void removeView(View childView) {
        ++mChildBitmapRevision;
        if (mChildView != null) {`;
const clickBefore = `        if (activeAnnotation != null) {
            deselectAnnotation(activeAnnotation);
        }

        if (nextActiveAnnotation != null) {
            selectAnnotation(nextActiveAnnotation);
        }`;
const clickAfter = `        // Atlas stable PointAnnotation: a focused bubble remains tappable.
        if (activeAnnotation != null && selectedMarkerID == mActiveMarkerID) {
            activeAnnotation.onSelect(true);
            return;
        }
        if (activeAnnotation != null) {
            deselectAnnotation(activeAnnotation);
        }

        if (nextActiveAnnotation != null) {
            selectAnnotation(nextActiveAnnotation);
        }`;
const containerBefore = `            mOffscreenAnnotationViewContainer = new FrameLayout(getContext());`;
const containerAfter = `            mOffscreenAnnotationViewContainer = new FrameLayout(getContext()) {
                @Override
                protected void onMeasure(int widthMeasureSpec, int heightMeasureSpec) {
                    // React Native owns each child's Yoga measurement. A normal
                    // zero-size FrameLayout remeasures those bitmap roots to 0x0.
                    setMeasuredDimension(0, 0);
                }

                @Override
                protected void onLayout(boolean changed, int left, int top, int right, int bottom) {
                    // Preserve RN child bounds while keeping them attached for
                    // Fresco/callout content. The host itself stays offscreen 0x0.
                }
            };`;
const topLayerBefore = `            addBitmapToStyle(mCalloutBitmap, mCalloutBitmapId);
        }
    }

    @Override
    public void removeFromMap(MLRNMapView mapView) {`;
const topLayerAfter = `            addBitmapToStyle(mCalloutBitmap, mCalloutBitmapId);
        }
        // RN route layers are mounted after SymbolManager is created. Raise its
        // shared annotation layer once on attachment, not on camera/bitmap ticks.
        mMap.getStyle(new Style.OnStyleLoaded() {
            @Override
            public void onStyleLoaded(@NonNull Style style) {
                SymbolManager manager = mapView.getSymbolManager();
                if (manager != null) {
                    atlasBringAnnotationLayerToFront(style, manager.getLayerId());
                }
            }
        });
    }

    public static void atlasBringAnnotationLayerToFront(Style style, String layerId) {
        org.maplibre.android.style.layers.Layer layer = style.getLayer(layerId);
        java.util.List<org.maplibre.android.style.layers.Layer> layers = style.getLayers();
        if (layer == null || layers.isEmpty()
                || layerId.equals(layers.get(layers.size() - 1).getId())) {
            return;
        }
        // Removing by object preserves its native layer for reinsertion.
        if (style.removeLayer(layer)) {
            style.addLayer(layer);
        }
    }

    @Override
    public void removeFromMap(MLRNMapView mapView) {`;
const layerAddedBefore = `        layerWaiters.remove(layerId);
    }`;
const layerAddedAfter = `        layerWaiters.remove(layerId);
        // A later order can remount RN driver/route layers while its endpoint
        // annotations stay mounted. Keep their stems/shadows above those layers.
        // This is a layer-creation event, never a camera or coordinate update.
        if (symbolManager != null && !mPointAnnotations.isEmpty() && mMap != null) {
            Style style = mMap.getStyle();
            if (style != null) {
                MLRNPointAnnotation.atlasBringAnnotationLayerToFront(style, symbolManager.getLayerId());
            }
        }
    }`;

const PATCHES = [
  { file: `${JAVA_ROOT}/components/annotation/MLRNPointAnnotation.java`,
    hash: '2784785d67aa8928d1112ad66ecce09229253b3553d955e189e58524876c7c3c',
    previousHashes: ['e94e7e00243dbb8e86657d9e9ef89b11df042a7acb8ecee3a144c6edfa170b3e'],
    migrations: [{ hash: 'eb7dc29eabf7d60fd724261f032c648252519a4df31532d9ff6890973612c418', replacements: [['private static void atlasBringAnnotationLayerToFront', 'public static void atlasBringAnnotationLayerToFront']] }],
    replacements: [[annotationFieldsBefore, annotationFieldsAfter], [refreshBefore, refreshAfter], [anchorBefore, anchorAfter], [removeBefore, removeAfter], [topLayerBefore, topLayerAfter]] },
  { file: `${JAVA_ROOT}/components/mapview/MLRNMapView.java`,
    hash: '93c49acc60fb276caf8a67594aab355e7897ed28147892e06bf81135f78118cb',
    previousHashes: ['3536b76f509471144891977cb856b21646f336e4e75872eafef34c4b2f01641d', 'f06567139c325e7e7838cb503c653ff79d0a851a9eef2c0538c03ceaf2e3c973'],
    replacements: [[clickBefore, clickAfter], [containerBefore, containerAfter], [layerAddedBefore, layerAddedAfter]] },
];
const normalise = source => source.replace(/\r\n/g, '\n');
const sha = source => crypto.createHash('sha256').update(source).digest('hex');
function replaceOnce(source, before, after, filename) {
  if (!source.includes(before) || source.indexOf(before) !== source.lastIndexOf(before)) {
    throw Error(`MapLibre ${filename}: expected exactly one guarded source block; review the native patch`);
  }
  return source.replace(before, after);
}
function patchSource(source, patch) {
  source = normalise(source);
  const migration = patch.migrations?.find(version => version.hash === sha(source));
  if (migration) return patchSource(migration.replacements.reduce((text, [before, after]) => replaceOnce(text, before, after, patch.file), source), patch);
  if (patch.previousHashes?.includes(sha(source))) {
    // Upgrade only the exact earlier reviewed Atlas patch, never arbitrary edits.
    let original = source;
    for (const [before, after] of [...patch.replacements].reverse()) {
      if (original.includes(after)) original = replaceOnce(original, after, before, patch.file);
    }
    if (sha(original) !== patch.hash) throw Error(`MapLibre ${patch.file}: previous patch source changed unexpectedly`);
    return patchSource(original, patch);
  }
  if (source.includes('// Atlas stable PointAnnotation:')) {
    let original = source;
    for (const [before, after] of [...patch.replacements].reverse()) original = replaceOnce(original, after, before, patch.file);
    if (sha(original) !== patch.hash) throw Error(`MapLibre ${patch.file}: already-patched source changed unexpectedly`);
    return source;
  }
  if (sha(source) !== patch.hash) throw Error(`MapLibre ${patch.file}: source differs from reviewed SDK ${SDK_VERSION}; review the native patch`);
  return patch.replacements.reduce((text, [before, after]) => replaceOnce(text, before, after, patch.file), source);
}
function patchSdk(sdkRoot = path.resolve(__dirname, '../node_modules/@maplibre/maplibre-react-native')) {
  const version = JSON.parse(fs.readFileSync(path.join(sdkRoot, 'package.json'), 'utf8')).version;
  if (version !== SDK_VERSION) throw Error(`MapLibre native patch requires ${SDK_VERSION}, found ${version}`);
  // Validate every file first so an unexpected SDK cannot be half-patched.
  const edits = PATCHES.map(patch => {
    const filename = path.join(sdkRoot, patch.file);
    const original = fs.readFileSync(filename, 'utf8');
    const patched = patchSource(original, patch);
    return { filename, original, patched: original.includes('\r\n') ? patched.replace(/\n/g, '\r\n') : patched };
  });
  for (const edit of edits) if (edit.original !== edit.patched) fs.writeFileSync(edit.filename, edit.patched);
  return edits.filter(edit => edit.original !== edit.patched).length;
}
module.exports = { SDK_VERSION, PATCHES, patchSource, patchSdk };
if (require.main === module) console.log(`MapLibre ${SDK_VERSION}: ${patchSdk()} native files patched (stable bitmap bounds and repeated selection).`);
