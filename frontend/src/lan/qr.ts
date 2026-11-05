// A small QR code encoder for the LAN lobby: byte mode, error correction level M, versions 1–10
// (up to 213 bytes, plenty for an address like http://192.168.1.20:5195/join/ABCD).
// Follows ISO/IEC 18004: Reed–Solomon blocks over GF(256), function patterns, zigzag placement,
// the best of the eight masks by the standard penalty rules, BCH-coded format and version bits.
// qrMatrix(text) → rows of booleans (true = dark), without the quiet zone.

// error correction codewords per block and number of blocks, level M, versions 1–10
const ECC_PER_BLOCK = [0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26]
const BLOCKS = [0, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5]
const FORMAT_M = 0 // level M's two format bits

function gfMul(x: number, y: number): number {
  let z = 0
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d)
    z ^= ((y >>> i) & 1) * x
  }
  return z & 0xff
}

/** Generator polynomial of the given degree (coefficients, highest power first, leading 1 dropped). */
function rsDivisor(degree: number): number[] {
  const out = new Array<number>(degree).fill(0)
  out[degree - 1] = 1
  let root = 1
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < out.length; j++) {
      out[j] = gfMul(out[j], root)
      if (j + 1 < out.length) out[j] ^= out[j + 1]
    }
    root = gfMul(root, 2)
  }
  return out
}

function rsRemainder(data: number[], div: number[]): number[] {
  const out = new Array<number>(div.length).fill(0)
  for (const b of data) {
    const f = b ^ (out.shift() as number)
    out.push(0)
    for (let i = 0; i < div.length; i++) out[i] ^= gfMul(div[i], f)
  }
  return out
}

function rawModules(v: number): number {
  let n = (16 * v + 128) * v + 64
  if (v >= 2) {
    const a = Math.floor(v / 7) + 2
    n -= (25 * a - 10) * a - 55
    if (v >= 7) n -= 36
  }
  return n
}

const dataCodewords = (v: number) => Math.floor(rawModules(v) / 8) - ECC_PER_BLOCK[v] * BLOCKS[v]

function alignPositions(v: number, size: number): number[] {
  if (v === 1) return []
  const n = Math.floor(v / 7) + 2
  const step = Math.ceil((v * 4 + 4) / (n * 2 - 2)) * 2
  const out = [6]
  for (let pos = size - 7; out.length < n; pos -= step) out.splice(1, 0, pos)
  return out
}

/** Data codewords followed by error correction, split into blocks and interleaved. */
function codewords(bytes: number[], v: number): number[] {
  const cap = dataCodewords(v)
  const bits: number[] = []
  const put = (val: number, len: number) => { for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1) }
  put(4, 4) // byte mode
  put(bytes.length, v < 10 ? 8 : 16)
  for (const b of bytes) put(b, 8)
  put(0, Math.min(4, cap * 8 - bits.length))
  put(0, (8 - (bits.length % 8)) % 8)
  const data: number[] = []
  for (let i = 0; i < bits.length; i += 8) data.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0))
  for (let pad = 0xec; data.length < cap; pad ^= 0xec ^ 0x11) data.push(pad)
  const nBlocks = BLOCKS[v], ecLen = ECC_PER_BLOCK[v]
  const total = Math.floor(rawModules(v) / 8)
  const nShort = nBlocks - (total % nBlocks)
  const shortLen = Math.floor(total / nBlocks) // data + ecc of a short block
  const div = rsDivisor(ecLen)
  const blocks: number[][] = []
  for (let i = 0, k = 0; i < nBlocks; i++) {
    const d = data.slice(k, k + shortLen - ecLen + (i < nShort ? 0 : 1))
    k += d.length
    blocks.push([...d, ...rsRemainder(d, div)])
  }
  const out: number[] = []
  const dLen = (b: number[]) => b.length - ecLen
  for (let i = 0; i < shortLen - ecLen + 1; i++) for (const b of blocks) if (i < dLen(b)) out.push(b[i])
  for (let i = 0; i < ecLen; i++) for (const b of blocks) out.push(b[dLen(b) + i])
  return out
}

function maskOn(m: number, x: number, y: number): boolean {
  switch (m) {
    case 0: return (x + y) % 2 === 0
    case 1: return y % 2 === 0
    case 2: return x % 3 === 0
    case 3: return (x + y) % 3 === 0
    case 4: return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0
    case 5: return ((x * y) % 2) + ((x * y) % 3) === 0
    case 6: return (((x * y) % 2) + ((x * y) % 3)) % 2 === 0
    default: return (((x + y) % 2) + ((x * y) % 3)) % 2 === 0
  }
}

function penalty(g: boolean[][]): number {
  const n = g.length
  let p = 0
  const line = (get: (i: number) => boolean) => {
    let run = 1
    for (let i = 1; i <= n; i++) {
      if (i < n && get(i) === get(i - 1)) { run++; continue }
      if (run >= 5) p += 3 + (run - 5)
      run = 1
    }
    // finder-like 1:1:3:1:1 with four light modules on one side
    for (let i = 0; i + 10 < n; i++) {
      const s = Array.from({ length: 11 }, (_, k) => get(i + k))
      const core = s[4] && !s[5] && s[6] && s[7] && s[8] && !s[9] && s[10]
      const a = !s[0] && !s[1] && !s[2] && !s[3] && core
      const b = s[0] && !s[1] && s[2] && s[3] && s[4] && !s[5] && s[6] && !s[7] && !s[8] && !s[9] && !s[10]
      if (a || b) p += 40
    }
  }
  for (let y = 0; y < n; y++) line(i => g[y][i])
  for (let x = 0; x < n; x++) line(i => g[i][x])
  let dark = 0
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    if (g[y][x]) dark++
    if (x + 1 < n && y + 1 < n && g[y][x] === g[y][x + 1] && g[y][x] === g[y + 1][x] && g[y][x] === g[y + 1][x + 1]) p += 3
  }
  const total = n * n
  p += (Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1) * 10
  return p
}

/** The QR symbol for a text, as rows of dark (true) and light modules. Throws if the text is too long. */
export function qrMatrix(text: string): boolean[][] {
  const bytes = [...new TextEncoder().encode(text)]
  let v = 1
  while (v <= 10 && 4 + (v < 10 ? 8 : 16) + bytes.length * 8 > dataCodewords(v) * 8) v++
  if (v > 10) throw new Error('QR: text too long')
  const size = v * 4 + 17
  const mod: boolean[][] = Array.from({ length: size }, () => new Array<boolean>(size).fill(false))
  const fn: boolean[][] = Array.from({ length: size }, () => new Array<boolean>(size).fill(false))
  const set = (x: number, y: number, dark: boolean) => { mod[y][x] = dark; fn[y][x] = true }
  // timing, finders (with separators), alignment patterns
  for (let i = 0; i < size; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0) }
  for (const [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]]) {
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const x = cx + dx, y = cy + dy
      if (x < 0 || y < 0 || x >= size || y >= size) continue
      const d = Math.max(Math.abs(dx), Math.abs(dy))
      set(x, y, d !== 2 && d !== 4)
    }
  }
  const al = alignPositions(v, size)
  for (let i = 0; i < al.length; i++) for (let j = 0; j < al.length; j++) {
    if ((i === 0 && j === 0) || (i === 0 && j === al.length - 1) || (i === al.length - 1 && j === 0)) continue
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(al[i] + dx, al[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1)
  }
  const drawFormat = (mask: number) => {
    const d = (FORMAT_M << 3) | mask
    let r = d
    for (let i = 0; i < 10; i++) r = (r << 1) ^ ((r >>> 9) * 0x537)
    const bits = ((d << 10) | r) ^ 0x5412
    const bit = (i: number) => ((bits >>> i) & 1) === 1
    for (let i = 0; i <= 5; i++) set(8, i, bit(i))
    set(8, 7, bit(6)); set(8, 8, bit(7)); set(7, 8, bit(8))
    for (let i = 9; i < 15; i++) set(14 - i, 8, bit(i))
    for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(i))
    for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(i))
    set(8, size - 8, true) // the dark module
  }
  drawFormat(0) // reserve the format areas for now
  if (v >= 7) {
    let r = v
    for (let i = 0; i < 12; i++) r = (r << 1) ^ ((r >>> 11) * 0x1f25)
    const bits = (v << 12) | r
    for (let i = 0; i < 18; i++) {
      const dark = ((bits >>> i) & 1) === 1
      const a = size - 11 + (i % 3), b = Math.floor(i / 3)
      set(a, b, dark); set(b, a, dark)
    }
  }
  // data, in the zigzag from the bottom-right corner
  const cw = codewords(bytes, v)
  let bi = 0
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j
        const up = ((right + 1) & 2) === 0
        const y = up ? size - 1 - vert : vert
        if (fn[y][x] || bi >= cw.length * 8) continue
        mod[y][x] = ((cw[bi >>> 3] >>> (7 - (bi & 7))) & 1) === 1
        bi++
      }
    }
  }
  // the mask with the lowest penalty
  let best = 0, bestP = Infinity
  const masked = (m: number) => mod.map((row, y) => row.map((dark, x) => (!fn[y][x] && maskOn(m, x, y) ? !dark : dark)))
  for (let m = 0; m < 8; m++) {
    drawFormat(m)
    const p = penalty(masked(m))
    if (p < bestP) { bestP = p; best = m }
  }
  drawFormat(best)
  return masked(best)
}
