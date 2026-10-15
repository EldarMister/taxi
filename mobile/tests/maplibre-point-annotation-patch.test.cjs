const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');
const { PATCHES, SDK_VERSION, patchSource, patchSdk } = require('../scripts/patch-maplibre-point-annotations.cjs');

const liveSdk = path.join(__dirname, '../node_modules/@maplibre/maplibre-react-native');
const sources = PATCHES.map(patch => {
  let source = fs.readFileSync(path.join(liveSdk, patch.file), 'utf8').replace(/\r\n/g, '\n');
  if (source.includes('// Atlas stable PointAnnotation:')) for (const [before, after] of [...patch.replacements].reverse()) source = source.replace(after, before);
  return source;
});
function fixture(t, eol = '\n') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-maplibre-patch-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ version: SDK_VERSION }));
  PATCHES.forEach((patch, index) => {
    const filename = path.join(root, patch.file);
    fs.mkdirSync(path.dirname(filename), { recursive: true });
    fs.writeFileSync(filename, sources[index].replace(/\n/g, eol));
  });
  return root;
}

test('fresh SDK patch is idempotent, preserves CRLF and is wired into npm install', t => {
  const root = fixture(t, '\r\n');
  assert.equal(patchSdk(root), 2);
  const first = PATCHES.map(patch => fs.readFileSync(path.join(root, patch.file), 'utf8'));
  assert.ok(first.every(source => source.includes('\r\n') && !source.replace(/\r\n/g, '').includes('\n')));
  assert.equal(patchSdk(root), 0);
  PATCHES.forEach((patch, index) => assert.equal(fs.readFileSync(path.join(root, patch.file), 'utf8'), first[index]));
  assert.equal(require('../package.json').scripts.postinstall, 'node scripts/patch-maplibre-point-annotations.cjs');
  assert.equal(require('../package-lock.json').packages[''].hasInstallScript, true);
  const [oldBefore, oldAfter] = PATCHES[1].replacements[0];
  const oldReviewedPatch = sources[1].replace(oldBefore, oldAfter);
  assert.equal(patchSource(oldReviewedPatch, PATCHES[1]), patchSource(sources[1], PATCHES[1]), 'the exact previous patch upgrades to the guarded layout fix');
  const oldAnnotationPatch = PATCHES[0].replacements.slice(0, -1).reduce((source, [before, after]) => source.replace(before, after), sources[0]);
  assert.equal(patchSource(oldAnnotationPatch, PATCHES[0]), patchSource(sources[0], PATCHES[0]), 'the reviewed crop patch upgrades to one-time layer raising');
  const privateHelperPatch = patchSource(sources[0], PATCHES[0]).replace('public static void atlasBringAnnotationLayerToFront', 'private static void atlasBringAnnotationLayerToFront');
  assert.equal(patchSource(privateHelperPatch, PATCHES[0]), patchSource(sources[0], PATCHES[0]));
  const priorLayerPatch = PATCHES[1].migrations[0].replacements.reduce((source, [patched, original]) => source.replace(original, patched), sources[1]);
  assert.equal(patchSource(priorLayerPatch, PATCHES[1]), patchSource(sources[1], PATCHES[1]), 'the previous layer patch migrates safely to cached IDs during theme reload');
  const oldLayoutPatch = PATCHES[1].replacements.slice(0, 2).reduce((source, [before, after]) => source.replace(before, after), sources[1]);
  assert.equal(patchSource(oldLayoutPatch, PATCHES[1]), patchSource(sources[1], PATCHES[1]), 'the previous layout patch upgrades to new-order layer events');
});

test('unexpected SDK versions or native edits fail before writing either file', t => {
  const root = fixture(t);
  const files = PATCHES.map(patch => path.join(root, patch.file));
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ version: '10.4.3' }));
  assert.throws(() => patchSdk(root), /requires 10\.4\.2/);
  assert.equal(fs.readFileSync(files[0], 'utf8'), sources[0]);
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ version: SDK_VERSION }));
  fs.appendFileSync(files[1], '\n// An unexpected native change.\n');
  assert.throws(() => patchSdk(root), /source differs from reviewed SDK/);
  assert.equal(fs.readFileSync(files[0], 'utf8'), sources[0], 'validation cannot leave a half-patched SDK');
  const patched = patchSource(sources[0], PATCHES[0]);
  assert.throws(() => patchSource(patched + '\n// Changed after installation.\n', PATCHES[0]), /changed unexpectedly/);
  const partial = sources[0].replace(PATCHES[0].replacements[0][0], PATCHES[0].replacements[0][1]);
  assert.throws(() => patchSource(partial, PATCHES[0]), /guarded source block/);
});

function method(source, signature) {
  const start = source.indexOf(signature);
  assert.ok(start >= 0, signature);
  const open = source.indexOf('{', start);
  let depth = 1, end = open + 1;
  while (depth && end < source.length) {
    if (source[end] === '{') depth++;
    else if (source[end] === '}') depth--;
    end++;
  }
  assert.equal(depth, 0);
  return source.slice(start, end);
}

test('actual patched Java crop/anchor and repeated-click methods preserve position and interaction', t => {
  const javac = spawnSync('javac', ['-version'], { encoding: 'utf8', windowsHide: true });
  if (javac.error?.code === 'ENOENT') return t.skip('Java compiler is unavailable; Android build still compiles these methods');
  assert.equal(javac.status, 0, javac.stderr);
  const root = fixture(t);
  patchSdk(root);
  const annotation = fs.readFileSync(path.join(root, PATCHES[0].file), 'utf8');
  const map = fs.readFileSync(path.join(root, PATCHES[1].file), 'utf8');
  assert.match(method(annotation, 'public void addToMap'), /atlasBringAnnotationLayerToFront/);
  assert.match(method(map, 'public void createSymbolManager'), /atlasAnnotationLayerId = symbolManager.getLayerId\(\)/);
  assert.doesNotMatch(method(map, 'public void layerAdded'), /symbolManager.getLayerId\(\)/);
  for (const signature of ['public void setCoordinate', 'private void updateOptions', 'private void refreshBitmap(View v, int left']) {
    assert.doesNotMatch(method(annotation, signature), /atlasBringAnnotationLayerToFront/, `layer raising must not run for ${signature}`);
  }
  const code = `import java.util.*;
public class AtlasPointAnnotationRegression {
  ${method(annotation, 'private static int[] atlasVisibleBounds')}
  ${method(annotation, 'private static float[] atlasAnchorOffset')}
  ${method(annotation, 'public static void atlasBringAnnotationLayerToFront').replaceAll('org.maplibre.android.style.layers.Layer', 'Layer')}
  static class Layer {
    String id; Layer(String id) { this.id = id; } String getId() { return id; }
  }
  static class Style {
    List<Layer> layers = new ArrayList<>(); int removes, adds; boolean allowRemove = true;
    Layer getLayer(String id) { for (Layer layer : layers) if (layer.id.equals(id)) return layer; return null; }
    List<Layer> getLayers() { return layers; }
    boolean removeLayer(Layer layer) { if (!allowRemove) return false; removes++; return layers.remove(layer); }
    void addLayer(Layer layer) { adds++; layers.add(layer); }
  }
  static class NativeMap {
    Style style; NativeMap(Style style) { this.style = style; } Style getStyle() { return style; }
  }
  static class SymbolManager { String getLayerId() { throw new Error("disposed native Layer handle"); } }
  interface FoundLayerCallback { void found(Layer layer); }
  NativeMap mMap; SymbolManager symbolManager; String atlasAnnotationLayerId = "annotation";
  Map<String, List<FoundLayerCallback>> layerWaiters = new HashMap<>();
  ${method(map, 'public void layerAdded')}
  boolean mAnnotationClicked;
  long mActiveMarkerID = -1;
  ViewGroup mOffscreenAnnotationViewContainer;
  Map<String, MLRNPointAnnotation> mPointAnnotations = new LinkedHashMap<>();
  static class ViewGroup {
    int width, height, measureCalls, layoutCalls; boolean attached;
    List<ViewGroup> children = new ArrayList<>();
    void addView(ViewGroup child) { children.add(child); child.attached = attached; }
    void setLayoutParams(Object params) {}
    void setMeasuredDimension(int width, int height) { this.width = width; this.height = height; }
    protected void onMeasure(int widthSpec, int heightSpec) {
      measureCalls++; setMeasuredDimension(0, 0);
      for (ViewGroup child : children) child.setMeasuredDimension(0, 0);
    }
    protected void onLayout(boolean changed, int left, int top, int right, int bottom) {
      layoutCalls++;
      for (ViewGroup child : children) child.setMeasuredDimension(0, 0);
    }
  }
  static class FrameLayout extends ViewGroup {
    FrameLayout(Object context) {}
    static class LayoutParams {
      LayoutParams(int width, int height) {}
      void setMargins(int left, int top, int right, int bottom) {}
    }
  }
  Object getContext() { return this; }
  void addView(ViewGroup view) { view.attached = true; }
  ${method(map, 'public ViewGroup offscreenAnnotationViewContainer')}
  static class Symbol {
    long id; Symbol(long id) { this.id = id; } long getId() { return id; }
  }
  static class MLRNPointAnnotation {
    long id; int selected = 0, deselected = 0;
    MLRNPointAnnotation(long id) { this.id = id; }
    long getMapboxID() { return id; }
    void onSelect(boolean send) { check(send, "selection must reach JS"); selected++; }
    void onDeselect() { deselected++; }
    static void atlasBringAnnotationLayerToFront(Style style, String layerId) { AtlasPointAnnotationRegression.atlasBringAnnotationLayerToFront(style, layerId); }
  }
  void selectAnnotation(MLRNPointAnnotation annotation) { mActiveMarkerID = annotation.id; annotation.onSelect(true); }
  void deselectAnnotation(MLRNPointAnnotation annotation) { mActiveMarkerID = -1; annotation.onDeselect(); }
  ${method(map, 'public void onMarkerClick').replace('@NonNull ', '')}
  static void check(boolean value, String message) { if (!value) throw new AssertionError(message); }
  static void near(float actual, float expected) { check(Math.abs(actual - expected) < .0001f, actual + " != " + expected); }
  static void boundsEqual(int[] actual, int... expected) { check(Arrays.equals(actual, expected), Arrays.toString(actual)); }
  static void paint(int[] pixels, int width, int left, int top, int right, int bottom, int color) {
    for (int y = top; y < bottom; y++) for (int x = left; x < right; x++) pixels[y * width + x] = color;
  }
  public static void main(String[] args) {
    boundsEqual(atlasVisibleBounds(new int[12], 4, 3), 0, 0, 1, 1);
    int[] faint = new int[12]; faint[11] = 0x01000000;
    boundsEqual(atlasVisibleBounds(faint, 4, 3), 3, 2, 4, 3);
    int[] opaque = new int[12]; Arrays.fill(opaque, 0xFF087FFF);
    boundsEqual(atlasVisibleBounds(opaque, 4, 3), 0, 0, 4, 3);
    for (float density : new float[]{1f, 1.5f, 2f, 2.625f, 3.5f}) {
      int width = Math.round(260 * density), height = Math.round(112 * density);
      for (int bodyRightDp : new int[]{60, 206, 252}) {
        int[] pixels = new int[width * height];
        int left = Math.round(8 * density), top = Math.round(30 * density);
        int right = Math.round(bodyRightDp * density), bottom = Math.round(110 * density);
        paint(pixels, width, left, top, right, Math.round(82 * density), 0xFF087FFF);
        paint(pixels, width, Math.round(32 * density), top, Math.round(36 * density), bottom, 0xFF101D38);
        int[] crop = atlasVisibleBounds(pixels, width, height);
        boundsEqual(crop, left, top, right, bottom);
        float anchorX = 34f / 260f, anchorY = 104f / 112f;
        float[] offset = atlasAnchorOffset(width, height, crop[0], crop[1], anchorX, anchorY, density);
        // The original ground pixel in the cropped icon must remain at geo(0,0).
        near(offset[0] * density + width * anchorX - crop[0], 0f);
        near(offset[1] * density + height * anchorY - crop[1], 0f);
        if (bodyRightDp == 60) check(crop[2] - crop[0] < width / 3, "compact transparent canvas remains clickable");
      }
    }
    AtlasPointAnnotationRegression map = new AtlasPointAnnotationRegression();
    ViewGroup offscreen = map.offscreenAnnotationViewContainer();
    ViewGroup endpoint = new ViewGroup(); endpoint.width = 455; endpoint.height = 196;
    ViewGroup callout = new ViewGroup(); callout.width = 280; callout.height = 90;
    offscreen.addView(endpoint); offscreen.addView(callout);
    offscreen.onMeasure(0, 0); offscreen.onLayout(true, 0, 0, 0, 0);
    check(offscreen.width == 0 && offscreen.height == 0, "offscreen host must remain 0x0");
    check(endpoint.width == 455 && endpoint.height == 196, "FrameLayout erased endpoint Yoga bounds");
    check(callout.width == 280 && callout.height == 90, "FrameLayout erased callout Yoga bounds");
    check(endpoint.attached && callout.attached, "Fresco/callout children must stay attached");
    check(offscreen == map.offscreenAnnotationViewContainer(), "keep one attached host");
    check(offscreen.measureCalls == 0 && offscreen.layoutCalls == 0, "do not invoke parent child-layout machinery");
    Style style = new Style();
    Layer background = new Layer("background"), endpointLayer = new Layer("annotation"), routeHalo = new Layer("route-halo"), route = new Layer("route");
    style.layers.addAll(Arrays.asList(background, endpointLayer, routeHalo, route));
    atlasBringAnnotationLayerToFront(style, "annotation");
    check(style.layers.equals(Arrays.asList(background, routeHalo, route, endpointLayer)), "route must not cover endpoint stem/shadow");
    check(style.layers.get(3) == endpointLayer, "preserve exact native layer object and its properties");
    atlasBringAnnotationLayerToFront(style, "annotation");
    atlasBringAnnotationLayerToFront(style, "missing");
    check(style.removes == 1 && style.adds == 1, "second endpoint attachment must not reorder an already-top layer");
    style.layers.add(new Layer("later-layer")); style.allowRemove = false;
    atlasBringAnnotationLayerToFront(style, "annotation");
    check(style.adds == 1 && style.layers.size() == 5, "failed native removal must not duplicate a layer");
    style.allowRemove = true;
    map.mMap = new NativeMap(style); map.symbolManager = new SymbolManager();
    map.mPointAnnotations.put("pickup", new MLRNPointAnnotation(0));
    Layer newOrderDriver = new Layer("next-order-driver"); style.layers.add(newOrderDriver);
    map.layerAdded(newOrderDriver);
    check(style.layers.get(style.layers.size() - 1) == endpointLayer && style.adds == 2, "new-order driver remount must raise the existing endpoints once");
    map.layerAdded(newOrderDriver);
    check(style.adds == 2, "an already-top endpoint layer must not be reinserted again");
    Layer newRoute = new Layer("next-order-route"); style.layers.add(style.layers.indexOf(newOrderDriver), newRoute);
    map.layerAdded(newRoute);
    check(style.adds == 2 && style.layers.get(style.layers.size() - 1) == endpointLayer, "route inserted below driver cannot cover endpoint ground");
    Style replacementStyle = new Style(); replacementStyle.layers.add(new Layer("replacement-background"));
    map.mMap = new NativeMap(replacementStyle);
    map.layerAdded(replacementStyle.layers.get(0));
    check(replacementStyle.removes == 0, "theme reload must not touch a disposed SymbolManager native layer");
    map.mMap = new NativeMap(style);
    map.mPointAnnotations.clear();
    MLRNPointAnnotation pickup = new MLRNPointAnnotation(1), dropoff = new MLRNPointAnnotation(2);
    map.mPointAnnotations.put("pickup", pickup); map.mPointAnnotations.put("dropoff", dropoff);
    map.onMarkerClick(new Symbol(1));
    check(pickup.selected == 1 && map.mActiveMarkerID == 1, "first tap focuses pickup");
    map.onMarkerClick(new Symbol(1));
    check(pickup.selected == 2 && pickup.deselected == 0 && map.mActiveMarkerID == 1, "second focused tap edits");
    map.onMarkerClick(new Symbol(2));
    check(pickup.deselected == 1 && dropoff.selected == 1 && map.mActiveMarkerID == 2, "switching endpoints still deselects old pin");
    map.onMarkerClick(new Symbol(2));
    check(dropoff.selected == 2 && dropoff.deselected == 0 && map.mActiveMarkerID == 2, "dropoff focused bubble remains tappable");
    System.out.println("crop, fractional-density anchors and repeated selection passed");
  }
}`;
  fs.writeFileSync(path.join(root, 'AtlasPointAnnotationRegression.java'), code);
  const compile = spawnSync('javac', ['AtlasPointAnnotationRegression.java'], { cwd: root, encoding: 'utf8', windowsHide: true, timeout: 60000 });
  assert.equal(compile.status, 0, compile.error?.message || compile.stderr);
  const run = spawnSync('java', ['-cp', root, 'AtlasPointAnnotationRegression'], { encoding: 'utf8', windowsHide: true, timeout: 15000 });
  assert.equal(run.status, 0, run.error?.message || run.stderr);
  assert.match(run.stdout, /fractional-density anchors and repeated selection passed/);
});
