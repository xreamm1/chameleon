const assert = require('node:assert/strict');
const { halftone } = require('./script.js');
const width = 64, count = width * width;
function source(value) { return {gray: new Float32Array(count).fill(value), mask: new Uint8Array(count).fill(1)}; }
// Full-density layers fill every pixel, each retaining its exclusive checkerboard parity.
let output = halftone(source(0), source(1), width, width);
for (let p = 0; p < count; p++) {
  const color = ((p % width + Math.floor(p / width)) & 1) * 255;
  assert.deepEqual(Array.from(output.slice(p * 4, p * 4 + 4)), [color, color, color, 255]);
}
// Midtones retain their mean coverage without the previous coarse threshold tile.
output = halftone(source(.5), source(.5), width, width);
let black = 0, white = 0;
for (let p = 0; p < count; p++) {
  const [r,g,b,a] = output.slice(p * 4, p * 4 + 4);
  assert.ok(a === 0 || a === 255);
  if (!a) continue;
  assert.equal(r,g); assert.equal(g,b); assert.ok(r === 0 || r === 255);
  assert.equal(r / 255, (p % width + Math.floor(p / width)) & 1);
  r ? white++ : black++;
}
assert.ok(Math.abs(black - count / 4) < count * .03);
assert.ok(Math.abs(white - count / 4) < count * .03);
const empty = source(.5); empty.mask.fill(0);
assert.ok(halftone(empty,empty,width,width).every(v => v === 0));
console.log('PASS: dense checkerboard, binary RGB/alpha, tone coverage, transparency');
