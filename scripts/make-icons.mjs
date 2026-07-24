// Generate PWA icons from the Spartan Crew arrow mark (extracted from the
// wordmark logo) on the brand dark background. Uses sharp to rasterize SVG.
// Run:  node scripts/make-icons.mjs
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { ROOT_DIR } from "./_env.mjs";

const BG = "#0e0e0e";

// The arrow mark (red + grey) in the wordmark's own coordinate space.
// bbox: x 647.574..793.701 (w 146.127), y 2.254..193.112 (h 190.858).
const MARK = `
  <polygon fill="#C72218" points="756.59,48.431 647.574,193.112 721.796,193.112 793.701,97.685"/>
  <polygon fill="#878787" points="751.377,41.73 721.796,2.254 647.574,2.254 714.267,90.985"/>
`;
const MARK_MIN_X = 647.574, MARK_MIN_Y = 2.254, MARK_H = 190.858;

// Compose a 512x512 SVG with the mark centered at a given content height.
function iconSvg(contentH, w = 146.127) {
  const scale = contentH / MARK_H;
  const cw = w * scale;
  const tx = (512 - cw) / 2;
  const ty = (512 - contentH) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
    <rect width="512" height="512" fill="${BG}"/>
    <g transform="translate(${tx.toFixed(2)},${ty.toFixed(2)}) scale(${scale.toFixed(4)}) translate(${-MARK_MIN_X},${-MARK_MIN_Y})">
      ${MARK}
    </g>
  </svg>`;
}

const dir = join(ROOT_DIR, "public", "icons");
mkdirSync(dir, { recursive: true });

const iconStd = Buffer.from(iconSvg(340)); // ~66% — normal icon
const iconMask = Buffer.from(iconSvg(300)); // ~59% — inside the maskable safe zone

const jobs = [
  ["icon-192.png", iconStd, 192],
  ["icon-512.png", iconStd, 512],
  ["icon-maskable-512.png", iconMask, 512],
  ["apple-touch-icon.png", iconStd, 180],
  ["favicon-32.png", iconStd, 32],
];

for (const [name, svg, size] of jobs) {
  await sharp(svg).resize(size, size).png().toFile(join(dir, name));
  console.log("wrote", join("public/icons", name), `(${size}x${size})`);
}
console.log("done");
