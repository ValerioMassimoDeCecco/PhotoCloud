// Loads the native module built by `rust-anything build`.
const native = require('./zk_rs.node')

// Structured values cross as JSON text. JSON has no `undefined`, NaN, -0, bigint, Date, Map, Set
// or bytes, and Rust strings no lone surrogates: those travel as one-key marker objects
// (`{"$undefined": true}`, `{"$num": "NaN"}`, `{"$map": [[k, v]]}`, `{"$bytes": [...]}`, ...),
// the same markers recordings use.
const replacer = function (k, v) {
  const raw = this[k]
  if (raw instanceof Date) return { $date: Number.isNaN(raw.getTime()) ? 'Invalid' : raw.toISOString() }
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer(raw)) return { $buffer: Array.from(raw) }
  if (raw instanceof Uint8Array) return { $bytes: Array.from(raw) }
  if (raw instanceof Map) return { $map: [...raw] }
  if (raw instanceof Set) return { $set: [...raw] }
  return v === undefined ? { $undefined: true }
    : typeof v === 'bigint' ? { $bigint: String(v) }
    : typeof v === 'number' ? (Number.isFinite(v) && !Object.is(v, -0) ? v : { $num: Object.is(v, -0) ? '-0' : String(v) })
    : typeof v === 'string' && !v.isWellFormed() ? { $utf16: Array.from({ length: v.length }, (_, i) => v.charCodeAt(i)) }
    : v
}
const encode = v => JSON.stringify(v, replacer)
const single = (v, key) => Object.keys(v).length === 1 && key in v
const revive = v => Array.isArray(v) ? v.map(revive)
  : v !== null && typeof v === 'object'
    ? (single(v, '$undefined') ? undefined
      : single(v, '$utf16') ? fromUnits(v.$utf16)
      : single(v, '$num') ? Number(v.$num)
      : single(v, '$bigint') ? BigInt(v.$bigint)
      : single(v, '$date') ? new Date(v.$date)
      : single(v, '$bytes') ? Uint8Array.from(v.$bytes)
      : single(v, '$buffer') ? Buffer.from(v.$buffer)
      : single(v, '$map') ? new Map(v.$map.map(([k, x]) => [revive(k), revive(x)]))
      : single(v, '$set') ? new Set(v.$set.map(revive))
      : Object.fromEntries(Object.entries(v).map(([k, x]) => [k, revive(x)])))
    : v
// Most results carry no marker: skip the walk unless the text has one.
const decode = text => {
  const value = JSON.parse(text)
  return text.includes('"$') ? revive(value) : value
}
const fromUnits = (units) => {
  let out = ''
  for (let i = 0; i < units.length; i += 8192)
    out += String.fromCharCode.apply(null, Array.prototype.slice.call(units, i, i + 8192))
  return out
}

module.exports = { ...native }
const specs = {
  blake2b: [[1, 0], 'json', false],
  blake2bLong: [[1, 0], 'json', false],
  buildChunkNonce: [[1, 0], 'json', false],
  buildChunkAad: [[1, 0], 'json', false],
  serializePczkHeader: [[1], 'json', false],
  parsePczkHeader: [[1], 'json', false],
  computeBlobRangePlan: [[1], 'json', false],
  constantTimeEqual: [[1, 1], 'raw', false],
  utf8Encode: [[0], 'json', false],
  utf8Decode: [[1], 'raw', false],
  normalizePassphraseNfc: [[0], 'json', false],
  toHex: [[1], 'raw', false],
  fromHex: [[0], 'json', false],
  toBase64Url: [[1], 'raw', false],
  fromBase64Url: [[0], 'json', false],
  uuidToBytes: [[0], 'json', false],
  bytesToUuid: [[1], 'raw', false],
  concatBytes: [[1], 'json', false],
}
const classes = {
  IncrementalSha256: [[], { update: [[1], 'raw'], digest: [[], 'json'] }],
  IncrementalHmacSha256: [[1], { update: [[1], 'raw'], digest: [[], 'json'] }],
}
const convert = result => result === 'json' ? decode : result === 'units' ? fromUnits : x => x
// An omitted structured argument is `undefined`, not a missing value.
const prepare = (a, structured) => Array.from({ length: Math.max(a.length, structured.length) }, (_, i) => structured[i] ? encode(a[i]) : a[i])
// Functions: [structured arguments, result kind, async].
for (const [name, [structured, result, isAsync]] of Object.entries(specs)) {
  const call = native[name]
  const out = convert(result)
  module.exports[name] = isAsync
    ? async (...a) => out(await call(...prepare(a, structured)))
    : (...a) => out(call(...prepare(a, structured)))
}
// Classes: a JS class around the native one, converting arguments and results.
const INNER = Symbol('native')
for (const [name, [ctor, methods]] of Object.entries(classes)) {
  const Native = native[name]
  const Wrapped = { [name]: class { constructor(...a) { this[INNER] = new Native(...prepare(a, ctor)) } } }[name]
  for (const [method, [structured, result]] of Object.entries(methods)) {
    const out = convert(result)
    Wrapped.prototype[method] = function (...a) { return out(this[INNER][method](...prepare(a, structured))) }
  }
  module.exports[name] = Wrapped
}

// The binary wire (see rust-anything's `wire.rs`): arguments are written into `wIn`, results read
// from `wOut`; both are registered with the native module once.
let wIn = new Uint8Array(1 << 16), wOut = new Uint8Array(1 << 16)
const wLen = new Uint32Array(1)
let iv = new DataView(wIn.buffer), ov = new DataView(wOut.buffer), at = 0, p = 0
native.rustAnythingWireInit(wIn, wOut, wLen)
const regrow = () => native.rustAnythingWireInit(wIn, wOut, wLen)
// Runs a wire function; a result larger than `wOut` is fetched once `wOut` has grown.
const wireCall = fn => {
  wLen[0] = at
  const n = fn()
  if (Number.isNaN(n)) return false
  if (n === Infinity) {
    p = 0
    throw new Error(rStr())
  }
  if (n < 0) {
    wOut = new Uint8Array(Math.max(wOut.length * 2, -n))
    ov = new DataView(wOut.buffer)
    native.rustAnythingWireInit(wIn, wOut, wLen)
    native.rustAnythingWireFlush()
  }
  p = 0
  return true
}

const need = n => {
  if (at + n <= wIn.length) return
  const grown = new Uint8Array(Math.max(wIn.length * 2, at + n))
  grown.set(wIn)
  wIn = grown
  iv = new DataView(wIn.buffer)
  regrow()
}
const wU8 = v => { need(1); iv.setUint8(at++, v) }
const wU32 = v => { need(4); iv.setUint32(at, v, true); at += 4 }
const wF64 = v => { need(8); iv.setFloat64(at, v, true); at += 8 }
const wUnits = s => {
  need(4 + 2 * s.length)
  iv.setUint32(at, s.length, true)
  at += 4
  for (let i = 0; i < s.length; i++) { iv.setUint16(at, s.charCodeAt(i), true); at += 2 }
}
const wStr = s => { wU8(4); wUnits(s) }
const wDyn = v => {
  switch (typeof v) {
    case 'undefined': wU8(0); return true
    case 'boolean': wU8(v ? 3 : 2); return true
    case 'number': wU8(4); wF64(v); return true
    case 'string': wU8(5); wUnits(v); return true
    case 'object':
      if (v === null) { wU8(1); return true }
      if (Array.isArray(v)) {
        wU8(6); wU32(v.length)
        for (let i = 0; i < v.length; i++) if (!wDyn(v[i])) return false
        return true
      }
      if (Object.getPrototypeOf(v) !== Object.prototype && Object.getPrototypeOf(v) !== null) return false
      {
        const keys = Object.keys(v)
        wU8(7); wU32(keys.length)
        for (const k of keys) { wUnits(k); if (!wDyn(v[k])) return false }
        return true
      }
  }
  return false
}
const rU8 = () => ov.getUint8(p++)
const rU32 = () => { const v = ov.getUint32(p, true); p += 4; return v }
const rF64 = () => { const v = ov.getFloat64(p, true); p += 8; return v }
// ignoreBOM: a leading U+FEFF is part of the string, not a byte-order mark.
const utf16 = new TextDecoder('utf-16le', { ignoreBOM: true })
const rUnits = (wellFormed) => {
  const n = rU32()
  let s
  if (n > 24 && wellFormed) s = utf16.decode(wOut.subarray(p, p + 2 * n))
  else {
    s = ''
    for (let i = 0; i < n; i++) s += String.fromCharCode(ov.getUint16(p + 2 * i, true))
  }
  p += 2 * n
  return s
}
// Tag 1: a string from Rust (well-formed); 4: raw code units, lone surrogates included.
const rStr = () => rUnits(rU8() === 1)
const rDyn = () => {
  switch (rU8()) {
    case 0: return undefined
    case 1: return null
    case 2: return false
    case 3: return true
    case 4: return rF64()
    case 5: return rUnits(false)
    case 6: { const n = rU32(); const a = new Array(n); for (let i = 0; i < n; i++) a[i] = rDyn(); return a }
    case 7: { const n = rU32(); const o = {}; for (let i = 0; i < n; i++) { const k = rUnits(false); o[k] = rDyn() } return o }
  }
}

// `blake2b`: binary wire; the JSON version handles inputs of other shapes.
{
const json = module.exports.blake2b
const call = native.blake2bWire
const encode = (a0, a1) => {
at = 0
if (!wDyn(a0)) return false
if (a1 === undefined) {
wU8(0)
} else if (a1 === null) {
return false
wU8(2)
} else {
wU8(1)
if (typeof a1 !== 'number') return false
wF64(a1)
}
return true
}
const decode = () => {
let t
t = rDyn()
return t
}
module.exports.blake2b = function blake2b (a0, a1) {
  try {
    if (arguments.length <= 2 && encode(a0, a1) && wireCall(call)) return decode()
    return json(...arguments)
  } catch (e) {
    throw jsError(e)
  }
}
}

// `blake2bLong`: binary wire; the JSON version handles inputs of other shapes.
{
const json = module.exports.blake2bLong
const call = native.blake2bLongWire
const encode = (a0, a1) => {
at = 0
if (!wDyn(a0)) return false
if (typeof a1 !== 'number') return false
wF64(a1)
return true
}
const decode = () => {
let t
t = rDyn()
return t
}
module.exports.blake2bLong = function blake2bLong (a0, a1) {
  try {
    if (arguments.length <= 2 && encode(a0, a1) && wireCall(call)) return decode()
    return json(...arguments)
  } catch (e) {
    throw jsError(e)
  }
}
}

// `buildChunkNonce`: binary wire; the JSON version handles inputs of other shapes.
{
const json = module.exports.buildChunkNonce
const call = native.buildChunkNonceWire
const encode = (a0, a1) => {
at = 0
if (!wDyn(a0)) return false
if (typeof a1 !== 'number') return false
wF64(a1)
return true
}
const decode = () => {
let t
t = rDyn()
return t
}
module.exports.buildChunkNonce = function buildChunkNonce (a0, a1) {
  try {
    if (arguments.length <= 2 && encode(a0, a1) && wireCall(call)) return decode()
    return json(...arguments)
  } catch (e) {
    throw jsError(e)
  }
}
}

// `buildChunkAad`: binary wire; the JSON version handles inputs of other shapes.
{
const json = module.exports.buildChunkAad
const call = native.buildChunkAadWire
const encode = (a0, a1) => {
at = 0
if (!wDyn(a0)) return false
if (typeof a1 !== 'boolean') return false
wU8(a1 ? 1 : 0)
return true
}
const decode = () => {
let t
t = rDyn()
return t
}
module.exports.buildChunkAad = function buildChunkAad (a0, a1) {
  try {
    if (arguments.length <= 2 && encode(a0, a1) && wireCall(call)) return decode()
    return json(...arguments)
  } catch (e) {
    throw jsError(e)
  }
}
}

// `serializePczkHeader`: binary wire; the JSON version handles inputs of other shapes.
{
const json = module.exports.serializePczkHeader
const call = native.serializePczkHeaderWire
const encode = (a0) => {
at = 0
if (!wDyn(a0)) return false
return true
}
const decode = () => {
let t
t = rDyn()
return t
}
module.exports.serializePczkHeader = function serializePczkHeader (a0) {
  try {
    if (arguments.length <= 1 && encode(a0) && wireCall(call)) return decode()
    return json(...arguments)
  } catch (e) {
    throw jsError(e)
  }
}
}

// `parsePczkHeader`: binary wire; the JSON version handles inputs of other shapes.
{
const json = module.exports.parsePczkHeader
const call = native.parsePczkHeaderWire
const encode = (a0) => {
at = 0
if (!wDyn(a0)) return false
return true
}
const decode = () => {
let t
{
const o0 = {}
const n0 = rU8()
for (let j0 = 0; j0 < n0; j0++) {
switch (rU8()) {
case 0: {
let v0
v0 = rStr()
o0["magic"] = v0
break
}
case 1: {
let v0
v0 = rF64()
o0["version"] = v0
break
}
case 2: {
let v0
v0 = rF64()
o0["chunkSizeLog2"] = v0
break
}
case 3: {
let v0
v0 = rF64()
o0["chunkPlaintextSize"] = v0
break
}
case 4: {
let v0
v0 = rF64()
o0["chunkCiphertextSize"] = v0
break
}
case 5: {
let v0
v0 = rStr()
o0["blobId"] = v0
break
}
case 6: {
let v0
v0 = rDyn()
o0["blobIdBytes"] = v0
break
}
case 7: {
let v0
v0 = rDyn()
o0["noncePrefix"] = v0
break
}
case 8: {
let v0
v0 = rDyn()
o0["wrappedFk"] = v0
break
}
case 9: {
let v0
v0 = rDyn()
o0["rawHeader"] = v0
break
}
default: {
const k0 = rStr()
o0[k0] = rDyn()
}
}
}
t = o0
}
return t
}
module.exports.parsePczkHeader = function parsePczkHeader (a0) {
  try {
    if (arguments.length <= 1 && encode(a0) && wireCall(call)) return decode()
    return json(...arguments)
  } catch (e) {
    throw jsError(e)
  }
}
}

// `computeBlobRangePlan`: binary wire; the JSON version handles inputs of other shapes.
{
const json = module.exports.computeBlobRangePlan
const call = native.computeBlobRangePlanWire
const encode = (a0) => {
at = 0
if (!wDyn(a0)) return false
return true
}
const decode = () => {
let t
{
const o0 = {}
const n0 = rU8()
for (let j0 = 0; j0 < n0; j0++) {
switch (rU8()) {
case 0: {
let v0
v0 = rF64()
o0["totalCiphertextBytes"] = v0
break
}
case 1: {
let v0
v0 = rF64()
o0["totalPlaintextBytes"] = v0
break
}
case 2: {
let v0
v0 = rF64()
o0["chunkSizeLog2"] = v0
break
}
case 3: {
let v0
v0 = rF64()
o0["chunkPlaintextSize"] = v0
break
}
case 4: {
let v0
v0 = rF64()
o0["chunkCiphertextSize"] = v0
break
}
case 5: {
let v0
v0 = rF64()
o0["totalChunks"] = v0
break
}
case 6: {
let v0
v0 = rF64()
o0["startPlaintextByte"] = v0
break
}
case 7: {
let v0
v0 = rF64()
o0["endPlaintextByteInclusive"] = v0
break
}
case 8: {
let v0
v0 = rF64()
o0["startChunkIndex"] = v0
break
}
case 9: {
let v0
v0 = rF64()
o0["endChunkIndex"] = v0
break
}
case 10: {
let v0
v0 = rF64()
o0["ciphertextStartByte"] = v0
break
}
case 11: {
let v0
v0 = rF64()
o0["ciphertextEndByteInclusive"] = v0
break
}
case 12: {
let v0
if (rU8() === 0) v0 = null
else {
const n1 = rU32()
const a1 = new Array(n1)
for (let i1 = 0; i1 < n1; i1++) {
let v1
{
const o2 = {}
const n2 = rU8()
for (let j2 = 0; j2 < n2; j2++) {
switch (rU8()) {
case 0: {
let v2
v2 = rF64()
o2["chunkIndex"] = v2
break
}
case 1: {
let v2
v2 = rU8() === 1
o2["isLast"] = v2
break
}
case 2: {
let v2
v2 = rF64()
o2["ciphertextStartInBlob"] = v2
break
}
case 3: {
let v2
v2 = rF64()
o2["ciphertextEndInclusiveInBlob"] = v2
break
}
case 4: {
let v2
v2 = rF64()
o2["ciphertextOffsetInSlice"] = v2
break
}
case 5: {
let v2
v2 = rF64()
o2["ciphertextLength"] = v2
break
}
case 6: {
let v2
v2 = rF64()
o2["plaintextStartInBlob"] = v2
break
}
case 7: {
let v2
v2 = rF64()
o2["plaintextEndInclusiveInBlob"] = v2
break
}
default: {
const k2 = rStr()
o2[k2] = rDyn()
}
}
}
v1 = o2
}
a1[i1] = v1
}
v0 = a1
}
o0["chunks"] = v0
break
}
default: {
const k0 = rStr()
o0[k0] = rDyn()
}
}
}
t = o0
}
return t
}
module.exports.computeBlobRangePlan = function computeBlobRangePlan (a0) {
  try {
    if (arguments.length <= 1 && encode(a0) && wireCall(call)) return decode()
    return json(...arguments)
  } catch (e) {
    throw jsError(e)
  }
}
}

// `constantTimeEqual`: binary wire; the JSON version handles inputs of other shapes.
{
const json = module.exports.constantTimeEqual
const call = native.constantTimeEqualWire
const encode = (a0, a1) => {
at = 0
if (!wDyn(a0)) return false
if (!wDyn(a1)) return false
return true
}
const decode = () => {
let t
t = rU8() === 1
return t
}
module.exports.constantTimeEqual = function constantTimeEqual (a0, a1) {
  try {
    if (arguments.length <= 2 && encode(a0, a1) && wireCall(call)) return decode()
    return json(...arguments)
  } catch (e) {
    throw jsError(e)
  }
}
}

// `utf8Encode`: binary wire; the JSON version handles inputs of other shapes.
{
const json = module.exports.utf8Encode
const call = native.utf8EncodeWire
const encode = (a0) => {
at = 0
if (typeof a0 !== 'string') return false
wStr(a0)
return true
}
const decode = () => {
let t
t = rDyn()
return t
}
module.exports.utf8Encode = function utf8Encode (a0) {
  if (illFormed(a0)) throw new TypeError('argument 1 of utf8Encode has a lone surrogate, which a Rust String cannot hold')
  try {
    if (arguments.length <= 1 && encode(a0) && wireCall(call)) return decode()
    return json(...arguments)
  } catch (e) {
    throw jsError(e)
  }
}
}

// `utf8Decode`: binary wire; the JSON version handles inputs of other shapes.
{
const json = module.exports.utf8Decode
const call = native.utf8DecodeWire
const encode = (a0) => {
at = 0
if (!wDyn(a0)) return false
return true
}
const decode = () => {
let t
t = rStr()
return t
}
module.exports.utf8Decode = function utf8Decode (a0) {
  try {
    if (arguments.length <= 1 && encode(a0) && wireCall(call)) return decode()
    return json(...arguments)
  } catch (e) {
    throw jsError(e)
  }
}
}

// `normalizePassphraseNfc`: binary wire; the JSON version handles inputs of other shapes.
{
const json = module.exports.normalizePassphraseNfc
const call = native.normalizePassphraseNfcWire
const encode = (a0) => {
at = 0
if (typeof a0 !== 'string') return false
wStr(a0)
return true
}
const decode = () => {
let t
t = rDyn()
return t
}
module.exports.normalizePassphraseNfc = function normalizePassphraseNfc (a0) {
  if (illFormed(a0)) throw new TypeError('argument 1 of normalizePassphraseNfc has a lone surrogate, which a Rust String cannot hold')
  try {
    if (arguments.length <= 1 && encode(a0) && wireCall(call)) return decode()
    return json(...arguments)
  } catch (e) {
    throw jsError(e)
  }
}
}

// `toHex`: binary wire; the JSON version handles inputs of other shapes.
{
const json = module.exports.toHex
const call = native.toHexWire
const encode = (a0) => {
at = 0
if (!wDyn(a0)) return false
return true
}
const decode = () => {
let t
t = rStr()
return t
}
module.exports.toHex = function toHex (a0) {
  try {
    if (arguments.length <= 1 && encode(a0) && wireCall(call)) return decode()
    return json(...arguments)
  } catch (e) {
    throw jsError(e)
  }
}
}

// `fromHex`: binary wire; the JSON version handles inputs of other shapes.
{
const json = module.exports.fromHex
const call = native.fromHexWire
const encode = (a0) => {
at = 0
if (typeof a0 !== 'string') return false
wStr(a0)
return true
}
const decode = () => {
let t
t = rDyn()
return t
}
module.exports.fromHex = function fromHex (a0) {
  if (illFormed(a0)) throw new TypeError('argument 1 of fromHex has a lone surrogate, which a Rust String cannot hold')
  try {
    if (arguments.length <= 1 && encode(a0) && wireCall(call)) return decode()
    return json(...arguments)
  } catch (e) {
    throw jsError(e)
  }
}
}

// `toBase64Url`: binary wire; the JSON version handles inputs of other shapes.
{
const json = module.exports.toBase64Url
const call = native.toBase64UrlWire
const encode = (a0) => {
at = 0
if (!wDyn(a0)) return false
return true
}
const decode = () => {
let t
t = rStr()
return t
}
module.exports.toBase64Url = function toBase64Url (a0) {
  try {
    if (arguments.length <= 1 && encode(a0) && wireCall(call)) return decode()
    return json(...arguments)
  } catch (e) {
    throw jsError(e)
  }
}
}

// `fromBase64Url`: binary wire; the JSON version handles inputs of other shapes.
{
const json = module.exports.fromBase64Url
const call = native.fromBase64UrlWire
const encode = (a0) => {
at = 0
if (typeof a0 !== 'string') return false
wStr(a0)
return true
}
const decode = () => {
let t
t = rDyn()
return t
}
module.exports.fromBase64Url = function fromBase64Url (a0) {
  if (illFormed(a0)) throw new TypeError('argument 1 of fromBase64Url has a lone surrogate, which a Rust String cannot hold')
  try {
    if (arguments.length <= 1 && encode(a0) && wireCall(call)) return decode()
    return json(...arguments)
  } catch (e) {
    throw jsError(e)
  }
}
}

// `uuidToBytes`: binary wire; the JSON version handles inputs of other shapes.
{
const json = module.exports.uuidToBytes
const call = native.uuidToBytesWire
const encode = (a0) => {
at = 0
if (typeof a0 !== 'string') return false
wStr(a0)
return true
}
const decode = () => {
let t
t = rDyn()
return t
}
module.exports.uuidToBytes = function uuidToBytes (a0) {
  if (illFormed(a0)) throw new TypeError('argument 1 of uuidToBytes has a lone surrogate, which a Rust String cannot hold')
  try {
    if (arguments.length <= 1 && encode(a0) && wireCall(call)) return decode()
    return json(...arguments)
  } catch (e) {
    throw jsError(e)
  }
}
}

// `bytesToUuid`: binary wire; the JSON version handles inputs of other shapes.
{
const json = module.exports.bytesToUuid
const call = native.bytesToUuidWire
const encode = (a0) => {
at = 0
if (!wDyn(a0)) return false
return true
}
const decode = () => {
let t
t = rStr()
return t
}
module.exports.bytesToUuid = function bytesToUuid (a0) {
  try {
    if (arguments.length <= 1 && encode(a0) && wireCall(call)) return decode()
    return json(...arguments)
  } catch (e) {
    throw jsError(e)
  }
}
}
const guards = {
  concatBytes: [false, []],
}
const JS_ERRORS = /^(TypeError|RangeError|SyntaxError|ReferenceError|URIError|EvalError): ([\s\S]*)$/
const jsError = e => {
  const message = typeof e?.message === 'string' ? e.message : ''
  const typed = JS_ERRORS.exec(message)
  if (typed) return new globalThis[typed[1]](typed[2])
  if (/Expected$/.test(e?.code)) return Object.assign(new TypeError(message), { code: e.code })
  if (message.startsWith('Rust panic:')) e.code = 'RUST_PANIC'
  return e
}
const illFormed = v => typeof v === 'string' ? !v.isWellFormed() : Array.isArray(v) && v.some(illFormed)
for (const [name, [isAsync, strings]] of Object.entries(guards)) {
  const f = module.exports[name]
  if (typeof f !== 'function') continue
  const check = a => {
    for (const i of strings) {
      if (illFormed(a[i])) throw new TypeError(`argument ${i + 1} of ${name} has a lone surrogate, which a Rust String cannot hold`)
    }
  }
  module.exports[name] = isAsync
    ? { [name]: async function (...a) { check(a); try { return await f(...a) } catch (e) { throw jsError(e) } } }[name]
    : { [name]: function (...a) { check(a); try { return f(...a) } catch (e) { throw jsError(e) } } }[name]
}
