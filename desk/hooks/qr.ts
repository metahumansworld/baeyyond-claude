// A QR code for the phone link, written here because a mod imports no packages. Byte mode,
// versions 1 to 10, error correction M (L when M will not fit): room for a link of 270
// bytes. It follows ISO/IEC 18004 as Project Nayuki's reference encoder lays it out.
// The module count of a version-v code is 4v + 17; the code is drawn with a quiet zone of 4.

type Level = 'L' | 'M'

// for versions 1 to 10 (index 0 unused)
const ECC_PER_BLOCK: Record<Level, number[]> = {
  L: [0, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18],
  M: [0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26],
}
const BLOCKS: Record<Level, number[]> = {
  L: [0, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4],
  M: [0, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5],
}
const FORMAT_LEVEL: Record<Level, number> = { L: 1, M: 0 }
export const MAX_VERSION = 10

const bit = (x: number, i: number) => ((x >>> i) & 1) !== 0

function rawModules(ver: number): number {
  let n = (16 * ver + 128) * ver + 64
  if (ver >= 2) {
    const align = Math.floor(ver / 7) + 2
    n -= (25 * align - 10) * align - 55
    if (ver >= 7) n -= 36
  }
  return n
}

const dataCodewords = (ver: number, lv: Level) =>
  Math.floor(rawModules(ver) / 8) - (ECC_PER_BLOCK[lv][ver] ?? 0) * (BLOCKS[lv][ver] ?? 0)

function mul(x: number, y: number): number {
  let z = 0
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d)
    z ^= ((y >>> i) & 1) * x
  }
  return z & 0xff
}

function divisor(degree: number): number[] {
  const out = new Array<number>(degree).fill(0)
  out[degree - 1] = 1
  let root = 1
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < degree; j++) {
      out[j] = mul(out[j] ?? 0, root)
      if (j + 1 < degree) out[j] = (out[j] ?? 0) ^ (out[j + 1] ?? 0)
    }
    root = mul(root, 0x02)
  }
  return out
}

function remainder(data: readonly number[], div: readonly number[]): number[] {
  const out = div.map(() => 0)
  for (const b of data) {
    const factor = b ^ (out.shift() ?? 0)
    out.push(0)
    div.forEach((c, i) => {
      out[i] = (out[i] ?? 0) ^ mul(c, factor)
    })
  }
  return out
}

function alignPositions(ver: number): number[] {
  if (ver === 1) return []
  const n = Math.floor(ver / 7) + 2
  const size = ver * 4 + 17
  const step = Math.ceil((ver * 4 + 4) / (n * 2 - 2)) * 2
  const out = [6]
  for (let pos = size - 7; out.length < n; pos -= step) out.splice(1, 0, pos)
  return out
}

function utf8(text: string): number[] {
  const out: number[] = []
  for (const ch of text) {
    let c = ch.codePointAt(0) ?? 0
    if (c < 0x80) out.push(c)
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63))
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63))
    else {
      out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63))
    }
  }
  return out
}

/** The code's modules, row by row, `true` dark; throws for text over 270 bytes or so. */
export function qrModules(text: string): boolean[][] {
  const bytes = utf8(text)
  let ver = 0
  let lv: Level = 'M'
  for (const level of ['M', 'L'] as const) {
    for (let v = 1; v <= MAX_VERSION && ver === 0; v++) {
      const cc = v <= 9 ? 8 : 16
      if (4 + cc + bytes.length * 8 <= dataCodewords(v, level) * 8) {
        ver = v
        lv = level
      }
    }
    if (ver !== 0) break
  }
  if (ver === 0) throw new Error(`a link of ${bytes.length} bytes is too long for the phone code`)

  // the bit stream: mode, count, bytes, terminator, padding
  const bits: number[] = []
  const put = (val: number, len: number) => {
    for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1)
  }
  put(0b0100, 4)
  put(bytes.length, ver <= 9 ? 8 : 16)
  for (const b of bytes) put(b, 8)
  const capacity = dataCodewords(ver, lv) * 8
  put(0, Math.min(4, capacity - bits.length))
  put(0, (8 - (bits.length % 8)) % 8)
  for (let pad = 0xec; bits.length < capacity; pad ^= 0xec ^ 0x11) put(pad, 8)
  const data: number[] = []
  for (let i = 0; i < bits.length; i += 8) {
    let b = 0
    for (let j = 0; j < 8; j++) b = (b << 1) | (bits[i + j] ?? 0)
    data.push(b)
  }

  // error correction, in blocks, interleaved
  const nBlocks = BLOCKS[lv][ver] ?? 1
  const eccLen = ECC_PER_BLOCK[lv][ver] ?? 0
  const raw = Math.floor(rawModules(ver) / 8)
  const nShort = nBlocks - (raw % nBlocks)
  const shortLen = Math.floor(raw / nBlocks)
  const div = divisor(eccLen)
  const blocks: number[][] = []
  for (let i = 0, k = 0; i < nBlocks; i++) {
    const dat = data.slice(k, k + shortLen - eccLen + (i < nShort ? 0 : 1))
    k += dat.length
    const ecc = remainder(dat, div)
    if (i < nShort) dat.push(0)
    blocks.push([...dat, ...ecc])
  }
  const codewords: number[] = []
  const blockLen = blocks[0]?.length ?? 0
  for (let i = 0; i < blockLen; i++) {
    blocks.forEach((block, j) => {
      if (i !== shortLen - eccLen || j >= nShort) codewords.push(block[i] ?? 0)
    })
  }

  // the function patterns
  const size = ver * 4 + 17
  const mods = Array.from({ length: size }, () => new Array<boolean>(size).fill(false))
  const fixed = Array.from({ length: size }, () => new Array<boolean>(size).fill(false))
  const set = (x: number, y: number, dark: boolean) => {
    const row = mods[y]
    const frow = fixed[y]
    if (row === undefined || frow === undefined || x < 0 || x >= size) return
    row[x] = dark
    frow[x] = true
  }
  for (let i = 0; i < size; i++) {
    set(6, i, i % 2 === 0)
    set(i, 6, i % 2 === 0)
  }
  const finder = (cx: number, cy: number) => {
    for (let dy = -4; dy <= 4; dy++)
      for (let dx = -4; dx <= 4; dx++) {
        const d = Math.max(Math.abs(dx), Math.abs(dy))
        const x = cx + dx
        const y = cy + dy
        if (x >= 0 && x < size && y >= 0 && y < size) set(x, y, d !== 2 && d !== 4)
      }
  }
  finder(3, 3)
  finder(size - 4, 3)
  finder(3, size - 4)
  const align = alignPositions(ver)
  const na = align.length
  for (let i = 0; i < na; i++)
    for (let j = 0; j < na; j++) {
      if ((i === 0 && j === 0) || (i === 0 && j === na - 1) || (i === na - 1 && j === 0)) continue
      const ax = align[i] ?? 0
      const ay = align[j] ?? 0
      for (let dy = -2; dy <= 2; dy++)
        for (let dx = -2; dx <= 2; dx++) set(ax + dx, ay + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1)
    }
  const format = (mask: number) => {
    const d = (FORMAT_LEVEL[lv] << 3) | mask
    let rem = d
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537)
    const b = ((d << 10) | rem) ^ 0x5412
    for (let i = 0; i <= 5; i++) set(8, i, bit(b, i))
    set(8, 7, bit(b, 6))
    set(8, 8, bit(b, 7))
    set(7, 8, bit(b, 8))
    for (let i = 9; i < 15; i++) set(14 - i, 8, bit(b, i))
    for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(b, i))
    for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(b, i))
    set(8, size - 8, true)
  }
  format(0)
  if (ver >= 7) {
    let rem = ver
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25)
    const b = (ver << 12) | rem
    for (let i = 0; i < 18; i++) {
      const a = size - 11 + (i % 3)
      const c = Math.floor(i / 3)
      set(a, c, bit(b, i))
      set(c, a, bit(b, i))
    }
  }

  // the data, in the zigzag
  let i = 0
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5
    for (let vert = 0; vert < size; vert++)
      for (let j = 0; j < 2; j++) {
        const x = right - j
        const up = ((right + 1) & 2) === 0
        const y = up ? size - 1 - vert : vert
        const row = mods[y]
        if (row !== undefined && !(fixed[y]?.[x] ?? true) && i < codewords.length * 8) {
          row[x] = bit(codewords[i >>> 3] ?? 0, 7 - (i & 7))
          i++
        }
      }
  }

  // the mask with the least penalty
  const masked = (mask: number) =>
    mods.map((row, y) =>
      row.map((dark, x) => {
        if (fixed[y]?.[x] ?? false) return dark
        const flip = [
          (x + y) % 2 === 0,
          y % 2 === 0,
          x % 3 === 0,
          (x + y) % 3 === 0,
          (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
          ((x * y) % 2) + ((x * y) % 3) === 0,
          (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
          (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
        ][mask]
        return flip === true ? !dark : dark
      }),
    )
  let best: boolean[][] = mods
  let bestScore = Infinity
  let bestMask = 0
  for (let mask = 0; mask < 8; mask++) {
    format(mask) // the format bits are fixed modules: masked() keeps them as drawn
    const m = masked(mask)
    const score = penalty(m)
    if (score < bestScore) {
      bestScore = score
      best = m
      bestMask = mask
    }
  }
  format(bestMask)
  // the chosen format bits, drawn last, into the chosen grid
  return best.map((row, y) => row.map((dark, x) => ((fixed[y]?.[x] ?? false) ? (mods[y]?.[x] ?? false) : dark)))
}

function penalty(m: boolean[][]): number {
  const size = m.length
  let score = 0
  const at = (x: number, y: number) => m[y]?.[x] ?? false
  const lines = (horizontal: boolean) => {
    for (let a = 0; a < size; a++) {
      let run = 1
      const line: boolean[] = []
      for (let b = 0; b < size; b++) line.push(horizontal ? at(b, a) : at(a, b))
      for (let b = 1; b <= size; b++) {
        if (b < size && line[b] === line[b - 1]) run++
        else {
          if (run >= 5) score += run - 2
          run = 1
        }
      }
      const s = line.map(d => (d ? '1' : '0')).join('')
      for (const pat of ['10111010000', '00001011101']) {
        for (let k = s.indexOf(pat); k !== -1; k = s.indexOf(pat, k + 1)) score += 40
      }
    }
  }
  lines(true)
  lines(false)
  for (let y = 0; y < size - 1; y++)
    for (let x = 0; x < size - 1; x++) {
      const c = at(x, y)
      if (c === at(x + 1, y) && c === at(x, y + 1) && c === at(x + 1, y + 1)) score += 3
    }
  let dark = 0
  for (const row of m) for (const d of row) if (d) dark++
  const total = size * size
  score += Math.floor(Math.abs(dark * 20 - total * 10) / total) * 10
  return score
}

/** The code as rows of '1' (dark) and '0', for a value the pane keeps. */
export const qrRows = (text: string) => qrModules(text).map(row => row.map(d => (d ? '1' : '0')).join(''))

/** The code as an SVG: dark modules on white, a quiet zone of four. */
export function qrSvg(rows: readonly string[]): string {
  const n = rows.length
  const all = n + 8
  let path = ''
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      if (row[x] !== '1') continue
      let w = 1
      while (row[x + w] === '1') w++
      path += `M${x + 4} ${y + 4}h${w}v1h-${w}z`
      x += w - 1
    }
  })
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${all} ${all}" shape-rendering="crispEdges">` +
    `<rect width="${all}" height="${all}" fill="#ffffff"/><path d="${path}" fill="#000000"/></svg>`
  )
}

/**
 * The code as text for a terminal: two module rows to a line in half blocks, dark modules
 * drawn as blanks on a light ground (each line meant for black text on white).
 */
export function qrText(rows: readonly string[]): string[] {
  const n = rows.length
  const pad = '0'.repeat(n + 4)
  const grid = [pad, pad, ...rows.map(r => '00' + r + '00'), pad, pad]
  const out: string[] = []
  for (let y = 0; y < grid.length; y += 2) {
    const top = grid[y] ?? pad
    const bottom = grid[y + 1] ?? pad
    let line = ''
    for (let x = 0; x < top.length; x++) {
      const t = top[x] === '1'
      const b = bottom[x] === '1'
      // light is ink here: a dark module is a gap in the light
      line += !t && !b ? '█' : !t ? '▀' : !b ? '▄' : ' '
    }
    out.push(line)
  }
  return out
}
