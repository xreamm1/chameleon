const assert = require('node:assert/strict');
const { prepare, halftone } = require('./script.js');
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
const expected = (.12 + .88 * Math.pow(.5,.8)) * count / 2;
assert.ok(Math.abs(black - expected) < count * .03);
assert.ok(Math.abs(white - expected) < count * .03);
// A white subject touching the top edge must not become another background seed.
const rgba=new Uint8ClampedArray(count*4);
for(let p=0;p<count;p++)rgba[p*4+3]=255;
for(let y=0;y<40;y++)for(let x=20;x<44;x++)rgba.fill(255,(y*width+x)*4,(y*width+x)*4+4);
const prepared=prepare(rgba,width,width);
assert.equal(prepared.mask[10*width+30],1);
assert.equal(prepared.mask[10*width+5],0);
const empty = source(.5); empty.mask.fill(0);
assert.ok(halftone(empty,empty,width,width).every(v => v === 0));
console.log('PASS: dense checkerboard, binary RGB/alpha, tone coverage, transparency');
