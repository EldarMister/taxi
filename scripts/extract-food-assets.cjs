/**
 * Lossless crops of the food reference PNGs supplied in designe/еда.
 * Sources are never modified. No generated or substitute imagery is used.
 * Run: node scripts/extract-food-assets.cjs
 * Uses the Windows System.Drawing runtime already available on this project host.
 */
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const projectRoot = path.resolve(__dirname, '..');
const sourceRoot = path.join(projectRoot, 'designe', 'еда');
const outputRoot = path.join(projectRoot, 'mobile', 'assets', 'food');

const crops = [
  ['homepage-car', 'главный экран', 129, 559, 332, 287],
  ['homepage-burger', 'главный экран', 480, 559, 334, 287],
  ['home-promo', 'главный экран', 129, 1072, 685, 446],
  ['restaurant-sushi', 'каталог доступных ресторанов', 117, 501, 252, 244],
  ['restaurant-kfc', 'каталог доступных ресторанов', 117, 792, 252, 242],
  ['restaurant-halva', 'каталог доступных ресторанов', 117, 1079, 252, 235],
  ['restaurant-burger', 'каталог доступных ресторанов', 117, 1357, 252, 234],
  ['sushi-hero', 'каталог кафешки', 88, 199, 764, 222],
  ['philadelphia', 'каталог кафешки', 128, 801, 181, 170],
  ['california', 'каталог кафешки', 128, 1012, 181, 173],
  ['tempura', 'каталог кафешки', 128, 1226, 181, 172],
  ['salmon', 'каталог кафешки', 128, 1440, 181, 169],
  ['philadelphia-hero', 'подробная карточка блюда', 102, 270, 736, 351],
  ['philadelphia-cart', 'корзина', 114, 269, 174, 167],
  ['california-cart', 'корзина', 114, 492, 174, 170],
  ['soy', 'корзина', 114, 709, 174, 164],
  ['ginger', 'корзина', 114, 897, 174, 165],
  ['restaurant-order', 'заказ отправлен', 110, 1214, 165, 165],
  // Inspection-only crops: these contain the reference's drawn status/nav icons.
  ['sushi-hero-reference', 'каталог кафешки', 88, 7, 764, 414],
  ['philadelphia-hero-reference', 'подробная карточка блюда', 102, 86, 736, 535],
];

fs.mkdirSync(outputRoot, { recursive: true });
const manifest = crops.map(([name, source, x, y, width, height]) => ({
  name,
  source: path.join(sourceRoot, `${source}.png`),
  destination: path.join(outputRoot, `${name}.png`),
  x, y, width, height,
}));
const encodedManifest = Buffer.from(JSON.stringify(manifest), 'utf8').toString('base64');
const encodedOutputRoot = Buffer.from(outputRoot, 'utf8').toString('base64');
const powershell = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$foodManifest = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encodedManifest}')) | ConvertFrom-Json
$foodOutputRoot = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encodedOutputRoot}'))
foreach ($foodCrop in $foodManifest) {
  $foodSource = [Drawing.Bitmap]::FromFile($foodCrop.source)
  try {
    $foodRect = New-Object Drawing.Rectangle($foodCrop.x, $foodCrop.y, $foodCrop.width, $foodCrop.height)
    $foodBitmap = $foodSource.Clone($foodRect, [Drawing.Imaging.PixelFormat]::Format32bppArgb)
    try { $foodBitmap.Save($foodCrop.destination, [Drawing.Imaging.ImageFormat]::Png) }
    finally { $foodBitmap.Dispose() }
  }
  finally { $foodSource.Dispose() }
}
$foodColumns = 4
$foodCellWidth = 300
$foodCellHeight = 235
$foodRows = [Math]::Ceiling($foodManifest.Count / $foodColumns)
$foodSheet = New-Object Drawing.Bitmap(($foodColumns * $foodCellWidth), ($foodRows * $foodCellHeight))
$foodGraphics = [Drawing.Graphics]::FromImage($foodSheet)
$foodFont = New-Object Drawing.Font('Arial', 12)
try {
  $foodGraphics.Clear([Drawing.Color]::FromArgb(245, 245, 245))
  $foodGraphics.InterpolationMode = [Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  for ($foodIndex = 0; $foodIndex -lt $foodManifest.Count; $foodIndex++) {
    $foodCrop = $foodManifest[$foodIndex]
    $foodThumb = [Drawing.Image]::FromFile($foodCrop.destination)
    try {
      $foodScale = [Math]::Min(280 / $foodThumb.Width, 192 / $foodThumb.Height)
      $foodWidth = [int]($foodThumb.Width * $foodScale)
      $foodHeight = [int]($foodThumb.Height * $foodScale)
      $foodLeft = ($foodIndex % $foodColumns) * $foodCellWidth
      $foodTop = [Math]::Floor($foodIndex / $foodColumns) * $foodCellHeight
      $foodGraphics.DrawImage($foodThumb, [int]($foodLeft + (300 - $foodWidth) / 2), [int]($foodTop + 8), $foodWidth, $foodHeight)
      $foodGraphics.DrawString($foodCrop.name, $foodFont, [Drawing.Brushes]::Black, [single]($foodLeft + 10), [single]($foodTop + 204))
    }
    finally { $foodThumb.Dispose() }
  }
  $foodSheet.Save((Join-Path $foodOutputRoot 'contact-sheet.png'), [Drawing.Imaging.ImageFormat]::Png)
}
finally { $foodFont.Dispose(); $foodGraphics.Dispose(); $foodSheet.Dispose() }
`;
execFileSync('powershell.exe', [
  '-NoProfile', '-NonInteractive', '-EncodedCommand',
  Buffer.from(powershell, 'utf16le').toString('base64'),
], { stdio: 'inherit', windowsHide: true });

fs.writeFileSync(path.join(outputRoot, 'sources.json'), JSON.stringify(manifest.map(item => ({
  file: `${item.name}.png`,
  source: path.relative(projectRoot, item.source).split(path.sep).join('/'),
  crop: { x: item.x, y: item.y, width: item.width, height: item.height },
})), null, 2) + '\n');
console.log(`Extracted ${manifest.length} reference crops into mobile/assets/food.`);
