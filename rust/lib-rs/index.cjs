// Loads the native module built by `rust-anything build`.
const native = require('./lib_rs.node')

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
  validateAndroidConfig: [[1], 'raw', false],
  generateAndroidManifestXml: [[1], 'raw', false],
  generateAppBuildGradleKts: [[1], 'raw', false],
  generateMainActivityKt: [[1], 'raw', false],
  deriveKey: [[0, 1], 'json', false],
  deriveKeyAsync: [[0, 1], 'json', true],
  encryptedPlaintextSize: [[1], 'raw', false],
  encryptFile: [[1, 0], 'json', false],
  encryptFileAsync: [[1, 0], 'json', true],
  encryptFileStream: [[0, 0, 0], 'json', true],
  decryptFile: [[1, 0], 'json', false],
  decryptFileAsync: [[1, 0], 'json', true],
  decryptFileSha256Stream: [[0, 0], 'json', true],
  calculateBufferHash: [[1], 'raw', false],
  findDuplicateGroups: [[1], 'json', false],
  resolveFileViewerSpec: [[0], 'json', false],
  parseDelimitedTextToSheet: [[0, 0, 0], 'json', false],
  parseDocumentBuffer: [[1, 1, 0], 'json', true],
  emptyExifMetadata: [[], 'json', false],
  parseExifFromJpeg: [[1], 'json', false],
  readCurrentAndroidReleaseVersion: [[0], 'json', false],
  extractApkSigningCertSha256: [[1], 'raw', true],
  compileSignedAndroidApk: [[0], 'json', true],
  triggerGitHubActionsBuild: [[1], 'json', true],
  publishApkToGitHubRelease: [[1], 'json', true],
  groupMediaItems: [[1, 0], 'json', false],
  normalizeSha256Hex: [[1], 'raw', false],
  cleanupOrphanTempFiles: [[0, 1], 'raw', false],
  sanitizeHexColor: [[1, 0], 'raw', false],
  hexToRgbTuple: [[0], 'json', false],
  sanitizeLiquidGlassConfig: [[1], 'json', false],
  computeLiquidGlassCssVariables: [[1, 0], 'json', false],
  exportLiquidGlassConfigJson: [[1], 'raw', false],
  importLiquidGlassConfigJson: [[0], 'json', false],
  parseNaturalQuery: [[0, 1], 'json', false],
  mediaItemMatchesQuery: [[1, 1, 1], 'raw', false],
  searchMediaItems: [[1, 0, 1, 1], 'json', false],
  getProtectedSigningDir: [[1], 'raw', false],
  getProtectedSigningPropertiesPath: [[1, 1], 'raw', false],
  parseSigningProperties: [[0], 'json', false],
  serializeSigningProperties: [[1], 'raw', false],
  readSigningPropertiesFile: [[0], 'json', false],
  writeProtectedSigningProperties: [[0, 1], 'raw', false],
  createPersistentPkcs12Keystore: [[0, 0, 1], 'json', false],
  applySigningEnvFromProtectedConfig: [[1], 'json', false],
  ensurePersistentLocalSigning: [[1], 'json', false],
  dctPHashFromGrayPixels: [[1, 0, 0], 'json', false],
  pHashToHex: [[1], 'raw', false],
  hexToPHash: [[0], 'json', false],
  computePHashHex: [[1], 'raw', true],
  groupSimilarByHash: [[1, 0], 'json', false],
  applyPresetToEditState: [[1, 0], 'json', false],
  clampNormalizedCropBox: [[1, 0], 'json', false],
  fitAspectNormalizedCropBox: [[0, 0, 0], 'json', false],
  dragNormalizedCropHandle: [[1, 0, 0, 0, 0, 0, 0, 0], 'json', false],
  normalizedBoxToPixelRect: [[0, 0, 1], 'json', false],
  computeCropRect: [[0, 0, 0], 'json', false],
  transformRgbPixel: [[0, 0, 0, 1], 'json', false],
  clampTrimRange: [[0, 0, 0, 0], 'json', false],
  buildCssFilterString: [[1], 'raw', false],
  computeFittedMediaSize: [[0, 0, 0, 0], 'json', false],
  clampZoomPan: [[0, 0, 0, 0, 0, 0, 0, 0, 0], 'json', false],
  computePinchZoomPan: [[1], 'json', false],
  initPushService: [[0], 'json', true],
  loadUserSubscriptions: [[0], 'json', false],
  saveUserSubscriptions: [[0, 1], 'raw', false],
  addUserSubscription: [[0, 1], 'raw', false],
  sendPushToUser: [[0, 1], 'json', true],
  renderSharePage: [[1], 'raw', false],
  renderShareErrorPage: [[1], 'raw', false],
  loadPublicShares: [[0], 'json', false],
  savePublicShares: [[0, 1], 'raw', false],
  loadAlbumShares: [[0], 'json', false],
  saveAlbumShares: [[0, 1], 'raw', false],
  createPublicShare: [[0, 1, 1], 'json', false],
  verifySharePassword: [[1, 0], 'raw', false],
  resolveShareByToken: [[0, 0], 'json', false],
  upsertAlbumShare: [[0, 1, 0, 0, 0, 0, 0], 'json', false],
  computeCloudStorageStats: [[1, 1, 0], 'json', false],
  renderGalleryTemplate: [[1, 1, 1, 1], 'raw', false],
  renderTrashTemplate: [[1, 1], 'raw', false],
  parsePreviewVariant: [[1, 0], 'raw', false],
  isJpegMagicBytes: [[1], 'raw', false],
  writeJsonAtomic: [[0, 1], 'raw', false],
  getOrCreateServerSecret: [[0], 'json', false],
  wrapSecret: [[1, 0], 'json', false],
  unwrapSecret: [[1, 1], 'raw', false],
  isValidUuidV4: [[1], 'raw', false],
  decodeBase64UrlStrict: [[1, 0], 'json', false],
  computeScryptVerifierAsync: [[1, 1], 'json', true],
  verifyScryptConstantTime: [[1, 1, 1], 'raw', true],
  deriveFakeSaltForUsername: [[1, 0], 'raw', false],
  writeBufferAtomicSync: [[0, 0, 1], 'raw', false],
  parseHttpRangeHeader: [[0, 0], 'json', false],
  verifyInviteTokenConstantTime: [[0, 1], 'raw', false],
  isSecureOrLocalhostRequest: [[1], 'raw', false],
}
const classes = {

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

// `validateAndroidConfig`: binary wire; the JSON version handles inputs of other shapes.
{
const json = module.exports.validateAndroidConfig
const call = native.validateAndroidConfigWire
const encode = (a0) => {
at = 0
if (!wDyn(a0)) return false
return true
}
const decode = () => {
let t
{
const g0 = rU8()
if (g0 === 0) t = undefined
else if (g0 === 2) t = null
else {
t = rStr()
}
}
return t
}
module.exports.validateAndroidConfig = function validateAndroidConfig (a0) {
  try {
    if (arguments.length <= 1 && encode(a0) && wireCall(call)) return decode()
    return json(...arguments)
  } catch (e) {
    throw jsError(e)
  }
}
}

// `generateAndroidManifestXml`: binary wire; the JSON version handles inputs of other shapes.
{
const json = module.exports.generateAndroidManifestXml
const call = native.generateAndroidManifestXmlWire
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
module.exports.generateAndroidManifestXml = function generateAndroidManifestXml (a0) {
  try {
    if (arguments.length <= 1 && encode(a0) && wireCall(call)) return decode()
    return json(...arguments)
  } catch (e) {
    throw jsError(e)
  }
}
}

// `generateAppBuildGradleKts`: binary wire; the JSON version handles inputs of other shapes.
{
const json = module.exports.generateAppBuildGradleKts
const call = native.generateAppBuildGradleKtsWire
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
module.exports.generateAppBuildGradleKts = function generateAppBuildGradleKts (a0) {
  try {
    if (arguments.length <= 1 && encode(a0) && wireCall(call)) return decode()
    return json(...arguments)
  } catch (e) {
    throw jsError(e)
  }
}
}

// `generateMainActivityKt`: binary wire; the JSON version handles inputs of other shapes.
{
const json = module.exports.generateMainActivityKt
const call = native.generateMainActivityKtWire
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
module.exports.generateMainActivityKt = function generateMainActivityKt (a0) {
  try {
    if (arguments.length <= 1 && encode(a0) && wireCall(call)) return decode()
    return json(...arguments)
  } catch (e) {
    throw jsError(e)
  }
}
}

// `generateApiKey`: binary wire; the JSON version handles inputs of other shapes.
{
const json = module.exports.generateApiKey
const call = native.generateApiKeyWire
const encode = (a0) => {
at = 0
if (a0 === undefined) {
wU8(0)
} else if (a0 === null) {
return false
wU8(2)
} else {
wU8(1)
if (typeof a0 !== 'number') return false
wF64(a0)
}
return true
}
const decode = () => {
let t
t = rStr()
return t
}
module.exports.generateApiKey = function generateApiKey (a0) {
  try {
    if (arguments.length <= 1 && encode(a0) && wireCall(call)) return decode()
    return json(...arguments)
  } catch (e) {
    throw jsError(e)
  }
}
}

// `hashKey`: binary wire; the JSON version handles inputs of other shapes.
{
const json = module.exports.hashKey
const call = native.hashKeyWire
const encode = (a0) => {
at = 0
if (typeof a0 !== 'string') return false
wStr(a0)
return true
}
const decode = () => {
let t
t = rStr()
return t
}
module.exports.hashKey = function hashKey (a0) {
  if (illFormed(a0)) throw new TypeError('argument 1 of hashKey has a lone surrogate, which a Rust String cannot hold')
  try {
    if (arguments.length <= 1 && encode(a0) && wireCall(call)) return decode()
    return json(...arguments)
  } catch (e) {
    throw jsError(e)
  }
}
}

// `verifyKey`: binary wire; the JSON version handles inputs of other shapes.
{
const json = module.exports.verifyKey
const call = native.verifyKeyWire
const encode = (a0, a1) => {
at = 0
if (typeof a0 !== 'string') return false
wStr(a0)
if (typeof a1 !== 'string') return false
wStr(a1)
return true
}
const decode = () => {
let t
t = rU8() === 1
return t
}
module.exports.verifyKey = function verifyKey (a0, a1) {
  if (illFormed(a0)) throw new TypeError('argument 1 of verifyKey has a lone surrogate, which a Rust String cannot hold')
  if (illFormed(a1)) throw new TypeError('argument 2 of verifyKey has a lone surrogate, which a Rust String cannot hold')
  try {
    if (arguments.length <= 2 && encode(a0, a1) && wireCall(call)) return decode()
    return json(...arguments)
  } catch (e) {
    throw jsError(e)
  }
}
}

// `deriveKey`: binary wire; the JSON version handles inputs of other shapes.
{
const json = module.exports.deriveKey
const call = native.deriveKeyWire
const encode = (a0, a1) => {
at = 0
if (typeof a0 !== 'string') return false
wStr(a0)
if (!wDyn(a1)) return false
return true
}
const decode = () => {
let t
t = rDyn()
return t
}
module.exports.deriveKey = function deriveKey (a0, a1) {
  if (illFormed(a0)) throw new TypeError('argument 1 of deriveKey has a lone surrogate, which a Rust String cannot hold')
  try {
    if (arguments.length <= 2 && encode(a0, a1) && wireCall(call)) return decode()
    return json(...arguments)
  } catch (e) {
    throw jsError(e)
  }
}
}

// `encryptedPlaintextSize`: binary wire; the JSON version handles inputs of other shapes.
{
const json = module.exports.encryptedPlaintextSize
const call = native.encryptedPlaintextSizeWire
const encode = (a0) => {
at = 0
if (!wDyn(a0)) return false
return true
}
const decode = () => {
let t
t = rF64()
return t
}
module.exports.encryptedPlaintextSize = function encryptedPlaintextSize (a0) {
  try {
    if (arguments.length <= 1 && encode(a0) && wireCall(call)) return decode()
    return json(...arguments)
  } catch (e) {
    throw jsError(e)
  }
}
}

// `encryptFile`: binary wire; the JSON version handles inputs of other shapes.
{
const json = module.exports.encryptFile
const call = native.encryptFileWire
const encode = (a0, a1) => {
at = 0
if (!wDyn(a0)) return false
if (typeof a1 !== 'string') return false
wStr(a1)
return true
}
const decode = () => {
let t
t = rDyn()
return t
}
module.exports.encryptFile = function encryptFile (a0, a1) {
  if (illFormed(a1)) throw new TypeError('argument 2 of encryptFile has a lone surrogate, which a Rust String cannot hold')
  try {
    if (arguments.length <= 2 && encode(a0, a1) && wireCall(call)) return decode()
    return json(...arguments)
  } catch (e) {
    throw jsError(e)
  }
}
}

// `decryptFile`: binary wire; the JSON version handles inputs of other shapes.
{
const json = module.exports.decryptFile
const call = native.decryptFileWire
const encode = (a0, a1) => {
at = 0
if (!wDyn(a0)) return false
if (typeof a1 !== 'string') return false
wStr(a1)
return true
}
const decode = () => {
let t
t = rDyn()
return t
}
module.exports.decryptFile = function decryptFile (a0, a1) {
  if (illFormed(a1)) throw new TypeError('argument 2 of decryptFile has a lone surrogate, which a Rust String cannot hold')
  try {
    if (arguments.length <= 2 && encode(a0, a1) && wireCall(call)) return decode()
    return json(...arguments)
  } catch (e) {
    throw jsError(e)
  }
}
}

// `calculateBufferHash`: binary wire; the JSON version handles inputs of other shapes.
{
const json = module.exports.calculateBufferHash
const call = native.calculateBufferHashWire
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
module.exports.calculateBufferHash = function calculateBufferHash (a0) {
  try {
    if (arguments.length <= 1 && encode(a0) && wireCall(call)) return decode()
    return json(...arguments)
  } catch (e) {
    throw jsError(e)
  }
}
}

// `findDuplicateGroups`: binary wire; the JSON version handles inputs of other shapes.
{
const json = module.exports.findDuplicateGroups
const call = native.findDuplicateGroupsWire
const encode = (a0) => {
at = 0
if (!Array.isArray(a0)) return false
wU8(1)
wU32(a0.length)
for (let i0 = 0; i0 < a0.length; i0++) {
const v0 = a0[i0]
if (v0 === null || typeof v0 !== 'object' || Array.isArray(v0)) return false
{
const at1 = at
wU8(0)
let n1 = 0, r1 = 0
for (const k1 in v0) {
switch (k1) {
case "filename": {
wU8(0)
r1++
const f1 = v0[k1]
if (typeof f1 !== 'string') return false
wStr(f1)
break
}
case "hash": {
wU8(1)
r1++
const f1 = v0[k1]
if (f1 === undefined) {
return false
wU8(0)
} else if (f1 === null) {
wU8(2)
} else {
wU8(1)
if (typeof f1 !== 'string') return false
wStr(f1)
}
break
}
default: return false
}
if (++n1 > 255) return false
}
if (r1 !== 2) return false
iv.setUint8(at1, n1)
}
}
return true
}
const decode = () => {
let t
if (rU8() === 0) t = null
else {
const n0 = rU32()
const a0 = new Array(n0)
for (let i0 = 0; i0 < n0; i0++) {
let v0
if (rU8() === 0) v0 = null
else {
const n1 = rU32()
const a1 = new Array(n1)
for (let i1 = 0; i1 < n1; i1++) {
let v1
v1 = rStr()
a1[i1] = v1
}
v0 = a1
}
a0[i0] = v0
}
t = a0
}
return t
}
module.exports.findDuplicateGroups = function findDuplicateGroups (a0) {
  try {
    if (arguments.length <= 1 && encode(a0) && wireCall(call)) return decode()
    return json(...arguments)
  } catch (e) {
    throw jsError(e)
  }
}
}

// `resolveFileViewerSpec`: binary wire; the JSON version handles inputs of other shapes.
{
const json = module.exports.resolveFileViewerSpec
const call = native.resolveFileViewerSpecWire
const encode = (a0) => {
at = 0
if (typeof a0 !== 'string') return false
wStr(a0)
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
o0["filename"] = v0
break
}
case 1: {
let v0
v0 = rStr()
o0["extension"] = v0
break
}
case 2: {
let v0
v0 = rStr()
o0["mimeType"] = v0
break
}
case 3: {
let v0
v0 = rStr()
o0["viewerMode"] = v0
break
}
case 4: {
let v0
v0 = rStr()
o0["viewerType"] = v0
break
}
case 5: {
let v0
v0 = rU8() === 1
o0["canPreviewInApp"] = v0
break
}
case 6: {
let v0
v0 = rU8() === 1
o0["canOpenInApp"] = v0
break
}
case 7: {
let v0
v0 = rStr()
o0["formatLabel"] = v0
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
module.exports.resolveFileViewerSpec = function resolveFileViewerSpec (a0) {
  if (illFormed(a0)) throw new TypeError('argument 1 of resolveFileViewerSpec has a lone surrogate, which a Rust String cannot hold')
  try {
    if (arguments.length <= 1 && encode(a0) && wireCall(call)) return decode()
    return json(...arguments)
  } catch (e) {
    throw jsError(e)
  }
}
}

// `parseDelimitedTextToSheet`: binary wire; the JSON version handles inputs of other shapes.
{
const json = module.exports.parseDelimitedTextToSheet
const call = native.parseDelimitedTextToSheetWire
const encode = (a0, a1, a2) => {
at = 0
if (typeof a0 !== 'string') return false
wStr(a0)
if (a1 === undefined) {
wU8(0)
} else if (a1 === null) {
return false
wU8(2)
} else {
wU8(1)
if (typeof a1 !== 'string') return false
wStr(a1)
}
if (a2 === undefined) {
wU8(0)
} else if (a2 === null) {
return false
wU8(2)
} else {
wU8(1)
if (typeof a2 !== 'string') return false
wStr(a2)
}
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
o0["name"] = v0
break
}
case 1: {
let v0
if (rU8() === 0) v0 = null
else {
const n1 = rU32()
const a1 = new Array(n1)
for (let i1 = 0; i1 < n1; i1++) {
let v1
v1 = rStr()
a1[i1] = v1
}
v0 = a1
}
o0["headers"] = v0
break
}
case 2: {
let v0
if (rU8() === 0) v0 = null
else {
const n1 = rU32()
const a1 = new Array(n1)
for (let i1 = 0; i1 < n1; i1++) {
let v1
if (rU8() === 0) v1 = null
else {
const n2 = rU32()
const a2 = new Array(n2)
for (let i2 = 0; i2 < n2; i2++) {
let v2
v2 = rStr()
a2[i2] = v2
}
v1 = a2
}
a1[i1] = v1
}
v0 = a1
}
o0["rows"] = v0
break
}
case 3: {
let v0
if (rU8() === 0) v0 = null
else {
const n1 = rU32()
const a1 = new Array(n1)
for (let i1 = 0; i1 < n1; i1++) {
let v1
if (rU8() === 0) v1 = null
else {
const n2 = rU32()
const a2 = new Array(n2)
for (let i2 = 0; i2 < n2; i2++) {
let v2
v2 = rStr()
a2[i2] = v2
}
v1 = a2
}
a1[i1] = v1
}
v0 = a1
}
o0["allRows"] = v0
break
}
case 4: {
let v0
v0 = rF64()
o0["totalRows"] = v0
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
module.exports.parseDelimitedTextToSheet = function parseDelimitedTextToSheet (a0, a1, a2) {
  if (illFormed(a0)) throw new TypeError('argument 1 of parseDelimitedTextToSheet has a lone surrogate, which a Rust String cannot hold')
  if (illFormed(a1)) throw new TypeError('argument 2 of parseDelimitedTextToSheet has a lone surrogate, which a Rust String cannot hold')
  if (illFormed(a2)) throw new TypeError('argument 3 of parseDelimitedTextToSheet has a lone surrogate, which a Rust String cannot hold')
  try {
    if (arguments.length <= 3 && encode(a0, a1, a2) && wireCall(call)) return decode()
    return json(...arguments)
  } catch (e) {
    throw jsError(e)
  }
}
}

// `emptyExifMetadata`: binary wire; the JSON version handles inputs of other shapes.
{
const json = module.exports.emptyExifMetadata
const call = native.emptyExifMetadataWire
const encode = () => {
at = 0
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
{
const g1 = rU8()
if (g1 === 0) v0 = undefined
else if (g1 === 2) v0 = null
else {
v0 = rStr()
}
}
o0["make"] = v0
break
}
case 1: {
let v0
{
const g1 = rU8()
if (g1 === 0) v0 = undefined
else if (g1 === 2) v0 = null
else {
v0 = rStr()
}
}
o0["model"] = v0
break
}
case 2: {
let v0
{
const g1 = rU8()
if (g1 === 0) v0 = undefined
else if (g1 === 2) v0 = null
else {
v0 = rStr()
}
}
o0["camera"] = v0
break
}
case 3: {
let v0
{
const g1 = rU8()
if (g1 === 0) v0 = undefined
else if (g1 === 2) v0 = null
else {
v0 = rStr()
}
}
o0["dateTimeOriginal"] = v0
break
}
case 4: {
let v0
{
const g1 = rU8()
if (g1 === 0) v0 = undefined
else if (g1 === 2) v0 = null
else {
v0 = rF64()
}
}
o0["dateTimeOriginalMs"] = v0
break
}
case 5: {
let v0
{
const g1 = rU8()
if (g1 === 0) v0 = undefined
else if (g1 === 2) v0 = null
else {
v0 = rF64()
}
}
o0["apertureFNumber"] = v0
break
}
case 6: {
let v0
{
const g1 = rU8()
if (g1 === 0) v0 = undefined
else if (g1 === 2) v0 = null
else {
v0 = rF64()
}
}
o0["iso"] = v0
break
}
case 7: {
let v0
{
const g1 = rU8()
if (g1 === 0) v0 = undefined
else if (g1 === 2) v0 = null
else {
v0 = rF64()
}
}
o0["exposureTimeSec"] = v0
break
}
case 8: {
let v0
{
const g1 = rU8()
if (g1 === 0) v0 = undefined
else if (g1 === 2) v0 = null
else {
v0 = rStr()
}
}
o0["exposureTimeLabel"] = v0
break
}
case 9: {
let v0
{
const g1 = rU8()
if (g1 === 0) v0 = undefined
else if (g1 === 2) v0 = null
else {
v0 = rF64()
}
}
o0["focalLengthMm"] = v0
break
}
case 10: {
let v0
{
const g1 = rU8()
if (g1 === 0) v0 = undefined
else if (g1 === 2) v0 = null
else {
v0 = rF64()
}
}
o0["latitude"] = v0
break
}
case 11: {
let v0
{
const g1 = rU8()
if (g1 === 0) v0 = undefined
else if (g1 === 2) v0 = null
else {
v0 = rF64()
}
}
o0["longitude"] = v0
break
}
case 12: {
let v0
{
const g1 = rU8()
if (g1 === 0) v0 = undefined
else if (g1 === 2) v0 = null
else {
v0 = rF64()
}
}
o0["altitudeM"] = v0
break
}
case 13: {
let v0
v0 = rU8() === 1
o0["hasGps"] = v0
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
module.exports.emptyExifMetadata = function emptyExifMetadata () {
  try {
    if (arguments.length <= 0 && encode() && wireCall(call)) return decode()
    return json(...arguments)
  } catch (e) {
    throw jsError(e)
  }
}
}

// `isExifParseableFilename`: binary wire; the JSON version handles inputs of other shapes.
{
const json = module.exports.isExifParseableFilename
const call = native.isExifParseableFilenameWire
const encode = (a0) => {
at = 0
if (typeof a0 !== 'string') return false
wStr(a0)
return true
}
const decode = () => {
let t
t = rU8() === 1
return t
}
module.exports.isExifParseableFilename = function isExifParseableFilename (a0) {
  if (illFormed(a0)) throw new TypeError('argument 1 of isExifParseableFilename has a lone surrogate, which a Rust String cannot hold')
  try {
    if (arguments.length <= 1 && encode(a0) && wireCall(call)) return decode()
    return json(...arguments)
  } catch (e) {
    throw jsError(e)
  }
}
}

// `parseExifDateTimeMs`: binary wire; the JSON version handles inputs of other shapes.
{
const json = module.exports.parseExifDateTimeMs
const call = native.parseExifDateTimeMsWire
const encode = (a0) => {
at = 0
if (a0 === undefined) {
return false
wU8(0)
} else if (a0 === null) {
wU8(2)
} else {
wU8(1)
if (typeof a0 !== 'string') return false
wStr(a0)
}
return true
}
const decode = () => {
let t
{
const g0 = rU8()
if (g0 === 0) t = undefined
else if (g0 === 2) t = null
else {
t = rF64()
}
}
return t
}
module.exports.parseExifDateTimeMs = function parseExifDateTimeMs (a0) {
  if (illFormed(a0)) throw new TypeError('argument 1 of parseExifDateTimeMs has a lone surrogate, which a Rust String cannot hold')
  try {
    if (arguments.length <= 1 && encode(a0) && wireCall(call)) return decode()
    return json(...arguments)
  } catch (e) {
    throw jsError(e)
  }
}
}

// `parseExifFromJpeg`: binary wire; the JSON version handles inputs of other shapes.
{
const json = module.exports.parseExifFromJpeg
const call = native.parseExifFromJpegWire
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
{
const g1 = rU8()
if (g1 === 0) v0 = undefined
else if (g1 === 2) v0 = null
else {
v0 = rStr()
}
}
o0["make"] = v0
break
}
case 1: {
let v0
{
const g1 = rU8()
if (g1 === 0) v0 = undefined
else if (g1 === 2) v0 = null
else {
v0 = rStr()
}
}
o0["model"] = v0
break
}
case 2: {
let v0
{
const g1 = rU8()
if (g1 === 0) v0 = undefined
else if (g1 === 2) v0 = null
else {
v0 = rStr()
}
}
o0["camera"] = v0
break
}
case 3: {
let v0
{
const g1 = rU8()
if (g1 === 0) v0 = undefined
else if (g1 === 2) v0 = null
else {
v0 = rStr()
}
}
o0["dateTimeOriginal"] = v0
break
}
case 4: {
let v0
{
const g1 = rU8()
if (g1 === 0) v0 = undefined
else if (g1 === 2) v0 = null
else {
v0 = rF64()
}
}
o0["dateTimeOriginalMs"] = v0
break
}
case 5: {
let v0
{
const g1 = rU8()
if (g1 === 0) v0 = undefined
else if (g1 === 2) v0 = null
else {
v0 = rF64()
}
}
o0["apertureFNumber"] = v0
break
}
case 6: {
let v0
{
const g1 = rU8()
if (g1 === 0) v0 = undefined
else if (g1 === 2) v0 = null
else {
v0 = rF64()
}
}
o0["iso"] = v0
break
}
case 7: {
let v0
{
const g1 = rU8()
if (g1 === 0) v0 = undefined
else if (g1 === 2) v0 = null
else {
v0 = rF64()
}
}
o0["exposureTimeSec"] = v0
break
}
case 8: {
let v0
{
const g1 = rU8()
if (g1 === 0) v0 = undefined
else if (g1 === 2) v0 = null
else {
v0 = rStr()
}
}
o0["exposureTimeLabel"] = v0
break
}
case 9: {
let v0
{
const g1 = rU8()
if (g1 === 0) v0 = undefined
else if (g1 === 2) v0 = null
else {
v0 = rF64()
}
}
o0["focalLengthMm"] = v0
break
}
case 10: {
let v0
{
const g1 = rU8()
if (g1 === 0) v0 = undefined
else if (g1 === 2) v0 = null
else {
v0 = rF64()
}
}
o0["latitude"] = v0
break
}
case 11: {
let v0
{
const g1 = rU8()
if (g1 === 0) v0 = undefined
else if (g1 === 2) v0 = null
else {
v0 = rF64()
}
}
o0["longitude"] = v0
break
}
case 12: {
let v0
{
const g1 = rU8()
if (g1 === 0) v0 = undefined
else if (g1 === 2) v0 = null
else {
v0 = rF64()
}
}
o0["altitudeM"] = v0
break
}
case 13: {
let v0
v0 = rU8() === 1
o0["hasGps"] = v0
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
module.exports.parseExifFromJpeg = function parseExifFromJpeg (a0) {
  try {
    if (arguments.length <= 1 && encode(a0) && wireCall(call)) return decode()
    return json(...arguments)
  } catch (e) {
    throw jsError(e)
  }
}
}

// `readCurrentAndroidReleaseVersion`: binary wire; the JSON version handles inputs of other shapes.
{
const json = module.exports.readCurrentAndroidReleaseVersion
const call = native.readCurrentAndroidReleaseVersionWire
const encode = (a0) => {
at = 0
if (a0 === undefined) {
wU8(0)
} else if (a0 === null) {
return false
wU8(2)
} else {
wU8(1)
if (typeof a0 !== 'string') return false
wStr(a0)
}
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
o0["versionName"] = v0
break
}
case 1: {
let v0
v0 = rF64()
o0["versionCode"] = v0
break
}
case 2: {
let v0
v0 = rStr()
o0["tagName"] = v0
break
}
case 3: {
let v0
v0 = rStr()
o0["apkFilename"] = v0
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
module.exports.readCurrentAndroidReleaseVersion = function readCurrentAndroidReleaseVersion (a0) {
  if (illFormed(a0)) throw new TypeError('argument 1 of readCurrentAndroidReleaseVersion has a lone surrogate, which a Rust String cannot hold')
  try {
    if (arguments.length <= 1 && encode(a0) && wireCall(call)) return decode()
    return json(...arguments)
  } catch (e) {
    throw jsError(e)
  }
}
}

// `collectFilesToSync`: binary wire; the JSON version handles inputs of other shapes.
{
const json = module.exports.collectFilesToSync
const call = native.collectFilesToSyncWire
const encode = (a0) => {
at = 0
if (a0 === undefined) {
wU8(0)
} else if (a0 === null) {
return false
wU8(2)
} else {
wU8(1)
if (typeof a0 !== 'string') return false
wStr(a0)
}
return true
}
const decode = () => {
let t
if (rU8() === 0) t = null
else {
const n0 = rU32()
const a0 = new Array(n0)
for (let i0 = 0; i0 < n0; i0++) {
let v0
v0 = rStr()
a0[i0] = v0
}
t = a0
}
return t
}
module.exports.collectFilesToSync = function collectFilesToSync (a0) {
  if (illFormed(a0)) throw new TypeError('argument 1 of collectFilesToSync has a lone surrogate, which a Rust String cannot hold')
  try {
    if (arguments.length <= 1 && encode(a0) && wireCall(call)) return decode()
    return json(...arguments)
  } catch (e) {
    throw jsError(e)
  }
}
}

// `groupMediaItems`: binary wire; the JSON version handles inputs of other shapes.
{
const json = module.exports.groupMediaItems
const call = native.groupMediaItemsWire
const encode = (a0, a1) => {
at = 0
if (!Array.isArray(a0)) return false
wU8(1)
wU32(a0.length)
for (let i0 = 0; i0 < a0.length; i0++) {
const v0 = a0[i0]
if (v0 === null || typeof v0 !== 'object' || Array.isArray(v0)) return false
{
const at1 = at
wU8(0)
let n1 = 0, r1 = 0
for (const k1 in v0) {
switch (k1) {
case "filename": {
wU8(0)
r1++
const f1 = v0[k1]
if (typeof f1 !== 'string') return false
wStr(f1)
break
}
case "timestamp": {
wU8(1)
r1++
const f1 = v0[k1]
if (typeof f1 !== 'number') return false
wF64(f1)
break
}
case "size": {
wU8(2)
const f1 = v0[k1]
if (f1 === undefined) {
wU8(0)
} else if (f1 === null) {
return false
wU8(2)
} else {
wU8(1)
if (typeof f1 !== 'number') return false
wF64(f1)
}
break
}
case "isMedia": {
wU8(3)
const f1 = v0[k1]
if (f1 === undefined) {
wU8(0)
} else if (f1 === null) {
return false
wU8(2)
} else {
wU8(1)
if (typeof f1 !== 'boolean') return false
wU8(f1 ? 1 : 0)
}
break
}
case "category": {
wU8(4)
const f1 = v0[k1]
if (f1 === undefined) {
wU8(0)
} else if (f1 === null) {
return false
wU8(2)
} else {
wU8(1)
if (typeof f1 !== 'string') return false
wStr(f1)
}
break
}
case "album": {
wU8(5)
const f1 = v0[k1]
if (f1 === undefined) {
wU8(0)
} else if (f1 === null) {
return false
wU8(2)
} else {
wU8(1)
if (typeof f1 !== 'string') return false
wStr(f1)
}
break
}
case "hasThumb": {
wU8(6)
const f1 = v0[k1]
if (f1 === undefined) {
wU8(0)
} else if (f1 === null) {
return false
wU8(2)
} else {
wU8(1)
if (typeof f1 !== 'boolean') return false
wU8(f1 ? 1 : 0)
}
break
}
default: return false
}
if (++n1 > 255) return false
}
if (r1 !== 2) return false
iv.setUint8(at1, n1)
}
}
if (typeof a1 !== 'string') return false
wStr(a1)
return true
}
const decode = () => {
let t
if (rU8() === 0) t = null
else {
const n0 = rU32()
const a0 = new Array(n0)
for (let i0 = 0; i0 < n0; i0++) {
let v0
{
const o1 = {}
const n1 = rU8()
for (let j1 = 0; j1 < n1; j1++) {
switch (rU8()) {
case 0: {
let v1
v1 = rStr()
o1["title"] = v1
break
}
case 1: {
let v1
if (rU8() === 0) v1 = null
else {
const n2 = rU32()
const a2 = new Array(n2)
for (let i2 = 0; i2 < n2; i2++) {
let v2
{
const o3 = {}
const n3 = rU8()
for (let j3 = 0; j3 < n3; j3++) {
switch (rU8()) {
case 0: {
let v3
v3 = rStr()
o3["filename"] = v3
break
}
case 1: {
let v3
v3 = rF64()
o3["timestamp"] = v3
break
}
case 2: {
let v3
{
const g4 = rU8()
if (g4 === 0) v3 = undefined
else if (g4 === 2) v3 = null
else {
v3 = rF64()
}
}
o3["size"] = v3
break
}
case 3: {
let v3
{
const g4 = rU8()
if (g4 === 0) v3 = undefined
else if (g4 === 2) v3 = null
else {
v3 = rU8() === 1
}
}
o3["isMedia"] = v3
break
}
case 4: {
let v3
v3 = rDyn()
o3["category"] = v3
break
}
case 5: {
let v3
{
const g4 = rU8()
if (g4 === 0) v3 = undefined
else if (g4 === 2) v3 = null
else {
v3 = rStr()
}
}
o3["album"] = v3
break
}
case 6: {
let v3
{
const g4 = rU8()
if (g4 === 0) v3 = undefined
else if (g4 === 2) v3 = null
else {
v3 = rU8() === 1
}
}
o3["hasThumb"] = v3
break
}
default: {
const k3 = rStr()
o3[k3] = rDyn()
}
}
}
v2 = o3
}
a2[i2] = v2
}
v1 = a2
}
o1["items"] = v1
break
}
default: {
const k1 = rStr()
o1[k1] = rDyn()
}
}
}
v0 = o1
}
a0[i0] = v0
}
t = a0
}
return t
}
module.exports.groupMediaItems = function groupMediaItems (a0, a1) {
  if (illFormed(a1)) throw new TypeError('argument 2 of groupMediaItems has a lone surrogate, which a Rust String cannot hold')
  try {
    if (arguments.length <= 2 && encode(a0, a1) && wireCall(call)) return decode()
    return json(...arguments)
  } catch (e) {
    throw jsError(e)
  }
}
}

// `isVideoFilename`: binary wire; the JSON version handles inputs of other shapes.
{
const json = module.exports.isVideoFilename
const call = native.isVideoFilenameWire
const encode = (a0) => {
at = 0
if (typeof a0 !== 'string') return false
wStr(a0)
return true
}
const decode = () => {
let t
t = rU8() === 1
return t
}
module.exports.isVideoFilename = function isVideoFilename (a0) {
  if (illFormed(a0)) throw new TypeError('argument 1 of isVideoFilename has a lone surrogate, which a Rust String cannot hold')
  try {
    if (arguments.length <= 1 && encode(a0) && wireCall(call)) return decode()
    return json(...arguments)
  } catch (e) {
    throw jsError(e)
  }
}
}

// `normalizeSha256Hex`: binary wire; the JSON version handles inputs of other shapes.
{
const json = module.exports.normalizeSha256Hex
const call = native.normalizeSha256HexWire
const encode = (a0) => {
at = 0
if (!wDyn(a0)) return false
return true
}
const decode = () => {
let t
{
const g0 = rU8()
if (g0 === 0) t = undefined
else if (g0 === 2) t = null
else {
t = rStr()
}
}
return t
}
module.exports.normalizeSha256Hex = function normalizeSha256Hex (a0) {
  try {
    if (arguments.length <= 1 && encode(a0) && wireCall(call)) return decode()
    return json(...arguments)
  } catch (e) {
    throw jsError(e)
  }
}
}

// `cleanupOrphanTempFiles`: binary wire; the JSON version handles inputs of other shapes.
{
const json = module.exports.cleanupOrphanTempFiles
const call = native.cleanupOrphanTempFilesWire
const encode = (a0, a1) => {
at = 0
if (typeof a0 !== 'string') return false
wStr(a0)
if (!wDyn(a1)) return false
return true
}
const decode = () => {
let t
t = rF64()
return t
}
module.exports.cleanupOrphanTempFiles = function cleanupOrphanTempFiles (a0, a1) {
  if (illFormed(a0)) throw new TypeError('argument 1 of cleanupOrphanTempFiles has a lone surrogate, which a Rust String cannot hold')
  try {
    if (arguments.length <= 2 && encode(a0, a1) && wireCall(call)) return decode()
    return json(...arguments)
  } catch (e) {
    throw jsError(e)
  }
}
}

// `sanitizeHexColor`: binary wire; the JSON version handles inputs of other shapes.
{
const json = module.exports.sanitizeHexColor
const call = native.sanitizeHexColorWire
const encode = (a0, a1) => {
at = 0
if (!wDyn(a0)) return false
if (typeof a1 !== 'string') return false
wStr(a1)
return true
}
const decode = () => {
let t
t = rStr()
return t
}
module.exports.sanitizeHexColor = function sanitizeHexColor (a0, a1) {
  if (illFormed(a1)) throw new TypeError('argument 2 of sanitizeHexColor has a lone surrogate, which a Rust String cannot hold')
  try {
    if (arguments.length <= 2 && encode(a0, a1) && wireCall(call)) return decode()
    return json(...arguments)
  } catch (e) {
    throw jsError(e)
  }
}
}

// `hexToRgbTuple`: binary wire; the JSON version handles inputs of other shapes.
{
const json = module.exports.hexToRgbTuple
const call = native.hexToRgbTupleWire
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
module.exports.hexToRgbTuple = function hexToRgbTuple (a0) {
  if (illFormed(a0)) throw new TypeError('argument 1 of hexToRgbTuple has a lone surrogate, which a Rust String cannot hold')
  try {
    if (arguments.length <= 1 && encode(a0) && wireCall(call)) return decode()
    return json(...arguments)
  } catch (e) {
    throw jsError(e)
  }
}
}

// `sanitizeLiquidGlassConfig`: binary wire; the JSON version handles inputs of other shapes.
{
const json = module.exports.sanitizeLiquidGlassConfig
const call = native.sanitizeLiquidGlassConfigWire
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
o0["glassIntensity"] = v0
break
}
case 1: {
let v0
v0 = rF64()
o0["transparency"] = v0
break
}
case 2: {
let v0
v0 = rF64()
o0["opacity"] = v0
break
}
case 3: {
let v0
v0 = rF64()
o0["blurRadius"] = v0
break
}
case 4: {
let v0
v0 = rF64()
o0["backdropSaturation"] = v0
break
}
case 5: {
let v0
v0 = rF64()
o0["brightness"] = v0
break
}
case 6: {
let v0
v0 = rF64()
o0["contrast"] = v0
break
}
case 7: {
let v0
v0 = rF64()
o0["visualDepth"] = v0
break
}
case 8: {
let v0
v0 = rStr()
o0["primaryColor"] = v0
break
}
case 9: {
let v0
v0 = rStr()
o0["secondaryColor"] = v0
break
}
case 10: {
let v0
v0 = rStr()
o0["glassColor"] = v0
break
}
case 11: {
let v0
v0 = rStr()
o0["surfaceToneColor"] = v0
break
}
case 12: {
let v0
v0 = rStr()
o0["borderColor"] = v0
break
}
case 13: {
let v0
v0 = rStr()
o0["iconColor"] = v0
break
}
case 14: {
let v0
v0 = rStr()
o0["textColor"] = v0
break
}
case 15: {
let v0
v0 = rStr()
o0["accentColor"] = v0
break
}
case 16: {
let v0
v0 = rU8() === 1
o0["useCustomColors"] = v0
break
}
case 17: {
let v0
v0 = rU8() === 1
o0["specularHighlights"] = v0
break
}
case 18: {
let v0
v0 = rF64()
o0["highlightIntensity"] = v0
break
}
case 19: {
let v0
v0 = rU8() === 1
o0["luminousBorders"] = v0
break
}
case 20: {
let v0
v0 = rF64()
o0["borderGlowIntensity"] = v0
break
}
case 21: {
let v0
v0 = rU8() === 1
o0["surfaceGradient"] = v0
break
}
case 22: {
let v0
v0 = rF64()
o0["gradientAngle"] = v0
break
}
case 23: {
let v0
v0 = rU8() === 1
o0["shadowsEnabled"] = v0
break
}
case 24: {
let v0
v0 = rF64()
o0["shadowIntensity"] = v0
break
}
case 25: {
let v0
v0 = rU8() === 1
o0["depthEffect"] = v0
break
}
case 26: {
let v0
v0 = rF64()
o0["refractionIntensity"] = v0
break
}
case 27: {
let v0
v0 = rU8() === 1
o0["animationsEnabled"] = v0
break
}
case 28: {
let v0
v0 = rF64()
o0["animationIntensity"] = v0
break
}
case 29: {
let v0
v0 = rF64()
o0["componentCornerRadius"] = v0
break
}
case 30: {
let v0
v0 = rStr()
o0["navBarGlassStyle"] = v0
break
}
case 31: {
let v0
v0 = rStr()
o0["cardGlassStyle"] = v0
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
module.exports.sanitizeLiquidGlassConfig = function sanitizeLiquidGlassConfig (a0) {
  try {
    if (arguments.length <= 1 && encode(a0) && wireCall(call)) return decode()
    return json(...arguments)
  } catch (e) {
    throw jsError(e)
  }
}
}

// `computeLiquidGlassCssVariables`: binary wire; the JSON version handles inputs of other shapes.
{
const json = module.exports.computeLiquidGlassCssVariables
const call = native.computeLiquidGlassCssVariablesWire
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
if (typeof a1 !== 'boolean') return false
wU8(a1 ? 1 : 0)
}
return true
}
const decode = () => {
let t
if (rU8() === 0) t = null
else {
const n0 = rU32()
const o0 = {}
for (let i0 = 0; i0 < n0; i0++) {
const k0 = rStr()
let v0
v0 = rStr()
o0[k0] = v0
}
t = o0
}
return t
}
module.exports.computeLiquidGlassCssVariables = function computeLiquidGlassCssVariables (a0, a1) {
  try {
    if (arguments.length <= 2 && encode(a0, a1) && wireCall(call)) return decode()
    return json(...arguments)
  } catch (e) {
    throw jsError(e)
  }
}
}

// `exportLiquidGlassConfigJson`: binary wire; the JSON version handles inputs of other shapes.
{
const json = module.exports.exportLiquidGlassConfigJson
const call = native.exportLiquidGlassConfigJsonWire
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
module.exports.exportLiquidGlassConfigJson = function exportLiquidGlassConfigJson (a0) {
  try {
    if (arguments.length <= 1 && encode(a0) && wireCall(call)) return decode()
    return json(...arguments)
  } catch (e) {
    throw jsError(e)
  }
}
}

// `importLiquidGlassConfigJson`: binary wire; the JSON version handles inputs of other shapes.
{
const json = module.exports.importLiquidGlassConfigJson
const call = native.importLiquidGlassConfigJsonWire
const encode = (a0) => {
at = 0
if (typeof a0 !== 'string') return false
wStr(a0)
return true
}
const decode = () => {
let t
{
const g0 = rU8()
if (g0 === 0) t = undefined
else if (g0 === 2) t = null
else {
{
const o1 = {}
const n1 = rU8()
for (let j1 = 0; j1 < n1; j1++) {
switch (rU8()) {
case 0: {
let v1
v1 = rF64()
o1["glassIntensity"] = v1
break
}
case 1: {
let v1
v1 = rF64()
o1["transparency"] = v1
break
}
case 2: {
let v1
v1 = rF64()
o1["opacity"] = v1
break
}
case 3: {
let v1
v1 = rF64()
o1["blurRadius"] = v1
break
}
case 4: {
let v1
v1 = rF64()
o1["backdropSaturation"] = v1
break
}
case 5: {
let v1
v1 = rF64()
o1["brightness"] = v1
break
}
case 6: {
let v1
v1 = rF64()
o1["contrast"] = v1
break
}
case 7: {
let v1
v1 = rF64()
o1["visualDepth"] = v1
break
}
case 8: {
let v1
v1 = rStr()
o1["primaryColor"] = v1
break
}
case 9: {
let v1
v1 = rStr()
o1["secondaryColor"] = v1
break
}
case 10: {
let v1
v1 = rStr()
o1["glassColor"] = v1
break
}
case 11: {
let v1
v1 = rStr()
o1["surfaceToneColor"] = v1
break
}
case 12: {
let v1
v1 = rStr()
o1["borderColor"] = v1
break
}
case 13: {
let v1
v1 = rStr()
o1["iconColor"] = v1
break
}
case 14: {
let v1
v1 = rStr()
o1["textColor"] = v1
break
}
case 15: {
let v1
v1 = rStr()
o1["accentColor"] = v1
break
}
case 16: {
let v1
v1 = rU8() === 1
o1["useCustomColors"] = v1
break
}
case 17: {
let v1
v1 = rU8() === 1
o1["specularHighlights"] = v1
break
}
case 18: {
let v1
v1 = rF64()
o1["highlightIntensity"] = v1
break
}
case 19: {
let v1
v1 = rU8() === 1
o1["luminousBorders"] = v1
break
}
case 20: {
let v1
v1 = rF64()
o1["borderGlowIntensity"] = v1
break
}
case 21: {
let v1
v1 = rU8() === 1
o1["surfaceGradient"] = v1
break
}
case 22: {
let v1
v1 = rF64()
o1["gradientAngle"] = v1
break
}
case 23: {
let v1
v1 = rU8() === 1
o1["shadowsEnabled"] = v1
break
}
case 24: {
let v1
v1 = rF64()
o1["shadowIntensity"] = v1
break
}
case 25: {
let v1
v1 = rU8() === 1
o1["depthEffect"] = v1
break
}
case 26: {
let v1
v1 = rF64()
o1["refractionIntensity"] = v1
break
}
case 27: {
let v1
v1 = rU8() === 1
o1["animationsEnabled"] = v1
break
}
case 28: {
let v1
v1 = rF64()
o1["animationIntensity"] = v1
break
}
case 29: {
let v1
v1 = rF64()
o1["componentCornerRadius"] = v1
break
}
case 30: {
let v1
v1 = rStr()
o1["navBarGlassStyle"] = v1
break
}
case 31: {
let v1
v1 = rStr()
o1["cardGlassStyle"] = v1
break
}
default: {
const k1 = rStr()
o1[k1] = rDyn()
}
}
}
t = o1
}
}
}
return t
}
module.exports.importLiquidGlassConfigJson = function importLiquidGlassConfigJson (a0) {
  if (illFormed(a0)) throw new TypeError('argument 1 of importLiquidGlassConfigJson has a lone surrogate, which a Rust String cannot hold')
  try {
    if (arguments.length <= 1 && encode(a0) && wireCall(call)) return decode()
    return json(...arguments)
  } catch (e) {
    throw jsError(e)
  }
}
}

// `renderMapPage`: binary wire; the JSON version handles inputs of other shapes.
{
const json = module.exports.renderMapPage
const call = native.renderMapPageWire
const encode = (a0) => {
at = 0
if (typeof a0 !== 'string') return false
wStr(a0)
return true
}
const decode = () => {
let t
t = rStr()
return t
}
module.exports.renderMapPage = function renderMapPage (a0) {
  if (illFormed(a0)) throw new TypeError('argument 1 of renderMapPage has a lone surrogate, which a Rust String cannot hold')
  try {
    if (arguments.length <= 1 && encode(a0) && wireCall(call)) return decode()
    return json(...arguments)
  } catch (e) {
    throw jsError(e)
  }
}
}

// `parseNaturalQuery`: binary wire; the JSON version handles inputs of other shapes.
{
const json = module.exports.parseNaturalQuery
const call = native.parseNaturalQueryWire
const encode = (a0, a1) => {
at = 0
if (typeof a0 !== 'string') return false
wStr(a0)
if (!wDyn(a1)) return false
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
if (rU8() === 0) v0 = null
else {
const n1 = rU32()
const a1 = new Array(n1)
for (let i1 = 0; i1 < n1; i1++) {
let v1
v1 = rStr()
a1[i1] = v1
}
v0 = a1
}
o0["textTokens"] = v0
break
}
case 1: {
let v0
if (rU8() === 0) v0 = null
else {
const n1 = rU32()
const a1 = new Array(n1)
for (let i1 = 0; i1 < n1; i1++) {
let v1
v1 = rF64()
a1[i1] = v1
}
v0 = a1
}
o0["years"] = v0
break
}
case 2: {
let v0
if (rU8() === 0) v0 = null
else {
const n1 = rU32()
const a1 = new Array(n1)
for (let i1 = 0; i1 < n1; i1++) {
let v1
v1 = rF64()
a1[i1] = v1
}
v0 = a1
}
o0["months"] = v0
break
}
case 3: {
let v0
if (rU8() === 0) v0 = null
else {
const n1 = rU32()
const a1 = new Array(n1)
for (let i1 = 0; i1 < n1; i1++) {
let v1
v1 = rF64()
a1[i1] = v1
}
v0 = a1
}
o0["days"] = v0
break
}
case 4: {
let v0
{
const g1 = rU8()
if (g1 === 0) v0 = undefined
else if (g1 === 2) v0 = null
else {
v0 = rF64()
}
}
o0["dateFrom"] = v0
break
}
case 5: {
let v0
{
const g1 = rU8()
if (g1 === 0) v0 = undefined
else if (g1 === 2) v0 = null
else {
v0 = rF64()
}
}
o0["dateTo"] = v0
break
}
case 6: {
let v0
{
const g1 = rU8()
if (g1 === 0) v0 = undefined
else if (g1 === 2) v0 = null
else {
v0 = rStr()
}
}
o0["mediaType"] = v0
break
}
case 7: {
let v0
v0 = rU8() === 1
o0["favoritesOnly"] = v0
break
}
case 8: {
let v0
if (rU8() === 0) v0 = null
else {
const n1 = rU32()
const a1 = new Array(n1)
for (let i1 = 0; i1 < n1; i1++) {
let v1
v1 = rStr()
a1[i1] = v1
}
v0 = a1
}
o0["albums"] = v0
break
}
case 9: {
let v0
if (rU8() === 0) v0 = null
else {
const n1 = rU32()
const a1 = new Array(n1)
for (let i1 = 0; i1 < n1; i1++) {
let v1
v1 = rStr()
a1[i1] = v1
}
v0 = a1
}
o0["explanation"] = v0
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
module.exports.parseNaturalQuery = function parseNaturalQuery (a0, a1) {
  if (illFormed(a0)) throw new TypeError('argument 1 of parseNaturalQuery has a lone surrogate, which a Rust String cannot hold')
  try {
    if (arguments.length <= 2 && encode(a0, a1) && wireCall(call)) return decode()
    return json(...arguments)
  } catch (e) {
    throw jsError(e)
  }
}
}

// `mediaItemMatchesQuery`: binary wire; the JSON version handles inputs of other shapes.
{
const json = module.exports.mediaItemMatchesQuery
const call = native.mediaItemMatchesQueryWire
const encode = (a0, a1, a2) => {
at = 0
if (!wDyn(a0)) return false
if (!wDyn(a1)) return false
if (!wDyn(a2)) return false
return true
}
const decode = () => {
let t
t = rU8() === 1
return t
}
module.exports.mediaItemMatchesQuery = function mediaItemMatchesQuery (a0, a1, a2) {
  try {
    if (arguments.length <= 3 && encode(a0, a1, a2) && wireCall(call)) return decode()
    return json(...arguments)
  } catch (e) {
    throw jsError(e)
  }
}
}

// `searchMediaItems`: binary wire; the JSON version handles inputs of other shapes.
{
const json = module.exports.searchMediaItems
const call = native.searchMediaItemsWire
const encode = (a0, a1, a2, a3) => {
at = 0
if (!Array.isArray(a0)) return false
wU8(1)
wU32(a0.length)
for (let i0 = 0; i0 < a0.length; i0++) {
const v0 = a0[i0]
if (v0 === null || typeof v0 !== 'object' || Array.isArray(v0)) return false
{
const at1 = at
wU8(0)
let n1 = 0, r1 = 0
for (const k1 in v0) {
switch (k1) {
case "filename": {
wU8(0)
r1++
const f1 = v0[k1]
if (typeof f1 !== 'string') return false
wStr(f1)
break
}
case "timestamp": {
wU8(1)
r1++
const f1 = v0[k1]
if (typeof f1 !== 'number') return false
wF64(f1)
break
}
case "isMedia": {
wU8(2)
r1++
const f1 = v0[k1]
if (typeof f1 !== 'boolean') return false
wU8(f1 ? 1 : 0)
break
}
case "album": {
wU8(3)
const f1 = v0[k1]
if (f1 === undefined) {
wU8(0)
} else if (f1 === null) {
return false
wU8(2)
} else {
wU8(1)
if (typeof f1 !== 'string') return false
wStr(f1)
}
break
}
default: return false
}
if (++n1 > 255) return false
}
if (r1 !== 3) return false
iv.setUint8(at1, n1)
}
}
if (typeof a1 !== 'string') return false
wStr(a1)
if (!wDyn(a2)) return false
if (!wDyn(a3)) return false
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
{
const o1 = {}
const n1 = rU8()
for (let j1 = 0; j1 < n1; j1++) {
switch (rU8()) {
case 0: {
let v1
if (rU8() === 0) v1 = null
else {
const n2 = rU32()
const a2 = new Array(n2)
for (let i2 = 0; i2 < n2; i2++) {
let v2
v2 = rStr()
a2[i2] = v2
}
v1 = a2
}
o1["textTokens"] = v1
break
}
case 1: {
let v1
if (rU8() === 0) v1 = null
else {
const n2 = rU32()
const a2 = new Array(n2)
for (let i2 = 0; i2 < n2; i2++) {
let v2
v2 = rF64()
a2[i2] = v2
}
v1 = a2
}
o1["years"] = v1
break
}
case 2: {
let v1
if (rU8() === 0) v1 = null
else {
const n2 = rU32()
const a2 = new Array(n2)
for (let i2 = 0; i2 < n2; i2++) {
let v2
v2 = rF64()
a2[i2] = v2
}
v1 = a2
}
o1["months"] = v1
break
}
case 3: {
let v1
if (rU8() === 0) v1 = null
else {
const n2 = rU32()
const a2 = new Array(n2)
for (let i2 = 0; i2 < n2; i2++) {
let v2
v2 = rF64()
a2[i2] = v2
}
v1 = a2
}
o1["days"] = v1
break
}
case 4: {
let v1
{
const g2 = rU8()
if (g2 === 0) v1 = undefined
else if (g2 === 2) v1 = null
else {
v1 = rF64()
}
}
o1["dateFrom"] = v1
break
}
case 5: {
let v1
{
const g2 = rU8()
if (g2 === 0) v1 = undefined
else if (g2 === 2) v1 = null
else {
v1 = rF64()
}
}
o1["dateTo"] = v1
break
}
case 6: {
let v1
{
const g2 = rU8()
if (g2 === 0) v1 = undefined
else if (g2 === 2) v1 = null
else {
v1 = rStr()
}
}
o1["mediaType"] = v1
break
}
case 7: {
let v1
v1 = rU8() === 1
o1["favoritesOnly"] = v1
break
}
case 8: {
let v1
if (rU8() === 0) v1 = null
else {
const n2 = rU32()
const a2 = new Array(n2)
for (let i2 = 0; i2 < n2; i2++) {
let v2
v2 = rStr()
a2[i2] = v2
}
v1 = a2
}
o1["albums"] = v1
break
}
case 9: {
let v1
if (rU8() === 0) v1 = null
else {
const n2 = rU32()
const a2 = new Array(n2)
for (let i2 = 0; i2 < n2; i2++) {
let v2
v2 = rStr()
a2[i2] = v2
}
v1 = a2
}
o1["explanation"] = v1
break
}
default: {
const k1 = rStr()
o1[k1] = rDyn()
}
}
}
v0 = o1
}
o0["query"] = v0
break
}
case 1: {
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
v2 = rStr()
o2["filename"] = v2
break
}
case 1: {
let v2
v2 = rF64()
o2["timestamp"] = v2
break
}
case 2: {
let v2
v2 = rU8() === 1
o2["isMedia"] = v2
break
}
case 3: {
let v2
{
const g3 = rU8()
if (g3 === 0) v2 = undefined
else if (g3 === 2) v2 = null
else {
v2 = rStr()
}
}
o2["album"] = v2
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
o0["results"] = v0
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
module.exports.searchMediaItems = function searchMediaItems (a0, a1, a2, a3) {
  if (illFormed(a1)) throw new TypeError('argument 2 of searchMediaItems has a lone surrogate, which a Rust String cannot hold')
  try {
    if (arguments.length <= 4 && encode(a0, a1, a2, a3) && wireCall(call)) return decode()
    return json(...arguments)
  } catch (e) {
    throw jsError(e)
  }
}
}

// `getProtectedSigningDir`: binary wire; the JSON version handles inputs of other shapes.
{
const json = module.exports.getProtectedSigningDir
const call = native.getProtectedSigningDirWire
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
module.exports.getProtectedSigningDir = function getProtectedSigningDir (a0) {
  try {
    if (arguments.length <= 1 && encode(a0) && wireCall(call)) return decode()
    return json(...arguments)
  } catch (e) {
    throw jsError(e)
  }
}
}

// `getProtectedSigningPropertiesPath`: binary wire; the JSON version handles inputs of other shapes.
{
const json = module.exports.getProtectedSigningPropertiesPath
const call = native.getProtectedSigningPropertiesPathWire
const encode = (a0, a1) => {
at = 0
if (!wDyn(a0)) return false
if (!wDyn(a1)) return false
return true
}
const decode = () => {
let t
t = rStr()
return t
}
module.exports.getProtectedSigningPropertiesPath = function getProtectedSigningPropertiesPath (a0, a1) {
  try {
    if (arguments.length <= 2 && encode(a0, a1) && wireCall(call)) return decode()
    return json(...arguments)
  } catch (e) {
    throw jsError(e)
  }
}
}

// `parseSigningProperties`: binary wire; the JSON version handles inputs of other shapes.
{
const json = module.exports.parseSigningProperties
const call = native.parseSigningPropertiesWire
const encode = (a0) => {
at = 0
if (typeof a0 !== 'string') return false
wStr(a0)
return true
}
const decode = () => {
let t
if (rU8() === 0) t = null
else {
const n0 = rU32()
const o0 = {}
for (let i0 = 0; i0 < n0; i0++) {
const k0 = rStr()
let v0
v0 = rStr()
o0[k0] = v0
}
t = o0
}
return t
}
module.exports.parseSigningProperties = function parseSigningProperties (a0) {
  if (illFormed(a0)) throw new TypeError('argument 1 of parseSigningProperties has a lone surrogate, which a Rust String cannot hold')
  try {
    if (arguments.length <= 1 && encode(a0) && wireCall(call)) return decode()
    return json(...arguments)
  } catch (e) {
    throw jsError(e)
  }
}
}

// `serializeSigningProperties`: binary wire; the JSON version handles inputs of other shapes.
{
const json = module.exports.serializeSigningProperties
const call = native.serializeSigningPropertiesWire
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
module.exports.serializeSigningProperties = function serializeSigningProperties (a0) {
  try {
    if (arguments.length <= 1 && encode(a0) && wireCall(call)) return decode()
    return json(...arguments)
  } catch (e) {
    throw jsError(e)
  }
}
}

// `enforceProtectedPermissions`: binary wire; the JSON version handles inputs of other shapes.
{
const json = module.exports.enforceProtectedPermissions
const call = native.enforceProtectedPermissionsWire
const encode = (a0, a1) => {
at = 0
if (typeof a0 !== 'string') return false
wStr(a0)
if (typeof a1 !== 'boolean') return false
wU8(a1 ? 1 : 0)
return true
}
const decode = () => {
let t
return t
}
module.exports.enforceProtectedPermissions = function enforceProtectedPermissions (a0, a1) {
  if (illFormed(a0)) throw new TypeError('argument 1 of enforceProtectedPermissions has a lone surrogate, which a Rust String cannot hold')
  try {
    if (arguments.length <= 2 && encode(a0, a1) && wireCall(call)) return decode()
    return json(...arguments)
  } catch (e) {
    throw jsError(e)
  }
}
}

// `readSigningPropertiesFile`: binary wire; the JSON version handles inputs of other shapes.
{
const json = module.exports.readSigningPropertiesFile
const call = native.readSigningPropertiesFileWire
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
module.exports.readSigningPropertiesFile = function readSigningPropertiesFile (a0) {
  if (illFormed(a0)) throw new TypeError('argument 1 of readSigningPropertiesFile has a lone surrogate, which a Rust String cannot hold')
  try {
    if (arguments.length <= 1 && encode(a0) && wireCall(call)) return decode()
    return json(...arguments)
  } catch (e) {
    throw jsError(e)
  }
}
}

// `writeProtectedSigningProperties`: binary wire; the JSON version handles inputs of other shapes.
{
const json = module.exports.writeProtectedSigningProperties
const call = native.writeProtectedSigningPropertiesWire
const encode = (a0, a1) => {
at = 0
if (typeof a0 !== 'string') return false
wStr(a0)
if (!wDyn(a1)) return false
return true
}
const decode = () => {
let t
return t
}
module.exports.writeProtectedSigningProperties = function writeProtectedSigningProperties (a0, a1) {
  if (illFormed(a0)) throw new TypeError('argument 1 of writeProtectedSigningProperties has a lone surrogate, which a Rust String cannot hold')
  try {
    if (arguments.length <= 2 && encode(a0, a1) && wireCall(call)) return decode()
    return json(...arguments)
  } catch (e) {
    throw jsError(e)
  }
}
}

// `computePkcs12CertSha256WithOpenSsl`: binary wire; the JSON version handles inputs of other shapes.
{
const json = module.exports.computePkcs12CertSha256WithOpenSsl
const call = native.computePkcs12CertSha256WithOpenSslWire
const encode = (a0, a1) => {
at = 0
if (typeof a0 !== 'string') return false
wStr(a0)
if (typeof a1 !== 'string') return false
wStr(a1)
return true
}
const decode = () => {
let t
t = rStr()
return t
}
module.exports.computePkcs12CertSha256WithOpenSsl = function computePkcs12CertSha256WithOpenSsl (a0, a1) {
  if (illFormed(a0)) throw new TypeError('argument 1 of computePkcs12CertSha256WithOpenSsl has a lone surrogate, which a Rust String cannot hold')
  if (illFormed(a1)) throw new TypeError('argument 2 of computePkcs12CertSha256WithOpenSsl has a lone surrogate, which a Rust String cannot hold')
  try {
    if (arguments.length <= 2 && encode(a0, a1) && wireCall(call)) return decode()
    return json(...arguments)
  } catch (e) {
    throw jsError(e)
  }
}
}

// `createPersistentPkcs12Keystore`: binary wire; the JSON version handles inputs of other shapes.
{
const json = module.exports.createPersistentPkcs12Keystore
const call = native.createPersistentPkcs12KeystoreWire
const encode = (a0, a1, a2) => {
at = 0
if (typeof a0 !== 'string') return false
wStr(a0)
if (typeof a1 !== 'string') return false
wStr(a1)
if (!wDyn(a2)) return false
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
o0["storeFile"] = v0
break
}
case 1: {
let v0
v0 = rStr()
o0["storePassword"] = v0
break
}
case 2: {
let v0
v0 = rStr()
o0["keyAlias"] = v0
break
}
case 3: {
let v0
v0 = rStr()
o0["keyPassword"] = v0
break
}
case 4: {
let v0
v0 = rStr()
o0["storeType"] = v0
break
}
case 5: {
let v0
{
const g1 = rU8()
if (g1 === 0) v0 = undefined
else if (g1 === 2) v0 = null
else {
v0 = rStr()
}
}
o0["certSha256"] = v0
break
}
case 6: {
let v0
{
const g1 = rU8()
if (g1 === 0) v0 = undefined
else if (g1 === 2) v0 = null
else {
v0 = rStr()
}
}
o0["createdAt"] = v0
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
module.exports.createPersistentPkcs12Keystore = function createPersistentPkcs12Keystore (a0, a1, a2) {
  if (illFormed(a0)) throw new TypeError('argument 1 of createPersistentPkcs12Keystore has a lone surrogate, which a Rust String cannot hold')
  if (illFormed(a1)) throw new TypeError('argument 2 of createPersistentPkcs12Keystore has a lone surrogate, which a Rust String cannot hold')
  try {
    if (arguments.length <= 3 && encode(a0, a1, a2) && wireCall(call)) return decode()
    return json(...arguments)
  } catch (e) {
    throw jsError(e)
  }
}
}

// `applySigningEnvFromProtectedConfig`: binary wire; the JSON version handles inputs of other shapes.
{
const json = module.exports.applySigningEnvFromProtectedConfig
const call = native.applySigningEnvFromProtectedConfigWire
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
o0["source"] = v0
break
}
case 1: {
let v0
v0 = rStr()
o0["propertiesPath"] = v0
break
}
case 2: {
let v0
{
const g1 = rU8()
if (g1 === 0) v0 = undefined
else if (g1 === 2) v0 = null
else {
{
const o2 = {}
const n2 = rU8()
for (let j2 = 0; j2 < n2; j2++) {
switch (rU8()) {
case 0: {
let v2
v2 = rStr()
o2["storeFile"] = v2
break
}
case 1: {
let v2
v2 = rStr()
o2["storePassword"] = v2
break
}
case 2: {
let v2
v2 = rStr()
o2["keyAlias"] = v2
break
}
case 3: {
let v2
v2 = rStr()
o2["keyPassword"] = v2
break
}
case 4: {
let v2
v2 = rStr()
o2["storeType"] = v2
break
}
case 5: {
let v2
{
const g3 = rU8()
if (g3 === 0) v2 = undefined
else if (g3 === 2) v2 = null
else {
v2 = rStr()
}
}
o2["certSha256"] = v2
break
}
case 6: {
let v2
{
const g3 = rU8()
if (g3 === 0) v2 = undefined
else if (g3 === 2) v2 = null
else {
v2 = rStr()
}
}
o2["createdAt"] = v2
break
}
default: {
const k2 = rStr()
o2[k2] = rDyn()
}
}
}
v0 = o2
}
}
}
o0["config"] = v0
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
module.exports.applySigningEnvFromProtectedConfig = function applySigningEnvFromProtectedConfig (a0) {
  try {
    if (arguments.length <= 1 && encode(a0) && wireCall(call)) return decode()
    return json(...arguments)
  } catch (e) {
    throw jsError(e)
  }
}
}

// `ensurePersistentLocalSigning`: binary wire; the JSON version handles inputs of other shapes.
{
const json = module.exports.ensurePersistentLocalSigning
const call = native.ensurePersistentLocalSigningWire
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
o0["source"] = v0
break
}
case 1: {
let v0
v0 = rStr()
o0["propertiesPath"] = v0
break
}
case 2: {
let v0
{
const g1 = rU8()
if (g1 === 0) v0 = undefined
else if (g1 === 2) v0 = null
else {
{
const o2 = {}
const n2 = rU8()
for (let j2 = 0; j2 < n2; j2++) {
switch (rU8()) {
case 0: {
let v2
v2 = rStr()
o2["storeFile"] = v2
break
}
case 1: {
let v2
v2 = rStr()
o2["storePassword"] = v2
break
}
case 2: {
let v2
v2 = rStr()
o2["keyAlias"] = v2
break
}
case 3: {
let v2
v2 = rStr()
o2["keyPassword"] = v2
break
}
case 4: {
let v2
v2 = rStr()
o2["storeType"] = v2
break
}
case 5: {
let v2
{
const g3 = rU8()
if (g3 === 0) v2 = undefined
else if (g3 === 2) v2 = null
else {
v2 = rStr()
}
}
o2["certSha256"] = v2
break
}
case 6: {
let v2
{
const g3 = rU8()
if (g3 === 0) v2 = undefined
else if (g3 === 2) v2 = null
else {
v2 = rStr()
}
}
o2["createdAt"] = v2
break
}
default: {
const k2 = rStr()
o2[k2] = rDyn()
}
}
}
v0 = o2
}
}
}
o0["config"] = v0
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
module.exports.ensurePersistentLocalSigning = function ensurePersistentLocalSigning (a0) {
  try {
    if (arguments.length <= 1 && encode(a0) && wireCall(call)) return decode()
    return json(...arguments)
  } catch (e) {
    throw jsError(e)
  }
}
}

// `isPHashSupportedFilename`: binary wire; the JSON version handles inputs of other shapes.
{
const json = module.exports.isPHashSupportedFilename
const call = native.isPHashSupportedFilenameWire
const encode = (a0) => {
at = 0
if (typeof a0 !== 'string') return false
wStr(a0)
return true
}
const decode = () => {
let t
t = rU8() === 1
return t
}
module.exports.isPHashSupportedFilename = function isPHashSupportedFilename (a0) {
  if (illFormed(a0)) throw new TypeError('argument 1 of isPHashSupportedFilename has a lone surrogate, which a Rust String cannot hold')
  try {
    if (arguments.length <= 1 && encode(a0) && wireCall(call)) return decode()
    return json(...arguments)
  } catch (e) {
    throw jsError(e)
  }
}
}

// `dctPHashFromGrayPixels`: binary wire; the JSON version handles inputs of other shapes.
{
const json = module.exports.dctPHashFromGrayPixels
const call = native.dctPHashFromGrayPixelsWire
const encode = (a0, a1, a2) => {
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
if (a2 === undefined) {
wU8(0)
} else if (a2 === null) {
return false
wU8(2)
} else {
wU8(1)
if (typeof a2 !== 'number') return false
wF64(a2)
}
return true
}
const decode = () => {
let t
t = rDyn()
return t
}
module.exports.dctPHashFromGrayPixels = function dctPHashFromGrayPixels (a0, a1, a2) {
  try {
    if (arguments.length <= 3 && encode(a0, a1, a2) && wireCall(call)) return decode()
    return json(...arguments)
  } catch (e) {
    throw jsError(e)
  }
}
}

// `pHashToHex`: binary wire; the JSON version handles inputs of other shapes.
{
const json = module.exports.pHashToHex
const call = native.pHashToHexWire
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
module.exports.pHashToHex = function pHashToHex (a0) {
  try {
    if (arguments.length <= 1 && encode(a0) && wireCall(call)) return decode()
    return json(...arguments)
  } catch (e) {
    throw jsError(e)
  }
}
}

// `hexToPHash`: binary wire; the JSON version handles inputs of other shapes.
{
const json = module.exports.hexToPHash
const call = native.hexToPHashWire
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
module.exports.hexToPHash = function hexToPHash (a0) {
  if (illFormed(a0)) throw new TypeError('argument 1 of hexToPHash has a lone surrogate, which a Rust String cannot hold')
  try {
    if (arguments.length <= 1 && encode(a0) && wireCall(call)) return decode()
    return json(...arguments)
  } catch (e) {
    throw jsError(e)
  }
}
}

// `hammingDistanceHex`: binary wire; the JSON version handles inputs of other shapes.
{
const json = module.exports.hammingDistanceHex
const call = native.hammingDistanceHexWire
const encode = (a0, a1) => {
at = 0
if (typeof a0 !== 'string') return false
wStr(a0)
if (typeof a1 !== 'string') return false
wStr(a1)
return true
}
const decode = () => {
let t
t = rF64()
return t
}
module.exports.hammingDistanceHex = function hammingDistanceHex (a0, a1) {
  if (illFormed(a0)) throw new TypeError('argument 1 of hammingDistanceHex has a lone surrogate, which a Rust String cannot hold')
  if (illFormed(a1)) throw new TypeError('argument 2 of hammingDistanceHex has a lone surrogate, which a Rust String cannot hold')
  try {
    if (arguments.length <= 2 && encode(a0, a1) && wireCall(call)) return decode()
    return json(...arguments)
  } catch (e) {
    throw jsError(e)
  }
}
}

// `groupSimilarByHash`: binary wire; the JSON version handles inputs of other shapes.
{
const json = module.exports.groupSimilarByHash
const call = native.groupSimilarByHashWire
const encode = (a0, a1) => {
at = 0
if (!Array.isArray(a0)) return false
wU8(1)
wU32(a0.length)
for (let i0 = 0; i0 < a0.length; i0++) {
const v0 = a0[i0]
if (v0 === null || typeof v0 !== 'object' || Array.isArray(v0)) return false
{
const at1 = at
wU8(0)
let n1 = 0, r1 = 0
for (const k1 in v0) {
switch (k1) {
case "filename": {
wU8(0)
r1++
const f1 = v0[k1]
if (typeof f1 !== 'string') return false
wStr(f1)
break
}
case "phash": {
wU8(1)
r1++
const f1 = v0[k1]
if (typeof f1 !== 'string') return false
wStr(f1)
break
}
default: return false
}
if (++n1 > 255) return false
}
if (r1 !== 2) return false
iv.setUint8(at1, n1)
}
}
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
if (rU8() === 0) t = null
else {
const n0 = rU32()
const a0 = new Array(n0)
for (let i0 = 0; i0 < n0; i0++) {
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
v2 = rStr()
o2["filename"] = v2
break
}
case 1: {
let v2
v2 = rStr()
o2["phash"] = v2
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
a0[i0] = v0
}
t = a0
}
return t
}
module.exports.groupSimilarByHash = function groupSimilarByHash (a0, a1) {
  try {
    if (arguments.length <= 2 && encode(a0, a1) && wireCall(call)) return decode()
    return json(...arguments)
  } catch (e) {
    throw jsError(e)
  }
}
}

// `applyPresetToEditState`: binary wire; the JSON version handles inputs of other shapes.
{
const json = module.exports.applyPresetToEditState
const call = native.applyPresetToEditStateWire
const encode = (a0, a1) => {
at = 0
if (!wDyn(a0)) return false
if (typeof a1 !== 'string') return false
wStr(a1)
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
o0["brightness"] = v0
break
}
case 1: {
let v0
v0 = rF64()
o0["contrast"] = v0
break
}
case 2: {
let v0
v0 = rF64()
o0["saturation"] = v0
break
}
case 3: {
let v0
v0 = rF64()
o0["warmth"] = v0
break
}
case 4: {
let v0
v0 = rF64()
o0["rotation"] = v0
break
}
case 5: {
let v0
v0 = rU8() === 1
o0["flipH"] = v0
break
}
case 6: {
let v0
v0 = rU8() === 1
o0["flipV"] = v0
break
}
case 7: {
let v0
v0 = rStr()
o0["cropAspect"] = v0
break
}
case 8: {
let v0
{
const o1 = {}
const n1 = rU8()
for (let j1 = 0; j1 < n1; j1++) {
switch (rU8()) {
case 0: {
let v1
v1 = rF64()
o1["left"] = v1
break
}
case 1: {
let v1
v1 = rF64()
o1["top"] = v1
break
}
case 2: {
let v1
v1 = rF64()
o1["right"] = v1
break
}
case 3: {
let v1
v1 = rF64()
o1["bottom"] = v1
break
}
default: {
const k1 = rStr()
o1[k1] = rDyn()
}
}
}
v0 = o1
}
o0["cropBox"] = v0
break
}
case 9: {
let v0
v0 = rStr()
o0["filterPreset"] = v0
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
module.exports.applyPresetToEditState = function applyPresetToEditState (a0, a1) {
  if (illFormed(a1)) throw new TypeError('argument 2 of applyPresetToEditState has a lone surrogate, which a Rust String cannot hold')
  try {
    if (arguments.length <= 2 && encode(a0, a1) && wireCall(call)) return decode()
    return json(...arguments)
  } catch (e) {
    throw jsError(e)
  }
}
}

// `normalizeRotation`: binary wire; the JSON version handles inputs of other shapes.
{
const json = module.exports.normalizeRotation
const call = native.normalizeRotationWire
const encode = (a0) => {
at = 0
if (typeof a0 !== 'number') return false
wF64(a0)
return true
}
const decode = () => {
let t
t = rF64()
return t
}
module.exports.normalizeRotation = function normalizeRotation (a0) {
  try {
    if (arguments.length <= 1 && encode(a0) && wireCall(call)) return decode()
    return json(...arguments)
  } catch (e) {
    throw jsError(e)
  }
}
}

// `clampNormalizedCropBox`: binary wire; the JSON version handles inputs of other shapes.
{
const json = module.exports.clampNormalizedCropBox
const call = native.clampNormalizedCropBoxWire
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
{
const o0 = {}
const n0 = rU8()
for (let j0 = 0; j0 < n0; j0++) {
switch (rU8()) {
case 0: {
let v0
v0 = rF64()
o0["left"] = v0
break
}
case 1: {
let v0
v0 = rF64()
o0["top"] = v0
break
}
case 2: {
let v0
v0 = rF64()
o0["right"] = v0
break
}
case 3: {
let v0
v0 = rF64()
o0["bottom"] = v0
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
module.exports.clampNormalizedCropBox = function clampNormalizedCropBox (a0, a1) {
  try {
    if (arguments.length <= 2 && encode(a0, a1) && wireCall(call)) return decode()
    return json(...arguments)
  } catch (e) {
    throw jsError(e)
  }
}
}

// `fitAspectNormalizedCropBox`: binary wire; the JSON version handles inputs of other shapes.
{
const json = module.exports.fitAspectNormalizedCropBox
const call = native.fitAspectNormalizedCropBoxWire
const encode = (a0, a1, a2) => {
at = 0
if (typeof a0 !== 'number') return false
wF64(a0)
if (typeof a1 !== 'number') return false
wF64(a1)
if (typeof a2 !== 'string') return false
wStr(a2)
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
o0["left"] = v0
break
}
case 1: {
let v0
v0 = rF64()
o0["top"] = v0
break
}
case 2: {
let v0
v0 = rF64()
o0["right"] = v0
break
}
case 3: {
let v0
v0 = rF64()
o0["bottom"] = v0
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
module.exports.fitAspectNormalizedCropBox = function fitAspectNormalizedCropBox (a0, a1, a2) {
  if (illFormed(a2)) throw new TypeError('argument 3 of fitAspectNormalizedCropBox has a lone surrogate, which a Rust String cannot hold')
  try {
    if (arguments.length <= 3 && encode(a0, a1, a2) && wireCall(call)) return decode()
    return json(...arguments)
  } catch (e) {
    throw jsError(e)
  }
}
}

// `dragNormalizedCropHandle`: binary wire; the JSON version handles inputs of other shapes.
{
const json = module.exports.dragNormalizedCropHandle
const call = native.dragNormalizedCropHandleWire
const encode = (a0, a1, a2, a3, a4, a5, a6, a7) => {
at = 0
if (!wDyn(a0)) return false
if (typeof a1 !== 'string') return false
wStr(a1)
if (typeof a2 !== 'number') return false
wF64(a2)
if (typeof a3 !== 'number') return false
wF64(a3)
if (a4 === undefined) {
wU8(0)
} else if (a4 === null) {
return false
wU8(2)
} else {
wU8(1)
if (typeof a4 !== 'string') return false
wStr(a4)
}
if (a5 === undefined) {
wU8(0)
} else if (a5 === null) {
return false
wU8(2)
} else {
wU8(1)
if (typeof a5 !== 'number') return false
wF64(a5)
}
if (a6 === undefined) {
wU8(0)
} else if (a6 === null) {
return false
wU8(2)
} else {
wU8(1)
if (typeof a6 !== 'number') return false
wF64(a6)
}
if (a7 === undefined) {
wU8(0)
} else if (a7 === null) {
return false
wU8(2)
} else {
wU8(1)
if (typeof a7 !== 'number') return false
wF64(a7)
}
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
o0["left"] = v0
break
}
case 1: {
let v0
v0 = rF64()
o0["top"] = v0
break
}
case 2: {
let v0
v0 = rF64()
o0["right"] = v0
break
}
case 3: {
let v0
v0 = rF64()
o0["bottom"] = v0
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
module.exports.dragNormalizedCropHandle = function dragNormalizedCropHandle (a0, a1, a2, a3, a4, a5, a6, a7) {
  if (illFormed(a1)) throw new TypeError('argument 2 of dragNormalizedCropHandle has a lone surrogate, which a Rust String cannot hold')
  if (illFormed(a4)) throw new TypeError('argument 5 of dragNormalizedCropHandle has a lone surrogate, which a Rust String cannot hold')
  try {
    if (arguments.length <= 8 && encode(a0, a1, a2, a3, a4, a5, a6, a7) && wireCall(call)) return decode()
    return json(...arguments)
  } catch (e) {
    throw jsError(e)
  }
}
}

// `normalizedBoxToPixelRect`: binary wire; the JSON version handles inputs of other shapes.
{
const json = module.exports.normalizedBoxToPixelRect
const call = native.normalizedBoxToPixelRectWire
const encode = (a0, a1, a2) => {
at = 0
if (typeof a0 !== 'number') return false
wF64(a0)
if (typeof a1 !== 'number') return false
wF64(a1)
if (!wDyn(a2)) return false
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
o0["x"] = v0
break
}
case 1: {
let v0
v0 = rF64()
o0["y"] = v0
break
}
case 2: {
let v0
v0 = rF64()
o0["width"] = v0
break
}
case 3: {
let v0
v0 = rF64()
o0["height"] = v0
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
module.exports.normalizedBoxToPixelRect = function normalizedBoxToPixelRect (a0, a1, a2) {
  try {
    if (arguments.length <= 3 && encode(a0, a1, a2) && wireCall(call)) return decode()
    return json(...arguments)
  } catch (e) {
    throw jsError(e)
  }
}
}

// `computeCropRect`: binary wire; the JSON version handles inputs of other shapes.
{
const json = module.exports.computeCropRect
const call = native.computeCropRectWire
const encode = (a0, a1, a2) => {
at = 0
if (typeof a0 !== 'number') return false
wF64(a0)
if (typeof a1 !== 'number') return false
wF64(a1)
if (typeof a2 !== 'string') return false
wStr(a2)
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
o0["x"] = v0
break
}
case 1: {
let v0
v0 = rF64()
o0["y"] = v0
break
}
case 2: {
let v0
v0 = rF64()
o0["width"] = v0
break
}
case 3: {
let v0
v0 = rF64()
o0["height"] = v0
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
module.exports.computeCropRect = function computeCropRect (a0, a1, a2) {
  if (illFormed(a2)) throw new TypeError('argument 3 of computeCropRect has a lone surrogate, which a Rust String cannot hold')
  try {
    if (arguments.length <= 3 && encode(a0, a1, a2) && wireCall(call)) return decode()
    return json(...arguments)
  } catch (e) {
    throw jsError(e)
  }
}
}

// `clampByte`: binary wire; the JSON version handles inputs of other shapes.
{
const json = module.exports.clampByte
const call = native.clampByteWire
const encode = (a0) => {
at = 0
if (typeof a0 !== 'number') return false
wF64(a0)
return true
}
const decode = () => {
let t
t = rF64()
return t
}
module.exports.clampByte = function clampByte (a0) {
  try {
    if (arguments.length <= 1 && encode(a0) && wireCall(call)) return decode()
    return json(...arguments)
  } catch (e) {
    throw jsError(e)
  }
}
}

// `transformRgbPixel`: binary wire; the JSON version handles inputs of other shapes.
{
const json = module.exports.transformRgbPixel
const call = native.transformRgbPixelWire
const encode = (a0, a1, a2, a3) => {
at = 0
if (typeof a0 !== 'number') return false
wF64(a0)
if (typeof a1 !== 'number') return false
wF64(a1)
if (typeof a2 !== 'number') return false
wF64(a2)
if (!wDyn(a3)) return false
return true
}
const decode = () => {
let t
t = rDyn()
return t
}
module.exports.transformRgbPixel = function transformRgbPixel (a0, a1, a2, a3) {
  try {
    if (arguments.length <= 4 && encode(a0, a1, a2, a3) && wireCall(call)) return decode()
    return json(...arguments)
  } catch (e) {
    throw jsError(e)
  }
}
}

// `clampTrimRange`: binary wire; the JSON version handles inputs of other shapes.
{
const json = module.exports.clampTrimRange
const call = native.clampTrimRangeWire
const encode = (a0, a1, a2, a3) => {
at = 0
if (typeof a0 !== 'number') return false
wF64(a0)
if (typeof a1 !== 'number') return false
wF64(a1)
if (typeof a2 !== 'number') return false
wF64(a2)
if (a3 === undefined) {
wU8(0)
} else if (a3 === null) {
return false
wU8(2)
} else {
wU8(1)
if (typeof a3 !== 'number') return false
wF64(a3)
}
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
o0["trimStartSec"] = v0
break
}
case 1: {
let v0
v0 = rF64()
o0["trimEndSec"] = v0
break
}
case 2: {
let v0
v0 = rF64()
o0["trimmedDurationSec"] = v0
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
module.exports.clampTrimRange = function clampTrimRange (a0, a1, a2, a3) {
  try {
    if (arguments.length <= 4 && encode(a0, a1, a2, a3) && wireCall(call)) return decode()
    return json(...arguments)
  } catch (e) {
    throw jsError(e)
  }
}
}

// `formatMediaDuration`: binary wire; the JSON version handles inputs of other shapes.
{
const json = module.exports.formatMediaDuration
const call = native.formatMediaDurationWire
const encode = (a0, a1) => {
at = 0
if (typeof a0 !== 'number') return false
wF64(a0)
if (a1 === undefined) {
wU8(0)
} else if (a1 === null) {
return false
wU8(2)
} else {
wU8(1)
if (typeof a1 !== 'boolean') return false
wU8(a1 ? 1 : 0)
}
return true
}
const decode = () => {
let t
t = rStr()
return t
}
module.exports.formatMediaDuration = function formatMediaDuration (a0, a1) {
  try {
    if (arguments.length <= 2 && encode(a0, a1) && wireCall(call)) return decode()
    return json(...arguments)
  } catch (e) {
    throw jsError(e)
  }
}
}

// `buildCssFilterString`: binary wire; the JSON version handles inputs of other shapes.
{
const json = module.exports.buildCssFilterString
const call = native.buildCssFilterStringWire
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
module.exports.buildCssFilterString = function buildCssFilterString (a0) {
  try {
    if (arguments.length <= 1 && encode(a0) && wireCall(call)) return decode()
    return json(...arguments)
  } catch (e) {
    throw jsError(e)
  }
}
}

// `computeFittedMediaSize`: binary wire; the JSON version handles inputs of other shapes.
{
const json = module.exports.computeFittedMediaSize
const call = native.computeFittedMediaSizeWire
const encode = (a0, a1, a2, a3) => {
at = 0
if (typeof a0 !== 'number') return false
wF64(a0)
if (typeof a1 !== 'number') return false
wF64(a1)
if (a2 === undefined) {
wU8(0)
} else if (a2 === null) {
return false
wU8(2)
} else {
wU8(1)
if (typeof a2 !== 'number') return false
wF64(a2)
}
if (a3 === undefined) {
wU8(0)
} else if (a3 === null) {
return false
wU8(2)
} else {
wU8(1)
if (typeof a3 !== 'number') return false
wF64(a3)
}
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
o0["width"] = v0
break
}
case 1: {
let v0
v0 = rF64()
o0["height"] = v0
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
module.exports.computeFittedMediaSize = function computeFittedMediaSize (a0, a1, a2, a3) {
  try {
    if (arguments.length <= 4 && encode(a0, a1, a2, a3) && wireCall(call)) return decode()
    return json(...arguments)
  } catch (e) {
    throw jsError(e)
  }
}
}

// `clampZoomPan`: binary wire; the JSON version handles inputs of other shapes.
{
const json = module.exports.clampZoomPan
const call = native.clampZoomPanWire
const encode = (a0, a1, a2, a3, a4, a5, a6, a7, a8) => {
at = 0
if (typeof a0 !== 'number') return false
wF64(a0)
if (typeof a1 !== 'number') return false
wF64(a1)
if (typeof a2 !== 'number') return false
wF64(a2)
if (typeof a3 !== 'number') return false
wF64(a3)
if (typeof a4 !== 'number') return false
wF64(a4)
if (a5 === undefined) {
wU8(0)
} else if (a5 === null) {
return false
wU8(2)
} else {
wU8(1)
if (typeof a5 !== 'number') return false
wF64(a5)
}
if (a6 === undefined) {
wU8(0)
} else if (a6 === null) {
return false
wU8(2)
} else {
wU8(1)
if (typeof a6 !== 'number') return false
wF64(a6)
}
if (a7 === undefined) {
wU8(0)
} else if (a7 === null) {
return false
wU8(2)
} else {
wU8(1)
if (typeof a7 !== 'number') return false
wF64(a7)
}
if (a8 === undefined) {
wU8(0)
} else if (a8 === null) {
return false
wU8(2)
} else {
wU8(1)
if (typeof a8 !== 'number') return false
wF64(a8)
}
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
o0["scale"] = v0
break
}
case 1: {
let v0
v0 = rF64()
o0["panX"] = v0
break
}
case 2: {
let v0
v0 = rF64()
o0["panY"] = v0
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
module.exports.clampZoomPan = function clampZoomPan (a0, a1, a2, a3, a4, a5, a6, a7, a8) {
  try {
    if (arguments.length <= 9 && encode(a0, a1, a2, a3, a4, a5, a6, a7, a8) && wireCall(call)) return decode()
    return json(...arguments)
  } catch (e) {
    throw jsError(e)
  }
}
}

// `computePinchZoomPan`: binary wire; the JSON version handles inputs of other shapes.
{
const json = module.exports.computePinchZoomPan
const call = native.computePinchZoomPanWire
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
o0["scale"] = v0
break
}
case 1: {
let v0
v0 = rF64()
o0["panX"] = v0
break
}
case 2: {
let v0
v0 = rF64()
o0["panY"] = v0
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
module.exports.computePinchZoomPan = function computePinchZoomPan (a0) {
  try {
    if (arguments.length <= 1 && encode(a0) && wireCall(call)) return decode()
    return json(...arguments)
  } catch (e) {
    throw jsError(e)
  }
}
}

// `getVapidPublicKey`: binary wire; the JSON version handles inputs of other shapes.
{
const json = module.exports.getVapidPublicKey
const call = native.getVapidPublicKeyWire
const encode = () => {
at = 0
return true
}
const decode = () => {
let t
{
const g0 = rU8()
if (g0 === 0) t = undefined
else if (g0 === 2) t = null
else {
t = rStr()
}
}
return t
}
module.exports.getVapidPublicKey = function getVapidPublicKey () {
  try {
    if (arguments.length <= 0 && encode() && wireCall(call)) return decode()
    return json(...arguments)
  } catch (e) {
    throw jsError(e)
  }
}
}

// `getUserPushPath`: binary wire; the JSON version handles inputs of other shapes.
{
const json = module.exports.getUserPushPath
const call = native.getUserPushPathWire
const encode = (a0) => {
at = 0
if (typeof a0 !== 'string') return false
wStr(a0)
return true
}
const decode = () => {
let t
t = rStr()
return t
}
module.exports.getUserPushPath = function getUserPushPath (a0) {
  if (illFormed(a0)) throw new TypeError('argument 1 of getUserPushPath has a lone surrogate, which a Rust String cannot hold')
  try {
    if (arguments.length <= 1 && encode(a0) && wireCall(call)) return decode()
    return json(...arguments)
  } catch (e) {
    throw jsError(e)
  }
}
}

// `loadUserSubscriptions`: binary wire; the JSON version handles inputs of other shapes.
{
const json = module.exports.loadUserSubscriptions
const call = native.loadUserSubscriptionsWire
const encode = (a0) => {
at = 0
if (typeof a0 !== 'string') return false
wStr(a0)
return true
}
const decode = () => {
let t
if (rU8() === 0) t = null
else {
const n0 = rU32()
const a0 = new Array(n0)
for (let i0 = 0; i0 < n0; i0++) {
let v0
{
const o1 = {}
const n1 = rU8()
for (let j1 = 0; j1 < n1; j1++) {
switch (rU8()) {
case 0: {
let v1
v1 = rStr()
o1["endpoint"] = v1
break
}
case 1: {
let v1
{
const o2 = {}
const n2 = rU8()
for (let j2 = 0; j2 < n2; j2++) {
switch (rU8()) {
case 0: {
let v2
v2 = rStr()
o2["p256dh"] = v2
break
}
case 1: {
let v2
v2 = rStr()
o2["auth"] = v2
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
o1["keys"] = v1
break
}
case 2: {
let v1
{
const g2 = rU8()
if (g2 === 0) v1 = undefined
else if (g2 === 2) v1 = null
else {
v1 = rStr()
}
}
o1["userAgent"] = v1
break
}
case 3: {
let v1
v1 = rF64()
o1["createdAt"] = v1
break
}
default: {
const k1 = rStr()
o1[k1] = rDyn()
}
}
}
v0 = o1
}
a0[i0] = v0
}
t = a0
}
return t
}
module.exports.loadUserSubscriptions = function loadUserSubscriptions (a0) {
  if (illFormed(a0)) throw new TypeError('argument 1 of loadUserSubscriptions has a lone surrogate, which a Rust String cannot hold')
  try {
    if (arguments.length <= 1 && encode(a0) && wireCall(call)) return decode()
    return json(...arguments)
  } catch (e) {
    throw jsError(e)
  }
}
}

// `saveUserSubscriptions`: binary wire; the JSON version handles inputs of other shapes.
{
const json = module.exports.saveUserSubscriptions
const call = native.saveUserSubscriptionsWire
const encode = (a0, a1) => {
at = 0
if (typeof a0 !== 'string') return false
wStr(a0)
if (!Array.isArray(a1)) return false
wU8(1)
wU32(a1.length)
for (let i0 = 0; i0 < a1.length; i0++) {
const v0 = a1[i0]
if (v0 === null || typeof v0 !== 'object' || Array.isArray(v0)) return false
{
const at1 = at
wU8(0)
let n1 = 0, r1 = 0
for (const k1 in v0) {
switch (k1) {
case "endpoint": {
wU8(0)
r1++
const f1 = v0[k1]
if (typeof f1 !== 'string') return false
wStr(f1)
break
}
case "keys": {
wU8(1)
r1++
const f1 = v0[k1]
if (f1 === null || typeof f1 !== 'object' || Array.isArray(f1)) return false
{
const at2 = at
wU8(0)
let n2 = 0, r2 = 0
for (const k2 in f1) {
switch (k2) {
case "p256dh": {
wU8(0)
r2++
const f2 = f1[k2]
if (typeof f2 !== 'string') return false
wStr(f2)
break
}
case "auth": {
wU8(1)
r2++
const f2 = f1[k2]
if (typeof f2 !== 'string') return false
wStr(f2)
break
}
default: return false
}
if (++n2 > 255) return false
}
if (r2 !== 2) return false
iv.setUint8(at2, n2)
}
break
}
case "userAgent": {
wU8(2)
const f1 = v0[k1]
if (f1 === undefined) {
wU8(0)
} else if (f1 === null) {
return false
wU8(2)
} else {
wU8(1)
if (typeof f1 !== 'string') return false
wStr(f1)
}
break
}
case "createdAt": {
wU8(3)
r1++
const f1 = v0[k1]
if (typeof f1 !== 'number') return false
wF64(f1)
break
}
default: return false
}
if (++n1 > 255) return false
}
if (r1 !== 3) return false
iv.setUint8(at1, n1)
}
}
return true
}
const decode = () => {
let t
return t
}
module.exports.saveUserSubscriptions = function saveUserSubscriptions (a0, a1) {
  if (illFormed(a0)) throw new TypeError('argument 1 of saveUserSubscriptions has a lone surrogate, which a Rust String cannot hold')
  try {
    if (arguments.length <= 2 && encode(a0, a1) && wireCall(call)) return decode()
    return json(...arguments)
  } catch (e) {
    throw jsError(e)
  }
}
}

// `addUserSubscription`: binary wire; the JSON version handles inputs of other shapes.
{
const json = module.exports.addUserSubscription
const call = native.addUserSubscriptionWire
const encode = (a0, a1) => {
at = 0
if (typeof a0 !== 'string') return false
wStr(a0)
if (!wDyn(a1)) return false
return true
}
const decode = () => {
let t
t = rF64()
return t
}
module.exports.addUserSubscription = function addUserSubscription (a0, a1) {
  if (illFormed(a0)) throw new TypeError('argument 1 of addUserSubscription has a lone surrogate, which a Rust String cannot hold')
  try {
    if (arguments.length <= 2 && encode(a0, a1) && wireCall(call)) return decode()
    return json(...arguments)
  } catch (e) {
    throw jsError(e)
  }
}
}

// `removeUserSubscription`: binary wire; the JSON version handles inputs of other shapes.
{
const json = module.exports.removeUserSubscription
const call = native.removeUserSubscriptionWire
const encode = (a0, a1) => {
at = 0
if (typeof a0 !== 'string') return false
wStr(a0)
if (typeof a1 !== 'string') return false
wStr(a1)
return true
}
const decode = () => {
let t
t = rF64()
return t
}
module.exports.removeUserSubscription = function removeUserSubscription (a0, a1) {
  if (illFormed(a0)) throw new TypeError('argument 1 of removeUserSubscription has a lone surrogate, which a Rust String cannot hold')
  if (illFormed(a1)) throw new TypeError('argument 2 of removeUserSubscription has a lone surrogate, which a Rust String cannot hold')
  try {
    if (arguments.length <= 2 && encode(a0, a1) && wireCall(call)) return decode()
    return json(...arguments)
  } catch (e) {
    throw jsError(e)
  }
}
}

// `renderSharePage`: binary wire; the JSON version handles inputs of other shapes.
{
const json = module.exports.renderSharePage
const call = native.renderSharePageWire
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
module.exports.renderSharePage = function renderSharePage (a0) {
  try {
    if (arguments.length <= 1 && encode(a0) && wireCall(call)) return decode()
    return json(...arguments)
  } catch (e) {
    throw jsError(e)
  }
}
}

// `renderSharePasswordPage`: binary wire; the JSON version handles inputs of other shapes.
{
const json = module.exports.renderSharePasswordPage
const call = native.renderSharePasswordPageWire
const encode = (a0, a1) => {
at = 0
if (typeof a0 !== 'string') return false
wStr(a0)
if (a1 === undefined) {
wU8(0)
} else if (a1 === null) {
return false
wU8(2)
} else {
wU8(1)
if (typeof a1 !== 'string') return false
wStr(a1)
}
return true
}
const decode = () => {
let t
t = rStr()
return t
}
module.exports.renderSharePasswordPage = function renderSharePasswordPage (a0, a1) {
  if (illFormed(a0)) throw new TypeError('argument 1 of renderSharePasswordPage has a lone surrogate, which a Rust String cannot hold')
  if (illFormed(a1)) throw new TypeError('argument 2 of renderSharePasswordPage has a lone surrogate, which a Rust String cannot hold')
  try {
    if (arguments.length <= 2 && encode(a0, a1) && wireCall(call)) return decode()
    return json(...arguments)
  } catch (e) {
    throw jsError(e)
  }
}
}

// `renderShareErrorPage`: binary wire; the JSON version handles inputs of other shapes.
{
const json = module.exports.renderShareErrorPage
const call = native.renderShareErrorPageWire
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
module.exports.renderShareErrorPage = function renderShareErrorPage (a0) {
  try {
    if (arguments.length <= 1 && encode(a0) && wireCall(call)) return decode()
    return json(...arguments)
  } catch (e) {
    throw jsError(e)
  }
}
}

// `getSharesFilePath`: binary wire; the JSON version handles inputs of other shapes.
{
const json = module.exports.getSharesFilePath
const call = native.getSharesFilePathWire
const encode = (a0) => {
at = 0
if (typeof a0 !== 'string') return false
wStr(a0)
return true
}
const decode = () => {
let t
t = rStr()
return t
}
module.exports.getSharesFilePath = function getSharesFilePath (a0) {
  if (illFormed(a0)) throw new TypeError('argument 1 of getSharesFilePath has a lone surrogate, which a Rust String cannot hold')
  try {
    if (arguments.length <= 1 && encode(a0) && wireCall(call)) return decode()
    return json(...arguments)
  } catch (e) {
    throw jsError(e)
  }
}
}

// `getAlbumSharesFilePath`: binary wire; the JSON version handles inputs of other shapes.
{
const json = module.exports.getAlbumSharesFilePath
const call = native.getAlbumSharesFilePathWire
const encode = (a0) => {
at = 0
if (typeof a0 !== 'string') return false
wStr(a0)
return true
}
const decode = () => {
let t
t = rStr()
return t
}
module.exports.getAlbumSharesFilePath = function getAlbumSharesFilePath (a0) {
  if (illFormed(a0)) throw new TypeError('argument 1 of getAlbumSharesFilePath has a lone surrogate, which a Rust String cannot hold')
  try {
    if (arguments.length <= 1 && encode(a0) && wireCall(call)) return decode()
    return json(...arguments)
  } catch (e) {
    throw jsError(e)
  }
}
}

// `loadPublicShares`: binary wire; the JSON version handles inputs of other shapes.
{
const json = module.exports.loadPublicShares
const call = native.loadPublicSharesWire
const encode = (a0) => {
at = 0
if (typeof a0 !== 'string') return false
wStr(a0)
return true
}
const decode = () => {
let t
if (rU8() === 0) t = null
else {
const n0 = rU32()
const o0 = {}
for (let i0 = 0; i0 < n0; i0++) {
const k0 = rStr()
let v0
{
const o1 = {}
const n1 = rU8()
for (let j1 = 0; j1 < n1; j1++) {
switch (rU8()) {
case 0: {
let v1
v1 = rStr()
o1["id"] = v1
break
}
case 1: {
let v1
v1 = rStr()
o1["owner"] = v1
break
}
case 2: {
let v1
if (rU8() === 0) v1 = null
else {
const n2 = rU32()
const a2 = new Array(n2)
for (let i2 = 0; i2 < n2; i2++) {
let v2
v2 = rStr()
a2[i2] = v2
}
v1 = a2
}
o1["filenames"] = v1
break
}
case 3: {
let v1
v1 = rStr()
o1["label"] = v1
break
}
case 4: {
let v1
v1 = rF64()
o1["createdAt"] = v1
break
}
case 5: {
let v1
v1 = rF64()
o1["expiresAt"] = v1
break
}
case 6: {
let v1
{
const g2 = rU8()
if (g2 === 0) v1 = undefined
else if (g2 === 2) v1 = null
else {
v1 = rStr()
}
}
o1["passwordHash"] = v1
break
}
case 7: {
let v1
{
const g2 = rU8()
if (g2 === 0) v1 = undefined
else if (g2 === 2) v1 = null
else {
v1 = rF64()
}
}
o1["maxDownloads"] = v1
break
}
case 8: {
let v1
v1 = rF64()
o1["downloadCount"] = v1
break
}
case 9: {
let v1
{
const o2 = {}
const n2 = rU8()
for (let j2 = 0; j2 < n2; j2++) {
switch (rU8()) {
case 0: {
let v2
v2 = rF64()
o2["v"] = v2
break
}
case 1: {
let v2
v2 = rStr()
o2["salt"] = v2
break
}
case 2: {
let v2
v2 = rStr()
o2["iv"] = v2
break
}
case 3: {
let v2
v2 = rStr()
o2["tag"] = v2
break
}
case 4: {
let v2
v2 = rStr()
o2["ct"] = v2
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
o1["keyWrap"] = v1
break
}
default: {
const k1 = rStr()
o1[k1] = rDyn()
}
}
}
v0 = o1
}
o0[k0] = v0
}
t = o0
}
return t
}
module.exports.loadPublicShares = function loadPublicShares (a0) {
  if (illFormed(a0)) throw new TypeError('argument 1 of loadPublicShares has a lone surrogate, which a Rust String cannot hold')
  try {
    if (arguments.length <= 1 && encode(a0) && wireCall(call)) return decode()
    return json(...arguments)
  } catch (e) {
    throw jsError(e)
  }
}
}

// `savePublicShares`: binary wire; the JSON version handles inputs of other shapes.
{
const json = module.exports.savePublicShares
const call = native.savePublicSharesWire
const encode = (a0, a1) => {
at = 0
if (typeof a0 !== 'string') return false
wStr(a0)
if (!wDyn(a1)) return false
return true
}
const decode = () => {
let t
return t
}
module.exports.savePublicShares = function savePublicShares (a0, a1) {
  if (illFormed(a0)) throw new TypeError('argument 1 of savePublicShares has a lone surrogate, which a Rust String cannot hold')
  try {
    if (arguments.length <= 2 && encode(a0, a1) && wireCall(call)) return decode()
    return json(...arguments)
  } catch (e) {
    throw jsError(e)
  }
}
}

// `loadAlbumShares`: binary wire; the JSON version handles inputs of other shapes.
{
const json = module.exports.loadAlbumShares
const call = native.loadAlbumSharesWire
const encode = (a0) => {
at = 0
if (typeof a0 !== 'string') return false
wStr(a0)
return true
}
const decode = () => {
let t
if (rU8() === 0) t = null
else {
const n0 = rU32()
const o0 = {}
for (let i0 = 0; i0 < n0; i0++) {
const k0 = rStr()
let v0
{
const o1 = {}
const n1 = rU8()
for (let j1 = 0; j1 < n1; j1++) {
switch (rU8()) {
case 0: {
let v1
v1 = rStr()
o1["id"] = v1
break
}
case 1: {
let v1
v1 = rStr()
o1["owner"] = v1
break
}
case 2: {
let v1
v1 = rStr()
o1["album"] = v1
break
}
case 3: {
let v1
if (rU8() === 0) v1 = null
else {
const n2 = rU32()
const o2 = {}
for (let i2 = 0; i2 < n2; i2++) {
const k2 = rStr()
let v2
v2 = rStr()
o2[k2] = v2
}
v1 = o2
}
o1["participants"] = v1
break
}
case 4: {
let v1
v1 = rF64()
o1["createdAt"] = v1
break
}
case 5: {
let v1
{
const o2 = {}
const n2 = rU8()
for (let j2 = 0; j2 < n2; j2++) {
switch (rU8()) {
case 0: {
let v2
v2 = rF64()
o2["v"] = v2
break
}
case 1: {
let v2
v2 = rStr()
o2["salt"] = v2
break
}
case 2: {
let v2
v2 = rStr()
o2["iv"] = v2
break
}
case 3: {
let v2
v2 = rStr()
o2["tag"] = v2
break
}
case 4: {
let v2
v2 = rStr()
o2["ct"] = v2
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
o1["keyWrap"] = v1
break
}
default: {
const k1 = rStr()
o1[k1] = rDyn()
}
}
}
v0 = o1
}
o0[k0] = v0
}
t = o0
}
return t
}
module.exports.loadAlbumShares = function loadAlbumShares (a0) {
  if (illFormed(a0)) throw new TypeError('argument 1 of loadAlbumShares has a lone surrogate, which a Rust String cannot hold')
  try {
    if (arguments.length <= 1 && encode(a0) && wireCall(call)) return decode()
    return json(...arguments)
  } catch (e) {
    throw jsError(e)
  }
}
}

// `saveAlbumShares`: binary wire; the JSON version handles inputs of other shapes.
{
const json = module.exports.saveAlbumShares
const call = native.saveAlbumSharesWire
const encode = (a0, a1) => {
at = 0
if (typeof a0 !== 'string') return false
wStr(a0)
if (!wDyn(a1)) return false
return true
}
const decode = () => {
let t
return t
}
module.exports.saveAlbumShares = function saveAlbumShares (a0, a1) {
  if (illFormed(a0)) throw new TypeError('argument 1 of saveAlbumShares has a lone surrogate, which a Rust String cannot hold')
  try {
    if (arguments.length <= 2 && encode(a0, a1) && wireCall(call)) return decode()
    return json(...arguments)
  } catch (e) {
    throw jsError(e)
  }
}
}

// `createPublicShare`: binary wire; the JSON version handles inputs of other shapes.
{
const json = module.exports.createPublicShare
const call = native.createPublicShareWire
const encode = (a0, a1, a2) => {
at = 0
if (typeof a0 !== 'string') return false
wStr(a0)
if (!wDyn(a1)) return false
if (!wDyn(a2)) return false
return true
}
const decode = () => {
let t
t = rDyn()
return t
}
module.exports.createPublicShare = function createPublicShare (a0, a1, a2) {
  if (illFormed(a0)) throw new TypeError('argument 1 of createPublicShare has a lone surrogate, which a Rust String cannot hold')
  try {
    if (arguments.length <= 3 && encode(a0, a1, a2) && wireCall(call)) return decode()
    return json(...arguments)
  } catch (e) {
    throw jsError(e)
  }
}
}

// `verifySharePassword`: binary wire; the JSON version handles inputs of other shapes.
{
const json = module.exports.verifySharePassword
const call = native.verifySharePasswordWire
const encode = (a0, a1) => {
at = 0
if (!wDyn(a0)) return false
if (typeof a1 !== 'string') return false
wStr(a1)
return true
}
const decode = () => {
let t
t = rU8() === 1
return t
}
module.exports.verifySharePassword = function verifySharePassword (a0, a1) {
  if (illFormed(a1)) throw new TypeError('argument 2 of verifySharePassword has a lone surrogate, which a Rust String cannot hold')
  try {
    if (arguments.length <= 2 && encode(a0, a1) && wireCall(call)) return decode()
    return json(...arguments)
  } catch (e) {
    throw jsError(e)
  }
}
}

// `resolveShareByToken`: binary wire; the JSON version handles inputs of other shapes.
{
const json = module.exports.resolveShareByToken
const call = native.resolveShareByTokenWire
const encode = (a0, a1) => {
at = 0
if (typeof a0 !== 'string') return false
wStr(a0)
if (typeof a1 !== 'string') return false
wStr(a1)
return true
}
const decode = () => {
let t
t = rDyn()
return t
}
module.exports.resolveShareByToken = function resolveShareByToken (a0, a1) {
  if (illFormed(a0)) throw new TypeError('argument 1 of resolveShareByToken has a lone surrogate, which a Rust String cannot hold')
  if (illFormed(a1)) throw new TypeError('argument 2 of resolveShareByToken has a lone surrogate, which a Rust String cannot hold')
  try {
    if (arguments.length <= 2 && encode(a0, a1) && wireCall(call)) return decode()
    return json(...arguments)
  } catch (e) {
    throw jsError(e)
  }
}
}

// `incrementShareDownloadCount`: binary wire; the JSON version handles inputs of other shapes.
{
const json = module.exports.incrementShareDownloadCount
const call = native.incrementShareDownloadCountWire
const encode = (a0, a1) => {
at = 0
if (typeof a0 !== 'string') return false
wStr(a0)
if (typeof a1 !== 'string') return false
wStr(a1)
return true
}
const decode = () => {
let t
t = rU8() === 1
return t
}
module.exports.incrementShareDownloadCount = function incrementShareDownloadCount (a0, a1) {
  if (illFormed(a0)) throw new TypeError('argument 1 of incrementShareDownloadCount has a lone surrogate, which a Rust String cannot hold')
  if (illFormed(a1)) throw new TypeError('argument 2 of incrementShareDownloadCount has a lone surrogate, which a Rust String cannot hold')
  try {
    if (arguments.length <= 2 && encode(a0, a1) && wireCall(call)) return decode()
    return json(...arguments)
  } catch (e) {
    throw jsError(e)
  }
}
}

// `upsertAlbumShare`: binary wire; the JSON version handles inputs of other shapes.
{
const json = module.exports.upsertAlbumShare
const call = native.upsertAlbumShareWire
const encode = (a0, a1, a2, a3, a4, a5, a6) => {
at = 0
if (typeof a0 !== 'string') return false
wStr(a0)
if (!wDyn(a1)) return false
if (typeof a2 !== 'string') return false
wStr(a2)
if (typeof a3 !== 'string') return false
wStr(a3)
if (typeof a4 !== 'string') return false
wStr(a4)
if (typeof a5 !== 'string') return false
wStr(a5)
if (typeof a6 !== 'string') return false
wStr(a6)
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
o0["id"] = v0
break
}
case 1: {
let v0
v0 = rStr()
o0["owner"] = v0
break
}
case 2: {
let v0
v0 = rStr()
o0["album"] = v0
break
}
case 3: {
let v0
if (rU8() === 0) v0 = null
else {
const n1 = rU32()
const o1 = {}
for (let i1 = 0; i1 < n1; i1++) {
const k1 = rStr()
let v1
v1 = rStr()
o1[k1] = v1
}
v0 = o1
}
o0["participants"] = v0
break
}
case 4: {
let v0
v0 = rF64()
o0["createdAt"] = v0
break
}
case 5: {
let v0
{
const o1 = {}
const n1 = rU8()
for (let j1 = 0; j1 < n1; j1++) {
switch (rU8()) {
case 0: {
let v1
v1 = rF64()
o1["v"] = v1
break
}
case 1: {
let v1
v1 = rStr()
o1["salt"] = v1
break
}
case 2: {
let v1
v1 = rStr()
o1["iv"] = v1
break
}
case 3: {
let v1
v1 = rStr()
o1["tag"] = v1
break
}
case 4: {
let v1
v1 = rStr()
o1["ct"] = v1
break
}
default: {
const k1 = rStr()
o1[k1] = rDyn()
}
}
}
v0 = o1
}
o0["keyWrap"] = v0
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
module.exports.upsertAlbumShare = function upsertAlbumShare (a0, a1, a2, a3, a4, a5, a6) {
  if (illFormed(a0)) throw new TypeError('argument 1 of upsertAlbumShare has a lone surrogate, which a Rust String cannot hold')
  if (illFormed(a2)) throw new TypeError('argument 3 of upsertAlbumShare has a lone surrogate, which a Rust String cannot hold')
  if (illFormed(a3)) throw new TypeError('argument 4 of upsertAlbumShare has a lone surrogate, which a Rust String cannot hold')
  if (illFormed(a4)) throw new TypeError('argument 5 of upsertAlbumShare has a lone surrogate, which a Rust String cannot hold')
  if (illFormed(a5)) throw new TypeError('argument 6 of upsertAlbumShare has a lone surrogate, which a Rust String cannot hold')
  if (illFormed(a6)) throw new TypeError('argument 7 of upsertAlbumShare has a lone surrogate, which a Rust String cannot hold')
  try {
    if (arguments.length <= 7 && encode(a0, a1, a2, a3, a4, a5, a6) && wireCall(call)) return decode()
    return json(...arguments)
  } catch (e) {
    throw jsError(e)
  }
}
}

// `deleteAlbumSharesForAlbum`: binary wire; the JSON version handles inputs of other shapes.
{
const json = module.exports.deleteAlbumSharesForAlbum
const call = native.deleteAlbumSharesForAlbumWire
const encode = (a0, a1, a2) => {
at = 0
if (typeof a0 !== 'string') return false
wStr(a0)
if (typeof a1 !== 'string') return false
wStr(a1)
if (typeof a2 !== 'string') return false
wStr(a2)
return true
}
const decode = () => {
let t
t = rF64()
return t
}
module.exports.deleteAlbumSharesForAlbum = function deleteAlbumSharesForAlbum (a0, a1, a2) {
  if (illFormed(a0)) throw new TypeError('argument 1 of deleteAlbumSharesForAlbum has a lone surrogate, which a Rust String cannot hold')
  if (illFormed(a1)) throw new TypeError('argument 2 of deleteAlbumSharesForAlbum has a lone surrogate, which a Rust String cannot hold')
  if (illFormed(a2)) throw new TypeError('argument 3 of deleteAlbumSharesForAlbum has a lone surrogate, which a Rust String cannot hold')
  try {
    if (arguments.length <= 3 && encode(a0, a1, a2) && wireCall(call)) return decode()
    return json(...arguments)
  } catch (e) {
    throw jsError(e)
  }
}
}

// `escapeHtml`: binary wire; the JSON version handles inputs of other shapes.
{
const json = module.exports.escapeHtml
const call = native.escapeHtmlWire
const encode = (a0) => {
at = 0
if (typeof a0 !== 'string') return false
wStr(a0)
return true
}
const decode = () => {
let t
t = rStr()
return t
}
module.exports.escapeHtml = function escapeHtml (a0) {
  if (illFormed(a0)) throw new TypeError('argument 1 of escapeHtml has a lone surrogate, which a Rust String cannot hold')
  try {
    if (arguments.length <= 1 && encode(a0) && wireCall(call)) return decode()
    return json(...arguments)
  } catch (e) {
    throw jsError(e)
  }
}
}

// `formatFileSize`: binary wire; the JSON version handles inputs of other shapes.
{
const json = module.exports.formatFileSize
const call = native.formatFileSizeWire
const encode = (a0) => {
at = 0
if (a0 === undefined) {
wU8(0)
} else if (a0 === null) {
return false
wU8(2)
} else {
wU8(1)
if (typeof a0 !== 'number') return false
wF64(a0)
}
return true
}
const decode = () => {
let t
t = rStr()
return t
}
module.exports.formatFileSize = function formatFileSize (a0) {
  try {
    if (arguments.length <= 1 && encode(a0) && wireCall(call)) return decode()
    return json(...arguments)
  } catch (e) {
    throw jsError(e)
  }
}
}

// `computeCloudStorageStats`: binary wire; the JSON version handles inputs of other shapes.
{
const json = module.exports.computeCloudStorageStats
const call = native.computeCloudStorageStatsWire
const encode = (a0, a1, a2) => {
at = 0
if (a0 === undefined) {
wU8(0)
} else if (a0 === null) {
return false
wU8(2)
} else {
wU8(1)
if (!Array.isArray(a0)) return false
wU8(1)
wU32(a0.length)
for (let i0 = 0; i0 < a0.length; i0++) {
const v0 = a0[i0]
if (v0 === null || typeof v0 !== 'object' || Array.isArray(v0)) return false
{
const at1 = at
wU8(0)
let n1 = 0, r1 = 0
for (const k1 in v0) {
switch (k1) {
case "filename": {
wU8(0)
r1++
const f1 = v0[k1]
if (typeof f1 !== 'string') return false
wStr(f1)
break
}
case "timestamp": {
wU8(1)
r1++
const f1 = v0[k1]
if (typeof f1 !== 'number') return false
wF64(f1)
break
}
case "size": {
wU8(2)
const f1 = v0[k1]
if (f1 === undefined) {
wU8(0)
} else if (f1 === null) {
return false
wU8(2)
} else {
wU8(1)
if (typeof f1 !== 'number') return false
wF64(f1)
}
break
}
case "isMedia": {
wU8(3)
const f1 = v0[k1]
if (f1 === undefined) {
wU8(0)
} else if (f1 === null) {
return false
wU8(2)
} else {
wU8(1)
if (typeof f1 !== 'boolean') return false
wU8(f1 ? 1 : 0)
}
break
}
case "category": {
wU8(4)
const f1 = v0[k1]
if (f1 === undefined) {
wU8(0)
} else if (f1 === null) {
return false
wU8(2)
} else {
wU8(1)
if (typeof f1 !== 'string') return false
wStr(f1)
}
break
}
case "album": {
wU8(5)
const f1 = v0[k1]
if (f1 === undefined) {
wU8(0)
} else if (f1 === null) {
return false
wU8(2)
} else {
wU8(1)
if (typeof f1 !== 'string') return false
wStr(f1)
}
break
}
case "hasThumb": {
wU8(6)
const f1 = v0[k1]
if (f1 === undefined) {
wU8(0)
} else if (f1 === null) {
return false
wU8(2)
} else {
wU8(1)
if (typeof f1 !== 'boolean') return false
wU8(f1 ? 1 : 0)
}
break
}
default: return false
}
if (++n1 > 255) return false
}
if (r1 !== 2) return false
iv.setUint8(at1, n1)
}
}
}
if (a1 === undefined) {
wU8(0)
} else if (a1 === null) {
return false
wU8(2)
} else {
wU8(1)
if (!Array.isArray(a1)) return false
wU8(1)
wU32(a1.length)
for (let i0 = 0; i0 < a1.length; i0++) {
const v0 = a1[i0]
if (v0 === null || typeof v0 !== 'object' || Array.isArray(v0)) return false
{
const at1 = at
wU8(0)
let n1 = 0, r1 = 0
for (const k1 in v0) {
switch (k1) {
case "filename": {
wU8(0)
r1++
const f1 = v0[k1]
if (typeof f1 !== 'string') return false
wStr(f1)
break
}
case "timestamp": {
wU8(1)
r1++
const f1 = v0[k1]
if (typeof f1 !== 'number') return false
wF64(f1)
break
}
case "size": {
wU8(2)
const f1 = v0[k1]
if (f1 === undefined) {
wU8(0)
} else if (f1 === null) {
return false
wU8(2)
} else {
wU8(1)
if (typeof f1 !== 'number') return false
wF64(f1)
}
break
}
case "isMedia": {
wU8(3)
const f1 = v0[k1]
if (f1 === undefined) {
wU8(0)
} else if (f1 === null) {
return false
wU8(2)
} else {
wU8(1)
if (typeof f1 !== 'boolean') return false
wU8(f1 ? 1 : 0)
}
break
}
case "category": {
wU8(4)
const f1 = v0[k1]
if (f1 === undefined) {
wU8(0)
} else if (f1 === null) {
return false
wU8(2)
} else {
wU8(1)
if (typeof f1 !== 'string') return false
wStr(f1)
}
break
}
case "album": {
wU8(5)
const f1 = v0[k1]
if (f1 === undefined) {
wU8(0)
} else if (f1 === null) {
return false
wU8(2)
} else {
wU8(1)
if (typeof f1 !== 'string') return false
wStr(f1)
}
break
}
case "hasThumb": {
wU8(6)
const f1 = v0[k1]
if (f1 === undefined) {
wU8(0)
} else if (f1 === null) {
return false
wU8(2)
} else {
wU8(1)
if (typeof f1 !== 'boolean') return false
wU8(f1 ? 1 : 0)
}
break
}
default: return false
}
if (++n1 > 255) return false
}
if (r1 !== 2) return false
iv.setUint8(at1, n1)
}
}
}
if (a2 === undefined) {
wU8(0)
} else if (a2 === null) {
return false
wU8(2)
} else {
wU8(1)
if (typeof a2 !== 'number') return false
wF64(a2)
}
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
o0["mediaBytes"] = v0
break
}
case 1: {
let v0
v0 = rF64()
o0["mediaCount"] = v0
break
}
case 2: {
let v0
v0 = rF64()
o0["filesBytes"] = v0
break
}
case 3: {
let v0
v0 = rF64()
o0["filesCount"] = v0
break
}
case 4: {
let v0
v0 = rF64()
o0["activeBytes"] = v0
break
}
case 5: {
let v0
v0 = rF64()
o0["activeTotalBytes"] = v0
break
}
case 6: {
let v0
v0 = rF64()
o0["activeCount"] = v0
break
}
case 7: {
let v0
v0 = rF64()
o0["trashBytes"] = v0
break
}
case 8: {
let v0
v0 = rF64()
o0["trashCount"] = v0
break
}
case 9: {
let v0
v0 = rF64()
o0["grandTotalBytes"] = v0
break
}
case 10: {
let v0
v0 = rF64()
o0["grandTotalCount"] = v0
break
}
case 11: {
let v0
v0 = rF64()
o0["mediaPct"] = v0
break
}
case 12: {
let v0
v0 = rF64()
o0["filesPct"] = v0
break
}
case 13: {
let v0
v0 = rF64()
o0["trashPct"] = v0
break
}
case 14: {
let v0
v0 = rF64()
o0["mediaPercent"] = v0
break
}
case 15: {
let v0
v0 = rF64()
o0["filesPercent"] = v0
break
}
case 16: {
let v0
v0 = rF64()
o0["trashPercent"] = v0
break
}
case 17: {
let v0
v0 = rStr()
o0["mediaFormatted"] = v0
break
}
case 18: {
let v0
v0 = rStr()
o0["filesFormatted"] = v0
break
}
case 19: {
let v0
v0 = rStr()
o0["activeTotalFormatted"] = v0
break
}
case 20: {
let v0
v0 = rStr()
o0["trashFormatted"] = v0
break
}
case 21: {
let v0
v0 = rStr()
o0["grandTotalFormatted"] = v0
break
}
case 22: {
let v0
{
const g1 = rU8()
if (g1 === 0) v0 = undefined
else if (g1 === 2) v0 = null
else {
v0 = rF64()
}
}
o0["thumbCacheBytes"] = v0
break
}
case 23: {
let v0
{
const g1 = rU8()
if (g1 === 0) v0 = undefined
else if (g1 === 2) v0 = null
else {
v0 = rStr()
}
}
o0["thumbCacheFormatted"] = v0
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
module.exports.computeCloudStorageStats = function computeCloudStorageStats (a0, a1, a2) {
  try {
    if (arguments.length <= 3 && encode(a0, a1, a2) && wireCall(call)) return decode()
    return json(...arguments)
  } catch (e) {
    throw jsError(e)
  }
}
}

// `renderLoginTemplate`: binary wire; the JSON version handles inputs of other shapes.
{
const json = module.exports.renderLoginTemplate
const call = native.renderLoginTemplateWire
const encode = (a0) => {
at = 0
if (a0 === undefined) {
wU8(0)
} else if (a0 === null) {
return false
wU8(2)
} else {
wU8(1)
if (typeof a0 !== 'string') return false
wStr(a0)
}
return true
}
const decode = () => {
let t
t = rStr()
return t
}
module.exports.renderLoginTemplate = function renderLoginTemplate (a0) {
  if (illFormed(a0)) throw new TypeError('argument 1 of renderLoginTemplate has a lone surrogate, which a Rust String cannot hold')
  try {
    if (arguments.length <= 1 && encode(a0) && wireCall(call)) return decode()
    return json(...arguments)
  } catch (e) {
    throw jsError(e)
  }
}
}

// `renderGalleryTemplate`: binary wire; the JSON version handles inputs of other shapes.
{
const json = module.exports.renderGalleryTemplate
const call = native.renderGalleryTemplateWire
const encode = (a0, a1, a2, a3) => {
at = 0
if (!Array.isArray(a0)) return false
wU8(1)
wU32(a0.length)
for (let i0 = 0; i0 < a0.length; i0++) {
const v0 = a0[i0]
if (v0 === null || typeof v0 !== 'object' || Array.isArray(v0)) return false
{
const at1 = at
wU8(0)
let n1 = 0, r1 = 0
for (const k1 in v0) {
switch (k1) {
case "filename": {
wU8(0)
r1++
const f1 = v0[k1]
if (typeof f1 !== 'string') return false
wStr(f1)
break
}
case "timestamp": {
wU8(1)
r1++
const f1 = v0[k1]
if (typeof f1 !== 'number') return false
wF64(f1)
break
}
case "size": {
wU8(2)
const f1 = v0[k1]
if (f1 === undefined) {
wU8(0)
} else if (f1 === null) {
return false
wU8(2)
} else {
wU8(1)
if (typeof f1 !== 'number') return false
wF64(f1)
}
break
}
case "isMedia": {
wU8(3)
const f1 = v0[k1]
if (f1 === undefined) {
wU8(0)
} else if (f1 === null) {
return false
wU8(2)
} else {
wU8(1)
if (typeof f1 !== 'boolean') return false
wU8(f1 ? 1 : 0)
}
break
}
case "category": {
wU8(4)
const f1 = v0[k1]
if (f1 === undefined) {
wU8(0)
} else if (f1 === null) {
return false
wU8(2)
} else {
wU8(1)
if (typeof f1 !== 'string') return false
wStr(f1)
}
break
}
case "album": {
wU8(5)
const f1 = v0[k1]
if (f1 === undefined) {
wU8(0)
} else if (f1 === null) {
return false
wU8(2)
} else {
wU8(1)
if (typeof f1 !== 'string') return false
wStr(f1)
}
break
}
case "hasThumb": {
wU8(6)
const f1 = v0[k1]
if (f1 === undefined) {
wU8(0)
} else if (f1 === null) {
return false
wU8(2)
} else {
wU8(1)
if (typeof f1 !== 'boolean') return false
wU8(f1 ? 1 : 0)
}
break
}
default: return false
}
if (++n1 > 255) return false
}
if (r1 !== 2) return false
iv.setUint8(at1, n1)
}
}
if (a1 === undefined) {
wU8(0)
} else if (a1 === null) {
return false
wU8(2)
} else {
wU8(1)
if (!Array.isArray(a1)) return false
wU8(1)
wU32(a1.length)
for (let i0 = 0; i0 < a1.length; i0++) {
const v0 = a1[i0]
if (typeof v0 !== 'string') return false
wStr(v0)
}
}
if (a2 === undefined) {
wU8(0)
} else if (a2 === null) {
return false
wU8(2)
} else {
wU8(1)
if (!Array.isArray(a2)) return false
wU8(1)
wU32(a2.length)
for (let i0 = 0; i0 < a2.length; i0++) {
const v0 = a2[i0]
if (v0 === null || typeof v0 !== 'object' || Array.isArray(v0)) return false
{
const at1 = at
wU8(0)
let n1 = 0, r1 = 0
for (const k1 in v0) {
switch (k1) {
case "filename": {
wU8(0)
r1++
const f1 = v0[k1]
if (typeof f1 !== 'string') return false
wStr(f1)
break
}
case "timestamp": {
wU8(1)
r1++
const f1 = v0[k1]
if (typeof f1 !== 'number') return false
wF64(f1)
break
}
case "size": {
wU8(2)
const f1 = v0[k1]
if (f1 === undefined) {
wU8(0)
} else if (f1 === null) {
return false
wU8(2)
} else {
wU8(1)
if (typeof f1 !== 'number') return false
wF64(f1)
}
break
}
case "isMedia": {
wU8(3)
const f1 = v0[k1]
if (f1 === undefined) {
wU8(0)
} else if (f1 === null) {
return false
wU8(2)
} else {
wU8(1)
if (typeof f1 !== 'boolean') return false
wU8(f1 ? 1 : 0)
}
break
}
case "category": {
wU8(4)
const f1 = v0[k1]
if (f1 === undefined) {
wU8(0)
} else if (f1 === null) {
return false
wU8(2)
} else {
wU8(1)
if (typeof f1 !== 'string') return false
wStr(f1)
}
break
}
case "album": {
wU8(5)
const f1 = v0[k1]
if (f1 === undefined) {
wU8(0)
} else if (f1 === null) {
return false
wU8(2)
} else {
wU8(1)
if (typeof f1 !== 'string') return false
wStr(f1)
}
break
}
case "hasThumb": {
wU8(6)
const f1 = v0[k1]
if (f1 === undefined) {
wU8(0)
} else if (f1 === null) {
return false
wU8(2)
} else {
wU8(1)
if (typeof f1 !== 'boolean') return false
wU8(f1 ? 1 : 0)
}
break
}
default: return false
}
if (++n1 > 255) return false
}
if (r1 !== 2) return false
iv.setUint8(at1, n1)
}
}
}
if (a3 === undefined) {
wU8(0)
} else if (a3 === null) {
return false
wU8(2)
} else {
wU8(1)
if (!Array.isArray(a3)) return false
wU8(1)
wU32(a3.length)
for (let i0 = 0; i0 < a3.length; i0++) {
const v0 = a3[i0]
if (typeof v0 !== 'string') return false
wStr(v0)
}
}
return true
}
const decode = () => {
let t
t = rStr()
return t
}
module.exports.renderGalleryTemplate = function renderGalleryTemplate (a0, a1, a2, a3) {
  try {
    if (arguments.length <= 4 && encode(a0, a1, a2, a3) && wireCall(call)) return decode()
    return json(...arguments)
  } catch (e) {
    throw jsError(e)
  }
}
}

// `renderTrashTemplate`: binary wire; the JSON version handles inputs of other shapes.
{
const json = module.exports.renderTrashTemplate
const call = native.renderTrashTemplateWire
const encode = (a0, a1) => {
at = 0
if (!Array.isArray(a0)) return false
wU8(1)
wU32(a0.length)
for (let i0 = 0; i0 < a0.length; i0++) {
const v0 = a0[i0]
if (v0 === null || typeof v0 !== 'object' || Array.isArray(v0)) return false
{
const at1 = at
wU8(0)
let n1 = 0, r1 = 0
for (const k1 in v0) {
switch (k1) {
case "filename": {
wU8(0)
r1++
const f1 = v0[k1]
if (typeof f1 !== 'string') return false
wStr(f1)
break
}
case "timestamp": {
wU8(1)
r1++
const f1 = v0[k1]
if (typeof f1 !== 'number') return false
wF64(f1)
break
}
case "size": {
wU8(2)
const f1 = v0[k1]
if (f1 === undefined) {
wU8(0)
} else if (f1 === null) {
return false
wU8(2)
} else {
wU8(1)
if (typeof f1 !== 'number') return false
wF64(f1)
}
break
}
case "isMedia": {
wU8(3)
const f1 = v0[k1]
if (f1 === undefined) {
wU8(0)
} else if (f1 === null) {
return false
wU8(2)
} else {
wU8(1)
if (typeof f1 !== 'boolean') return false
wU8(f1 ? 1 : 0)
}
break
}
case "category": {
wU8(4)
const f1 = v0[k1]
if (f1 === undefined) {
wU8(0)
} else if (f1 === null) {
return false
wU8(2)
} else {
wU8(1)
if (typeof f1 !== 'string') return false
wStr(f1)
}
break
}
case "album": {
wU8(5)
const f1 = v0[k1]
if (f1 === undefined) {
wU8(0)
} else if (f1 === null) {
return false
wU8(2)
} else {
wU8(1)
if (typeof f1 !== 'string') return false
wStr(f1)
}
break
}
case "hasThumb": {
wU8(6)
const f1 = v0[k1]
if (f1 === undefined) {
wU8(0)
} else if (f1 === null) {
return false
wU8(2)
} else {
wU8(1)
if (typeof f1 !== 'boolean') return false
wU8(f1 ? 1 : 0)
}
break
}
default: return false
}
if (++n1 > 255) return false
}
if (r1 !== 2) return false
iv.setUint8(at1, n1)
}
}
if (a1 === undefined) {
wU8(0)
} else if (a1 === null) {
return false
wU8(2)
} else {
wU8(1)
if (!Array.isArray(a1)) return false
wU8(1)
wU32(a1.length)
for (let i0 = 0; i0 < a1.length; i0++) {
const v0 = a1[i0]
if (v0 === null || typeof v0 !== 'object' || Array.isArray(v0)) return false
{
const at1 = at
wU8(0)
let n1 = 0, r1 = 0
for (const k1 in v0) {
switch (k1) {
case "filename": {
wU8(0)
r1++
const f1 = v0[k1]
if (typeof f1 !== 'string') return false
wStr(f1)
break
}
case "timestamp": {
wU8(1)
r1++
const f1 = v0[k1]
if (typeof f1 !== 'number') return false
wF64(f1)
break
}
case "size": {
wU8(2)
const f1 = v0[k1]
if (f1 === undefined) {
wU8(0)
} else if (f1 === null) {
return false
wU8(2)
} else {
wU8(1)
if (typeof f1 !== 'number') return false
wF64(f1)
}
break
}
case "isMedia": {
wU8(3)
const f1 = v0[k1]
if (f1 === undefined) {
wU8(0)
} else if (f1 === null) {
return false
wU8(2)
} else {
wU8(1)
if (typeof f1 !== 'boolean') return false
wU8(f1 ? 1 : 0)
}
break
}
case "category": {
wU8(4)
const f1 = v0[k1]
if (f1 === undefined) {
wU8(0)
} else if (f1 === null) {
return false
wU8(2)
} else {
wU8(1)
if (typeof f1 !== 'string') return false
wStr(f1)
}
break
}
case "album": {
wU8(5)
const f1 = v0[k1]
if (f1 === undefined) {
wU8(0)
} else if (f1 === null) {
return false
wU8(2)
} else {
wU8(1)
if (typeof f1 !== 'string') return false
wStr(f1)
}
break
}
case "hasThumb": {
wU8(6)
const f1 = v0[k1]
if (f1 === undefined) {
wU8(0)
} else if (f1 === null) {
return false
wU8(2)
} else {
wU8(1)
if (typeof f1 !== 'boolean') return false
wU8(f1 ? 1 : 0)
}
break
}
default: return false
}
if (++n1 > 255) return false
}
if (r1 !== 2) return false
iv.setUint8(at1, n1)
}
}
}
return true
}
const decode = () => {
let t
t = rStr()
return t
}
module.exports.renderTrashTemplate = function renderTrashTemplate (a0, a1) {
  try {
    if (arguments.length <= 2 && encode(a0, a1) && wireCall(call)) return decode()
    return json(...arguments)
  } catch (e) {
    throw jsError(e)
  }
}
}

// `resolveThumbCacheMaxBytes`: binary wire; the JSON version handles inputs of other shapes.
{
const json = module.exports.resolveThumbCacheMaxBytes
const call = native.resolveThumbCacheMaxBytesWire
const encode = (a0) => {
at = 0
if (a0 === undefined) {
wU8(0)
} else if (a0 === null) {
return false
wU8(2)
} else {
wU8(1)
if (typeof a0 !== 'number') return false
wF64(a0)
}
return true
}
const decode = () => {
let t
t = rF64()
return t
}
module.exports.resolveThumbCacheMaxBytes = function resolveThumbCacheMaxBytes (a0) {
  try {
    if (arguments.length <= 1 && encode(a0) && wireCall(call)) return decode()
    return json(...arguments)
  } catch (e) {
    throw jsError(e)
  }
}
}

// `parsePreviewVariant`: binary wire; the JSON version handles inputs of other shapes.
{
const json = module.exports.parsePreviewVariant
const call = native.parsePreviewVariantWire
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
if (typeof a1 !== 'boolean') return false
wU8(a1 ? 1 : 0)
}
return true
}
const decode = () => {
let t
{
const g0 = rU8()
if (g0 === 0) t = undefined
else if (g0 === 2) t = null
else {
t = rStr()
}
}
return t
}
module.exports.parsePreviewVariant = function parsePreviewVariant (a0, a1) {
  try {
    if (arguments.length <= 2 && encode(a0, a1) && wireCall(call)) return decode()
    return json(...arguments)
  } catch (e) {
    throw jsError(e)
  }
}
}

// `isJpegMagicBytes`: binary wire; the JSON version handles inputs of other shapes.
{
const json = module.exports.isJpegMagicBytes
const call = native.isJpegMagicBytesWire
const encode = (a0) => {
at = 0
if (!wDyn(a0)) return false
return true
}
const decode = () => {
let t
t = rU8() === 1
return t
}
module.exports.isJpegMagicBytes = function isJpegMagicBytes (a0) {
  try {
    if (arguments.length <= 1 && encode(a0) && wireCall(call)) return decode()
    return json(...arguments)
  } catch (e) {
    throw jsError(e)
  }
}
}

// `writeJsonAtomic`: binary wire; the JSON version handles inputs of other shapes.
{
const json = module.exports.writeJsonAtomic
const call = native.writeJsonAtomicWire
const encode = (a0, a1) => {
at = 0
if (typeof a0 !== 'string') return false
wStr(a0)
if (!wDyn(a1)) return false
return true
}
const decode = () => {
let t
return t
}
module.exports.writeJsonAtomic = function writeJsonAtomic (a0, a1) {
  if (illFormed(a0)) throw new TypeError('argument 1 of writeJsonAtomic has a lone surrogate, which a Rust String cannot hold')
  try {
    if (arguments.length <= 2 && encode(a0, a1) && wireCall(call)) return decode()
    return json(...arguments)
  } catch (e) {
    throw jsError(e)
  }
}
}

// `getOrCreateServerSecret`: binary wire; the JSON version handles inputs of other shapes.
{
const json = module.exports.getOrCreateServerSecret
const call = native.getOrCreateServerSecretWire
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
module.exports.getOrCreateServerSecret = function getOrCreateServerSecret (a0) {
  if (illFormed(a0)) throw new TypeError('argument 1 of getOrCreateServerSecret has a lone surrogate, which a Rust String cannot hold')
  try {
    if (arguments.length <= 1 && encode(a0) && wireCall(call)) return decode()
    return json(...arguments)
  } catch (e) {
    throw jsError(e)
  }
}
}

// `wrapSecret`: binary wire; the JSON version handles inputs of other shapes.
{
const json = module.exports.wrapSecret
const call = native.wrapSecretWire
const encode = (a0, a1) => {
at = 0
if (!wDyn(a0)) return false
if (typeof a1 !== 'string') return false
wStr(a1)
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
o0["v"] = v0
break
}
case 1: {
let v0
v0 = rStr()
o0["salt"] = v0
break
}
case 2: {
let v0
v0 = rStr()
o0["iv"] = v0
break
}
case 3: {
let v0
v0 = rStr()
o0["tag"] = v0
break
}
case 4: {
let v0
v0 = rStr()
o0["ct"] = v0
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
module.exports.wrapSecret = function wrapSecret (a0, a1) {
  if (illFormed(a1)) throw new TypeError('argument 2 of wrapSecret has a lone surrogate, which a Rust String cannot hold')
  try {
    if (arguments.length <= 2 && encode(a0, a1) && wireCall(call)) return decode()
    return json(...arguments)
  } catch (e) {
    throw jsError(e)
  }
}
}

// `unwrapSecret`: binary wire; the JSON version handles inputs of other shapes.
{
const json = module.exports.unwrapSecret
const call = native.unwrapSecretWire
const encode = (a0, a1) => {
at = 0
if (!wDyn(a0)) return false
if (!wDyn(a1)) return false
return true
}
const decode = () => {
let t
{
const g0 = rU8()
if (g0 === 0) t = undefined
else if (g0 === 2) t = null
else {
t = rStr()
}
}
return t
}
module.exports.unwrapSecret = function unwrapSecret (a0, a1) {
  try {
    if (arguments.length <= 2 && encode(a0, a1) && wireCall(call)) return decode()
    return json(...arguments)
  } catch (e) {
    throw jsError(e)
  }
}
}

// `hashLookupToken`: binary wire; the JSON version handles inputs of other shapes.
{
const json = module.exports.hashLookupToken
const call = native.hashLookupTokenWire
const encode = (a0) => {
at = 0
if (typeof a0 !== 'string') return false
wStr(a0)
return true
}
const decode = () => {
let t
t = rStr()
return t
}
module.exports.hashLookupToken = function hashLookupToken (a0) {
  if (illFormed(a0)) throw new TypeError('argument 1 of hashLookupToken has a lone surrogate, which a Rust String cannot hold')
  try {
    if (arguments.length <= 1 && encode(a0) && wireCall(call)) return decode()
    return json(...arguments)
  } catch (e) {
    throw jsError(e)
  }
}
}

// `isValidUuidV4`: binary wire; the JSON version handles inputs of other shapes.
{
const json = module.exports.isValidUuidV4
const call = native.isValidUuidV4Wire
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
module.exports.isValidUuidV4 = function isValidUuidV4 (a0) {
  try {
    if (arguments.length <= 1 && encode(a0) && wireCall(call)) return decode()
    return json(...arguments)
  } catch (e) {
    throw jsError(e)
  }
}
}

// `decodeBase64UrlStrict`: binary wire; the JSON version handles inputs of other shapes.
{
const json = module.exports.decodeBase64UrlStrict
const call = native.decodeBase64UrlStrictWire
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
module.exports.decodeBase64UrlStrict = function decodeBase64UrlStrict (a0, a1) {
  try {
    if (arguments.length <= 2 && encode(a0, a1) && wireCall(call)) return decode()
    return json(...arguments)
  } catch (e) {
    throw jsError(e)
  }
}
}

// `deriveFakeSaltForUsername`: binary wire; the JSON version handles inputs of other shapes.
{
const json = module.exports.deriveFakeSaltForUsername
const call = native.deriveFakeSaltForUsernameWire
const encode = (a0, a1) => {
at = 0
if (!wDyn(a0)) return false
if (typeof a1 !== 'string') return false
wStr(a1)
return true
}
const decode = () => {
let t
t = rStr()
return t
}
module.exports.deriveFakeSaltForUsername = function deriveFakeSaltForUsername (a0, a1) {
  if (illFormed(a1)) throw new TypeError('argument 2 of deriveFakeSaltForUsername has a lone surrogate, which a Rust String cannot hold')
  try {
    if (arguments.length <= 2 && encode(a0, a1) && wireCall(call)) return decode()
    return json(...arguments)
  } catch (e) {
    throw jsError(e)
  }
}
}

// `timingSafeHexEqual`: binary wire; the JSON version handles inputs of other shapes.
{
const json = module.exports.timingSafeHexEqual
const call = native.timingSafeHexEqualWire
const encode = (a0, a1) => {
at = 0
if (typeof a0 !== 'string') return false
wStr(a0)
if (typeof a1 !== 'string') return false
wStr(a1)
return true
}
const decode = () => {
let t
t = rU8() === 1
return t
}
module.exports.timingSafeHexEqual = function timingSafeHexEqual (a0, a1) {
  if (illFormed(a0)) throw new TypeError('argument 1 of timingSafeHexEqual has a lone surrogate, which a Rust String cannot hold')
  if (illFormed(a1)) throw new TypeError('argument 2 of timingSafeHexEqual has a lone surrogate, which a Rust String cannot hold')
  try {
    if (arguments.length <= 2 && encode(a0, a1) && wireCall(call)) return decode()
    return json(...arguments)
  } catch (e) {
    throw jsError(e)
  }
}
}

// `fsyncDirBestEffort`: binary wire; the JSON version handles inputs of other shapes.
{
const json = module.exports.fsyncDirBestEffort
const call = native.fsyncDirBestEffortWire
const encode = (a0) => {
at = 0
if (typeof a0 !== 'string') return false
wStr(a0)
return true
}
const decode = () => {
let t
return t
}
module.exports.fsyncDirBestEffort = function fsyncDirBestEffort (a0) {
  if (illFormed(a0)) throw new TypeError('argument 1 of fsyncDirBestEffort has a lone surrogate, which a Rust String cannot hold')
  try {
    if (arguments.length <= 1 && encode(a0) && wireCall(call)) return decode()
    return json(...arguments)
  } catch (e) {
    throw jsError(e)
  }
}
}

// `writeBufferAtomicSync`: binary wire; the JSON version handles inputs of other shapes.
{
const json = module.exports.writeBufferAtomicSync
const call = native.writeBufferAtomicSyncWire
const encode = (a0, a1, a2) => {
at = 0
if (typeof a0 !== 'string') return false
wStr(a0)
if (typeof a1 !== 'string') return false
wStr(a1)
if (!wDyn(a2)) return false
return true
}
const decode = () => {
let t
return t
}
module.exports.writeBufferAtomicSync = function writeBufferAtomicSync (a0, a1, a2) {
  if (illFormed(a0)) throw new TypeError('argument 1 of writeBufferAtomicSync has a lone surrogate, which a Rust String cannot hold')
  if (illFormed(a1)) throw new TypeError('argument 2 of writeBufferAtomicSync has a lone surrogate, which a Rust String cannot hold')
  try {
    if (arguments.length <= 3 && encode(a0, a1, a2) && wireCall(call)) return decode()
    return json(...arguments)
  } catch (e) {
    throw jsError(e)
  }
}
}

// `moveTempFileAtomicSync`: binary wire; the JSON version handles inputs of other shapes.
{
const json = module.exports.moveTempFileAtomicSync
const call = native.moveTempFileAtomicSyncWire
const encode = (a0, a1) => {
at = 0
if (typeof a0 !== 'string') return false
wStr(a0)
if (typeof a1 !== 'string') return false
wStr(a1)
return true
}
const decode = () => {
let t
return t
}
module.exports.moveTempFileAtomicSync = function moveTempFileAtomicSync (a0, a1) {
  if (illFormed(a0)) throw new TypeError('argument 1 of moveTempFileAtomicSync has a lone surrogate, which a Rust String cannot hold')
  if (illFormed(a1)) throw new TypeError('argument 2 of moveTempFileAtomicSync has a lone surrogate, which a Rust String cannot hold')
  try {
    if (arguments.length <= 2 && encode(a0, a1) && wireCall(call)) return decode()
    return json(...arguments)
  } catch (e) {
    throw jsError(e)
  }
}
}

// `parseHttpRangeHeader`: binary wire; the JSON version handles inputs of other shapes.
{
const json = module.exports.parseHttpRangeHeader
const call = native.parseHttpRangeHeaderWire
const encode = (a0, a1) => {
at = 0
if (a0 === undefined) {
wU8(0)
} else if (a0 === null) {
return false
wU8(2)
} else {
wU8(1)
if (typeof a0 !== 'string') return false
wStr(a0)
}
if (typeof a1 !== 'number') return false
wF64(a1)
return true
}
const decode = () => {
let t
t = rDyn()
return t
}
module.exports.parseHttpRangeHeader = function parseHttpRangeHeader (a0, a1) {
  if (illFormed(a0)) throw new TypeError('argument 1 of parseHttpRangeHeader has a lone surrogate, which a Rust String cannot hold')
  try {
    if (arguments.length <= 2 && encode(a0, a1) && wireCall(call)) return decode()
    return json(...arguments)
  } catch (e) {
    throw jsError(e)
  }
}
}

// `verifyInviteTokenConstantTime`: binary wire; the JSON version handles inputs of other shapes.
{
const json = module.exports.verifyInviteTokenConstantTime
const call = native.verifyInviteTokenConstantTimeWire
const encode = (a0, a1) => {
at = 0
if (a0 === undefined) {
wU8(0)
} else if (a0 === null) {
return false
wU8(2)
} else {
wU8(1)
if (typeof a0 !== 'string') return false
wStr(a0)
}
if (!wDyn(a1)) return false
return true
}
const decode = () => {
let t
t = rU8() === 1
return t
}
module.exports.verifyInviteTokenConstantTime = function verifyInviteTokenConstantTime (a0, a1) {
  if (illFormed(a0)) throw new TypeError('argument 1 of verifyInviteTokenConstantTime has a lone surrogate, which a Rust String cannot hold')
  try {
    if (arguments.length <= 2 && encode(a0, a1) && wireCall(call)) return decode()
    return json(...arguments)
  } catch (e) {
    throw jsError(e)
  }
}
}

// `isSecureOrLocalhostRequest`: binary wire; the JSON version handles inputs of other shapes.
{
const json = module.exports.isSecureOrLocalhostRequest
const call = native.isSecureOrLocalhostRequestWire
const encode = (a0) => {
at = 0
if (!wDyn(a0)) return false
return true
}
const decode = () => {
let t
t = rU8() === 1
return t
}
module.exports.isSecureOrLocalhostRequest = function isSecureOrLocalhostRequest (a0) {
  try {
    if (arguments.length <= 1 && encode(a0) && wireCall(call)) return decode()
    return json(...arguments)
  } catch (e) {
    throw jsError(e)
  }
}
}
const guards = {
  deriveKeyAsync: [true, [0]],
  encryptFileAsync: [true, [1]],
  encryptFileStream: [true, [0, 1, 2]],
  decryptFileAsync: [true, [1]],
  decryptFileSha256Stream: [true, [0, 1]],
  parseDocumentBuffer: [true, []],
  extractApkSigningCertSha256: [true, []],
  compileSignedAndroidApk: [true, [0]],
  triggerGitHubActionsBuild: [true, []],
  publishApkToGitHubRelease: [true, []],
  computePHashHex: [true, []],
  initPushService: [true, [0]],
  sendPushToUser: [true, [0]],
  computeScryptVerifierAsync: [true, []],
  verifyScryptConstantTime: [true, []],
  computeFileSha256Hex: [true, [0]],
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
