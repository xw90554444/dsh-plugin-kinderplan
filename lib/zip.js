/**
 * Minimal ZIP reader/writer for OOXML packages.
 *
 * A .docx is a ZIP of XML parts. DSH installs no zip library and the plugin
 * deliberately carries no dependencies, so this file implements exactly the
 * subset an OOXML package needs:
 *
 *  - read:  end-of-central-directory scan, central directory walk, deflate/store
 *           inflate. Every part of a Word file is far below any ZIP64 threshold,
 *           so ZIP64 records are reported rather than half-supported.
 *  - write: local headers + central directory + EOCD, deflate for everything
 *           non-empty. Entry order and the directory entries of the source
 *           package are preserved so the output stays byte-comparable with a
 *           Word-authored file.
 *
 * Only `node:zlib` is used.
 */

import { deflateRawSync, inflateRawSync } from 'node:zlib'

const SIG_EOCD = 0x06054b50
const SIG_CENTRAL = 0x02014b50
const SIG_LOCAL = 0x04034b50
const SIG_EOCD64_LOCATOR = 0x07064b50
const SIG_EOCD64 = 0x06064b50

// ---------------------------------------------------------------- crc32

const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  return table
})()

/** @param {Buffer} buffer */
export function crc32(buffer) {
  let c = 0 ^ -1
  for (let i = 0; i < buffer.length; i += 1) c = (c >>> 8) ^ CRC_TABLE[(c ^ buffer[i]) & 0xff]
  return (c ^ -1) >>> 0
}

// ---------------------------------------------------------------- reading

/**
 * Parse a ZIP archive into its entries.
 *
 * @param {Buffer} buffer
 * @returns {Array<{name:string, data:Buffer, method:number, isDir:boolean, date:Date, externalAttrs:number}>}
 */
export function readZip(buffer) {
  if (!Buffer.isBuffer(buffer)) buffer = Buffer.from(buffer)
  if (buffer.length < 22) throw new Error('not a zip archive: too short')

  // Locate the EOCD. A trailing comment is legal, so scan backwards but never
  // further than the 64 KiB a comment can occupy.
  const eocdMin = Math.max(0, buffer.length - 22 - 0xffff)
  let eocd = -1
  for (let i = buffer.length - 22; i >= eocdMin; i -= 1) {
    if (buffer.readUInt32LE(i) === SIG_EOCD) { eocd = i; break }
  }
  if (eocd < 0) throw new Error('not a zip archive: no end-of-central-directory record')

  for (let i = eocd - 20; i >= 0; i -= 1) {
    if (buffer.readUInt32LE(i) === SIG_EOCD64_LOCATOR) {
      const z64 = Number(buffer.readBigUInt64LE(i + 8))
      if (z64 >= 0 && z64 + 4 <= buffer.length && buffer.readUInt32LE(z64) === SIG_EOCD64) {
        throw new Error('zip64 archives are not supported; re-save the document without them')
      }
      break
    }
  }

  const entryCount = buffer.readUInt16LE(eocd + 10)
  const cdOffset = buffer.readUInt32LE(eocd + 16)
  const cdSize = buffer.readUInt32LE(eocd + 12)
  if (cdOffset + cdSize > buffer.length) throw new Error('zip central directory is out of range')

  const entries = []
  let p = cdOffset
  for (let n = 0; n < entryCount; n += 1) {
    if (p + 46 > buffer.length || buffer.readUInt32LE(p) !== SIG_CENTRAL) {
      throw new Error(`zip central directory entry ${n} is malformed`)
    }
    const flags = buffer.readUInt16LE(p + 8)
    const method = buffer.readUInt16LE(p + 10)
    const dosTime = buffer.readUInt16LE(p + 12)
    const dosDate = buffer.readUInt16LE(p + 14)
    const crc = buffer.readUInt32LE(p + 16)
    const compSize = buffer.readUInt32LE(p + 20)
    const rawSize = buffer.readUInt32LE(p + 24)
    const nameLen = buffer.readUInt16LE(p + 28)
    const extraLen = buffer.readUInt16LE(p + 30)
    const commentLen = buffer.readUInt16LE(p + 32)
    const externalAttrs = buffer.readUInt32LE(p + 38)
    const localOffset = buffer.readUInt32LE(p + 42)
    if (compSize === 0xffffffff || rawSize === 0xffffffff || localOffset === 0xffffffff) {
      throw new Error('zip64 entries are not supported')
    }

    const nameBytes = buffer.subarray(p + 46, p + 46 + nameLen)
    const name = flags & 0x800 ? nameBytes.toString('utf8') : decodeCp437ish(nameBytes)
    p += 46 + nameLen + extraLen + commentLen

    if (name.endsWith('/')) {
      entries.push({ name, data: Buffer.alloc(0), method, isDir: true, date: dosToDate(dosDate, dosTime), externalAttrs })
      continue
    }

    if (localOffset + 30 > buffer.length || buffer.readUInt32LE(localOffset) !== SIG_LOCAL) {
      throw new Error(`zip local header for ${name} is malformed`)
    }
    const lNameLen = buffer.readUInt16LE(localOffset + 26)
    const lExtraLen = buffer.readUInt16LE(localOffset + 28)
    const dataStart = localOffset + 30 + lNameLen + lExtraLen
    const raw = buffer.subarray(dataStart, dataStart + compSize)

    let data
    if (method === 0) data = Buffer.from(raw)
    else if (method === 8) data = inflateRawSync(raw)
    else throw new Error(`zip entry ${name} uses unsupported compression method ${method}`)

    if (data.length !== rawSize) {
      // Some writers set the data descriptor's sizes to zero in the local
      // header; the central directory is authoritative, so a mismatch here
      // means genuine corruption.
      throw new Error(`zip entry ${name}: inflated ${data.length} bytes, expected ${rawSize}`)
    }
    if (crc32(data) !== crc) throw new Error(`zip entry ${name}: CRC mismatch`)

    entries.push({ name, data, method, isDir: false, date: dosToDate(dosDate, dosTime), externalAttrs })
  }
  return entries
}

/**
 * Names in OOXML packages are ASCII, so the non-UTF-8 branch is a defensive
 * fallback: decode as latin1 rather than throwing on exotic archives.
 * @param {Buffer} bytes
 */
function decodeCp437ish(bytes) {
  for (const b of bytes) if (b > 0x7f) return bytes.toString('latin1')
  return bytes.toString('ascii')
}

function dosToDate(date, time) {
  return new Date(
    1980 + ((date >> 9) & 0x7f),
    ((date >> 5) & 0x0f) - 1,
    date & 0x1f,
    (time >> 11) & 0x1f,
    (time >> 5) & 0x3f,
    (time & 0x1f) * 2,
  )
}

function dateToDos(date) {
  const d = date instanceof Date && !Number.isNaN(date.getTime()) ? date : new Date()
  const year = Math.min(2107, Math.max(1980, d.getFullYear()))
  return {
    date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
  }
}

/** Read one part as UTF-8 text. @param {Buffer} buffer @param {string} name */
export function readPart(buffer, name) {
  const entry = readZip(buffer).find((e) => e.name === name)
  if (!entry) throw new Error(`zip part "${name}" is missing`)
  return entry.data.toString('utf8')
}

// ---------------------------------------------------------------- writing

/**
 * Build a ZIP archive.
 *
 * Entries keep their given order. Text parts are deflated; empty parts are
 * stored, which is what Word does with its directory entries.
 *
 * @param {Array<{name:string, data:Buffer|string, isDir?:boolean, date?:Date}>} entries
 * @returns {Buffer}
 */
export function writeZip(entries) {
  const chunks = []
  const central = []
  let offset = 0

  for (const entry of entries) {
    const nameBytes = Buffer.from(entry.name, 'utf8')
    const isDir = entry.isDir === true || entry.name.endsWith('/')
    const data = isDir
      ? Buffer.alloc(0)
      : (Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(String(entry.data ?? ''), 'utf8'))
    const { date, time } = dateToDos(entry.date)

    let method = 0
    let payload = data
    if (data.length > 0) {
      const deflated = deflateRawSync(data, { level: 9 })
      // Only pay for compression when it actually wins; tiny XML fragments can
      // grow, and a stored entry is still a perfectly valid package part.
      if (deflated.length < data.length) { method = 8; payload = deflated }
    }
    const crc = data.length > 0 ? crc32(data) : 0

    const local = Buffer.alloc(30)
    local.writeUInt32LE(SIG_LOCAL, 0)
    local.writeUInt16LE(20, 4)          // version needed
    local.writeUInt16LE(0x800, 6)       // UTF-8 names
    local.writeUInt16LE(method, 8)
    local.writeUInt16LE(time, 10)
    local.writeUInt16LE(date, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(payload.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(nameBytes.length, 26)
    local.writeUInt16LE(0, 28)
    chunks.push(local, nameBytes, payload)

    central.push({ nameBytes, method, time, date, crc, compSize: payload.length, rawSize: data.length, offset, isDir })
    offset += local.length + nameBytes.length + payload.length
  }

  const cdStart = offset
  for (const e of central) {
    const head = Buffer.alloc(46)
    head.writeUInt32LE(SIG_CENTRAL, 0)
    head.writeUInt16LE(20, 4)                 // version made by
    head.writeUInt16LE(20, 6)                 // version needed
    head.writeUInt16LE(0x800, 8)
    head.writeUInt16LE(e.method, 10)
    head.writeUInt16LE(e.time, 12)
    head.writeUInt16LE(e.date, 14)
    head.writeUInt32LE(e.crc, 16)
    head.writeUInt32LE(e.compSize, 20)
    head.writeUInt32LE(e.rawSize, 24)
    head.writeUInt16LE(e.nameBytes.length, 28)
    head.writeUInt16LE(0, 30)                 // extra
    head.writeUInt16LE(0, 32)                 // comment
    head.writeUInt16LE(0, 34)                 // disk
    head.writeUInt16LE(0, 36)                 // internal attrs
    // Mark directory entries so unzip tools recreate them with sane modes.
    head.writeUInt32LE(e.isDir ? 0x41ed0010 : 0x81a40000, 38)
    head.writeUInt32LE(e.offset, 42)
    chunks.push(head, e.nameBytes)
    offset += head.length + e.nameBytes.length
  }

  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(SIG_EOCD, 0)
  eocd.writeUInt16LE(0, 4)
  eocd.writeUInt16LE(0, 6)
  eocd.writeUInt16LE(central.length, 8)
  eocd.writeUInt16LE(central.length, 10)
  eocd.writeUInt32LE(offset - cdStart, 12)
  eocd.writeUInt32LE(cdStart, 16)
  eocd.writeUInt16LE(0, 20)
  chunks.push(eocd)

  return Buffer.concat(chunks)
}

/**
 * Rewrite a package: every source part is preserved byte-for-byte except the
 * ones named in `replacements`, and parts named in `additions` are appended.
 *
 * This is why exports match the school's template exactly — styles, theme,
 * numbering, the letterhead image in the header and the footer all come
 * straight from the uploaded document rather than from a reconstruction.
 *
 * @param {Buffer} source
 * @param {Record<string, string|Buffer|null>} replacements name -> new content (null removes)
 * @param {Record<string, string|Buffer>} [additions]
 * @param {{order?:string[]}} [options]
 * @returns {Buffer}
 */
export function rewritePackage(source, replacements, additions = {}, options = {}) {
  const entries = readZip(source)
  const seen = new Set()
  const out = []

  const place = (entry) => {
    const name = entry.name
    seen.add(name)
    if (Object.prototype.hasOwnProperty.call(replacements, name)) {
      const next = replacements[name]
      if (next === null) return
      out.push({ name, data: Buffer.isBuffer(next) ? next : Buffer.from(next, 'utf8'), isDir: false, date: entry.date })
      return
    }
    out.push({ name, data: entry.data, isDir: entry.isDir, date: entry.date })
  }

  // `[Content_Types].xml` must be the first part in a valid OPC package.
  for (const entry of entries) {
    if (entry.name === '[Content_Types].xml') place(entry)
  }
  for (const entry of entries) {
    if (entry.name !== '[Content_Types].xml') place(entry)
  }
  for (const [name, data] of Object.entries(additions)) {
    if (seen.has(name)) continue
    out.push({ name, data: Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8'), isDir: name.endsWith('/') })
  }

  const order = options.order ?? []
  if (order.length > 0) {
    const rank = (name) => {
      const i = order.indexOf(name)
      return i < 0 ? order.length : i
    }
    out.sort((a, b) => rank(a.name) - rank(b.name))
  }
  return writeZip(out)
}

export default { readZip, writeZip, readPart, rewritePackage, crc32 }
