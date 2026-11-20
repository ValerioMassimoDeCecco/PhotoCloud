"use strict";
(() => {
  var __create = Object.create;
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __getProtoOf = Object.getPrototypeOf;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __require = /* @__PURE__ */ ((x) => typeof require !== "undefined" ? require : typeof Proxy !== "undefined" ? new Proxy(x, {
    get: (a, b) => (typeof require !== "undefined" ? require : a)[b]
  }) : x)(function(x) {
    if (typeof require !== "undefined") return require.apply(this, arguments);
    throw Error('Dynamic require of "' + x + '" is not supported');
  });
  var __commonJS = (cb, mod) => function __require2() {
    try {
      return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
    } catch (e) {
      throw mod = 0, e;
    }
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
    // If the importer is in node compatibility mode or this is not an ESM
    // file that has been converted to a CommonJS file using a Babel-
    // compatible transform (i.e. "__esModule" has not been set), then set
    // "default" to the CommonJS "module.exports" for node compatibility.
    isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
    mod
  ));

  // node_modules/jszip/dist/jszip.min.js
  var require_jszip_min = __commonJS({
    "node_modules/jszip/dist/jszip.min.js"(exports, module) {
      !(function(e) {
        if ("object" == typeof exports && "undefined" != typeof module) module.exports = e();
        else if ("function" == typeof define && define.amd) define([], e);
        else {
          ("undefined" != typeof window ? window : "undefined" != typeof global ? global : "undefined" != typeof self ? self : this).JSZip = e();
        }
      })(function() {
        return (function s(a, o, h) {
          function u(r, e2) {
            if (!o[r]) {
              if (!a[r]) {
                var t = "function" == typeof __require && __require;
                if (!e2 && t) return t(r, true);
                if (l) return l(r, true);
                var n = new Error("Cannot find module '" + r + "'");
                throw n.code = "MODULE_NOT_FOUND", n;
              }
              var i = o[r] = { exports: {} };
              a[r][0].call(i.exports, function(e3) {
                var t2 = a[r][1][e3];
                return u(t2 || e3);
              }, i, i.exports, s, a, o, h);
            }
            return o[r].exports;
          }
          for (var l = "function" == typeof __require && __require, e = 0; e < h.length; e++) u(h[e]);
          return u;
        })({ 1: [function(e, t, r) {
          "use strict";
          var d = e("./utils"), c = e("./support"), p = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=";
          r.encode = function(e2) {
            for (var t2, r2, n, i, s, a, o, h = [], u = 0, l = e2.length, f = l, c2 = "string" !== d.getTypeOf(e2); u < e2.length; ) f = l - u, n = c2 ? (t2 = e2[u++], r2 = u < l ? e2[u++] : 0, u < l ? e2[u++] : 0) : (t2 = e2.charCodeAt(u++), r2 = u < l ? e2.charCodeAt(u++) : 0, u < l ? e2.charCodeAt(u++) : 0), i = t2 >> 2, s = (3 & t2) << 4 | r2 >> 4, a = 1 < f ? (15 & r2) << 2 | n >> 6 : 64, o = 2 < f ? 63 & n : 64, h.push(p.charAt(i) + p.charAt(s) + p.charAt(a) + p.charAt(o));
            return h.join("");
          }, r.decode = function(e2) {
            var t2, r2, n, i, s, a, o = 0, h = 0, u = "data:";
            if (e2.substr(0, u.length) === u) throw new Error("Invalid base64 input, it looks like a data url.");
            var l, f = 3 * (e2 = e2.replace(/[^A-Za-z0-9+/=]/g, "")).length / 4;
            if (e2.charAt(e2.length - 1) === p.charAt(64) && f--, e2.charAt(e2.length - 2) === p.charAt(64) && f--, f % 1 != 0) throw new Error("Invalid base64 input, bad content length.");
            for (l = c.uint8array ? new Uint8Array(0 | f) : new Array(0 | f); o < e2.length; ) t2 = p.indexOf(e2.charAt(o++)) << 2 | (i = p.indexOf(e2.charAt(o++))) >> 4, r2 = (15 & i) << 4 | (s = p.indexOf(e2.charAt(o++))) >> 2, n = (3 & s) << 6 | (a = p.indexOf(e2.charAt(o++))), l[h++] = t2, 64 !== s && (l[h++] = r2), 64 !== a && (l[h++] = n);
            return l;
          };
        }, { "./support": 30, "./utils": 32 }], 2: [function(e, t, r) {
          "use strict";
          var n = e("./external"), i = e("./stream/DataWorker"), s = e("./stream/Crc32Probe"), a = e("./stream/DataLengthProbe");
          function o(e2, t2, r2, n2, i2) {
            this.compressedSize = e2, this.uncompressedSize = t2, this.crc32 = r2, this.compression = n2, this.compressedContent = i2;
          }
          o.prototype = { getContentWorker: function() {
            var e2 = new i(n.Promise.resolve(this.compressedContent)).pipe(this.compression.uncompressWorker()).pipe(new a("data_length")), t2 = this;
            return e2.on("end", function() {
              if (this.streamInfo.data_length !== t2.uncompressedSize) throw new Error("Bug : uncompressed data size mismatch");
            }), e2;
          }, getCompressedWorker: function() {
            return new i(n.Promise.resolve(this.compressedContent)).withStreamInfo("compressedSize", this.compressedSize).withStreamInfo("uncompressedSize", this.uncompressedSize).withStreamInfo("crc32", this.crc32).withStreamInfo("compression", this.compression);
          } }, o.createWorkerFrom = function(e2, t2, r2) {
            return e2.pipe(new s()).pipe(new a("uncompressedSize")).pipe(t2.compressWorker(r2)).pipe(new a("compressedSize")).withStreamInfo("compression", t2);
          }, t.exports = o;
        }, { "./external": 6, "./stream/Crc32Probe": 25, "./stream/DataLengthProbe": 26, "./stream/DataWorker": 27 }], 3: [function(e, t, r) {
          "use strict";
          var n = e("./stream/GenericWorker");
          r.STORE = { magic: "\0\0", compressWorker: function() {
            return new n("STORE compression");
          }, uncompressWorker: function() {
            return new n("STORE decompression");
          } }, r.DEFLATE = e("./flate");
        }, { "./flate": 7, "./stream/GenericWorker": 28 }], 4: [function(e, t, r) {
          "use strict";
          var n = e("./utils");
          var o = (function() {
            for (var e2, t2 = [], r2 = 0; r2 < 256; r2++) {
              e2 = r2;
              for (var n2 = 0; n2 < 8; n2++) e2 = 1 & e2 ? 3988292384 ^ e2 >>> 1 : e2 >>> 1;
              t2[r2] = e2;
            }
            return t2;
          })();
          t.exports = function(e2, t2) {
            return void 0 !== e2 && e2.length ? "string" !== n.getTypeOf(e2) ? (function(e3, t3, r2, n2) {
              var i = o, s = n2 + r2;
              e3 ^= -1;
              for (var a = n2; a < s; a++) e3 = e3 >>> 8 ^ i[255 & (e3 ^ t3[a])];
              return -1 ^ e3;
            })(0 | t2, e2, e2.length, 0) : (function(e3, t3, r2, n2) {
              var i = o, s = n2 + r2;
              e3 ^= -1;
              for (var a = n2; a < s; a++) e3 = e3 >>> 8 ^ i[255 & (e3 ^ t3.charCodeAt(a))];
              return -1 ^ e3;
            })(0 | t2, e2, e2.length, 0) : 0;
          };
        }, { "./utils": 32 }], 5: [function(e, t, r) {
          "use strict";
          r.base64 = false, r.binary = false, r.dir = false, r.createFolders = true, r.date = null, r.compression = null, r.compressionOptions = null, r.comment = null, r.unixPermissions = null, r.dosPermissions = null;
        }, {}], 6: [function(e, t, r) {
          "use strict";
          var n = null;
          n = "undefined" != typeof Promise ? Promise : e("lie"), t.exports = { Promise: n };
        }, { lie: 37 }], 7: [function(e, t, r) {
          "use strict";
          var n = "undefined" != typeof Uint8Array && "undefined" != typeof Uint16Array && "undefined" != typeof Uint32Array, i = e("pako"), s = e("./utils"), a = e("./stream/GenericWorker"), o = n ? "uint8array" : "array";
          function h(e2, t2) {
            a.call(this, "FlateWorker/" + e2), this._pako = null, this._pakoAction = e2, this._pakoOptions = t2, this.meta = {};
          }
          r.magic = "\b\0", s.inherits(h, a), h.prototype.processChunk = function(e2) {
            this.meta = e2.meta, null === this._pako && this._createPako(), this._pako.push(s.transformTo(o, e2.data), false);
          }, h.prototype.flush = function() {
            a.prototype.flush.call(this), null === this._pako && this._createPako(), this._pako.push([], true);
          }, h.prototype.cleanUp = function() {
            a.prototype.cleanUp.call(this), this._pako = null;
          }, h.prototype._createPako = function() {
            this._pako = new i[this._pakoAction]({ raw: true, level: this._pakoOptions.level || -1 });
            var t2 = this;
            this._pako.onData = function(e2) {
              t2.push({ data: e2, meta: t2.meta });
            };
          }, r.compressWorker = function(e2) {
            return new h("Deflate", e2);
          }, r.uncompressWorker = function() {
            return new h("Inflate", {});
          };
        }, { "./stream/GenericWorker": 28, "./utils": 32, pako: 38 }], 8: [function(e, t, r) {
          "use strict";
          function A(e2, t2) {
            var r2, n2 = "";
            for (r2 = 0; r2 < t2; r2++) n2 += String.fromCharCode(255 & e2), e2 >>>= 8;
            return n2;
          }
          function n(e2, t2, r2, n2, i2, s2) {
            var a, o, h = e2.file, u = e2.compression, l = s2 !== O.utf8encode, f = I.transformTo("string", s2(h.name)), c = I.transformTo("string", O.utf8encode(h.name)), d = h.comment, p = I.transformTo("string", s2(d)), m = I.transformTo("string", O.utf8encode(d)), _ = c.length !== h.name.length, g = m.length !== d.length, b = "", v = "", y = "", w = h.dir, k = h.date, x = { crc32: 0, compressedSize: 0, uncompressedSize: 0 };
            t2 && !r2 || (x.crc32 = e2.crc32, x.compressedSize = e2.compressedSize, x.uncompressedSize = e2.uncompressedSize);
            var S = 0;
            t2 && (S |= 8), l || !_ && !g || (S |= 2048);
            var z = 0, C = 0;
            w && (z |= 16), "UNIX" === i2 ? (C = 798, z |= (function(e3, t3) {
              var r3 = e3;
              return e3 || (r3 = t3 ? 16893 : 33204), (65535 & r3) << 16;
            })(h.unixPermissions, w)) : (C = 20, z |= (function(e3) {
              return 63 & (e3 || 0);
            })(h.dosPermissions)), a = k.getUTCHours(), a <<= 6, a |= k.getUTCMinutes(), a <<= 5, a |= k.getUTCSeconds() / 2, o = k.getUTCFullYear() - 1980, o <<= 4, o |= k.getUTCMonth() + 1, o <<= 5, o |= k.getUTCDate(), _ && (v = A(1, 1) + A(B(f), 4) + c, b += "up" + A(v.length, 2) + v), g && (y = A(1, 1) + A(B(p), 4) + m, b += "uc" + A(y.length, 2) + y);
            var E = "";
            return E += "\n\0", E += A(S, 2), E += u.magic, E += A(a, 2), E += A(o, 2), E += A(x.crc32, 4), E += A(x.compressedSize, 4), E += A(x.uncompressedSize, 4), E += A(f.length, 2), E += A(b.length, 2), { fileRecord: R.LOCAL_FILE_HEADER + E + f + b, dirRecord: R.CENTRAL_FILE_HEADER + A(C, 2) + E + A(p.length, 2) + "\0\0\0\0" + A(z, 4) + A(n2, 4) + f + b + p };
          }
          var I = e("../utils"), i = e("../stream/GenericWorker"), O = e("../utf8"), B = e("../crc32"), R = e("../signature");
          function s(e2, t2, r2, n2) {
            i.call(this, "ZipFileWorker"), this.bytesWritten = 0, this.zipComment = t2, this.zipPlatform = r2, this.encodeFileName = n2, this.streamFiles = e2, this.accumulate = false, this.contentBuffer = [], this.dirRecords = [], this.currentSourceOffset = 0, this.entriesCount = 0, this.currentFile = null, this._sources = [];
          }
          I.inherits(s, i), s.prototype.push = function(e2) {
            var t2 = e2.meta.percent || 0, r2 = this.entriesCount, n2 = this._sources.length;
            this.accumulate ? this.contentBuffer.push(e2) : (this.bytesWritten += e2.data.length, i.prototype.push.call(this, { data: e2.data, meta: { currentFile: this.currentFile, percent: r2 ? (t2 + 100 * (r2 - n2 - 1)) / r2 : 100 } }));
          }, s.prototype.openedSource = function(e2) {
            this.currentSourceOffset = this.bytesWritten, this.currentFile = e2.file.name;
            var t2 = this.streamFiles && !e2.file.dir;
            if (t2) {
              var r2 = n(e2, t2, false, this.currentSourceOffset, this.zipPlatform, this.encodeFileName);
              this.push({ data: r2.fileRecord, meta: { percent: 0 } });
            } else this.accumulate = true;
          }, s.prototype.closedSource = function(e2) {
            this.accumulate = false;
            var t2 = this.streamFiles && !e2.file.dir, r2 = n(e2, t2, true, this.currentSourceOffset, this.zipPlatform, this.encodeFileName);
            if (this.dirRecords.push(r2.dirRecord), t2) this.push({ data: (function(e3) {
              return R.DATA_DESCRIPTOR + A(e3.crc32, 4) + A(e3.compressedSize, 4) + A(e3.uncompressedSize, 4);
            })(e2), meta: { percent: 100 } });
            else for (this.push({ data: r2.fileRecord, meta: { percent: 0 } }); this.contentBuffer.length; ) this.push(this.contentBuffer.shift());
            this.currentFile = null;
          }, s.prototype.flush = function() {
            for (var e2 = this.bytesWritten, t2 = 0; t2 < this.dirRecords.length; t2++) this.push({ data: this.dirRecords[t2], meta: { percent: 100 } });
            var r2 = this.bytesWritten - e2, n2 = (function(e3, t3, r3, n3, i2) {
              var s2 = I.transformTo("string", i2(n3));
              return R.CENTRAL_DIRECTORY_END + "\0\0\0\0" + A(e3, 2) + A(e3, 2) + A(t3, 4) + A(r3, 4) + A(s2.length, 2) + s2;
            })(this.dirRecords.length, r2, e2, this.zipComment, this.encodeFileName);
            this.push({ data: n2, meta: { percent: 100 } });
          }, s.prototype.prepareNextSource = function() {
            this.previous = this._sources.shift(), this.openedSource(this.previous.streamInfo), this.isPaused ? this.previous.pause() : this.previous.resume();
          }, s.prototype.registerPrevious = function(e2) {
            this._sources.push(e2);
            var t2 = this;
            return e2.on("data", function(e3) {
              t2.processChunk(e3);
            }), e2.on("end", function() {
              t2.closedSource(t2.previous.streamInfo), t2._sources.length ? t2.prepareNextSource() : t2.end();
            }), e2.on("error", function(e3) {
              t2.error(e3);
            }), this;
          }, s.prototype.resume = function() {
            return !!i.prototype.resume.call(this) && (!this.previous && this._sources.length ? (this.prepareNextSource(), true) : this.previous || this._sources.length || this.generatedError ? void 0 : (this.end(), true));
          }, s.prototype.error = function(e2) {
            var t2 = this._sources;
            if (!i.prototype.error.call(this, e2)) return false;
            for (var r2 = 0; r2 < t2.length; r2++) try {
              t2[r2].error(e2);
            } catch (e3) {
            }
            return true;
          }, s.prototype.lock = function() {
            i.prototype.lock.call(this);
            for (var e2 = this._sources, t2 = 0; t2 < e2.length; t2++) e2[t2].lock();
          }, t.exports = s;
        }, { "../crc32": 4, "../signature": 23, "../stream/GenericWorker": 28, "../utf8": 31, "../utils": 32 }], 9: [function(e, t, r) {
          "use strict";
          var u = e("../compressions"), n = e("./ZipFileWorker");
          r.generateWorker = function(e2, a, t2) {
            var o = new n(a.streamFiles, t2, a.platform, a.encodeFileName), h = 0;
            try {
              e2.forEach(function(e3, t3) {
                h++;
                var r2 = (function(e4, t4) {
                  var r3 = e4 || t4, n3 = u[r3];
                  if (!n3) throw new Error(r3 + " is not a valid compression method !");
                  return n3;
                })(t3.options.compression, a.compression), n2 = t3.options.compressionOptions || a.compressionOptions || {}, i = t3.dir, s = t3.date;
                t3._compressWorker(r2, n2).withStreamInfo("file", { name: e3, dir: i, date: s, comment: t3.comment || "", unixPermissions: t3.unixPermissions, dosPermissions: t3.dosPermissions }).pipe(o);
              }), o.entriesCount = h;
            } catch (e3) {
              o.error(e3);
            }
            return o;
          };
        }, { "../compressions": 3, "./ZipFileWorker": 8 }], 10: [function(e, t, r) {
          "use strict";
          function n() {
            if (!(this instanceof n)) return new n();
            if (arguments.length) throw new Error("The constructor with parameters has been removed in JSZip 3.0, please check the upgrade guide.");
            this.files = /* @__PURE__ */ Object.create(null), this.comment = null, this.root = "", this.clone = function() {
              var e2 = new n();
              for (var t2 in this) "function" != typeof this[t2] && (e2[t2] = this[t2]);
              return e2;
            };
          }
          (n.prototype = e("./object")).loadAsync = e("./load"), n.support = e("./support"), n.defaults = e("./defaults"), n.version = "3.10.2", n.loadAsync = function(e2, t2) {
            return new n().loadAsync(e2, t2);
          }, n.external = e("./external"), t.exports = n;
        }, { "./defaults": 5, "./external": 6, "./load": 11, "./object": 15, "./support": 30 }], 11: [function(e, t, r) {
          "use strict";
          var u = e("./utils"), i = e("./external"), n = e("./utf8"), s = e("./zipEntries"), a = e("./stream/Crc32Probe"), l = e("./nodejsUtils");
          function f(n2) {
            return new i.Promise(function(e2, t2) {
              var r2 = n2.decompressed.getContentWorker().pipe(new a());
              r2.on("error", function(e3) {
                t2(e3);
              }).on("end", function() {
                r2.streamInfo.crc32 !== n2.decompressed.crc32 ? t2(new Error("Corrupted zip : CRC32 mismatch")) : e2();
              }).resume();
            });
          }
          t.exports = function(e2, o) {
            var h = this;
            return o = u.extend(o || {}, { base64: false, checkCRC32: false, optimizedBinaryString: false, createFolders: false, decodeFileName: n.utf8decode }), l.isNode && l.isStream(e2) ? i.Promise.reject(new Error("JSZip can't accept a stream when loading a zip file.")) : u.prepareContent("the loaded zip file", e2, true, o.optimizedBinaryString, o.base64).then(function(e3) {
              var t2 = new s(o);
              return t2.load(e3), t2;
            }).then(function(e3) {
              var t2 = [i.Promise.resolve(e3)], r2 = e3.files;
              if (o.checkCRC32) for (var n2 = 0; n2 < r2.length; n2++) t2.push(f(r2[n2]));
              return i.Promise.all(t2);
            }).then(function(e3) {
              for (var t2 = e3.shift(), r2 = t2.files, n2 = 0; n2 < r2.length; n2++) {
                var i2 = r2[n2], s2 = i2.fileNameStr, a2 = u.resolve(i2.fileNameStr);
                h.file(a2, i2.decompressed, { binary: true, optimizedBinaryString: true, date: i2.date, dir: i2.dir, comment: i2.fileCommentStr.length ? i2.fileCommentStr : null, unixPermissions: i2.unixPermissions, dosPermissions: i2.dosPermissions, createFolders: o.createFolders }), i2.dir || (h.file(a2).unsafeOriginalName = s2);
              }
              return t2.zipComment.length && (h.comment = t2.zipComment), h;
            });
          };
        }, { "./external": 6, "./nodejsUtils": 14, "./stream/Crc32Probe": 25, "./utf8": 31, "./utils": 32, "./zipEntries": 33 }], 12: [function(e, t, r) {
          "use strict";
          var n = e("../utils"), i = e("../stream/GenericWorker");
          function s(e2, t2) {
            i.call(this, "Nodejs stream input adapter for " + e2), this._upstreamEnded = false, this._bindStream(t2);
          }
          n.inherits(s, i), s.prototype._bindStream = function(e2) {
            var t2 = this;
            (this._stream = e2).pause(), e2.on("data", function(e3) {
              t2.push({ data: e3, meta: { percent: 0 } });
            }).on("error", function(e3) {
              t2.isPaused ? this.generatedError = e3 : t2.error(e3);
            }).on("end", function() {
              t2.isPaused ? t2._upstreamEnded = true : t2.end();
            });
          }, s.prototype.pause = function() {
            return !!i.prototype.pause.call(this) && (this._stream.pause(), true);
          }, s.prototype.resume = function() {
            return !!i.prototype.resume.call(this) && (this._upstreamEnded ? this.end() : this._stream.resume(), true);
          }, t.exports = s;
        }, { "../stream/GenericWorker": 28, "../utils": 32 }], 13: [function(e, t, r) {
          "use strict";
          var i = e("readable-stream").Readable;
          function n(e2, t2, r2) {
            i.call(this, t2), this._helper = e2;
            var n2 = this;
            e2.on("data", function(e3, t3) {
              n2.push(e3) || n2._helper.pause(), r2 && r2(t3);
            }).on("error", function(e3) {
              n2.emit("error", e3);
            }).on("end", function() {
              n2.push(null);
            });
          }
          e("../utils").inherits(n, i), n.prototype._read = function() {
            this._helper.resume();
          }, t.exports = n;
        }, { "../utils": 32, "readable-stream": 16 }], 14: [function(e, t, r) {
          "use strict";
          t.exports = { isNode: "undefined" != typeof Buffer, newBufferFrom: function(e2, t2) {
            if (Buffer.from && Buffer.from !== Uint8Array.from) return Buffer.from(e2, t2);
            if ("number" == typeof e2) throw new Error('The "data" argument must not be a number');
            return new Buffer(e2, t2);
          }, allocBuffer: function(e2) {
            if (Buffer.alloc) return Buffer.alloc(e2);
            var t2 = new Buffer(e2);
            return t2.fill(0), t2;
          }, isBuffer: function(e2) {
            return Buffer.isBuffer(e2);
          }, isStream: function(e2) {
            return e2 && "function" == typeof e2.on && "function" == typeof e2.pause && "function" == typeof e2.resume;
          } };
        }, {}], 15: [function(e, t, r) {
          "use strict";
          function s(e2, t2, r2) {
            var n2, i2 = u.getTypeOf(t2), s2 = u.extend(r2 || {}, f);
            s2.date = s2.date || /* @__PURE__ */ new Date(), null !== s2.compression && (s2.compression = s2.compression.toUpperCase()), "string" == typeof s2.unixPermissions && (s2.unixPermissions = parseInt(s2.unixPermissions, 8)), s2.unixPermissions && 16384 & s2.unixPermissions && (s2.dir = true), s2.dosPermissions && 16 & s2.dosPermissions && (s2.dir = true), s2.dir && (e2 = g(e2)), s2.createFolders && (n2 = _(e2)) && b.call(this, n2, true);
            var a2 = "string" === i2 && false === s2.binary && false === s2.base64;
            r2 && void 0 !== r2.binary || (s2.binary = !a2), (t2 instanceof c && 0 === t2.uncompressedSize || s2.dir || !t2 || 0 === t2.length) && (s2.base64 = false, s2.binary = true, t2 = "", s2.compression = "STORE", i2 = "string");
            var o2 = null;
            o2 = t2 instanceof c || t2 instanceof l ? t2 : p.isNode && p.isStream(t2) ? new m(e2, t2) : u.prepareContent(e2, t2, s2.binary, s2.optimizedBinaryString, s2.base64);
            var h2 = new d(e2, o2, s2);
            this.files[e2] = h2;
          }
          var i = e("./utf8"), u = e("./utils"), l = e("./stream/GenericWorker"), a = e("./stream/StreamHelper"), f = e("./defaults"), c = e("./compressedObject"), d = e("./zipObject"), o = e("./generate"), p = e("./nodejsUtils"), m = e("./nodejs/NodejsStreamInputAdapter"), _ = function(e2) {
            "/" === e2.slice(-1) && (e2 = e2.substring(0, e2.length - 1));
            var t2 = e2.lastIndexOf("/");
            return 0 < t2 ? e2.substring(0, t2) : "";
          }, g = function(e2) {
            return "/" !== e2.slice(-1) && (e2 += "/"), e2;
          }, b = function(e2, t2) {
            return t2 = void 0 !== t2 ? t2 : f.createFolders, e2 = g(e2), this.files[e2] || s.call(this, e2, null, { dir: true, createFolders: t2 }), this.files[e2];
          };
          function h(e2) {
            return "[object RegExp]" === Object.prototype.toString.call(e2);
          }
          var n = { load: function() {
            throw new Error("This method has been removed in JSZip 3.0, please check the upgrade guide.");
          }, forEach: function(e2) {
            var t2, r2, n2;
            for (t2 in this.files) n2 = this.files[t2], (r2 = t2.slice(this.root.length, t2.length)) && t2.slice(0, this.root.length) === this.root && e2(r2, n2);
          }, filter: function(r2) {
            var n2 = [];
            return this.forEach(function(e2, t2) {
              r2(e2, t2) && n2.push(t2);
            }), n2;
          }, file: function(e2, t2, r2) {
            if (1 !== arguments.length) return e2 = this.root + e2, s.call(this, e2, t2, r2), this;
            if (h(e2)) {
              var n2 = e2;
              return this.filter(function(e3, t3) {
                return !t3.dir && n2.test(e3);
              });
            }
            var i2 = this.files[this.root + e2];
            return i2 && !i2.dir ? i2 : null;
          }, folder: function(r2) {
            if (!r2) return this;
            if (h(r2)) return this.filter(function(e3, t3) {
              return t3.dir && r2.test(e3);
            });
            var e2 = this.root + r2, t2 = b.call(this, e2), n2 = this.clone();
            return n2.root = t2.name, n2;
          }, remove: function(r2) {
            r2 = this.root + r2;
            var e2 = this.files[r2];
            if (e2 || ("/" !== r2.slice(-1) && (r2 += "/"), e2 = this.files[r2]), e2 && !e2.dir) delete this.files[r2];
            else for (var t2 = this.filter(function(e3, t3) {
              return t3.name.slice(0, r2.length) === r2;
            }), n2 = 0; n2 < t2.length; n2++) delete this.files[t2[n2].name];
            return this;
          }, generate: function() {
            throw new Error("This method has been removed in JSZip 3.0, please check the upgrade guide.");
          }, generateInternalStream: function(e2) {
            var t2, r2 = {};
            try {
              if ((r2 = u.extend(e2 || {}, { streamFiles: false, compression: "STORE", compressionOptions: null, type: "", platform: "DOS", comment: null, mimeType: "application/zip", encodeFileName: i.utf8encode })).type = r2.type.toLowerCase(), r2.compression = r2.compression.toUpperCase(), "binarystring" === r2.type && (r2.type = "string"), !r2.type) throw new Error("No output type specified.");
              u.checkSupport(r2.type), "darwin" !== r2.platform && "freebsd" !== r2.platform && "linux" !== r2.platform && "sunos" !== r2.platform || (r2.platform = "UNIX"), "win32" === r2.platform && (r2.platform = "DOS");
              var n2 = r2.comment || this.comment || "";
              t2 = o.generateWorker(this, r2, n2);
            } catch (e3) {
              (t2 = new l("error")).error(e3);
            }
            return new a(t2, r2.type || "string", r2.mimeType);
          }, generateAsync: function(e2, t2) {
            return this.generateInternalStream(e2).accumulate(t2);
          }, generateNodeStream: function(e2, t2) {
            return (e2 = e2 || {}).type || (e2.type = "nodebuffer"), this.generateInternalStream(e2).toNodejsStream(t2);
          } };
          t.exports = n;
        }, { "./compressedObject": 2, "./defaults": 5, "./generate": 9, "./nodejs/NodejsStreamInputAdapter": 12, "./nodejsUtils": 14, "./stream/GenericWorker": 28, "./stream/StreamHelper": 29, "./utf8": 31, "./utils": 32, "./zipObject": 35 }], 16: [function(e, t, r) {
          "use strict";
          t.exports = e("stream");
        }, { stream: void 0 }], 17: [function(e, t, r) {
          "use strict";
          var n = e("./DataReader");
          function i(e2) {
            n.call(this, e2);
            for (var t2 = 0; t2 < this.data.length; t2++) e2[t2] = 255 & e2[t2];
          }
          e("../utils").inherits(i, n), i.prototype.byteAt = function(e2) {
            return this.data[this.zero + e2];
          }, i.prototype.lastIndexOfSignature = function(e2) {
            for (var t2 = e2.charCodeAt(0), r2 = e2.charCodeAt(1), n2 = e2.charCodeAt(2), i2 = e2.charCodeAt(3), s = this.length - 4; 0 <= s; --s) if (this.data[s] === t2 && this.data[s + 1] === r2 && this.data[s + 2] === n2 && this.data[s + 3] === i2) return s - this.zero;
            return -1;
          }, i.prototype.readAndCheckSignature = function(e2) {
            var t2 = e2.charCodeAt(0), r2 = e2.charCodeAt(1), n2 = e2.charCodeAt(2), i2 = e2.charCodeAt(3), s = this.readData(4);
            return t2 === s[0] && r2 === s[1] && n2 === s[2] && i2 === s[3];
          }, i.prototype.readData = function(e2) {
            if (this.checkOffset(e2), 0 === e2) return [];
            var t2 = this.data.slice(this.zero + this.index, this.zero + this.index + e2);
            return this.index += e2, t2;
          }, t.exports = i;
        }, { "../utils": 32, "./DataReader": 18 }], 18: [function(e, t, r) {
          "use strict";
          var n = e("../utils");
          function i(e2) {
            this.data = e2, this.length = e2.length, this.index = 0, this.zero = 0;
          }
          i.prototype = { checkOffset: function(e2) {
            this.checkIndex(this.index + e2);
          }, checkIndex: function(e2) {
            if (this.length < this.zero + e2 || e2 < 0) throw new Error("End of data reached (data length = " + this.length + ", asked index = " + e2 + "). Corrupted zip ?");
          }, setIndex: function(e2) {
            this.checkIndex(e2), this.index = e2;
          }, skip: function(e2) {
            this.setIndex(this.index + e2);
          }, byteAt: function() {
          }, readInt: function(e2) {
            var t2, r2 = 0;
            for (this.checkOffset(e2), t2 = this.index + e2 - 1; t2 >= this.index; t2--) r2 = (r2 << 8) + this.byteAt(t2);
            return this.index += e2, r2;
          }, readString: function(e2) {
            return n.transformTo("string", this.readData(e2));
          }, readData: function() {
          }, lastIndexOfSignature: function() {
          }, readAndCheckSignature: function() {
          }, readDate: function() {
            var e2 = this.readInt(4);
            return new Date(Date.UTC(1980 + (e2 >> 25 & 127), (e2 >> 21 & 15) - 1, e2 >> 16 & 31, e2 >> 11 & 31, e2 >> 5 & 63, (31 & e2) << 1));
          } }, t.exports = i;
        }, { "../utils": 32 }], 19: [function(e, t, r) {
          "use strict";
          var n = e("./Uint8ArrayReader");
          function i(e2) {
            n.call(this, e2);
          }
          e("../utils").inherits(i, n), i.prototype.readData = function(e2) {
            this.checkOffset(e2);
            var t2 = this.data.slice(this.zero + this.index, this.zero + this.index + e2);
            return this.index += e2, t2;
          }, t.exports = i;
        }, { "../utils": 32, "./Uint8ArrayReader": 21 }], 20: [function(e, t, r) {
          "use strict";
          var n = e("./DataReader");
          function i(e2) {
            n.call(this, e2);
          }
          e("../utils").inherits(i, n), i.prototype.byteAt = function(e2) {
            return this.data.charCodeAt(this.zero + e2);
          }, i.prototype.lastIndexOfSignature = function(e2) {
            return this.data.lastIndexOf(e2) - this.zero;
          }, i.prototype.readAndCheckSignature = function(e2) {
            return e2 === this.readData(4);
          }, i.prototype.readData = function(e2) {
            this.checkOffset(e2);
            var t2 = this.data.slice(this.zero + this.index, this.zero + this.index + e2);
            return this.index += e2, t2;
          }, t.exports = i;
        }, { "../utils": 32, "./DataReader": 18 }], 21: [function(e, t, r) {
          "use strict";
          var n = e("./ArrayReader");
          function i(e2) {
            n.call(this, e2);
          }
          e("../utils").inherits(i, n), i.prototype.readData = function(e2) {
            if (this.checkOffset(e2), 0 === e2) return new Uint8Array(0);
            var t2 = this.data.subarray(this.zero + this.index, this.zero + this.index + e2);
            return this.index += e2, t2;
          }, t.exports = i;
        }, { "../utils": 32, "./ArrayReader": 17 }], 22: [function(e, t, r) {
          "use strict";
          var n = e("../utils"), i = e("../support"), s = e("./ArrayReader"), a = e("./StringReader"), o = e("./NodeBufferReader"), h = e("./Uint8ArrayReader");
          t.exports = function(e2) {
            var t2 = n.getTypeOf(e2);
            return n.checkSupport(t2), "string" !== t2 || i.uint8array ? "nodebuffer" === t2 ? new o(e2) : i.uint8array ? new h(n.transformTo("uint8array", e2)) : new s(n.transformTo("array", e2)) : new a(e2);
          };
        }, { "../support": 30, "../utils": 32, "./ArrayReader": 17, "./NodeBufferReader": 19, "./StringReader": 20, "./Uint8ArrayReader": 21 }], 23: [function(e, t, r) {
          "use strict";
          r.LOCAL_FILE_HEADER = "PK", r.CENTRAL_FILE_HEADER = "PK", r.CENTRAL_DIRECTORY_END = "PK", r.ZIP64_CENTRAL_DIRECTORY_LOCATOR = "PK\x07", r.ZIP64_CENTRAL_DIRECTORY_END = "PK", r.DATA_DESCRIPTOR = "PK\x07\b";
        }, {}], 24: [function(e, t, r) {
          "use strict";
          var n = e("./GenericWorker"), i = e("../utils");
          function s(e2) {
            n.call(this, "ConvertWorker to " + e2), this.destType = e2;
          }
          i.inherits(s, n), s.prototype.processChunk = function(e2) {
            this.push({ data: i.transformTo(this.destType, e2.data), meta: e2.meta });
          }, t.exports = s;
        }, { "../utils": 32, "./GenericWorker": 28 }], 25: [function(e, t, r) {
          "use strict";
          var n = e("./GenericWorker"), i = e("../crc32");
          function s() {
            n.call(this, "Crc32Probe"), this.withStreamInfo("crc32", 0);
          }
          e("../utils").inherits(s, n), s.prototype.processChunk = function(e2) {
            this.streamInfo.crc32 = i(e2.data, this.streamInfo.crc32 || 0), this.push(e2);
          }, t.exports = s;
        }, { "../crc32": 4, "../utils": 32, "./GenericWorker": 28 }], 26: [function(e, t, r) {
          "use strict";
          var n = e("../utils"), i = e("./GenericWorker");
          function s(e2) {
            i.call(this, "DataLengthProbe for " + e2), this.propName = e2, this.withStreamInfo(e2, 0);
          }
          n.inherits(s, i), s.prototype.processChunk = function(e2) {
            if (e2) {
              var t2 = this.streamInfo[this.propName] || 0;
              this.streamInfo[this.propName] = t2 + e2.data.length;
            }
            i.prototype.processChunk.call(this, e2);
          }, t.exports = s;
        }, { "../utils": 32, "./GenericWorker": 28 }], 27: [function(e, t, r) {
          "use strict";
          var n = e("../utils"), i = e("./GenericWorker");
          function s(e2) {
            i.call(this, "DataWorker");
            var t2 = this;
            this.dataIsReady = false, this.index = 0, this.max = 0, this.data = null, this.type = "", this._tickScheduled = false, e2.then(function(e3) {
              t2.dataIsReady = true, t2.data = e3, t2.max = e3 && e3.length || 0, t2.type = n.getTypeOf(e3), t2.isPaused || t2._tickAndRepeat();
            }, function(e3) {
              t2.error(e3);
            });
          }
          n.inherits(s, i), s.prototype.cleanUp = function() {
            i.prototype.cleanUp.call(this), this.data = null;
          }, s.prototype.resume = function() {
            return !!i.prototype.resume.call(this) && (!this._tickScheduled && this.dataIsReady && (this._tickScheduled = true, n.delay(this._tickAndRepeat, [], this)), true);
          }, s.prototype._tickAndRepeat = function() {
            this._tickScheduled = false, this.isPaused || this.isFinished || (this._tick(), this.isFinished || (n.delay(this._tickAndRepeat, [], this), this._tickScheduled = true));
          }, s.prototype._tick = function() {
            if (this.isPaused || this.isFinished) return false;
            var e2 = null, t2 = Math.min(this.max, this.index + 16384);
            if (this.index >= this.max) return this.end();
            switch (this.type) {
              case "string":
                e2 = this.data.substring(this.index, t2);
                break;
              case "uint8array":
                e2 = this.data.subarray(this.index, t2);
                break;
              case "array":
              case "nodebuffer":
                e2 = this.data.slice(this.index, t2);
            }
            return this.index = t2, this.push({ data: e2, meta: { percent: this.max ? this.index / this.max * 100 : 0 } });
          }, t.exports = s;
        }, { "../utils": 32, "./GenericWorker": 28 }], 28: [function(e, t, r) {
          "use strict";
          function n(e2) {
            this.name = e2 || "default", this.streamInfo = {}, this.generatedError = null, this.extraStreamInfo = {}, this.isPaused = true, this.isFinished = false, this.isLocked = false, this._listeners = { data: [], end: [], error: [] }, this.previous = null;
          }
          n.prototype = { push: function(e2) {
            this.emit("data", e2);
          }, end: function() {
            if (this.isFinished) return false;
            this.flush();
            try {
              this.emit("end"), this.cleanUp(), this.isFinished = true;
            } catch (e2) {
              this.emit("error", e2);
            }
            return true;
          }, error: function(e2) {
            return !this.isFinished && (this.isPaused ? this.generatedError = e2 : (this.isFinished = true, this.emit("error", e2), this.previous && this.previous.error(e2), this.cleanUp()), true);
          }, on: function(e2, t2) {
            return this._listeners[e2].push(t2), this;
          }, cleanUp: function() {
            this.streamInfo = this.generatedError = this.extraStreamInfo = null, this._listeners = [];
          }, emit: function(e2, t2) {
            if (this._listeners[e2]) for (var r2 = 0; r2 < this._listeners[e2].length; r2++) this._listeners[e2][r2].call(this, t2);
          }, pipe: function(e2) {
            return e2.registerPrevious(this);
          }, registerPrevious: function(e2) {
            if (this.isLocked) throw new Error("The stream '" + this + "' has already been used.");
            this.streamInfo = e2.streamInfo, this.mergeStreamInfo(), this.previous = e2;
            var t2 = this;
            return e2.on("data", function(e3) {
              t2.processChunk(e3);
            }), e2.on("end", function() {
              t2.end();
            }), e2.on("error", function(e3) {
              t2.error(e3);
            }), this;
          }, pause: function() {
            return !this.isPaused && !this.isFinished && (this.isPaused = true, this.previous && this.previous.pause(), true);
          }, resume: function() {
            if (!this.isPaused || this.isFinished) return false;
            var e2 = this.isPaused = false;
            return this.generatedError && (this.error(this.generatedError), e2 = true), this.previous && this.previous.resume(), !e2;
          }, flush: function() {
          }, processChunk: function(e2) {
            this.push(e2);
          }, withStreamInfo: function(e2, t2) {
            return this.extraStreamInfo[e2] = t2, this.mergeStreamInfo(), this;
          }, mergeStreamInfo: function() {
            for (var e2 in this.extraStreamInfo) Object.prototype.hasOwnProperty.call(this.extraStreamInfo, e2) && (this.streamInfo[e2] = this.extraStreamInfo[e2]);
          }, lock: function() {
            if (this.isLocked) throw new Error("The stream '" + this + "' has already been used.");
            this.isLocked = true, this.previous && this.previous.lock();
          }, toString: function() {
            var e2 = "Worker " + this.name;
            return this.previous ? this.previous + " -> " + e2 : e2;
          } }, t.exports = n;
        }, {}], 29: [function(e, t, r) {
          "use strict";
          var h = e("../utils"), i = e("./ConvertWorker"), s = e("./GenericWorker"), u = e("../base64"), n = e("../support"), a = e("../external"), o = null;
          if (n.nodestream) try {
            o = e("../nodejs/NodejsStreamOutputAdapter");
          } catch (e2) {
          }
          function l(e2, o2) {
            return new a.Promise(function(t2, r2) {
              var n2 = [], i2 = e2._internalType, s2 = e2._outputType, a2 = e2._mimeType;
              e2.on("data", function(e3, t3) {
                n2.push(e3), o2 && o2(t3);
              }).on("error", function(e3) {
                n2 = [], r2(e3);
              }).on("end", function() {
                try {
                  var e3 = (function(e4, t3, r3) {
                    switch (e4) {
                      case "blob":
                        return h.newBlob(h.transformTo("arraybuffer", t3), r3);
                      case "base64":
                        return u.encode(t3);
                      default:
                        return h.transformTo(e4, t3);
                    }
                  })(s2, (function(e4, t3) {
                    var r3, n3 = 0, i3 = null, s3 = 0;
                    for (r3 = 0; r3 < t3.length; r3++) s3 += t3[r3].length;
                    switch (e4) {
                      case "string":
                        return t3.join("");
                      case "array":
                        return Array.prototype.concat.apply([], t3);
                      case "uint8array":
                        for (i3 = new Uint8Array(s3), r3 = 0; r3 < t3.length; r3++) i3.set(t3[r3], n3), n3 += t3[r3].length;
                        return i3;
                      case "nodebuffer":
                        return Buffer.concat(t3);
                      default:
                        throw new Error("concat : unsupported type '" + e4 + "'");
                    }
                  })(i2, n2), a2);
                  t2(e3);
                } catch (e4) {
                  r2(e4);
                }
                n2 = [];
              }).resume();
            });
          }
          function f(e2, t2, r2) {
            var n2 = t2;
            switch (t2) {
              case "blob":
              case "arraybuffer":
                n2 = "uint8array";
                break;
              case "base64":
                n2 = "string";
            }
            try {
              this._internalType = n2, this._outputType = t2, this._mimeType = r2, h.checkSupport(n2), this._worker = e2.pipe(new i(n2)), e2.lock();
            } catch (e3) {
              this._worker = new s("error"), this._worker.error(e3);
            }
          }
          f.prototype = { accumulate: function(e2) {
            return l(this, e2);
          }, on: function(e2, t2) {
            var r2 = this;
            return "data" === e2 ? this._worker.on(e2, function(e3) {
              t2.call(r2, e3.data, e3.meta);
            }) : this._worker.on(e2, function() {
              h.delay(t2, arguments, r2);
            }), this;
          }, resume: function() {
            return h.delay(this._worker.resume, [], this._worker), this;
          }, pause: function() {
            return this._worker.pause(), this;
          }, toNodejsStream: function(e2) {
            if (h.checkSupport("nodestream"), "nodebuffer" !== this._outputType) throw new Error(this._outputType + " is not supported by this method");
            return new o(this, { objectMode: "nodebuffer" !== this._outputType }, e2);
          } }, t.exports = f;
        }, { "../base64": 1, "../external": 6, "../nodejs/NodejsStreamOutputAdapter": 13, "../support": 30, "../utils": 32, "./ConvertWorker": 24, "./GenericWorker": 28 }], 30: [function(e, t, r) {
          "use strict";
          if (r.base64 = true, r.array = true, r.string = true, r.arraybuffer = "undefined" != typeof ArrayBuffer && "undefined" != typeof Uint8Array, r.nodebuffer = "undefined" != typeof Buffer, r.uint8array = "undefined" != typeof Uint8Array, "undefined" == typeof ArrayBuffer) r.blob = false;
          else {
            var n = new ArrayBuffer(0);
            try {
              r.blob = 0 === new Blob([n], { type: "application/zip" }).size;
            } catch (e2) {
              try {
                var i = new (self.BlobBuilder || self.WebKitBlobBuilder || self.MozBlobBuilder || self.MSBlobBuilder)();
                i.append(n), r.blob = 0 === i.getBlob("application/zip").size;
              } catch (e3) {
                r.blob = false;
              }
            }
          }
          try {
            r.nodestream = !!e("readable-stream").Readable;
          } catch (e2) {
            r.nodestream = false;
          }
        }, { "readable-stream": 16 }], 31: [function(e, t, s) {
          "use strict";
          for (var o = e("./utils"), h = e("./support"), r = e("./nodejsUtils"), n = e("./stream/GenericWorker"), u = new Array(256), i = 0; i < 256; i++) u[i] = 252 <= i ? 6 : 248 <= i ? 5 : 240 <= i ? 4 : 224 <= i ? 3 : 192 <= i ? 2 : 1;
          u[254] = u[254] = 1;
          function a() {
            n.call(this, "utf-8 decode"), this.leftOver = null;
          }
          function l() {
            n.call(this, "utf-8 encode");
          }
          s.utf8encode = function(e2) {
            return h.nodebuffer ? r.newBufferFrom(e2, "utf-8") : (function(e3) {
              var t2, r2, n2, i2, s2, a2 = e3.length, o2 = 0;
              for (i2 = 0; i2 < a2; i2++) 55296 == (64512 & (r2 = e3.charCodeAt(i2))) && i2 + 1 < a2 && 56320 == (64512 & (n2 = e3.charCodeAt(i2 + 1))) && (r2 = 65536 + (r2 - 55296 << 10) + (n2 - 56320), i2++), o2 += r2 < 128 ? 1 : r2 < 2048 ? 2 : r2 < 65536 ? 3 : 4;
              for (t2 = h.uint8array ? new Uint8Array(o2) : new Array(o2), i2 = s2 = 0; s2 < o2; i2++) 55296 == (64512 & (r2 = e3.charCodeAt(i2))) && i2 + 1 < a2 && 56320 == (64512 & (n2 = e3.charCodeAt(i2 + 1))) && (r2 = 65536 + (r2 - 55296 << 10) + (n2 - 56320), i2++), r2 < 128 ? t2[s2++] = r2 : (r2 < 2048 ? t2[s2++] = 192 | r2 >>> 6 : (r2 < 65536 ? t2[s2++] = 224 | r2 >>> 12 : (t2[s2++] = 240 | r2 >>> 18, t2[s2++] = 128 | r2 >>> 12 & 63), t2[s2++] = 128 | r2 >>> 6 & 63), t2[s2++] = 128 | 63 & r2);
              return t2;
            })(e2);
          }, s.utf8decode = function(e2) {
            return h.nodebuffer ? o.transformTo("nodebuffer", e2).toString("utf-8") : (function(e3) {
              var t2, r2, n2, i2, s2 = e3.length, a2 = new Array(2 * s2);
              for (t2 = r2 = 0; t2 < s2; ) if ((n2 = e3[t2++]) < 128) a2[r2++] = n2;
              else if (4 < (i2 = u[n2])) a2[r2++] = 65533, t2 += i2 - 1;
              else {
                for (n2 &= 2 === i2 ? 31 : 3 === i2 ? 15 : 7; 1 < i2 && t2 < s2; ) n2 = n2 << 6 | 63 & e3[t2++], i2--;
                1 < i2 ? a2[r2++] = 65533 : n2 < 65536 ? a2[r2++] = n2 : (n2 -= 65536, a2[r2++] = 55296 | n2 >> 10 & 1023, a2[r2++] = 56320 | 1023 & n2);
              }
              return a2.length !== r2 && (a2.subarray ? a2 = a2.subarray(0, r2) : a2.length = r2), o.applyFromCharCode(a2);
            })(e2 = o.transformTo(h.uint8array ? "uint8array" : "array", e2));
          }, o.inherits(a, n), a.prototype.processChunk = function(e2) {
            var t2 = o.transformTo(h.uint8array ? "uint8array" : "array", e2.data);
            if (this.leftOver && this.leftOver.length) {
              if (h.uint8array) {
                var r2 = t2;
                (t2 = new Uint8Array(r2.length + this.leftOver.length)).set(this.leftOver, 0), t2.set(r2, this.leftOver.length);
              } else t2 = this.leftOver.concat(t2);
              this.leftOver = null;
            }
            var n2 = (function(e3, t3) {
              var r3;
              for ((t3 = t3 || e3.length) > e3.length && (t3 = e3.length), r3 = t3 - 1; 0 <= r3 && 128 == (192 & e3[r3]); ) r3--;
              return r3 < 0 ? t3 : 0 === r3 ? t3 : r3 + u[e3[r3]] > t3 ? r3 : t3;
            })(t2), i2 = t2;
            n2 !== t2.length && (h.uint8array ? (i2 = t2.subarray(0, n2), this.leftOver = t2.subarray(n2, t2.length)) : (i2 = t2.slice(0, n2), this.leftOver = t2.slice(n2, t2.length))), this.push({ data: s.utf8decode(i2), meta: e2.meta });
          }, a.prototype.flush = function() {
            this.leftOver && this.leftOver.length && (this.push({ data: s.utf8decode(this.leftOver), meta: {} }), this.leftOver = null);
          }, s.Utf8DecodeWorker = a, o.inherits(l, n), l.prototype.processChunk = function(e2) {
            this.push({ data: s.utf8encode(e2.data), meta: e2.meta });
          }, s.Utf8EncodeWorker = l;
        }, { "./nodejsUtils": 14, "./stream/GenericWorker": 28, "./support": 30, "./utils": 32 }], 32: [function(e, t, a) {
          "use strict";
          var o = e("./support"), h = e("./base64"), r = e("./nodejsUtils"), u = e("./external");
          function n(e2) {
            return e2;
          }
          function l(e2, t2) {
            for (var r2 = 0; r2 < e2.length; ++r2) t2[r2] = 255 & e2.charCodeAt(r2);
            return t2;
          }
          e("setimmediate"), a.newBlob = function(t2, r2) {
            a.checkSupport("blob");
            try {
              return new Blob([t2], { type: r2 });
            } catch (e2) {
              try {
                var n2 = new (self.BlobBuilder || self.WebKitBlobBuilder || self.MozBlobBuilder || self.MSBlobBuilder)();
                return n2.append(t2), n2.getBlob(r2);
              } catch (e3) {
                throw new Error("Bug : can't construct the Blob.");
              }
            }
          };
          var i = { stringifyByChunk: function(e2, t2, r2) {
            var n2 = [], i2 = 0, s2 = e2.length;
            if (s2 <= r2) return String.fromCharCode.apply(null, e2);
            for (; i2 < s2; ) "array" === t2 || "nodebuffer" === t2 ? n2.push(String.fromCharCode.apply(null, e2.slice(i2, Math.min(i2 + r2, s2)))) : n2.push(String.fromCharCode.apply(null, e2.subarray(i2, Math.min(i2 + r2, s2)))), i2 += r2;
            return n2.join("");
          }, stringifyByChar: function(e2) {
            for (var t2 = "", r2 = 0; r2 < e2.length; r2++) t2 += String.fromCharCode(e2[r2]);
            return t2;
          }, applyCanBeUsed: { uint8array: (function() {
            try {
              return o.uint8array && 1 === String.fromCharCode.apply(null, new Uint8Array(1)).length;
            } catch (e2) {
              return false;
            }
          })(), nodebuffer: (function() {
            try {
              return o.nodebuffer && 1 === String.fromCharCode.apply(null, r.allocBuffer(1)).length;
            } catch (e2) {
              return false;
            }
          })() } };
          function s(e2) {
            var t2 = 65536, r2 = a.getTypeOf(e2), n2 = true;
            if ("uint8array" === r2 ? n2 = i.applyCanBeUsed.uint8array : "nodebuffer" === r2 && (n2 = i.applyCanBeUsed.nodebuffer), n2) for (; 1 < t2; ) try {
              return i.stringifyByChunk(e2, r2, t2);
            } catch (e3) {
              t2 = Math.floor(t2 / 2);
            }
            return i.stringifyByChar(e2);
          }
          function f(e2, t2) {
            for (var r2 = 0; r2 < e2.length; r2++) t2[r2] = e2[r2];
            return t2;
          }
          a.applyFromCharCode = s;
          var c = {};
          c.string = { string: n, array: function(e2) {
            return l(e2, new Array(e2.length));
          }, arraybuffer: function(e2) {
            return c.string.uint8array(e2).buffer;
          }, uint8array: function(e2) {
            return l(e2, new Uint8Array(e2.length));
          }, nodebuffer: function(e2) {
            return l(e2, r.allocBuffer(e2.length));
          } }, c.array = { string: s, array: n, arraybuffer: function(e2) {
            return new Uint8Array(e2).buffer;
          }, uint8array: function(e2) {
            return new Uint8Array(e2);
          }, nodebuffer: function(e2) {
            return r.newBufferFrom(e2);
          } }, c.arraybuffer = { string: function(e2) {
            return s(new Uint8Array(e2));
          }, array: function(e2) {
            return f(new Uint8Array(e2), new Array(e2.byteLength));
          }, arraybuffer: n, uint8array: function(e2) {
            return new Uint8Array(e2);
          }, nodebuffer: function(e2) {
            return r.newBufferFrom(new Uint8Array(e2));
          } }, c.uint8array = { string: s, array: function(e2) {
            return f(e2, new Array(e2.length));
          }, arraybuffer: function(e2) {
            return e2.buffer;
          }, uint8array: n, nodebuffer: function(e2) {
            return r.newBufferFrom(e2);
          } }, c.nodebuffer = { string: s, array: function(e2) {
            return f(e2, new Array(e2.length));
          }, arraybuffer: function(e2) {
            return c.nodebuffer.uint8array(e2).buffer;
          }, uint8array: function(e2) {
            return f(e2, new Uint8Array(e2.length));
          }, nodebuffer: n }, a.transformTo = function(e2, t2) {
            if (t2 = t2 || "", !e2) return t2;
            a.checkSupport(e2);
            var r2 = a.getTypeOf(t2);
            return c[r2][e2](t2);
          }, a.resolve = function(e2) {
            for (var t2 = e2.split("/"), r2 = [], n2 = 0; n2 < t2.length; n2++) {
              var i2 = t2[n2];
              "." === i2 || "" === i2 && 0 !== n2 && n2 !== t2.length - 1 || (".." === i2 ? r2.pop() : r2.push(i2));
            }
            return r2.join("/");
          }, a.getTypeOf = function(e2) {
            if ("string" == typeof e2) return "string";
            var t2 = Object.prototype.toString.call(e2);
            return "[object Array]" === t2 ? "array" : o.nodebuffer && r.isBuffer(e2) ? "nodebuffer" : o.uint8array && "[object Uint8Array]" === t2 ? "uint8array" : o.arraybuffer && "[object ArrayBuffer]" === t2 ? "arraybuffer" : void 0;
          }, a.checkSupport = function(e2) {
            if (!o[e2.toLowerCase()]) throw new Error(e2 + " is not supported by this platform");
          }, a.MAX_VALUE_16BITS = 65535, a.MAX_VALUE_32BITS = -1, a.pretty = function(e2) {
            var t2, r2, n2 = "";
            for (r2 = 0; r2 < (e2 || "").length; r2++) n2 += "\\x" + ((t2 = e2.charCodeAt(r2)) < 16 ? "0" : "") + t2.toString(16).toUpperCase();
            return n2;
          }, a.delay = function(e2, t2, r2) {
            setImmediate(function() {
              e2.apply(r2 || null, t2 || []);
            });
          }, a.inherits = function(e2, t2) {
            function r2() {
            }
            r2.prototype = t2.prototype, e2.prototype = new r2();
          }, a.extend = function() {
            var e2, t2, r2 = {};
            for (e2 = 0; e2 < arguments.length; e2++) for (t2 in arguments[e2]) Object.prototype.hasOwnProperty.call(arguments[e2], t2) && void 0 === r2[t2] && (r2[t2] = arguments[e2][t2]);
            return r2;
          }, a.prepareContent = function(r2, e2, n2, i2, s2) {
            return u.Promise.resolve(e2).then(function(n3) {
              return o.blob && (n3 instanceof Blob || -1 !== ["[object File]", "[object Blob]"].indexOf(Object.prototype.toString.call(n3))) ? void 0 !== Blob.prototype.arrayBuffer ? n3.arrayBuffer() : "undefined" != typeof FileReader ? new u.Promise(function(t2, r3) {
                var e3 = new FileReader();
                e3.onload = function(e4) {
                  t2(e4.target.result);
                }, e3.onerror = function(e4) {
                  r3(e4.target.error);
                }, e3.readAsArrayBuffer(n3);
              }) : u.Promise.reject(new Error(r2 + " is a Blob, but we have no way of reading it.")) : n3;
            }).then(function(e3) {
              var t2 = a.getTypeOf(e3);
              return t2 ? ("arraybuffer" === t2 ? e3 = a.transformTo("uint8array", e3) : "string" === t2 && (s2 ? e3 = h.decode(e3) : n2 && true !== i2 && (e3 = (function(e4) {
                return l(e4, o.uint8array ? new Uint8Array(e4.length) : new Array(e4.length));
              })(e3))), e3) : u.Promise.reject(new Error("Can't read the data of '" + r2 + "'. Is it in a supported JavaScript type (String, Blob, ArrayBuffer, etc) ?"));
            });
          };
        }, { "./base64": 1, "./external": 6, "./nodejsUtils": 14, "./support": 30, setimmediate: 54 }], 33: [function(e, t, r) {
          "use strict";
          var n = e("./reader/readerFor"), i = e("./utils"), s = e("./signature"), a = e("./zipEntry"), o = e("./support");
          function h(e2) {
            this.files = [], this.loadOptions = e2;
          }
          h.prototype = { checkSignature: function(e2) {
            if (!this.reader.readAndCheckSignature(e2)) {
              this.reader.index -= 4;
              var t2 = this.reader.readString(4);
              throw new Error("Corrupted zip or bug: unexpected signature (" + i.pretty(t2) + ", expected " + i.pretty(e2) + ")");
            }
          }, isSignature: function(e2, t2) {
            var r2 = this.reader.index;
            this.reader.setIndex(e2);
            var n2 = this.reader.readString(4) === t2;
            return this.reader.setIndex(r2), n2;
          }, readBlockEndOfCentral: function() {
            this.diskNumber = this.reader.readInt(2), this.diskWithCentralDirStart = this.reader.readInt(2), this.centralDirRecordsOnThisDisk = this.reader.readInt(2), this.centralDirRecords = this.reader.readInt(2), this.centralDirSize = this.reader.readInt(4), this.centralDirOffset = this.reader.readInt(4), this.zipCommentLength = this.reader.readInt(2);
            var e2 = this.reader.readData(this.zipCommentLength), t2 = o.uint8array ? "uint8array" : "array", r2 = i.transformTo(t2, e2);
            this.zipComment = this.loadOptions.decodeFileName(r2);
          }, readBlockZip64EndOfCentral: function() {
            this.zip64EndOfCentralSize = this.reader.readInt(8), this.reader.skip(4), this.diskNumber = this.reader.readInt(4), this.diskWithCentralDirStart = this.reader.readInt(4), this.centralDirRecordsOnThisDisk = this.reader.readInt(8), this.centralDirRecords = this.reader.readInt(8), this.centralDirSize = this.reader.readInt(8), this.centralDirOffset = this.reader.readInt(8), this.zip64ExtensibleData = {};
            for (var e2, t2, r2, n2 = this.zip64EndOfCentralSize - 44; 0 < n2; ) e2 = this.reader.readInt(2), t2 = this.reader.readInt(4), r2 = this.reader.readData(t2), this.zip64ExtensibleData[e2] = { id: e2, length: t2, value: r2 };
          }, readBlockZip64EndOfCentralLocator: function() {
            if (this.diskWithZip64CentralDirStart = this.reader.readInt(4), this.relativeOffsetEndOfZip64CentralDir = this.reader.readInt(8), this.disksCount = this.reader.readInt(4), 1 < this.disksCount) throw new Error("Multi-volumes zip are not supported");
          }, readLocalFiles: function() {
            var e2, t2;
            for (e2 = 0; e2 < this.files.length; e2++) t2 = this.files[e2], this.reader.setIndex(t2.localHeaderOffset), this.checkSignature(s.LOCAL_FILE_HEADER), t2.readLocalPart(this.reader), t2.handleUTF8(), t2.processAttributes();
          }, readCentralDir: function() {
            var e2;
            for (this.reader.setIndex(this.centralDirOffset); this.reader.readAndCheckSignature(s.CENTRAL_FILE_HEADER); ) (e2 = new a({ zip64: this.zip64 }, this.loadOptions)).readCentralPart(this.reader), this.files.push(e2);
            if (this.centralDirRecords !== this.files.length && 0 !== this.centralDirRecords && 0 === this.files.length) throw new Error("Corrupted zip or bug: expected " + this.centralDirRecords + " records in central dir, got " + this.files.length);
          }, readEndOfCentral: function() {
            var e2 = this.reader.lastIndexOfSignature(s.CENTRAL_DIRECTORY_END);
            if (e2 < 0) throw !this.isSignature(0, s.LOCAL_FILE_HEADER) ? new Error("Can't find end of central directory : is this a zip file ? If it is, see https://stuk.github.io/jszip/documentation/howto/read_zip.html") : new Error("Corrupted zip: can't find end of central directory");
            this.reader.setIndex(e2);
            var t2 = e2;
            if (this.checkSignature(s.CENTRAL_DIRECTORY_END), this.readBlockEndOfCentral(), this.diskNumber === i.MAX_VALUE_16BITS || this.diskWithCentralDirStart === i.MAX_VALUE_16BITS || this.centralDirRecordsOnThisDisk === i.MAX_VALUE_16BITS || this.centralDirRecords === i.MAX_VALUE_16BITS || this.centralDirSize === i.MAX_VALUE_32BITS || this.centralDirOffset === i.MAX_VALUE_32BITS) {
              if (this.zip64 = true, (e2 = this.reader.lastIndexOfSignature(s.ZIP64_CENTRAL_DIRECTORY_LOCATOR)) < 0) throw new Error("Corrupted zip: can't find the ZIP64 end of central directory locator");
              if (this.reader.setIndex(e2), this.checkSignature(s.ZIP64_CENTRAL_DIRECTORY_LOCATOR), this.readBlockZip64EndOfCentralLocator(), !this.isSignature(this.relativeOffsetEndOfZip64CentralDir, s.ZIP64_CENTRAL_DIRECTORY_END) && (this.relativeOffsetEndOfZip64CentralDir = this.reader.lastIndexOfSignature(s.ZIP64_CENTRAL_DIRECTORY_END), this.relativeOffsetEndOfZip64CentralDir < 0)) throw new Error("Corrupted zip: can't find the ZIP64 end of central directory");
              this.reader.setIndex(this.relativeOffsetEndOfZip64CentralDir), this.checkSignature(s.ZIP64_CENTRAL_DIRECTORY_END), this.readBlockZip64EndOfCentral();
            }
            var r2 = this.centralDirOffset + this.centralDirSize;
            this.zip64 && (r2 += 20, r2 += 12 + this.zip64EndOfCentralSize);
            var n2 = t2 - r2;
            if (0 < n2) this.isSignature(t2, s.CENTRAL_FILE_HEADER) || (this.reader.zero = n2);
            else if (n2 < 0) throw new Error("Corrupted zip: missing " + Math.abs(n2) + " bytes.");
          }, prepareReader: function(e2) {
            this.reader = n(e2);
          }, load: function(e2) {
            this.prepareReader(e2), this.readEndOfCentral(), this.readCentralDir(), this.readLocalFiles();
          } }, t.exports = h;
        }, { "./reader/readerFor": 22, "./signature": 23, "./support": 30, "./utils": 32, "./zipEntry": 34 }], 34: [function(e, t, r) {
          "use strict";
          var n = e("./reader/readerFor"), s = e("./utils"), i = e("./compressedObject"), a = e("./crc32"), o = e("./utf8"), h = e("./compressions"), u = e("./support");
          function l(e2, t2) {
            this.options = e2, this.loadOptions = t2;
          }
          l.prototype = { isEncrypted: function() {
            return 1 == (1 & this.bitFlag);
          }, useUTF8: function() {
            return 2048 == (2048 & this.bitFlag);
          }, readLocalPart: function(e2) {
            var t2, r2;
            if (e2.skip(22), this.fileNameLength = e2.readInt(2), r2 = e2.readInt(2), this.fileName = e2.readData(this.fileNameLength), e2.skip(r2), -1 === this.compressedSize || -1 === this.uncompressedSize) throw new Error("Bug or corrupted zip : didn't get enough information from the central directory (compressedSize === -1 || uncompressedSize === -1)");
            if (null === (t2 = (function(e3) {
              for (var t3 in h) if (Object.prototype.hasOwnProperty.call(h, t3) && h[t3].magic === e3) return h[t3];
              return null;
            })(this.compressionMethod))) throw new Error("Corrupted zip : compression " + s.pretty(this.compressionMethod) + " unknown (inner file : " + s.transformTo("string", this.fileName) + ")");
            this.decompressed = new i(this.compressedSize, this.uncompressedSize, this.crc32, t2, e2.readData(this.compressedSize));
          }, readCentralPart: function(e2) {
            this.versionMadeBy = e2.readInt(2), e2.skip(2), this.bitFlag = e2.readInt(2), this.compressionMethod = e2.readString(2), this.date = e2.readDate(), this.crc32 = e2.readInt(4), this.compressedSize = e2.readInt(4), this.uncompressedSize = e2.readInt(4);
            var t2 = e2.readInt(2);
            if (this.extraFieldsLength = e2.readInt(2), this.fileCommentLength = e2.readInt(2), this.diskNumberStart = e2.readInt(2), this.internalFileAttributes = e2.readInt(2), this.externalFileAttributes = e2.readInt(4), this.localHeaderOffset = e2.readInt(4), this.isEncrypted()) throw new Error("Encrypted zip are not supported");
            e2.skip(t2), this.readExtraFields(e2), this.parseZIP64ExtraField(e2), this.fileComment = e2.readData(this.fileCommentLength);
          }, processAttributes: function() {
            this.unixPermissions = null, this.dosPermissions = null;
            var e2 = this.versionMadeBy >> 8;
            this.dir = !!(16 & this.externalFileAttributes), 0 == e2 && (this.dosPermissions = 63 & this.externalFileAttributes), 3 == e2 && (this.unixPermissions = this.externalFileAttributes >> 16 & 65535), this.dir || "/" !== this.fileNameStr.slice(-1) || (this.dir = true);
          }, parseZIP64ExtraField: function() {
            if (this.extraFields[1]) {
              var e2 = n(this.extraFields[1].value);
              this.uncompressedSize === s.MAX_VALUE_32BITS && (this.uncompressedSize = e2.readInt(8)), this.compressedSize === s.MAX_VALUE_32BITS && (this.compressedSize = e2.readInt(8)), this.localHeaderOffset === s.MAX_VALUE_32BITS && (this.localHeaderOffset = e2.readInt(8)), this.diskNumberStart === s.MAX_VALUE_32BITS && (this.diskNumberStart = e2.readInt(4));
            }
          }, readExtraFields: function(e2) {
            var t2, r2, n2, i2 = e2.index + this.extraFieldsLength;
            for (this.extraFields || (this.extraFields = {}); e2.index + 4 < i2; ) t2 = e2.readInt(2), r2 = e2.readInt(2), n2 = e2.readData(r2), this.extraFields[t2] = { id: t2, length: r2, value: n2 };
            e2.setIndex(i2);
          }, handleUTF8: function() {
            var e2 = u.uint8array ? "uint8array" : "array";
            if (this.useUTF8()) this.fileNameStr = o.utf8decode(this.fileName), this.fileCommentStr = o.utf8decode(this.fileComment);
            else {
              var t2 = this.findExtraFieldUnicodePath();
              if (null !== t2) this.fileNameStr = t2;
              else {
                var r2 = s.transformTo(e2, this.fileName);
                this.fileNameStr = this.loadOptions.decodeFileName(r2);
              }
              var n2 = this.findExtraFieldUnicodeComment();
              if (null !== n2) this.fileCommentStr = n2;
              else {
                var i2 = s.transformTo(e2, this.fileComment);
                this.fileCommentStr = this.loadOptions.decodeFileName(i2);
              }
            }
          }, findExtraFieldUnicodePath: function() {
            var e2 = this.extraFields[28789];
            if (e2) {
              var t2 = n(e2.value);
              return 1 !== t2.readInt(1) ? null : a(this.fileName) !== t2.readInt(4) ? null : o.utf8decode(t2.readData(e2.length - 5));
            }
            return null;
          }, findExtraFieldUnicodeComment: function() {
            var e2 = this.extraFields[25461];
            if (e2) {
              var t2 = n(e2.value);
              return 1 !== t2.readInt(1) ? null : a(this.fileComment) !== t2.readInt(4) ? null : o.utf8decode(t2.readData(e2.length - 5));
            }
            return null;
          } }, t.exports = l;
        }, { "./compressedObject": 2, "./compressions": 3, "./crc32": 4, "./reader/readerFor": 22, "./support": 30, "./utf8": 31, "./utils": 32 }], 35: [function(e, t, r) {
          "use strict";
          function n(e2, t2, r2) {
            this.name = e2, this.dir = r2.dir, this.date = r2.date, this.comment = r2.comment, this.unixPermissions = r2.unixPermissions, this.dosPermissions = r2.dosPermissions, this._data = t2, this._dataBinary = r2.binary, this.options = { compression: r2.compression, compressionOptions: r2.compressionOptions };
          }
          var s = e("./stream/StreamHelper"), i = e("./stream/DataWorker"), a = e("./utf8"), o = e("./compressedObject"), h = e("./stream/GenericWorker");
          n.prototype = { internalStream: function(e2) {
            var t2 = null, r2 = "string";
            try {
              if (!e2) throw new Error("No output type specified.");
              var n2 = "string" === (r2 = e2.toLowerCase()) || "text" === r2;
              "binarystring" !== r2 && "text" !== r2 || (r2 = "string"), t2 = this._decompressWorker();
              var i2 = !this._dataBinary;
              i2 && !n2 && (t2 = t2.pipe(new a.Utf8EncodeWorker())), !i2 && n2 && (t2 = t2.pipe(new a.Utf8DecodeWorker()));
            } catch (e3) {
              (t2 = new h("error")).error(e3);
            }
            return new s(t2, r2, "");
          }, async: function(e2, t2) {
            return this.internalStream(e2).accumulate(t2);
          }, nodeStream: function(e2, t2) {
            return this.internalStream(e2 || "nodebuffer").toNodejsStream(t2);
          }, _compressWorker: function(e2, t2) {
            if (this._data instanceof o && this._data.compression.magic === e2.magic) return this._data.getCompressedWorker();
            var r2 = this._decompressWorker();
            return this._dataBinary || (r2 = r2.pipe(new a.Utf8EncodeWorker())), o.createWorkerFrom(r2, e2, t2);
          }, _decompressWorker: function() {
            return this._data instanceof o ? this._data.getContentWorker() : this._data instanceof h ? this._data : new i(this._data);
          } };
          for (var u = ["asText", "asBinary", "asNodeBuffer", "asUint8Array", "asArrayBuffer"], l = function() {
            throw new Error("This method has been removed in JSZip 3.0, please check the upgrade guide.");
          }, f = 0; f < u.length; f++) n.prototype[u[f]] = l;
          t.exports = n;
        }, { "./compressedObject": 2, "./stream/DataWorker": 27, "./stream/GenericWorker": 28, "./stream/StreamHelper": 29, "./utf8": 31 }], 36: [function(e, l, t) {
          (function(t2) {
            "use strict";
            var r, n, e2 = t2.MutationObserver || t2.WebKitMutationObserver;
            if (e2) {
              var i = 0, s = new e2(u), a = t2.document.createTextNode("");
              s.observe(a, { characterData: true }), r = function() {
                a.data = i = ++i % 2;
              };
            } else if (t2.setImmediate || void 0 === t2.MessageChannel) r = "document" in t2 && "onreadystatechange" in t2.document.createElement("script") ? function() {
              var e3 = t2.document.createElement("script");
              e3.onreadystatechange = function() {
                u(), e3.onreadystatechange = null, e3.parentNode.removeChild(e3), e3 = null;
              }, t2.document.documentElement.appendChild(e3);
            } : function() {
              setTimeout(u, 0);
            };
            else {
              var o = new t2.MessageChannel();
              o.port1.onmessage = u, r = function() {
                o.port2.postMessage(0);
              };
            }
            var h = [];
            function u() {
              var e3, t3;
              n = true;
              for (var r2 = h.length; r2; ) {
                for (t3 = h, h = [], e3 = -1; ++e3 < r2; ) t3[e3]();
                r2 = h.length;
              }
              n = false;
            }
            l.exports = function(e3) {
              1 !== h.push(e3) || n || r();
            };
          }).call(this, "undefined" != typeof global ? global : "undefined" != typeof self ? self : "undefined" != typeof window ? window : {});
        }, {}], 37: [function(e, t, r) {
          "use strict";
          var i = e("immediate");
          function u() {
          }
          var l = {}, s = ["REJECTED"], a = ["FULFILLED"], n = ["PENDING"];
          function o(e2) {
            if ("function" != typeof e2) throw new TypeError("resolver must be a function");
            this.state = n, this.queue = [], this.outcome = void 0, e2 !== u && d(this, e2);
          }
          function h(e2, t2, r2) {
            this.promise = e2, "function" == typeof t2 && (this.onFulfilled = t2, this.callFulfilled = this.otherCallFulfilled), "function" == typeof r2 && (this.onRejected = r2, this.callRejected = this.otherCallRejected);
          }
          function f(t2, r2, n2) {
            i(function() {
              var e2;
              try {
                e2 = r2(n2);
              } catch (e3) {
                return l.reject(t2, e3);
              }
              e2 === t2 ? l.reject(t2, new TypeError("Cannot resolve promise with itself")) : l.resolve(t2, e2);
            });
          }
          function c(e2) {
            var t2 = e2 && e2.then;
            if (e2 && ("object" == typeof e2 || "function" == typeof e2) && "function" == typeof t2) return function() {
              t2.apply(e2, arguments);
            };
          }
          function d(t2, e2) {
            var r2 = false;
            function n2(e3) {
              r2 || (r2 = true, l.reject(t2, e3));
            }
            function i2(e3) {
              r2 || (r2 = true, l.resolve(t2, e3));
            }
            var s2 = p(function() {
              e2(i2, n2);
            });
            "error" === s2.status && n2(s2.value);
          }
          function p(e2, t2) {
            var r2 = {};
            try {
              r2.value = e2(t2), r2.status = "success";
            } catch (e3) {
              r2.status = "error", r2.value = e3;
            }
            return r2;
          }
          (t.exports = o).prototype.finally = function(t2) {
            if ("function" != typeof t2) return this;
            var r2 = this.constructor;
            return this.then(function(e2) {
              return r2.resolve(t2()).then(function() {
                return e2;
              });
            }, function(e2) {
              return r2.resolve(t2()).then(function() {
                throw e2;
              });
            });
          }, o.prototype.catch = function(e2) {
            return this.then(null, e2);
          }, o.prototype.then = function(e2, t2) {
            if ("function" != typeof e2 && this.state === a || "function" != typeof t2 && this.state === s) return this;
            var r2 = new this.constructor(u);
            this.state !== n ? f(r2, this.state === a ? e2 : t2, this.outcome) : this.queue.push(new h(r2, e2, t2));
            return r2;
          }, h.prototype.callFulfilled = function(e2) {
            l.resolve(this.promise, e2);
          }, h.prototype.otherCallFulfilled = function(e2) {
            f(this.promise, this.onFulfilled, e2);
          }, h.prototype.callRejected = function(e2) {
            l.reject(this.promise, e2);
          }, h.prototype.otherCallRejected = function(e2) {
            f(this.promise, this.onRejected, e2);
          }, l.resolve = function(e2, t2) {
            var r2 = p(c, t2);
            if ("error" === r2.status) return l.reject(e2, r2.value);
            var n2 = r2.value;
            if (n2) d(e2, n2);
            else {
              e2.state = a, e2.outcome = t2;
              for (var i2 = -1, s2 = e2.queue.length; ++i2 < s2; ) e2.queue[i2].callFulfilled(t2);
            }
            return e2;
          }, l.reject = function(e2, t2) {
            e2.state = s, e2.outcome = t2;
            for (var r2 = -1, n2 = e2.queue.length; ++r2 < n2; ) e2.queue[r2].callRejected(t2);
            return e2;
          }, o.resolve = function(e2) {
            if (e2 instanceof this) return e2;
            return l.resolve(new this(u), e2);
          }, o.reject = function(e2) {
            var t2 = new this(u);
            return l.reject(t2, e2);
          }, o.all = function(e2) {
            var r2 = this;
            if ("[object Array]" !== Object.prototype.toString.call(e2)) return this.reject(new TypeError("must be an array"));
            var n2 = e2.length, i2 = false;
            if (!n2) return this.resolve([]);
            var s2 = new Array(n2), a2 = 0, t2 = -1, o2 = new this(u);
            for (; ++t2 < n2; ) h2(e2[t2], t2);
            return o2;
            function h2(e3, t3) {
              r2.resolve(e3).then(function(e4) {
                s2[t3] = e4, ++a2 !== n2 || i2 || (i2 = true, l.resolve(o2, s2));
              }, function(e4) {
                i2 || (i2 = true, l.reject(o2, e4));
              });
            }
          }, o.race = function(e2) {
            var t2 = this;
            if ("[object Array]" !== Object.prototype.toString.call(e2)) return this.reject(new TypeError("must be an array"));
            var r2 = e2.length, n2 = false;
            if (!r2) return this.resolve([]);
            var i2 = -1, s2 = new this(u);
            for (; ++i2 < r2; ) a2 = e2[i2], t2.resolve(a2).then(function(e3) {
              n2 || (n2 = true, l.resolve(s2, e3));
            }, function(e3) {
              n2 || (n2 = true, l.reject(s2, e3));
            });
            var a2;
            return s2;
          };
        }, { immediate: 36 }], 38: [function(e, t, r) {
          "use strict";
          var n = {};
          (0, e("./lib/utils/common").assign)(n, e("./lib/deflate"), e("./lib/inflate"), e("./lib/zlib/constants")), t.exports = n;
        }, { "./lib/deflate": 39, "./lib/inflate": 40, "./lib/utils/common": 41, "./lib/zlib/constants": 44 }], 39: [function(e, t, r) {
          "use strict";
          var a = e("./zlib/deflate"), o = e("./utils/common"), h = e("./utils/strings"), i = e("./zlib/messages"), s = e("./zlib/zstream"), u = Object.prototype.toString, l = 0, f = -1, c = 0, d = 8;
          function p(e2) {
            if (!(this instanceof p)) return new p(e2);
            this.options = o.assign({ level: f, method: d, chunkSize: 16384, windowBits: 15, memLevel: 8, strategy: c, to: "" }, e2 || {});
            var t2 = this.options;
            t2.raw && 0 < t2.windowBits ? t2.windowBits = -t2.windowBits : t2.gzip && 0 < t2.windowBits && t2.windowBits < 16 && (t2.windowBits += 16), this.err = 0, this.msg = "", this.ended = false, this.chunks = [], this.strm = new s(), this.strm.avail_out = 0;
            var r2 = a.deflateInit2(this.strm, t2.level, t2.method, t2.windowBits, t2.memLevel, t2.strategy);
            if (r2 !== l) throw new Error(i[r2]);
            if (t2.header && a.deflateSetHeader(this.strm, t2.header), t2.dictionary) {
              var n2;
              if (n2 = "string" == typeof t2.dictionary ? h.string2buf(t2.dictionary) : "[object ArrayBuffer]" === u.call(t2.dictionary) ? new Uint8Array(t2.dictionary) : t2.dictionary, (r2 = a.deflateSetDictionary(this.strm, n2)) !== l) throw new Error(i[r2]);
              this._dict_set = true;
            }
          }
          function n(e2, t2) {
            var r2 = new p(t2);
            if (r2.push(e2, true), r2.err) throw r2.msg || i[r2.err];
            return r2.result;
          }
          p.prototype.push = function(e2, t2) {
            var r2, n2, i2 = this.strm, s2 = this.options.chunkSize;
            if (this.ended) return false;
            n2 = t2 === ~~t2 ? t2 : true === t2 ? 4 : 0, "string" == typeof e2 ? i2.input = h.string2buf(e2) : "[object ArrayBuffer]" === u.call(e2) ? i2.input = new Uint8Array(e2) : i2.input = e2, i2.next_in = 0, i2.avail_in = i2.input.length;
            do {
              if (0 === i2.avail_out && (i2.output = new o.Buf8(s2), i2.next_out = 0, i2.avail_out = s2), 1 !== (r2 = a.deflate(i2, n2)) && r2 !== l) return this.onEnd(r2), !(this.ended = true);
              0 !== i2.avail_out && (0 !== i2.avail_in || 4 !== n2 && 2 !== n2) || ("string" === this.options.to ? this.onData(h.buf2binstring(o.shrinkBuf(i2.output, i2.next_out))) : this.onData(o.shrinkBuf(i2.output, i2.next_out)));
            } while ((0 < i2.avail_in || 0 === i2.avail_out) && 1 !== r2);
            return 4 === n2 ? (r2 = a.deflateEnd(this.strm), this.onEnd(r2), this.ended = true, r2 === l) : 2 !== n2 || (this.onEnd(l), !(i2.avail_out = 0));
          }, p.prototype.onData = function(e2) {
            this.chunks.push(e2);
          }, p.prototype.onEnd = function(e2) {
            e2 === l && ("string" === this.options.to ? this.result = this.chunks.join("") : this.result = o.flattenChunks(this.chunks)), this.chunks = [], this.err = e2, this.msg = this.strm.msg;
          }, r.Deflate = p, r.deflate = n, r.deflateRaw = function(e2, t2) {
            return (t2 = t2 || {}).raw = true, n(e2, t2);
          }, r.gzip = function(e2, t2) {
            return (t2 = t2 || {}).gzip = true, n(e2, t2);
          };
        }, { "./utils/common": 41, "./utils/strings": 42, "./zlib/deflate": 46, "./zlib/messages": 51, "./zlib/zstream": 53 }], 40: [function(e, t, r) {
          "use strict";
          var c = e("./zlib/inflate"), d = e("./utils/common"), p = e("./utils/strings"), m = e("./zlib/constants"), n = e("./zlib/messages"), i = e("./zlib/zstream"), s = e("./zlib/gzheader"), _ = Object.prototype.toString;
          function a(e2) {
            if (!(this instanceof a)) return new a(e2);
            this.options = d.assign({ chunkSize: 16384, windowBits: 0, to: "" }, e2 || {});
            var t2 = this.options;
            t2.raw && 0 <= t2.windowBits && t2.windowBits < 16 && (t2.windowBits = -t2.windowBits, 0 === t2.windowBits && (t2.windowBits = -15)), !(0 <= t2.windowBits && t2.windowBits < 16) || e2 && e2.windowBits || (t2.windowBits += 32), 15 < t2.windowBits && t2.windowBits < 48 && 0 == (15 & t2.windowBits) && (t2.windowBits |= 15), this.err = 0, this.msg = "", this.ended = false, this.chunks = [], this.strm = new i(), this.strm.avail_out = 0;
            var r2 = c.inflateInit2(this.strm, t2.windowBits);
            if (r2 !== m.Z_OK) throw new Error(n[r2]);
            this.header = new s(), c.inflateGetHeader(this.strm, this.header);
          }
          function o(e2, t2) {
            var r2 = new a(t2);
            if (r2.push(e2, true), r2.err) throw r2.msg || n[r2.err];
            return r2.result;
          }
          a.prototype.push = function(e2, t2) {
            var r2, n2, i2, s2, a2, o2, h = this.strm, u = this.options.chunkSize, l = this.options.dictionary, f = false;
            if (this.ended) return false;
            n2 = t2 === ~~t2 ? t2 : true === t2 ? m.Z_FINISH : m.Z_NO_FLUSH, "string" == typeof e2 ? h.input = p.binstring2buf(e2) : "[object ArrayBuffer]" === _.call(e2) ? h.input = new Uint8Array(e2) : h.input = e2, h.next_in = 0, h.avail_in = h.input.length;
            do {
              if (0 === h.avail_out && (h.output = new d.Buf8(u), h.next_out = 0, h.avail_out = u), (r2 = c.inflate(h, m.Z_NO_FLUSH)) === m.Z_NEED_DICT && l && (o2 = "string" == typeof l ? p.string2buf(l) : "[object ArrayBuffer]" === _.call(l) ? new Uint8Array(l) : l, r2 = c.inflateSetDictionary(this.strm, o2)), r2 === m.Z_BUF_ERROR && true === f && (r2 = m.Z_OK, f = false), r2 !== m.Z_STREAM_END && r2 !== m.Z_OK) return this.onEnd(r2), !(this.ended = true);
              h.next_out && (0 !== h.avail_out && r2 !== m.Z_STREAM_END && (0 !== h.avail_in || n2 !== m.Z_FINISH && n2 !== m.Z_SYNC_FLUSH) || ("string" === this.options.to ? (i2 = p.utf8border(h.output, h.next_out), s2 = h.next_out - i2, a2 = p.buf2string(h.output, i2), h.next_out = s2, h.avail_out = u - s2, s2 && d.arraySet(h.output, h.output, i2, s2, 0), this.onData(a2)) : this.onData(d.shrinkBuf(h.output, h.next_out)))), 0 === h.avail_in && 0 === h.avail_out && (f = true);
            } while ((0 < h.avail_in || 0 === h.avail_out) && r2 !== m.Z_STREAM_END);
            return r2 === m.Z_STREAM_END && (n2 = m.Z_FINISH), n2 === m.Z_FINISH ? (r2 = c.inflateEnd(this.strm), this.onEnd(r2), this.ended = true, r2 === m.Z_OK) : n2 !== m.Z_SYNC_FLUSH || (this.onEnd(m.Z_OK), !(h.avail_out = 0));
          }, a.prototype.onData = function(e2) {
            this.chunks.push(e2);
          }, a.prototype.onEnd = function(e2) {
            e2 === m.Z_OK && ("string" === this.options.to ? this.result = this.chunks.join("") : this.result = d.flattenChunks(this.chunks)), this.chunks = [], this.err = e2, this.msg = this.strm.msg;
          }, r.Inflate = a, r.inflate = o, r.inflateRaw = function(e2, t2) {
            return (t2 = t2 || {}).raw = true, o(e2, t2);
          }, r.ungzip = o;
        }, { "./utils/common": 41, "./utils/strings": 42, "./zlib/constants": 44, "./zlib/gzheader": 47, "./zlib/inflate": 49, "./zlib/messages": 51, "./zlib/zstream": 53 }], 41: [function(e, t, r) {
          "use strict";
          var n = "undefined" != typeof Uint8Array && "undefined" != typeof Uint16Array && "undefined" != typeof Int32Array;
          r.assign = function(e2) {
            for (var t2 = Array.prototype.slice.call(arguments, 1); t2.length; ) {
              var r2 = t2.shift();
              if (r2) {
                if ("object" != typeof r2) throw new TypeError(r2 + "must be non-object");
                for (var n2 in r2) r2.hasOwnProperty(n2) && (e2[n2] = r2[n2]);
              }
            }
            return e2;
          }, r.shrinkBuf = function(e2, t2) {
            return e2.length === t2 ? e2 : e2.subarray ? e2.subarray(0, t2) : (e2.length = t2, e2);
          };
          var i = { arraySet: function(e2, t2, r2, n2, i2) {
            if (t2.subarray && e2.subarray) e2.set(t2.subarray(r2, r2 + n2), i2);
            else for (var s2 = 0; s2 < n2; s2++) e2[i2 + s2] = t2[r2 + s2];
          }, flattenChunks: function(e2) {
            var t2, r2, n2, i2, s2, a;
            for (t2 = n2 = 0, r2 = e2.length; t2 < r2; t2++) n2 += e2[t2].length;
            for (a = new Uint8Array(n2), t2 = i2 = 0, r2 = e2.length; t2 < r2; t2++) s2 = e2[t2], a.set(s2, i2), i2 += s2.length;
            return a;
          } }, s = { arraySet: function(e2, t2, r2, n2, i2) {
            for (var s2 = 0; s2 < n2; s2++) e2[i2 + s2] = t2[r2 + s2];
          }, flattenChunks: function(e2) {
            return [].concat.apply([], e2);
          } };
          r.setTyped = function(e2) {
            e2 ? (r.Buf8 = Uint8Array, r.Buf16 = Uint16Array, r.Buf32 = Int32Array, r.assign(r, i)) : (r.Buf8 = Array, r.Buf16 = Array, r.Buf32 = Array, r.assign(r, s));
          }, r.setTyped(n);
        }, {}], 42: [function(e, t, r) {
          "use strict";
          var h = e("./common"), i = true, s = true;
          try {
            String.fromCharCode.apply(null, [0]);
          } catch (e2) {
            i = false;
          }
          try {
            String.fromCharCode.apply(null, new Uint8Array(1));
          } catch (e2) {
            s = false;
          }
          for (var u = new h.Buf8(256), n = 0; n < 256; n++) u[n] = 252 <= n ? 6 : 248 <= n ? 5 : 240 <= n ? 4 : 224 <= n ? 3 : 192 <= n ? 2 : 1;
          function l(e2, t2) {
            if (t2 < 65537 && (e2.subarray && s || !e2.subarray && i)) return String.fromCharCode.apply(null, h.shrinkBuf(e2, t2));
            for (var r2 = "", n2 = 0; n2 < t2; n2++) r2 += String.fromCharCode(e2[n2]);
            return r2;
          }
          u[254] = u[254] = 1, r.string2buf = function(e2) {
            var t2, r2, n2, i2, s2, a = e2.length, o = 0;
            for (i2 = 0; i2 < a; i2++) 55296 == (64512 & (r2 = e2.charCodeAt(i2))) && i2 + 1 < a && 56320 == (64512 & (n2 = e2.charCodeAt(i2 + 1))) && (r2 = 65536 + (r2 - 55296 << 10) + (n2 - 56320), i2++), o += r2 < 128 ? 1 : r2 < 2048 ? 2 : r2 < 65536 ? 3 : 4;
            for (t2 = new h.Buf8(o), i2 = s2 = 0; s2 < o; i2++) 55296 == (64512 & (r2 = e2.charCodeAt(i2))) && i2 + 1 < a && 56320 == (64512 & (n2 = e2.charCodeAt(i2 + 1))) && (r2 = 65536 + (r2 - 55296 << 10) + (n2 - 56320), i2++), r2 < 128 ? t2[s2++] = r2 : (r2 < 2048 ? t2[s2++] = 192 | r2 >>> 6 : (r2 < 65536 ? t2[s2++] = 224 | r2 >>> 12 : (t2[s2++] = 240 | r2 >>> 18, t2[s2++] = 128 | r2 >>> 12 & 63), t2[s2++] = 128 | r2 >>> 6 & 63), t2[s2++] = 128 | 63 & r2);
            return t2;
          }, r.buf2binstring = function(e2) {
            return l(e2, e2.length);
          }, r.binstring2buf = function(e2) {
            for (var t2 = new h.Buf8(e2.length), r2 = 0, n2 = t2.length; r2 < n2; r2++) t2[r2] = e2.charCodeAt(r2);
            return t2;
          }, r.buf2string = function(e2, t2) {
            var r2, n2, i2, s2, a = t2 || e2.length, o = new Array(2 * a);
            for (r2 = n2 = 0; r2 < a; ) if ((i2 = e2[r2++]) < 128) o[n2++] = i2;
            else if (4 < (s2 = u[i2])) o[n2++] = 65533, r2 += s2 - 1;
            else {
              for (i2 &= 2 === s2 ? 31 : 3 === s2 ? 15 : 7; 1 < s2 && r2 < a; ) i2 = i2 << 6 | 63 & e2[r2++], s2--;
              1 < s2 ? o[n2++] = 65533 : i2 < 65536 ? o[n2++] = i2 : (i2 -= 65536, o[n2++] = 55296 | i2 >> 10 & 1023, o[n2++] = 56320 | 1023 & i2);
            }
            return l(o, n2);
          }, r.utf8border = function(e2, t2) {
            var r2;
            for ((t2 = t2 || e2.length) > e2.length && (t2 = e2.length), r2 = t2 - 1; 0 <= r2 && 128 == (192 & e2[r2]); ) r2--;
            return r2 < 0 ? t2 : 0 === r2 ? t2 : r2 + u[e2[r2]] > t2 ? r2 : t2;
          };
        }, { "./common": 41 }], 43: [function(e, t, r) {
          "use strict";
          t.exports = function(e2, t2, r2, n) {
            for (var i = 65535 & e2 | 0, s = e2 >>> 16 & 65535 | 0, a = 0; 0 !== r2; ) {
              for (r2 -= a = 2e3 < r2 ? 2e3 : r2; s = s + (i = i + t2[n++] | 0) | 0, --a; ) ;
              i %= 65521, s %= 65521;
            }
            return i | s << 16 | 0;
          };
        }, {}], 44: [function(e, t, r) {
          "use strict";
          t.exports = { Z_NO_FLUSH: 0, Z_PARTIAL_FLUSH: 1, Z_SYNC_FLUSH: 2, Z_FULL_FLUSH: 3, Z_FINISH: 4, Z_BLOCK: 5, Z_TREES: 6, Z_OK: 0, Z_STREAM_END: 1, Z_NEED_DICT: 2, Z_ERRNO: -1, Z_STREAM_ERROR: -2, Z_DATA_ERROR: -3, Z_BUF_ERROR: -5, Z_NO_COMPRESSION: 0, Z_BEST_SPEED: 1, Z_BEST_COMPRESSION: 9, Z_DEFAULT_COMPRESSION: -1, Z_FILTERED: 1, Z_HUFFMAN_ONLY: 2, Z_RLE: 3, Z_FIXED: 4, Z_DEFAULT_STRATEGY: 0, Z_BINARY: 0, Z_TEXT: 1, Z_UNKNOWN: 2, Z_DEFLATED: 8 };
        }, {}], 45: [function(e, t, r) {
          "use strict";
          var o = (function() {
            for (var e2, t2 = [], r2 = 0; r2 < 256; r2++) {
              e2 = r2;
              for (var n = 0; n < 8; n++) e2 = 1 & e2 ? 3988292384 ^ e2 >>> 1 : e2 >>> 1;
              t2[r2] = e2;
            }
            return t2;
          })();
          t.exports = function(e2, t2, r2, n) {
            var i = o, s = n + r2;
            e2 ^= -1;
            for (var a = n; a < s; a++) e2 = e2 >>> 8 ^ i[255 & (e2 ^ t2[a])];
            return -1 ^ e2;
          };
        }, {}], 46: [function(e, t, r) {
          "use strict";
          var h, c = e("../utils/common"), u = e("./trees"), d = e("./adler32"), p = e("./crc32"), n = e("./messages"), l = 0, f = 4, m = 0, _ = -2, g = -1, b = 4, i = 2, v = 8, y = 9, s = 286, a = 30, o = 19, w = 2 * s + 1, k = 15, x = 3, S = 258, z = S + x + 1, C = 42, E = 113, A = 1, I = 2, O = 3, B = 4;
          function R(e2, t2) {
            return e2.msg = n[t2], t2;
          }
          function T(e2) {
            return (e2 << 1) - (4 < e2 ? 9 : 0);
          }
          function D(e2) {
            for (var t2 = e2.length; 0 <= --t2; ) e2[t2] = 0;
          }
          function F(e2) {
            var t2 = e2.state, r2 = t2.pending;
            r2 > e2.avail_out && (r2 = e2.avail_out), 0 !== r2 && (c.arraySet(e2.output, t2.pending_buf, t2.pending_out, r2, e2.next_out), e2.next_out += r2, t2.pending_out += r2, e2.total_out += r2, e2.avail_out -= r2, t2.pending -= r2, 0 === t2.pending && (t2.pending_out = 0));
          }
          function N(e2, t2) {
            u._tr_flush_block(e2, 0 <= e2.block_start ? e2.block_start : -1, e2.strstart - e2.block_start, t2), e2.block_start = e2.strstart, F(e2.strm);
          }
          function U(e2, t2) {
            e2.pending_buf[e2.pending++] = t2;
          }
          function P(e2, t2) {
            e2.pending_buf[e2.pending++] = t2 >>> 8 & 255, e2.pending_buf[e2.pending++] = 255 & t2;
          }
          function L(e2, t2) {
            var r2, n2, i2 = e2.max_chain_length, s2 = e2.strstart, a2 = e2.prev_length, o2 = e2.nice_match, h2 = e2.strstart > e2.w_size - z ? e2.strstart - (e2.w_size - z) : 0, u2 = e2.window, l2 = e2.w_mask, f2 = e2.prev, c2 = e2.strstart + S, d2 = u2[s2 + a2 - 1], p2 = u2[s2 + a2];
            e2.prev_length >= e2.good_match && (i2 >>= 2), o2 > e2.lookahead && (o2 = e2.lookahead);
            do {
              if (u2[(r2 = t2) + a2] === p2 && u2[r2 + a2 - 1] === d2 && u2[r2] === u2[s2] && u2[++r2] === u2[s2 + 1]) {
                s2 += 2, r2++;
                do {
                } while (u2[++s2] === u2[++r2] && u2[++s2] === u2[++r2] && u2[++s2] === u2[++r2] && u2[++s2] === u2[++r2] && u2[++s2] === u2[++r2] && u2[++s2] === u2[++r2] && u2[++s2] === u2[++r2] && u2[++s2] === u2[++r2] && s2 < c2);
                if (n2 = S - (c2 - s2), s2 = c2 - S, a2 < n2) {
                  if (e2.match_start = t2, o2 <= (a2 = n2)) break;
                  d2 = u2[s2 + a2 - 1], p2 = u2[s2 + a2];
                }
              }
            } while ((t2 = f2[t2 & l2]) > h2 && 0 != --i2);
            return a2 <= e2.lookahead ? a2 : e2.lookahead;
          }
          function j(e2) {
            var t2, r2, n2, i2, s2, a2, o2, h2, u2, l2, f2 = e2.w_size;
            do {
              if (i2 = e2.window_size - e2.lookahead - e2.strstart, e2.strstart >= f2 + (f2 - z)) {
                for (c.arraySet(e2.window, e2.window, f2, f2, 0), e2.match_start -= f2, e2.strstart -= f2, e2.block_start -= f2, t2 = r2 = e2.hash_size; n2 = e2.head[--t2], e2.head[t2] = f2 <= n2 ? n2 - f2 : 0, --r2; ) ;
                for (t2 = r2 = f2; n2 = e2.prev[--t2], e2.prev[t2] = f2 <= n2 ? n2 - f2 : 0, --r2; ) ;
                i2 += f2;
              }
              if (0 === e2.strm.avail_in) break;
              if (a2 = e2.strm, o2 = e2.window, h2 = e2.strstart + e2.lookahead, u2 = i2, l2 = void 0, l2 = a2.avail_in, u2 < l2 && (l2 = u2), r2 = 0 === l2 ? 0 : (a2.avail_in -= l2, c.arraySet(o2, a2.input, a2.next_in, l2, h2), 1 === a2.state.wrap ? a2.adler = d(a2.adler, o2, l2, h2) : 2 === a2.state.wrap && (a2.adler = p(a2.adler, o2, l2, h2)), a2.next_in += l2, a2.total_in += l2, l2), e2.lookahead += r2, e2.lookahead + e2.insert >= x) for (s2 = e2.strstart - e2.insert, e2.ins_h = e2.window[s2], e2.ins_h = (e2.ins_h << e2.hash_shift ^ e2.window[s2 + 1]) & e2.hash_mask; e2.insert && (e2.ins_h = (e2.ins_h << e2.hash_shift ^ e2.window[s2 + x - 1]) & e2.hash_mask, e2.prev[s2 & e2.w_mask] = e2.head[e2.ins_h], e2.head[e2.ins_h] = s2, s2++, e2.insert--, !(e2.lookahead + e2.insert < x)); ) ;
            } while (e2.lookahead < z && 0 !== e2.strm.avail_in);
          }
          function Z(e2, t2) {
            for (var r2, n2; ; ) {
              if (e2.lookahead < z) {
                if (j(e2), e2.lookahead < z && t2 === l) return A;
                if (0 === e2.lookahead) break;
              }
              if (r2 = 0, e2.lookahead >= x && (e2.ins_h = (e2.ins_h << e2.hash_shift ^ e2.window[e2.strstart + x - 1]) & e2.hash_mask, r2 = e2.prev[e2.strstart & e2.w_mask] = e2.head[e2.ins_h], e2.head[e2.ins_h] = e2.strstart), 0 !== r2 && e2.strstart - r2 <= e2.w_size - z && (e2.match_length = L(e2, r2)), e2.match_length >= x) if (n2 = u._tr_tally(e2, e2.strstart - e2.match_start, e2.match_length - x), e2.lookahead -= e2.match_length, e2.match_length <= e2.max_lazy_match && e2.lookahead >= x) {
                for (e2.match_length--; e2.strstart++, e2.ins_h = (e2.ins_h << e2.hash_shift ^ e2.window[e2.strstart + x - 1]) & e2.hash_mask, r2 = e2.prev[e2.strstart & e2.w_mask] = e2.head[e2.ins_h], e2.head[e2.ins_h] = e2.strstart, 0 != --e2.match_length; ) ;
                e2.strstart++;
              } else e2.strstart += e2.match_length, e2.match_length = 0, e2.ins_h = e2.window[e2.strstart], e2.ins_h = (e2.ins_h << e2.hash_shift ^ e2.window[e2.strstart + 1]) & e2.hash_mask;
              else n2 = u._tr_tally(e2, 0, e2.window[e2.strstart]), e2.lookahead--, e2.strstart++;
              if (n2 && (N(e2, false), 0 === e2.strm.avail_out)) return A;
            }
            return e2.insert = e2.strstart < x - 1 ? e2.strstart : x - 1, t2 === f ? (N(e2, true), 0 === e2.strm.avail_out ? O : B) : e2.last_lit && (N(e2, false), 0 === e2.strm.avail_out) ? A : I;
          }
          function W(e2, t2) {
            for (var r2, n2, i2; ; ) {
              if (e2.lookahead < z) {
                if (j(e2), e2.lookahead < z && t2 === l) return A;
                if (0 === e2.lookahead) break;
              }
              if (r2 = 0, e2.lookahead >= x && (e2.ins_h = (e2.ins_h << e2.hash_shift ^ e2.window[e2.strstart + x - 1]) & e2.hash_mask, r2 = e2.prev[e2.strstart & e2.w_mask] = e2.head[e2.ins_h], e2.head[e2.ins_h] = e2.strstart), e2.prev_length = e2.match_length, e2.prev_match = e2.match_start, e2.match_length = x - 1, 0 !== r2 && e2.prev_length < e2.max_lazy_match && e2.strstart - r2 <= e2.w_size - z && (e2.match_length = L(e2, r2), e2.match_length <= 5 && (1 === e2.strategy || e2.match_length === x && 4096 < e2.strstart - e2.match_start) && (e2.match_length = x - 1)), e2.prev_length >= x && e2.match_length <= e2.prev_length) {
                for (i2 = e2.strstart + e2.lookahead - x, n2 = u._tr_tally(e2, e2.strstart - 1 - e2.prev_match, e2.prev_length - x), e2.lookahead -= e2.prev_length - 1, e2.prev_length -= 2; ++e2.strstart <= i2 && (e2.ins_h = (e2.ins_h << e2.hash_shift ^ e2.window[e2.strstart + x - 1]) & e2.hash_mask, r2 = e2.prev[e2.strstart & e2.w_mask] = e2.head[e2.ins_h], e2.head[e2.ins_h] = e2.strstart), 0 != --e2.prev_length; ) ;
                if (e2.match_available = 0, e2.match_length = x - 1, e2.strstart++, n2 && (N(e2, false), 0 === e2.strm.avail_out)) return A;
              } else if (e2.match_available) {
                if ((n2 = u._tr_tally(e2, 0, e2.window[e2.strstart - 1])) && N(e2, false), e2.strstart++, e2.lookahead--, 0 === e2.strm.avail_out) return A;
              } else e2.match_available = 1, e2.strstart++, e2.lookahead--;
            }
            return e2.match_available && (n2 = u._tr_tally(e2, 0, e2.window[e2.strstart - 1]), e2.match_available = 0), e2.insert = e2.strstart < x - 1 ? e2.strstart : x - 1, t2 === f ? (N(e2, true), 0 === e2.strm.avail_out ? O : B) : e2.last_lit && (N(e2, false), 0 === e2.strm.avail_out) ? A : I;
          }
          function M(e2, t2, r2, n2, i2) {
            this.good_length = e2, this.max_lazy = t2, this.nice_length = r2, this.max_chain = n2, this.func = i2;
          }
          function H() {
            this.strm = null, this.status = 0, this.pending_buf = null, this.pending_buf_size = 0, this.pending_out = 0, this.pending = 0, this.wrap = 0, this.gzhead = null, this.gzindex = 0, this.method = v, this.last_flush = -1, this.w_size = 0, this.w_bits = 0, this.w_mask = 0, this.window = null, this.window_size = 0, this.prev = null, this.head = null, this.ins_h = 0, this.hash_size = 0, this.hash_bits = 0, this.hash_mask = 0, this.hash_shift = 0, this.block_start = 0, this.match_length = 0, this.prev_match = 0, this.match_available = 0, this.strstart = 0, this.match_start = 0, this.lookahead = 0, this.prev_length = 0, this.max_chain_length = 0, this.max_lazy_match = 0, this.level = 0, this.strategy = 0, this.good_match = 0, this.nice_match = 0, this.dyn_ltree = new c.Buf16(2 * w), this.dyn_dtree = new c.Buf16(2 * (2 * a + 1)), this.bl_tree = new c.Buf16(2 * (2 * o + 1)), D(this.dyn_ltree), D(this.dyn_dtree), D(this.bl_tree), this.l_desc = null, this.d_desc = null, this.bl_desc = null, this.bl_count = new c.Buf16(k + 1), this.heap = new c.Buf16(2 * s + 1), D(this.heap), this.heap_len = 0, this.heap_max = 0, this.depth = new c.Buf16(2 * s + 1), D(this.depth), this.l_buf = 0, this.lit_bufsize = 0, this.last_lit = 0, this.d_buf = 0, this.opt_len = 0, this.static_len = 0, this.matches = 0, this.insert = 0, this.bi_buf = 0, this.bi_valid = 0;
          }
          function G(e2) {
            var t2;
            return e2 && e2.state ? (e2.total_in = e2.total_out = 0, e2.data_type = i, (t2 = e2.state).pending = 0, t2.pending_out = 0, t2.wrap < 0 && (t2.wrap = -t2.wrap), t2.status = t2.wrap ? C : E, e2.adler = 2 === t2.wrap ? 0 : 1, t2.last_flush = l, u._tr_init(t2), m) : R(e2, _);
          }
          function K(e2) {
            var t2 = G(e2);
            return t2 === m && (function(e3) {
              e3.window_size = 2 * e3.w_size, D(e3.head), e3.max_lazy_match = h[e3.level].max_lazy, e3.good_match = h[e3.level].good_length, e3.nice_match = h[e3.level].nice_length, e3.max_chain_length = h[e3.level].max_chain, e3.strstart = 0, e3.block_start = 0, e3.lookahead = 0, e3.insert = 0, e3.match_length = e3.prev_length = x - 1, e3.match_available = 0, e3.ins_h = 0;
            })(e2.state), t2;
          }
          function Y(e2, t2, r2, n2, i2, s2) {
            if (!e2) return _;
            var a2 = 1;
            if (t2 === g && (t2 = 6), n2 < 0 ? (a2 = 0, n2 = -n2) : 15 < n2 && (a2 = 2, n2 -= 16), i2 < 1 || y < i2 || r2 !== v || n2 < 8 || 15 < n2 || t2 < 0 || 9 < t2 || s2 < 0 || b < s2) return R(e2, _);
            8 === n2 && (n2 = 9);
            var o2 = new H();
            return (e2.state = o2).strm = e2, o2.wrap = a2, o2.gzhead = null, o2.w_bits = n2, o2.w_size = 1 << o2.w_bits, o2.w_mask = o2.w_size - 1, o2.hash_bits = i2 + 7, o2.hash_size = 1 << o2.hash_bits, o2.hash_mask = o2.hash_size - 1, o2.hash_shift = ~~((o2.hash_bits + x - 1) / x), o2.window = new c.Buf8(2 * o2.w_size), o2.head = new c.Buf16(o2.hash_size), o2.prev = new c.Buf16(o2.w_size), o2.lit_bufsize = 1 << i2 + 6, o2.pending_buf_size = 4 * o2.lit_bufsize, o2.pending_buf = new c.Buf8(o2.pending_buf_size), o2.d_buf = 1 * o2.lit_bufsize, o2.l_buf = 3 * o2.lit_bufsize, o2.level = t2, o2.strategy = s2, o2.method = r2, K(e2);
          }
          h = [new M(0, 0, 0, 0, function(e2, t2) {
            var r2 = 65535;
            for (r2 > e2.pending_buf_size - 5 && (r2 = e2.pending_buf_size - 5); ; ) {
              if (e2.lookahead <= 1) {
                if (j(e2), 0 === e2.lookahead && t2 === l) return A;
                if (0 === e2.lookahead) break;
              }
              e2.strstart += e2.lookahead, e2.lookahead = 0;
              var n2 = e2.block_start + r2;
              if ((0 === e2.strstart || e2.strstart >= n2) && (e2.lookahead = e2.strstart - n2, e2.strstart = n2, N(e2, false), 0 === e2.strm.avail_out)) return A;
              if (e2.strstart - e2.block_start >= e2.w_size - z && (N(e2, false), 0 === e2.strm.avail_out)) return A;
            }
            return e2.insert = 0, t2 === f ? (N(e2, true), 0 === e2.strm.avail_out ? O : B) : (e2.strstart > e2.block_start && (N(e2, false), e2.strm.avail_out), A);
          }), new M(4, 4, 8, 4, Z), new M(4, 5, 16, 8, Z), new M(4, 6, 32, 32, Z), new M(4, 4, 16, 16, W), new M(8, 16, 32, 32, W), new M(8, 16, 128, 128, W), new M(8, 32, 128, 256, W), new M(32, 128, 258, 1024, W), new M(32, 258, 258, 4096, W)], r.deflateInit = function(e2, t2) {
            return Y(e2, t2, v, 15, 8, 0);
          }, r.deflateInit2 = Y, r.deflateReset = K, r.deflateResetKeep = G, r.deflateSetHeader = function(e2, t2) {
            return e2 && e2.state ? 2 !== e2.state.wrap ? _ : (e2.state.gzhead = t2, m) : _;
          }, r.deflate = function(e2, t2) {
            var r2, n2, i2, s2;
            if (!e2 || !e2.state || 5 < t2 || t2 < 0) return e2 ? R(e2, _) : _;
            if (n2 = e2.state, !e2.output || !e2.input && 0 !== e2.avail_in || 666 === n2.status && t2 !== f) return R(e2, 0 === e2.avail_out ? -5 : _);
            if (n2.strm = e2, r2 = n2.last_flush, n2.last_flush = t2, n2.status === C) if (2 === n2.wrap) e2.adler = 0, U(n2, 31), U(n2, 139), U(n2, 8), n2.gzhead ? (U(n2, (n2.gzhead.text ? 1 : 0) + (n2.gzhead.hcrc ? 2 : 0) + (n2.gzhead.extra ? 4 : 0) + (n2.gzhead.name ? 8 : 0) + (n2.gzhead.comment ? 16 : 0)), U(n2, 255 & n2.gzhead.time), U(n2, n2.gzhead.time >> 8 & 255), U(n2, n2.gzhead.time >> 16 & 255), U(n2, n2.gzhead.time >> 24 & 255), U(n2, 9 === n2.level ? 2 : 2 <= n2.strategy || n2.level < 2 ? 4 : 0), U(n2, 255 & n2.gzhead.os), n2.gzhead.extra && n2.gzhead.extra.length && (U(n2, 255 & n2.gzhead.extra.length), U(n2, n2.gzhead.extra.length >> 8 & 255)), n2.gzhead.hcrc && (e2.adler = p(e2.adler, n2.pending_buf, n2.pending, 0)), n2.gzindex = 0, n2.status = 69) : (U(n2, 0), U(n2, 0), U(n2, 0), U(n2, 0), U(n2, 0), U(n2, 9 === n2.level ? 2 : 2 <= n2.strategy || n2.level < 2 ? 4 : 0), U(n2, 3), n2.status = E);
            else {
              var a2 = v + (n2.w_bits - 8 << 4) << 8;
              a2 |= (2 <= n2.strategy || n2.level < 2 ? 0 : n2.level < 6 ? 1 : 6 === n2.level ? 2 : 3) << 6, 0 !== n2.strstart && (a2 |= 32), a2 += 31 - a2 % 31, n2.status = E, P(n2, a2), 0 !== n2.strstart && (P(n2, e2.adler >>> 16), P(n2, 65535 & e2.adler)), e2.adler = 1;
            }
            if (69 === n2.status) if (n2.gzhead.extra) {
              for (i2 = n2.pending; n2.gzindex < (65535 & n2.gzhead.extra.length) && (n2.pending !== n2.pending_buf_size || (n2.gzhead.hcrc && n2.pending > i2 && (e2.adler = p(e2.adler, n2.pending_buf, n2.pending - i2, i2)), F(e2), i2 = n2.pending, n2.pending !== n2.pending_buf_size)); ) U(n2, 255 & n2.gzhead.extra[n2.gzindex]), n2.gzindex++;
              n2.gzhead.hcrc && n2.pending > i2 && (e2.adler = p(e2.adler, n2.pending_buf, n2.pending - i2, i2)), n2.gzindex === n2.gzhead.extra.length && (n2.gzindex = 0, n2.status = 73);
            } else n2.status = 73;
            if (73 === n2.status) if (n2.gzhead.name) {
              i2 = n2.pending;
              do {
                if (n2.pending === n2.pending_buf_size && (n2.gzhead.hcrc && n2.pending > i2 && (e2.adler = p(e2.adler, n2.pending_buf, n2.pending - i2, i2)), F(e2), i2 = n2.pending, n2.pending === n2.pending_buf_size)) {
                  s2 = 1;
                  break;
                }
                s2 = n2.gzindex < n2.gzhead.name.length ? 255 & n2.gzhead.name.charCodeAt(n2.gzindex++) : 0, U(n2, s2);
              } while (0 !== s2);
              n2.gzhead.hcrc && n2.pending > i2 && (e2.adler = p(e2.adler, n2.pending_buf, n2.pending - i2, i2)), 0 === s2 && (n2.gzindex = 0, n2.status = 91);
            } else n2.status = 91;
            if (91 === n2.status) if (n2.gzhead.comment) {
              i2 = n2.pending;
              do {
                if (n2.pending === n2.pending_buf_size && (n2.gzhead.hcrc && n2.pending > i2 && (e2.adler = p(e2.adler, n2.pending_buf, n2.pending - i2, i2)), F(e2), i2 = n2.pending, n2.pending === n2.pending_buf_size)) {
                  s2 = 1;
                  break;
                }
                s2 = n2.gzindex < n2.gzhead.comment.length ? 255 & n2.gzhead.comment.charCodeAt(n2.gzindex++) : 0, U(n2, s2);
              } while (0 !== s2);
              n2.gzhead.hcrc && n2.pending > i2 && (e2.adler = p(e2.adler, n2.pending_buf, n2.pending - i2, i2)), 0 === s2 && (n2.status = 103);
            } else n2.status = 103;
            if (103 === n2.status && (n2.gzhead.hcrc ? (n2.pending + 2 > n2.pending_buf_size && F(e2), n2.pending + 2 <= n2.pending_buf_size && (U(n2, 255 & e2.adler), U(n2, e2.adler >> 8 & 255), e2.adler = 0, n2.status = E)) : n2.status = E), 0 !== n2.pending) {
              if (F(e2), 0 === e2.avail_out) return n2.last_flush = -1, m;
            } else if (0 === e2.avail_in && T(t2) <= T(r2) && t2 !== f) return R(e2, -5);
            if (666 === n2.status && 0 !== e2.avail_in) return R(e2, -5);
            if (0 !== e2.avail_in || 0 !== n2.lookahead || t2 !== l && 666 !== n2.status) {
              var o2 = 2 === n2.strategy ? (function(e3, t3) {
                for (var r3; ; ) {
                  if (0 === e3.lookahead && (j(e3), 0 === e3.lookahead)) {
                    if (t3 === l) return A;
                    break;
                  }
                  if (e3.match_length = 0, r3 = u._tr_tally(e3, 0, e3.window[e3.strstart]), e3.lookahead--, e3.strstart++, r3 && (N(e3, false), 0 === e3.strm.avail_out)) return A;
                }
                return e3.insert = 0, t3 === f ? (N(e3, true), 0 === e3.strm.avail_out ? O : B) : e3.last_lit && (N(e3, false), 0 === e3.strm.avail_out) ? A : I;
              })(n2, t2) : 3 === n2.strategy ? (function(e3, t3) {
                for (var r3, n3, i3, s3, a3 = e3.window; ; ) {
                  if (e3.lookahead <= S) {
                    if (j(e3), e3.lookahead <= S && t3 === l) return A;
                    if (0 === e3.lookahead) break;
                  }
                  if (e3.match_length = 0, e3.lookahead >= x && 0 < e3.strstart && (n3 = a3[i3 = e3.strstart - 1]) === a3[++i3] && n3 === a3[++i3] && n3 === a3[++i3]) {
                    s3 = e3.strstart + S;
                    do {
                    } while (n3 === a3[++i3] && n3 === a3[++i3] && n3 === a3[++i3] && n3 === a3[++i3] && n3 === a3[++i3] && n3 === a3[++i3] && n3 === a3[++i3] && n3 === a3[++i3] && i3 < s3);
                    e3.match_length = S - (s3 - i3), e3.match_length > e3.lookahead && (e3.match_length = e3.lookahead);
                  }
                  if (e3.match_length >= x ? (r3 = u._tr_tally(e3, 1, e3.match_length - x), e3.lookahead -= e3.match_length, e3.strstart += e3.match_length, e3.match_length = 0) : (r3 = u._tr_tally(e3, 0, e3.window[e3.strstart]), e3.lookahead--, e3.strstart++), r3 && (N(e3, false), 0 === e3.strm.avail_out)) return A;
                }
                return e3.insert = 0, t3 === f ? (N(e3, true), 0 === e3.strm.avail_out ? O : B) : e3.last_lit && (N(e3, false), 0 === e3.strm.avail_out) ? A : I;
              })(n2, t2) : h[n2.level].func(n2, t2);
              if (o2 !== O && o2 !== B || (n2.status = 666), o2 === A || o2 === O) return 0 === e2.avail_out && (n2.last_flush = -1), m;
              if (o2 === I && (1 === t2 ? u._tr_align(n2) : 5 !== t2 && (u._tr_stored_block(n2, 0, 0, false), 3 === t2 && (D(n2.head), 0 === n2.lookahead && (n2.strstart = 0, n2.block_start = 0, n2.insert = 0))), F(e2), 0 === e2.avail_out)) return n2.last_flush = -1, m;
            }
            return t2 !== f ? m : n2.wrap <= 0 ? 1 : (2 === n2.wrap ? (U(n2, 255 & e2.adler), U(n2, e2.adler >> 8 & 255), U(n2, e2.adler >> 16 & 255), U(n2, e2.adler >> 24 & 255), U(n2, 255 & e2.total_in), U(n2, e2.total_in >> 8 & 255), U(n2, e2.total_in >> 16 & 255), U(n2, e2.total_in >> 24 & 255)) : (P(n2, e2.adler >>> 16), P(n2, 65535 & e2.adler)), F(e2), 0 < n2.wrap && (n2.wrap = -n2.wrap), 0 !== n2.pending ? m : 1);
          }, r.deflateEnd = function(e2) {
            var t2;
            return e2 && e2.state ? (t2 = e2.state.status) !== C && 69 !== t2 && 73 !== t2 && 91 !== t2 && 103 !== t2 && t2 !== E && 666 !== t2 ? R(e2, _) : (e2.state = null, t2 === E ? R(e2, -3) : m) : _;
          }, r.deflateSetDictionary = function(e2, t2) {
            var r2, n2, i2, s2, a2, o2, h2, u2, l2 = t2.length;
            if (!e2 || !e2.state) return _;
            if (2 === (s2 = (r2 = e2.state).wrap) || 1 === s2 && r2.status !== C || r2.lookahead) return _;
            for (1 === s2 && (e2.adler = d(e2.adler, t2, l2, 0)), r2.wrap = 0, l2 >= r2.w_size && (0 === s2 && (D(r2.head), r2.strstart = 0, r2.block_start = 0, r2.insert = 0), u2 = new c.Buf8(r2.w_size), c.arraySet(u2, t2, l2 - r2.w_size, r2.w_size, 0), t2 = u2, l2 = r2.w_size), a2 = e2.avail_in, o2 = e2.next_in, h2 = e2.input, e2.avail_in = l2, e2.next_in = 0, e2.input = t2, j(r2); r2.lookahead >= x; ) {
              for (n2 = r2.strstart, i2 = r2.lookahead - (x - 1); r2.ins_h = (r2.ins_h << r2.hash_shift ^ r2.window[n2 + x - 1]) & r2.hash_mask, r2.prev[n2 & r2.w_mask] = r2.head[r2.ins_h], r2.head[r2.ins_h] = n2, n2++, --i2; ) ;
              r2.strstart = n2, r2.lookahead = x - 1, j(r2);
            }
            return r2.strstart += r2.lookahead, r2.block_start = r2.strstart, r2.insert = r2.lookahead, r2.lookahead = 0, r2.match_length = r2.prev_length = x - 1, r2.match_available = 0, e2.next_in = o2, e2.input = h2, e2.avail_in = a2, r2.wrap = s2, m;
          }, r.deflateInfo = "pako deflate (from Nodeca project)";
        }, { "../utils/common": 41, "./adler32": 43, "./crc32": 45, "./messages": 51, "./trees": 52 }], 47: [function(e, t, r) {
          "use strict";
          t.exports = function() {
            this.text = 0, this.time = 0, this.xflags = 0, this.os = 0, this.extra = null, this.extra_len = 0, this.name = "", this.comment = "", this.hcrc = 0, this.done = false;
          };
        }, {}], 48: [function(e, t, r) {
          "use strict";
          t.exports = function(e2, t2) {
            var r2, n, i, s, a, o, h, u, l, f, c, d, p, m, _, g, b, v, y, w, k, x, S, z, C;
            r2 = e2.state, n = e2.next_in, z = e2.input, i = n + (e2.avail_in - 5), s = e2.next_out, C = e2.output, a = s - (t2 - e2.avail_out), o = s + (e2.avail_out - 257), h = r2.dmax, u = r2.wsize, l = r2.whave, f = r2.wnext, c = r2.window, d = r2.hold, p = r2.bits, m = r2.lencode, _ = r2.distcode, g = (1 << r2.lenbits) - 1, b = (1 << r2.distbits) - 1;
            e: do {
              p < 15 && (d += z[n++] << p, p += 8, d += z[n++] << p, p += 8), v = m[d & g];
              t: for (; ; ) {
                if (d >>>= y = v >>> 24, p -= y, 0 === (y = v >>> 16 & 255)) C[s++] = 65535 & v;
                else {
                  if (!(16 & y)) {
                    if (0 == (64 & y)) {
                      v = m[(65535 & v) + (d & (1 << y) - 1)];
                      continue t;
                    }
                    if (32 & y) {
                      r2.mode = 12;
                      break e;
                    }
                    e2.msg = "invalid literal/length code", r2.mode = 30;
                    break e;
                  }
                  w = 65535 & v, (y &= 15) && (p < y && (d += z[n++] << p, p += 8), w += d & (1 << y) - 1, d >>>= y, p -= y), p < 15 && (d += z[n++] << p, p += 8, d += z[n++] << p, p += 8), v = _[d & b];
                  r: for (; ; ) {
                    if (d >>>= y = v >>> 24, p -= y, !(16 & (y = v >>> 16 & 255))) {
                      if (0 == (64 & y)) {
                        v = _[(65535 & v) + (d & (1 << y) - 1)];
                        continue r;
                      }
                      e2.msg = "invalid distance code", r2.mode = 30;
                      break e;
                    }
                    if (k = 65535 & v, p < (y &= 15) && (d += z[n++] << p, (p += 8) < y && (d += z[n++] << p, p += 8)), h < (k += d & (1 << y) - 1)) {
                      e2.msg = "invalid distance too far back", r2.mode = 30;
                      break e;
                    }
                    if (d >>>= y, p -= y, (y = s - a) < k) {
                      if (l < (y = k - y) && r2.sane) {
                        e2.msg = "invalid distance too far back", r2.mode = 30;
                        break e;
                      }
                      if (S = c, (x = 0) === f) {
                        if (x += u - y, y < w) {
                          for (w -= y; C[s++] = c[x++], --y; ) ;
                          x = s - k, S = C;
                        }
                      } else if (f < y) {
                        if (x += u + f - y, (y -= f) < w) {
                          for (w -= y; C[s++] = c[x++], --y; ) ;
                          if (x = 0, f < w) {
                            for (w -= y = f; C[s++] = c[x++], --y; ) ;
                            x = s - k, S = C;
                          }
                        }
                      } else if (x += f - y, y < w) {
                        for (w -= y; C[s++] = c[x++], --y; ) ;
                        x = s - k, S = C;
                      }
                      for (; 2 < w; ) C[s++] = S[x++], C[s++] = S[x++], C[s++] = S[x++], w -= 3;
                      w && (C[s++] = S[x++], 1 < w && (C[s++] = S[x++]));
                    } else {
                      for (x = s - k; C[s++] = C[x++], C[s++] = C[x++], C[s++] = C[x++], 2 < (w -= 3); ) ;
                      w && (C[s++] = C[x++], 1 < w && (C[s++] = C[x++]));
                    }
                    break;
                  }
                }
                break;
              }
            } while (n < i && s < o);
            n -= w = p >> 3, d &= (1 << (p -= w << 3)) - 1, e2.next_in = n, e2.next_out = s, e2.avail_in = n < i ? i - n + 5 : 5 - (n - i), e2.avail_out = s < o ? o - s + 257 : 257 - (s - o), r2.hold = d, r2.bits = p;
          };
        }, {}], 49: [function(e, t, r) {
          "use strict";
          var I = e("../utils/common"), O = e("./adler32"), B = e("./crc32"), R = e("./inffast"), T = e("./inftrees"), D = 1, F = 2, N = 0, U = -2, P = 1, n = 852, i = 592;
          function L(e2) {
            return (e2 >>> 24 & 255) + (e2 >>> 8 & 65280) + ((65280 & e2) << 8) + ((255 & e2) << 24);
          }
          function s() {
            this.mode = 0, this.last = false, this.wrap = 0, this.havedict = false, this.flags = 0, this.dmax = 0, this.check = 0, this.total = 0, this.head = null, this.wbits = 0, this.wsize = 0, this.whave = 0, this.wnext = 0, this.window = null, this.hold = 0, this.bits = 0, this.length = 0, this.offset = 0, this.extra = 0, this.lencode = null, this.distcode = null, this.lenbits = 0, this.distbits = 0, this.ncode = 0, this.nlen = 0, this.ndist = 0, this.have = 0, this.next = null, this.lens = new I.Buf16(320), this.work = new I.Buf16(288), this.lendyn = null, this.distdyn = null, this.sane = 0, this.back = 0, this.was = 0;
          }
          function a(e2) {
            var t2;
            return e2 && e2.state ? (t2 = e2.state, e2.total_in = e2.total_out = t2.total = 0, e2.msg = "", t2.wrap && (e2.adler = 1 & t2.wrap), t2.mode = P, t2.last = 0, t2.havedict = 0, t2.dmax = 32768, t2.head = null, t2.hold = 0, t2.bits = 0, t2.lencode = t2.lendyn = new I.Buf32(n), t2.distcode = t2.distdyn = new I.Buf32(i), t2.sane = 1, t2.back = -1, N) : U;
          }
          function o(e2) {
            var t2;
            return e2 && e2.state ? ((t2 = e2.state).wsize = 0, t2.whave = 0, t2.wnext = 0, a(e2)) : U;
          }
          function h(e2, t2) {
            var r2, n2;
            return e2 && e2.state ? (n2 = e2.state, t2 < 0 ? (r2 = 0, t2 = -t2) : (r2 = 1 + (t2 >> 4), t2 < 48 && (t2 &= 15)), t2 && (t2 < 8 || 15 < t2) ? U : (null !== n2.window && n2.wbits !== t2 && (n2.window = null), n2.wrap = r2, n2.wbits = t2, o(e2))) : U;
          }
          function u(e2, t2) {
            var r2, n2;
            return e2 ? (n2 = new s(), (e2.state = n2).window = null, (r2 = h(e2, t2)) !== N && (e2.state = null), r2) : U;
          }
          var l, f, c = true;
          function j(e2) {
            if (c) {
              var t2;
              for (l = new I.Buf32(512), f = new I.Buf32(32), t2 = 0; t2 < 144; ) e2.lens[t2++] = 8;
              for (; t2 < 256; ) e2.lens[t2++] = 9;
              for (; t2 < 280; ) e2.lens[t2++] = 7;
              for (; t2 < 288; ) e2.lens[t2++] = 8;
              for (T(D, e2.lens, 0, 288, l, 0, e2.work, { bits: 9 }), t2 = 0; t2 < 32; ) e2.lens[t2++] = 5;
              T(F, e2.lens, 0, 32, f, 0, e2.work, { bits: 5 }), c = false;
            }
            e2.lencode = l, e2.lenbits = 9, e2.distcode = f, e2.distbits = 5;
          }
          function Z(e2, t2, r2, n2) {
            var i2, s2 = e2.state;
            return null === s2.window && (s2.wsize = 1 << s2.wbits, s2.wnext = 0, s2.whave = 0, s2.window = new I.Buf8(s2.wsize)), n2 >= s2.wsize ? (I.arraySet(s2.window, t2, r2 - s2.wsize, s2.wsize, 0), s2.wnext = 0, s2.whave = s2.wsize) : (n2 < (i2 = s2.wsize - s2.wnext) && (i2 = n2), I.arraySet(s2.window, t2, r2 - n2, i2, s2.wnext), (n2 -= i2) ? (I.arraySet(s2.window, t2, r2 - n2, n2, 0), s2.wnext = n2, s2.whave = s2.wsize) : (s2.wnext += i2, s2.wnext === s2.wsize && (s2.wnext = 0), s2.whave < s2.wsize && (s2.whave += i2))), 0;
          }
          r.inflateReset = o, r.inflateReset2 = h, r.inflateResetKeep = a, r.inflateInit = function(e2) {
            return u(e2, 15);
          }, r.inflateInit2 = u, r.inflate = function(e2, t2) {
            var r2, n2, i2, s2, a2, o2, h2, u2, l2, f2, c2, d, p, m, _, g, b, v, y, w, k, x, S, z, C = 0, E = new I.Buf8(4), A = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];
            if (!e2 || !e2.state || !e2.output || !e2.input && 0 !== e2.avail_in) return U;
            12 === (r2 = e2.state).mode && (r2.mode = 13), a2 = e2.next_out, i2 = e2.output, h2 = e2.avail_out, s2 = e2.next_in, n2 = e2.input, o2 = e2.avail_in, u2 = r2.hold, l2 = r2.bits, f2 = o2, c2 = h2, x = N;
            e: for (; ; ) switch (r2.mode) {
              case P:
                if (0 === r2.wrap) {
                  r2.mode = 13;
                  break;
                }
                for (; l2 < 16; ) {
                  if (0 === o2) break e;
                  o2--, u2 += n2[s2++] << l2, l2 += 8;
                }
                if (2 & r2.wrap && 35615 === u2) {
                  E[r2.check = 0] = 255 & u2, E[1] = u2 >>> 8 & 255, r2.check = B(r2.check, E, 2, 0), l2 = u2 = 0, r2.mode = 2;
                  break;
                }
                if (r2.flags = 0, r2.head && (r2.head.done = false), !(1 & r2.wrap) || (((255 & u2) << 8) + (u2 >> 8)) % 31) {
                  e2.msg = "incorrect header check", r2.mode = 30;
                  break;
                }
                if (8 != (15 & u2)) {
                  e2.msg = "unknown compression method", r2.mode = 30;
                  break;
                }
                if (l2 -= 4, k = 8 + (15 & (u2 >>>= 4)), 0 === r2.wbits) r2.wbits = k;
                else if (k > r2.wbits) {
                  e2.msg = "invalid window size", r2.mode = 30;
                  break;
                }
                r2.dmax = 1 << k, e2.adler = r2.check = 1, r2.mode = 512 & u2 ? 10 : 12, l2 = u2 = 0;
                break;
              case 2:
                for (; l2 < 16; ) {
                  if (0 === o2) break e;
                  o2--, u2 += n2[s2++] << l2, l2 += 8;
                }
                if (r2.flags = u2, 8 != (255 & r2.flags)) {
                  e2.msg = "unknown compression method", r2.mode = 30;
                  break;
                }
                if (57344 & r2.flags) {
                  e2.msg = "unknown header flags set", r2.mode = 30;
                  break;
                }
                r2.head && (r2.head.text = u2 >> 8 & 1), 512 & r2.flags && (E[0] = 255 & u2, E[1] = u2 >>> 8 & 255, r2.check = B(r2.check, E, 2, 0)), l2 = u2 = 0, r2.mode = 3;
              case 3:
                for (; l2 < 32; ) {
                  if (0 === o2) break e;
                  o2--, u2 += n2[s2++] << l2, l2 += 8;
                }
                r2.head && (r2.head.time = u2), 512 & r2.flags && (E[0] = 255 & u2, E[1] = u2 >>> 8 & 255, E[2] = u2 >>> 16 & 255, E[3] = u2 >>> 24 & 255, r2.check = B(r2.check, E, 4, 0)), l2 = u2 = 0, r2.mode = 4;
              case 4:
                for (; l2 < 16; ) {
                  if (0 === o2) break e;
                  o2--, u2 += n2[s2++] << l2, l2 += 8;
                }
                r2.head && (r2.head.xflags = 255 & u2, r2.head.os = u2 >> 8), 512 & r2.flags && (E[0] = 255 & u2, E[1] = u2 >>> 8 & 255, r2.check = B(r2.check, E, 2, 0)), l2 = u2 = 0, r2.mode = 5;
              case 5:
                if (1024 & r2.flags) {
                  for (; l2 < 16; ) {
                    if (0 === o2) break e;
                    o2--, u2 += n2[s2++] << l2, l2 += 8;
                  }
                  r2.length = u2, r2.head && (r2.head.extra_len = u2), 512 & r2.flags && (E[0] = 255 & u2, E[1] = u2 >>> 8 & 255, r2.check = B(r2.check, E, 2, 0)), l2 = u2 = 0;
                } else r2.head && (r2.head.extra = null);
                r2.mode = 6;
              case 6:
                if (1024 & r2.flags && (o2 < (d = r2.length) && (d = o2), d && (r2.head && (k = r2.head.extra_len - r2.length, r2.head.extra || (r2.head.extra = new Array(r2.head.extra_len)), I.arraySet(r2.head.extra, n2, s2, d, k)), 512 & r2.flags && (r2.check = B(r2.check, n2, d, s2)), o2 -= d, s2 += d, r2.length -= d), r2.length)) break e;
                r2.length = 0, r2.mode = 7;
              case 7:
                if (2048 & r2.flags) {
                  if (0 === o2) break e;
                  for (d = 0; k = n2[s2 + d++], r2.head && k && r2.length < 65536 && (r2.head.name += String.fromCharCode(k)), k && d < o2; ) ;
                  if (512 & r2.flags && (r2.check = B(r2.check, n2, d, s2)), o2 -= d, s2 += d, k) break e;
                } else r2.head && (r2.head.name = null);
                r2.length = 0, r2.mode = 8;
              case 8:
                if (4096 & r2.flags) {
                  if (0 === o2) break e;
                  for (d = 0; k = n2[s2 + d++], r2.head && k && r2.length < 65536 && (r2.head.comment += String.fromCharCode(k)), k && d < o2; ) ;
                  if (512 & r2.flags && (r2.check = B(r2.check, n2, d, s2)), o2 -= d, s2 += d, k) break e;
                } else r2.head && (r2.head.comment = null);
                r2.mode = 9;
              case 9:
                if (512 & r2.flags) {
                  for (; l2 < 16; ) {
                    if (0 === o2) break e;
                    o2--, u2 += n2[s2++] << l2, l2 += 8;
                  }
                  if (u2 !== (65535 & r2.check)) {
                    e2.msg = "header crc mismatch", r2.mode = 30;
                    break;
                  }
                  l2 = u2 = 0;
                }
                r2.head && (r2.head.hcrc = r2.flags >> 9 & 1, r2.head.done = true), e2.adler = r2.check = 0, r2.mode = 12;
                break;
              case 10:
                for (; l2 < 32; ) {
                  if (0 === o2) break e;
                  o2--, u2 += n2[s2++] << l2, l2 += 8;
                }
                e2.adler = r2.check = L(u2), l2 = u2 = 0, r2.mode = 11;
              case 11:
                if (0 === r2.havedict) return e2.next_out = a2, e2.avail_out = h2, e2.next_in = s2, e2.avail_in = o2, r2.hold = u2, r2.bits = l2, 2;
                e2.adler = r2.check = 1, r2.mode = 12;
              case 12:
                if (5 === t2 || 6 === t2) break e;
              case 13:
                if (r2.last) {
                  u2 >>>= 7 & l2, l2 -= 7 & l2, r2.mode = 27;
                  break;
                }
                for (; l2 < 3; ) {
                  if (0 === o2) break e;
                  o2--, u2 += n2[s2++] << l2, l2 += 8;
                }
                switch (r2.last = 1 & u2, l2 -= 1, 3 & (u2 >>>= 1)) {
                  case 0:
                    r2.mode = 14;
                    break;
                  case 1:
                    if (j(r2), r2.mode = 20, 6 !== t2) break;
                    u2 >>>= 2, l2 -= 2;
                    break e;
                  case 2:
                    r2.mode = 17;
                    break;
                  case 3:
                    e2.msg = "invalid block type", r2.mode = 30;
                }
                u2 >>>= 2, l2 -= 2;
                break;
              case 14:
                for (u2 >>>= 7 & l2, l2 -= 7 & l2; l2 < 32; ) {
                  if (0 === o2) break e;
                  o2--, u2 += n2[s2++] << l2, l2 += 8;
                }
                if ((65535 & u2) != (u2 >>> 16 ^ 65535)) {
                  e2.msg = "invalid stored block lengths", r2.mode = 30;
                  break;
                }
                if (r2.length = 65535 & u2, l2 = u2 = 0, r2.mode = 15, 6 === t2) break e;
              case 15:
                r2.mode = 16;
              case 16:
                if (d = r2.length) {
                  if (o2 < d && (d = o2), h2 < d && (d = h2), 0 === d) break e;
                  I.arraySet(i2, n2, s2, d, a2), o2 -= d, s2 += d, h2 -= d, a2 += d, r2.length -= d;
                  break;
                }
                r2.mode = 12;
                break;
              case 17:
                for (; l2 < 14; ) {
                  if (0 === o2) break e;
                  o2--, u2 += n2[s2++] << l2, l2 += 8;
                }
                if (r2.nlen = 257 + (31 & u2), u2 >>>= 5, l2 -= 5, r2.ndist = 1 + (31 & u2), u2 >>>= 5, l2 -= 5, r2.ncode = 4 + (15 & u2), u2 >>>= 4, l2 -= 4, 286 < r2.nlen || 30 < r2.ndist) {
                  e2.msg = "too many length or distance symbols", r2.mode = 30;
                  break;
                }
                r2.have = 0, r2.mode = 18;
              case 18:
                for (; r2.have < r2.ncode; ) {
                  for (; l2 < 3; ) {
                    if (0 === o2) break e;
                    o2--, u2 += n2[s2++] << l2, l2 += 8;
                  }
                  r2.lens[A[r2.have++]] = 7 & u2, u2 >>>= 3, l2 -= 3;
                }
                for (; r2.have < 19; ) r2.lens[A[r2.have++]] = 0;
                if (r2.lencode = r2.lendyn, r2.lenbits = 7, S = { bits: r2.lenbits }, x = T(0, r2.lens, 0, 19, r2.lencode, 0, r2.work, S), r2.lenbits = S.bits, x) {
                  e2.msg = "invalid code lengths set", r2.mode = 30;
                  break;
                }
                r2.have = 0, r2.mode = 19;
              case 19:
                for (; r2.have < r2.nlen + r2.ndist; ) {
                  for (; g = (C = r2.lencode[u2 & (1 << r2.lenbits) - 1]) >>> 16 & 255, b = 65535 & C, !((_ = C >>> 24) <= l2); ) {
                    if (0 === o2) break e;
                    o2--, u2 += n2[s2++] << l2, l2 += 8;
                  }
                  if (b < 16) u2 >>>= _, l2 -= _, r2.lens[r2.have++] = b;
                  else {
                    if (16 === b) {
                      for (z = _ + 2; l2 < z; ) {
                        if (0 === o2) break e;
                        o2--, u2 += n2[s2++] << l2, l2 += 8;
                      }
                      if (u2 >>>= _, l2 -= _, 0 === r2.have) {
                        e2.msg = "invalid bit length repeat", r2.mode = 30;
                        break;
                      }
                      k = r2.lens[r2.have - 1], d = 3 + (3 & u2), u2 >>>= 2, l2 -= 2;
                    } else if (17 === b) {
                      for (z = _ + 3; l2 < z; ) {
                        if (0 === o2) break e;
                        o2--, u2 += n2[s2++] << l2, l2 += 8;
                      }
                      l2 -= _, k = 0, d = 3 + (7 & (u2 >>>= _)), u2 >>>= 3, l2 -= 3;
                    } else {
                      for (z = _ + 7; l2 < z; ) {
                        if (0 === o2) break e;
                        o2--, u2 += n2[s2++] << l2, l2 += 8;
                      }
                      l2 -= _, k = 0, d = 11 + (127 & (u2 >>>= _)), u2 >>>= 7, l2 -= 7;
                    }
                    if (r2.have + d > r2.nlen + r2.ndist) {
                      e2.msg = "invalid bit length repeat", r2.mode = 30;
                      break;
                    }
                    for (; d--; ) r2.lens[r2.have++] = k;
                  }
                }
                if (30 === r2.mode) break;
                if (0 === r2.lens[256]) {
                  e2.msg = "invalid code -- missing end-of-block", r2.mode = 30;
                  break;
                }
                if (r2.lenbits = 9, S = { bits: r2.lenbits }, x = T(D, r2.lens, 0, r2.nlen, r2.lencode, 0, r2.work, S), r2.lenbits = S.bits, x) {
                  e2.msg = "invalid literal/lengths set", r2.mode = 30;
                  break;
                }
                if (r2.distbits = 6, r2.distcode = r2.distdyn, S = { bits: r2.distbits }, x = T(F, r2.lens, r2.nlen, r2.ndist, r2.distcode, 0, r2.work, S), r2.distbits = S.bits, x) {
                  e2.msg = "invalid distances set", r2.mode = 30;
                  break;
                }
                if (r2.mode = 20, 6 === t2) break e;
              case 20:
                r2.mode = 21;
              case 21:
                if (6 <= o2 && 258 <= h2) {
                  e2.next_out = a2, e2.avail_out = h2, e2.next_in = s2, e2.avail_in = o2, r2.hold = u2, r2.bits = l2, R(e2, c2), a2 = e2.next_out, i2 = e2.output, h2 = e2.avail_out, s2 = e2.next_in, n2 = e2.input, o2 = e2.avail_in, u2 = r2.hold, l2 = r2.bits, 12 === r2.mode && (r2.back = -1);
                  break;
                }
                for (r2.back = 0; g = (C = r2.lencode[u2 & (1 << r2.lenbits) - 1]) >>> 16 & 255, b = 65535 & C, !((_ = C >>> 24) <= l2); ) {
                  if (0 === o2) break e;
                  o2--, u2 += n2[s2++] << l2, l2 += 8;
                }
                if (g && 0 == (240 & g)) {
                  for (v = _, y = g, w = b; g = (C = r2.lencode[w + ((u2 & (1 << v + y) - 1) >> v)]) >>> 16 & 255, b = 65535 & C, !(v + (_ = C >>> 24) <= l2); ) {
                    if (0 === o2) break e;
                    o2--, u2 += n2[s2++] << l2, l2 += 8;
                  }
                  u2 >>>= v, l2 -= v, r2.back += v;
                }
                if (u2 >>>= _, l2 -= _, r2.back += _, r2.length = b, 0 === g) {
                  r2.mode = 26;
                  break;
                }
                if (32 & g) {
                  r2.back = -1, r2.mode = 12;
                  break;
                }
                if (64 & g) {
                  e2.msg = "invalid literal/length code", r2.mode = 30;
                  break;
                }
                r2.extra = 15 & g, r2.mode = 22;
              case 22:
                if (r2.extra) {
                  for (z = r2.extra; l2 < z; ) {
                    if (0 === o2) break e;
                    o2--, u2 += n2[s2++] << l2, l2 += 8;
                  }
                  r2.length += u2 & (1 << r2.extra) - 1, u2 >>>= r2.extra, l2 -= r2.extra, r2.back += r2.extra;
                }
                r2.was = r2.length, r2.mode = 23;
              case 23:
                for (; g = (C = r2.distcode[u2 & (1 << r2.distbits) - 1]) >>> 16 & 255, b = 65535 & C, !((_ = C >>> 24) <= l2); ) {
                  if (0 === o2) break e;
                  o2--, u2 += n2[s2++] << l2, l2 += 8;
                }
                if (0 == (240 & g)) {
                  for (v = _, y = g, w = b; g = (C = r2.distcode[w + ((u2 & (1 << v + y) - 1) >> v)]) >>> 16 & 255, b = 65535 & C, !(v + (_ = C >>> 24) <= l2); ) {
                    if (0 === o2) break e;
                    o2--, u2 += n2[s2++] << l2, l2 += 8;
                  }
                  u2 >>>= v, l2 -= v, r2.back += v;
                }
                if (u2 >>>= _, l2 -= _, r2.back += _, 64 & g) {
                  e2.msg = "invalid distance code", r2.mode = 30;
                  break;
                }
                r2.offset = b, r2.extra = 15 & g, r2.mode = 24;
              case 24:
                if (r2.extra) {
                  for (z = r2.extra; l2 < z; ) {
                    if (0 === o2) break e;
                    o2--, u2 += n2[s2++] << l2, l2 += 8;
                  }
                  r2.offset += u2 & (1 << r2.extra) - 1, u2 >>>= r2.extra, l2 -= r2.extra, r2.back += r2.extra;
                }
                if (r2.offset > r2.dmax) {
                  e2.msg = "invalid distance too far back", r2.mode = 30;
                  break;
                }
                r2.mode = 25;
              case 25:
                if (0 === h2) break e;
                if (d = c2 - h2, r2.offset > d) {
                  if ((d = r2.offset - d) > r2.whave && r2.sane) {
                    e2.msg = "invalid distance too far back", r2.mode = 30;
                    break;
                  }
                  p = d > r2.wnext ? (d -= r2.wnext, r2.wsize - d) : r2.wnext - d, d > r2.length && (d = r2.length), m = r2.window;
                } else m = i2, p = a2 - r2.offset, d = r2.length;
                for (h2 < d && (d = h2), h2 -= d, r2.length -= d; i2[a2++] = m[p++], --d; ) ;
                0 === r2.length && (r2.mode = 21);
                break;
              case 26:
                if (0 === h2) break e;
                i2[a2++] = r2.length, h2--, r2.mode = 21;
                break;
              case 27:
                if (r2.wrap) {
                  for (; l2 < 32; ) {
                    if (0 === o2) break e;
                    o2--, u2 |= n2[s2++] << l2, l2 += 8;
                  }
                  if (c2 -= h2, e2.total_out += c2, r2.total += c2, c2 && (e2.adler = r2.check = r2.flags ? B(r2.check, i2, c2, a2 - c2) : O(r2.check, i2, c2, a2 - c2)), c2 = h2, (r2.flags ? u2 : L(u2)) !== r2.check) {
                    e2.msg = "incorrect data check", r2.mode = 30;
                    break;
                  }
                  l2 = u2 = 0;
                }
                r2.mode = 28;
              case 28:
                if (r2.wrap && r2.flags) {
                  for (; l2 < 32; ) {
                    if (0 === o2) break e;
                    o2--, u2 += n2[s2++] << l2, l2 += 8;
                  }
                  if (u2 !== (4294967295 & r2.total)) {
                    e2.msg = "incorrect length check", r2.mode = 30;
                    break;
                  }
                  l2 = u2 = 0;
                }
                r2.mode = 29;
              case 29:
                x = 1;
                break e;
              case 30:
                x = -3;
                break e;
              case 31:
                return -4;
              case 32:
              default:
                return U;
            }
            return e2.next_out = a2, e2.avail_out = h2, e2.next_in = s2, e2.avail_in = o2, r2.hold = u2, r2.bits = l2, (r2.wsize || c2 !== e2.avail_out && r2.mode < 30 && (r2.mode < 27 || 4 !== t2)) && Z(e2, e2.output, e2.next_out, c2 - e2.avail_out) ? (r2.mode = 31, -4) : (f2 -= e2.avail_in, c2 -= e2.avail_out, e2.total_in += f2, e2.total_out += c2, r2.total += c2, r2.wrap && c2 && (e2.adler = r2.check = r2.flags ? B(r2.check, i2, c2, e2.next_out - c2) : O(r2.check, i2, c2, e2.next_out - c2)), e2.data_type = r2.bits + (r2.last ? 64 : 0) + (12 === r2.mode ? 128 : 0) + (20 === r2.mode || 15 === r2.mode ? 256 : 0), (0 == f2 && 0 === c2 || 4 === t2) && x === N && (x = -5), x);
          }, r.inflateEnd = function(e2) {
            if (!e2 || !e2.state) return U;
            var t2 = e2.state;
            return t2.window && (t2.window = null), e2.state = null, N;
          }, r.inflateGetHeader = function(e2, t2) {
            var r2;
            return e2 && e2.state ? 0 == (2 & (r2 = e2.state).wrap) ? U : ((r2.head = t2).done = false, N) : U;
          }, r.inflateSetDictionary = function(e2, t2) {
            var r2, n2 = t2.length;
            return e2 && e2.state ? 0 !== (r2 = e2.state).wrap && 11 !== r2.mode ? U : 11 === r2.mode && O(1, t2, n2, 0) !== r2.check ? -3 : Z(e2, t2, n2, n2) ? (r2.mode = 31, -4) : (r2.havedict = 1, N) : U;
          }, r.inflateInfo = "pako inflate (from Nodeca project)";
        }, { "../utils/common": 41, "./adler32": 43, "./crc32": 45, "./inffast": 48, "./inftrees": 50 }], 50: [function(e, t, r) {
          "use strict";
          var D = e("../utils/common"), F = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258, 0, 0], N = [16, 16, 16, 16, 16, 16, 16, 16, 17, 17, 17, 17, 18, 18, 18, 18, 19, 19, 19, 19, 20, 20, 20, 20, 21, 21, 21, 21, 16, 72, 78], U = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577, 0, 0], P = [16, 16, 16, 16, 17, 17, 18, 18, 19, 19, 20, 20, 21, 21, 22, 22, 23, 23, 24, 24, 25, 25, 26, 26, 27, 27, 28, 28, 29, 29, 64, 64];
          t.exports = function(e2, t2, r2, n, i, s, a, o) {
            var h, u, l, f, c, d, p, m, _, g = o.bits, b = 0, v = 0, y = 0, w = 0, k = 0, x = 0, S = 0, z = 0, C = 0, E = 0, A = null, I = 0, O = new D.Buf16(16), B = new D.Buf16(16), R = null, T = 0;
            for (b = 0; b <= 15; b++) O[b] = 0;
            for (v = 0; v < n; v++) O[t2[r2 + v]]++;
            for (k = g, w = 15; 1 <= w && 0 === O[w]; w--) ;
            if (w < k && (k = w), 0 === w) return i[s++] = 20971520, i[s++] = 20971520, o.bits = 1, 0;
            for (y = 1; y < w && 0 === O[y]; y++) ;
            for (k < y && (k = y), b = z = 1; b <= 15; b++) if (z <<= 1, (z -= O[b]) < 0) return -1;
            if (0 < z && (0 === e2 || 1 !== w)) return -1;
            for (B[1] = 0, b = 1; b < 15; b++) B[b + 1] = B[b] + O[b];
            for (v = 0; v < n; v++) 0 !== t2[r2 + v] && (a[B[t2[r2 + v]]++] = v);
            if (d = 0 === e2 ? (A = R = a, 19) : 1 === e2 ? (A = F, I -= 257, R = N, T -= 257, 256) : (A = U, R = P, -1), b = y, c = s, S = v = E = 0, l = -1, f = (C = 1 << (x = k)) - 1, 1 === e2 && 852 < C || 2 === e2 && 592 < C) return 1;
            for (; ; ) {
              for (p = b - S, _ = a[v] < d ? (m = 0, a[v]) : a[v] > d ? (m = R[T + a[v]], A[I + a[v]]) : (m = 96, 0), h = 1 << b - S, y = u = 1 << x; i[c + (E >> S) + (u -= h)] = p << 24 | m << 16 | _ | 0, 0 !== u; ) ;
              for (h = 1 << b - 1; E & h; ) h >>= 1;
              if (0 !== h ? (E &= h - 1, E += h) : E = 0, v++, 0 == --O[b]) {
                if (b === w) break;
                b = t2[r2 + a[v]];
              }
              if (k < b && (E & f) !== l) {
                for (0 === S && (S = k), c += y, z = 1 << (x = b - S); x + S < w && !((z -= O[x + S]) <= 0); ) x++, z <<= 1;
                if (C += 1 << x, 1 === e2 && 852 < C || 2 === e2 && 592 < C) return 1;
                i[l = E & f] = k << 24 | x << 16 | c - s | 0;
              }
            }
            return 0 !== E && (i[c + E] = b - S << 24 | 64 << 16 | 0), o.bits = k, 0;
          };
        }, { "../utils/common": 41 }], 51: [function(e, t, r) {
          "use strict";
          t.exports = { 2: "need dictionary", 1: "stream end", 0: "", "-1": "file error", "-2": "stream error", "-3": "data error", "-4": "insufficient memory", "-5": "buffer error", "-6": "incompatible version" };
        }, {}], 52: [function(e, t, r) {
          "use strict";
          var i = e("../utils/common"), o = 0, h = 1;
          function n(e2) {
            for (var t2 = e2.length; 0 <= --t2; ) e2[t2] = 0;
          }
          var s = 0, a = 29, u = 256, l = u + 1 + a, f = 30, c = 19, _ = 2 * l + 1, g = 15, d = 16, p = 7, m = 256, b = 16, v = 17, y = 18, w = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0], k = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13], x = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 3, 7], S = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15], z = new Array(2 * (l + 2));
          n(z);
          var C = new Array(2 * f);
          n(C);
          var E = new Array(512);
          n(E);
          var A = new Array(256);
          n(A);
          var I = new Array(a);
          n(I);
          var O, B, R, T = new Array(f);
          function D(e2, t2, r2, n2, i2) {
            this.static_tree = e2, this.extra_bits = t2, this.extra_base = r2, this.elems = n2, this.max_length = i2, this.has_stree = e2 && e2.length;
          }
          function F(e2, t2) {
            this.dyn_tree = e2, this.max_code = 0, this.stat_desc = t2;
          }
          function N(e2) {
            return e2 < 256 ? E[e2] : E[256 + (e2 >>> 7)];
          }
          function U(e2, t2) {
            e2.pending_buf[e2.pending++] = 255 & t2, e2.pending_buf[e2.pending++] = t2 >>> 8 & 255;
          }
          function P(e2, t2, r2) {
            e2.bi_valid > d - r2 ? (e2.bi_buf |= t2 << e2.bi_valid & 65535, U(e2, e2.bi_buf), e2.bi_buf = t2 >> d - e2.bi_valid, e2.bi_valid += r2 - d) : (e2.bi_buf |= t2 << e2.bi_valid & 65535, e2.bi_valid += r2);
          }
          function L(e2, t2, r2) {
            P(e2, r2[2 * t2], r2[2 * t2 + 1]);
          }
          function j(e2, t2) {
            for (var r2 = 0; r2 |= 1 & e2, e2 >>>= 1, r2 <<= 1, 0 < --t2; ) ;
            return r2 >>> 1;
          }
          function Z(e2, t2, r2) {
            var n2, i2, s2 = new Array(g + 1), a2 = 0;
            for (n2 = 1; n2 <= g; n2++) s2[n2] = a2 = a2 + r2[n2 - 1] << 1;
            for (i2 = 0; i2 <= t2; i2++) {
              var o2 = e2[2 * i2 + 1];
              0 !== o2 && (e2[2 * i2] = j(s2[o2]++, o2));
            }
          }
          function W(e2) {
            var t2;
            for (t2 = 0; t2 < l; t2++) e2.dyn_ltree[2 * t2] = 0;
            for (t2 = 0; t2 < f; t2++) e2.dyn_dtree[2 * t2] = 0;
            for (t2 = 0; t2 < c; t2++) e2.bl_tree[2 * t2] = 0;
            e2.dyn_ltree[2 * m] = 1, e2.opt_len = e2.static_len = 0, e2.last_lit = e2.matches = 0;
          }
          function M(e2) {
            8 < e2.bi_valid ? U(e2, e2.bi_buf) : 0 < e2.bi_valid && (e2.pending_buf[e2.pending++] = e2.bi_buf), e2.bi_buf = 0, e2.bi_valid = 0;
          }
          function H(e2, t2, r2, n2) {
            var i2 = 2 * t2, s2 = 2 * r2;
            return e2[i2] < e2[s2] || e2[i2] === e2[s2] && n2[t2] <= n2[r2];
          }
          function G(e2, t2, r2) {
            for (var n2 = e2.heap[r2], i2 = r2 << 1; i2 <= e2.heap_len && (i2 < e2.heap_len && H(t2, e2.heap[i2 + 1], e2.heap[i2], e2.depth) && i2++, !H(t2, n2, e2.heap[i2], e2.depth)); ) e2.heap[r2] = e2.heap[i2], r2 = i2, i2 <<= 1;
            e2.heap[r2] = n2;
          }
          function K(e2, t2, r2) {
            var n2, i2, s2, a2, o2 = 0;
            if (0 !== e2.last_lit) for (; n2 = e2.pending_buf[e2.d_buf + 2 * o2] << 8 | e2.pending_buf[e2.d_buf + 2 * o2 + 1], i2 = e2.pending_buf[e2.l_buf + o2], o2++, 0 === n2 ? L(e2, i2, t2) : (L(e2, (s2 = A[i2]) + u + 1, t2), 0 !== (a2 = w[s2]) && P(e2, i2 -= I[s2], a2), L(e2, s2 = N(--n2), r2), 0 !== (a2 = k[s2]) && P(e2, n2 -= T[s2], a2)), o2 < e2.last_lit; ) ;
            L(e2, m, t2);
          }
          function Y(e2, t2) {
            var r2, n2, i2, s2 = t2.dyn_tree, a2 = t2.stat_desc.static_tree, o2 = t2.stat_desc.has_stree, h2 = t2.stat_desc.elems, u2 = -1;
            for (e2.heap_len = 0, e2.heap_max = _, r2 = 0; r2 < h2; r2++) 0 !== s2[2 * r2] ? (e2.heap[++e2.heap_len] = u2 = r2, e2.depth[r2] = 0) : s2[2 * r2 + 1] = 0;
            for (; e2.heap_len < 2; ) s2[2 * (i2 = e2.heap[++e2.heap_len] = u2 < 2 ? ++u2 : 0)] = 1, e2.depth[i2] = 0, e2.opt_len--, o2 && (e2.static_len -= a2[2 * i2 + 1]);
            for (t2.max_code = u2, r2 = e2.heap_len >> 1; 1 <= r2; r2--) G(e2, s2, r2);
            for (i2 = h2; r2 = e2.heap[1], e2.heap[1] = e2.heap[e2.heap_len--], G(e2, s2, 1), n2 = e2.heap[1], e2.heap[--e2.heap_max] = r2, e2.heap[--e2.heap_max] = n2, s2[2 * i2] = s2[2 * r2] + s2[2 * n2], e2.depth[i2] = (e2.depth[r2] >= e2.depth[n2] ? e2.depth[r2] : e2.depth[n2]) + 1, s2[2 * r2 + 1] = s2[2 * n2 + 1] = i2, e2.heap[1] = i2++, G(e2, s2, 1), 2 <= e2.heap_len; ) ;
            e2.heap[--e2.heap_max] = e2.heap[1], (function(e3, t3) {
              var r3, n3, i3, s3, a3, o3, h3 = t3.dyn_tree, u3 = t3.max_code, l2 = t3.stat_desc.static_tree, f2 = t3.stat_desc.has_stree, c2 = t3.stat_desc.extra_bits, d2 = t3.stat_desc.extra_base, p2 = t3.stat_desc.max_length, m2 = 0;
              for (s3 = 0; s3 <= g; s3++) e3.bl_count[s3] = 0;
              for (h3[2 * e3.heap[e3.heap_max] + 1] = 0, r3 = e3.heap_max + 1; r3 < _; r3++) p2 < (s3 = h3[2 * h3[2 * (n3 = e3.heap[r3]) + 1] + 1] + 1) && (s3 = p2, m2++), h3[2 * n3 + 1] = s3, u3 < n3 || (e3.bl_count[s3]++, a3 = 0, d2 <= n3 && (a3 = c2[n3 - d2]), o3 = h3[2 * n3], e3.opt_len += o3 * (s3 + a3), f2 && (e3.static_len += o3 * (l2[2 * n3 + 1] + a3)));
              if (0 !== m2) {
                do {
                  for (s3 = p2 - 1; 0 === e3.bl_count[s3]; ) s3--;
                  e3.bl_count[s3]--, e3.bl_count[s3 + 1] += 2, e3.bl_count[p2]--, m2 -= 2;
                } while (0 < m2);
                for (s3 = p2; 0 !== s3; s3--) for (n3 = e3.bl_count[s3]; 0 !== n3; ) u3 < (i3 = e3.heap[--r3]) || (h3[2 * i3 + 1] !== s3 && (e3.opt_len += (s3 - h3[2 * i3 + 1]) * h3[2 * i3], h3[2 * i3 + 1] = s3), n3--);
              }
            })(e2, t2), Z(s2, u2, e2.bl_count);
          }
          function X(e2, t2, r2) {
            var n2, i2, s2 = -1, a2 = t2[1], o2 = 0, h2 = 7, u2 = 4;
            for (0 === a2 && (h2 = 138, u2 = 3), t2[2 * (r2 + 1) + 1] = 65535, n2 = 0; n2 <= r2; n2++) i2 = a2, a2 = t2[2 * (n2 + 1) + 1], ++o2 < h2 && i2 === a2 || (o2 < u2 ? e2.bl_tree[2 * i2] += o2 : 0 !== i2 ? (i2 !== s2 && e2.bl_tree[2 * i2]++, e2.bl_tree[2 * b]++) : o2 <= 10 ? e2.bl_tree[2 * v]++ : e2.bl_tree[2 * y]++, s2 = i2, u2 = (o2 = 0) === a2 ? (h2 = 138, 3) : i2 === a2 ? (h2 = 6, 3) : (h2 = 7, 4));
          }
          function V(e2, t2, r2) {
            var n2, i2, s2 = -1, a2 = t2[1], o2 = 0, h2 = 7, u2 = 4;
            for (0 === a2 && (h2 = 138, u2 = 3), n2 = 0; n2 <= r2; n2++) if (i2 = a2, a2 = t2[2 * (n2 + 1) + 1], !(++o2 < h2 && i2 === a2)) {
              if (o2 < u2) for (; L(e2, i2, e2.bl_tree), 0 != --o2; ) ;
              else 0 !== i2 ? (i2 !== s2 && (L(e2, i2, e2.bl_tree), o2--), L(e2, b, e2.bl_tree), P(e2, o2 - 3, 2)) : o2 <= 10 ? (L(e2, v, e2.bl_tree), P(e2, o2 - 3, 3)) : (L(e2, y, e2.bl_tree), P(e2, o2 - 11, 7));
              s2 = i2, u2 = (o2 = 0) === a2 ? (h2 = 138, 3) : i2 === a2 ? (h2 = 6, 3) : (h2 = 7, 4);
            }
          }
          n(T);
          var q = false;
          function J(e2, t2, r2, n2) {
            P(e2, (s << 1) + (n2 ? 1 : 0), 3), (function(e3, t3, r3, n3) {
              M(e3), n3 && (U(e3, r3), U(e3, ~r3)), i.arraySet(e3.pending_buf, e3.window, t3, r3, e3.pending), e3.pending += r3;
            })(e2, t2, r2, true);
          }
          r._tr_init = function(e2) {
            q || ((function() {
              var e3, t2, r2, n2, i2, s2 = new Array(g + 1);
              for (n2 = r2 = 0; n2 < a - 1; n2++) for (I[n2] = r2, e3 = 0; e3 < 1 << w[n2]; e3++) A[r2++] = n2;
              for (A[r2 - 1] = n2, n2 = i2 = 0; n2 < 16; n2++) for (T[n2] = i2, e3 = 0; e3 < 1 << k[n2]; e3++) E[i2++] = n2;
              for (i2 >>= 7; n2 < f; n2++) for (T[n2] = i2 << 7, e3 = 0; e3 < 1 << k[n2] - 7; e3++) E[256 + i2++] = n2;
              for (t2 = 0; t2 <= g; t2++) s2[t2] = 0;
              for (e3 = 0; e3 <= 143; ) z[2 * e3 + 1] = 8, e3++, s2[8]++;
              for (; e3 <= 255; ) z[2 * e3 + 1] = 9, e3++, s2[9]++;
              for (; e3 <= 279; ) z[2 * e3 + 1] = 7, e3++, s2[7]++;
              for (; e3 <= 287; ) z[2 * e3 + 1] = 8, e3++, s2[8]++;
              for (Z(z, l + 1, s2), e3 = 0; e3 < f; e3++) C[2 * e3 + 1] = 5, C[2 * e3] = j(e3, 5);
              O = new D(z, w, u + 1, l, g), B = new D(C, k, 0, f, g), R = new D(new Array(0), x, 0, c, p);
            })(), q = true), e2.l_desc = new F(e2.dyn_ltree, O), e2.d_desc = new F(e2.dyn_dtree, B), e2.bl_desc = new F(e2.bl_tree, R), e2.bi_buf = 0, e2.bi_valid = 0, W(e2);
          }, r._tr_stored_block = J, r._tr_flush_block = function(e2, t2, r2, n2) {
            var i2, s2, a2 = 0;
            0 < e2.level ? (2 === e2.strm.data_type && (e2.strm.data_type = (function(e3) {
              var t3, r3 = 4093624447;
              for (t3 = 0; t3 <= 31; t3++, r3 >>>= 1) if (1 & r3 && 0 !== e3.dyn_ltree[2 * t3]) return o;
              if (0 !== e3.dyn_ltree[18] || 0 !== e3.dyn_ltree[20] || 0 !== e3.dyn_ltree[26]) return h;
              for (t3 = 32; t3 < u; t3++) if (0 !== e3.dyn_ltree[2 * t3]) return h;
              return o;
            })(e2)), Y(e2, e2.l_desc), Y(e2, e2.d_desc), a2 = (function(e3) {
              var t3;
              for (X(e3, e3.dyn_ltree, e3.l_desc.max_code), X(e3, e3.dyn_dtree, e3.d_desc.max_code), Y(e3, e3.bl_desc), t3 = c - 1; 3 <= t3 && 0 === e3.bl_tree[2 * S[t3] + 1]; t3--) ;
              return e3.opt_len += 3 * (t3 + 1) + 5 + 5 + 4, t3;
            })(e2), i2 = e2.opt_len + 3 + 7 >>> 3, (s2 = e2.static_len + 3 + 7 >>> 3) <= i2 && (i2 = s2)) : i2 = s2 = r2 + 5, r2 + 4 <= i2 && -1 !== t2 ? J(e2, t2, r2, n2) : 4 === e2.strategy || s2 === i2 ? (P(e2, 2 + (n2 ? 1 : 0), 3), K(e2, z, C)) : (P(e2, 4 + (n2 ? 1 : 0), 3), (function(e3, t3, r3, n3) {
              var i3;
              for (P(e3, t3 - 257, 5), P(e3, r3 - 1, 5), P(e3, n3 - 4, 4), i3 = 0; i3 < n3; i3++) P(e3, e3.bl_tree[2 * S[i3] + 1], 3);
              V(e3, e3.dyn_ltree, t3 - 1), V(e3, e3.dyn_dtree, r3 - 1);
            })(e2, e2.l_desc.max_code + 1, e2.d_desc.max_code + 1, a2 + 1), K(e2, e2.dyn_ltree, e2.dyn_dtree)), W(e2), n2 && M(e2);
          }, r._tr_tally = function(e2, t2, r2) {
            return e2.pending_buf[e2.d_buf + 2 * e2.last_lit] = t2 >>> 8 & 255, e2.pending_buf[e2.d_buf + 2 * e2.last_lit + 1] = 255 & t2, e2.pending_buf[e2.l_buf + e2.last_lit] = 255 & r2, e2.last_lit++, 0 === t2 ? e2.dyn_ltree[2 * r2]++ : (e2.matches++, t2--, e2.dyn_ltree[2 * (A[r2] + u + 1)]++, e2.dyn_dtree[2 * N(t2)]++), e2.last_lit === e2.lit_bufsize - 1;
          }, r._tr_align = function(e2) {
            P(e2, 2, 3), L(e2, m, z), (function(e3) {
              16 === e3.bi_valid ? (U(e3, e3.bi_buf), e3.bi_buf = 0, e3.bi_valid = 0) : 8 <= e3.bi_valid && (e3.pending_buf[e3.pending++] = 255 & e3.bi_buf, e3.bi_buf >>= 8, e3.bi_valid -= 8);
            })(e2);
          };
        }, { "../utils/common": 41 }], 53: [function(e, t, r) {
          "use strict";
          t.exports = function() {
            this.input = null, this.next_in = 0, this.avail_in = 0, this.total_in = 0, this.output = null, this.next_out = 0, this.avail_out = 0, this.total_out = 0, this.msg = "", this.state = null, this.data_type = 2, this.adler = 0;
          };
        }, {}], 54: [function(e, t, r) {
          (function(e2) {
            !(function(r2, n) {
              "use strict";
              if (!r2.setImmediate) {
                var i, s, t2, a, o = 1, h = {}, u = false, l = r2.document, e3 = Object.getPrototypeOf && Object.getPrototypeOf(r2);
                e3 = e3 && e3.setTimeout ? e3 : r2, i = "[object process]" === {}.toString.call(r2.process) ? function(e4) {
                  process.nextTick(function() {
                    c(e4);
                  });
                } : (function() {
                  if (r2.postMessage && !r2.importScripts) {
                    var e4 = true, t3 = r2.onmessage;
                    return r2.onmessage = function() {
                      e4 = false;
                    }, r2.postMessage("", "*"), r2.onmessage = t3, e4;
                  }
                })() ? (a = "setImmediate$" + Math.random() + "$", r2.addEventListener ? r2.addEventListener("message", d, false) : r2.attachEvent("onmessage", d), function(e4) {
                  r2.postMessage(a + e4, "*");
                }) : r2.MessageChannel ? ((t2 = new MessageChannel()).port1.onmessage = function(e4) {
                  c(e4.data);
                }, function(e4) {
                  t2.port2.postMessage(e4);
                }) : l && "onreadystatechange" in l.createElement("script") ? (s = l.documentElement, function(e4) {
                  var t3 = l.createElement("script");
                  t3.onreadystatechange = function() {
                    c(e4), t3.onreadystatechange = null, s.removeChild(t3), t3 = null;
                  }, s.appendChild(t3);
                }) : function(e4) {
                  setTimeout(c, 0, e4);
                }, e3.setImmediate = function(e4) {
                  "function" != typeof e4 && (e4 = new Function("" + e4));
                  for (var t3 = new Array(arguments.length - 1), r3 = 0; r3 < t3.length; r3++) t3[r3] = arguments[r3 + 1];
                  var n2 = { callback: e4, args: t3 };
                  return h[o] = n2, i(o), o++;
                }, e3.clearImmediate = f;
              }
              function f(e4) {
                delete h[e4];
              }
              function c(e4) {
                if (u) setTimeout(c, 0, e4);
                else {
                  var t3 = h[e4];
                  if (t3) {
                    u = true;
                    try {
                      !(function(e5) {
                        var t4 = e5.callback, r3 = e5.args;
                        switch (r3.length) {
                          case 0:
                            t4();
                            break;
                          case 1:
                            t4(r3[0]);
                            break;
                          case 2:
                            t4(r3[0], r3[1]);
                            break;
                          case 3:
                            t4(r3[0], r3[1], r3[2]);
                            break;
                          default:
                            t4.apply(n, r3);
                        }
                      })(t3);
                    } finally {
                      f(e4), u = false;
                    }
                  }
                }
              }
              function d(e4) {
                e4.source === r2 && "string" == typeof e4.data && 0 === e4.data.indexOf(a) && c(+e4.data.slice(a.length));
              }
            })("undefined" == typeof self ? void 0 === e2 ? this : e2 : self);
          }).call(this, "undefined" != typeof global ? global : "undefined" != typeof self ? self : "undefined" != typeof window ? window : {});
        }, {}] }, {}, [10])(10);
      });
    }
  });

  // src/lib/zk/errors.ts
  var ZkCryptoError = class _ZkCryptoError extends Error {
    code;
    constructor(code, message) {
      super(message);
      this.name = "ZkCryptoError";
      this.code = code;
      Object.setPrototypeOf(this, _ZkCryptoError.prototype);
    }
  };

  // src/lib/zk/zeroize.ts
  function zeroize(...buffers) {
    for (const buf of buffers) {
      if (!buf) continue;
      if (buf instanceof BigUint64Array) {
        buf.fill(0n);
      } else if (buf instanceof Uint8Array || buf instanceof Uint32Array || buf instanceof Int32Array) {
        buf.fill(0);
      } else if (buf instanceof ArrayBuffer) {
        new Uint8Array(buf).fill(0);
      }
    }
  }
  function constantTimeEqual(a, b) {
    if (a.byteLength !== b.byteLength) {
      return false;
    }
    let diff = 0;
    for (let i = 0; i < a.byteLength; i++) {
      diff |= a[i] ^ b[i];
    }
    return diff === 0;
  }
  function utf8Encode(text) {
    return new TextEncoder().encode(text);
  }
  function utf8Decode(bytes) {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  }
  function normalizePassphraseNfc(passphrase) {
    return utf8Encode(passphrase.normalize("NFC"));
  }
  function toHex(bytes) {
    let out = "";
    for (let i = 0; i < bytes.byteLength; i++) {
      out += bytes[i].toString(16).padStart(2, "0");
    }
    return out;
  }
  function fromHex(hexStr) {
    if (hexStr.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(hexStr)) {
      throw new ZkCryptoError("INVALID_PARAMETER" /* INVALID_PARAMETER */, "Invalid hexadecimal string.");
    }
    const out = new Uint8Array(hexStr.length / 2);
    for (let i = 0; i < out.byteLength; i++) {
      out[i] = parseInt(hexStr.slice(i * 2, i * 2 + 2), 16);
    }
    return out;
  }
  function toBase64Url(bytes) {
    if (typeof Buffer !== "undefined") {
      return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("base64url");
    }
    let binary = "";
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  function fromBase64Url(b64u) {
    if (!/^[A-Za-z0-9\-_]*$/.test(b64u)) {
      throw new ZkCryptoError("INVALID_PARAMETER" /* INVALID_PARAMETER */, "Invalid base64url string.");
    }
    if (typeof Buffer !== "undefined") {
      return new Uint8Array(Buffer.from(b64u, "base64url"));
    }
    const padded = b64u.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((b64u.length + 3) % 4);
    const binary = atob(padded);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      out[i] = binary.charCodeAt(i);
    }
    return out;
  }
  var UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  function uuidToBytes(uuid) {
    if (!UUID_REGEX.test(uuid)) {
      throw new ZkCryptoError("INVALID_PARAMETER" /* INVALID_PARAMETER */, "Invalid canonical UUID string.");
    }
    return fromHex(uuid.replace(/-/g, "").toLowerCase());
  }
  function bytesToUuid(bytes) {
    if (bytes.byteLength !== 16) {
      throw new ZkCryptoError("INVALID_PARAMETER" /* INVALID_PARAMETER */, "UUID binary representation must be 16 bytes.");
    }
    const h = toHex(bytes);
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
  }
  function concatBytes(...arrays) {
    let total = 0;
    for (const a of arrays) total += a.byteLength;
    const out = new Uint8Array(total);
    let offset = 0;
    for (const a of arrays) {
      out.set(a, offset);
      offset += a.byteLength;
    }
    return out;
  }

  // src/lib/zk/provider.ts
  var SHA256_K = new Uint32Array([
    1116352408,
    1899447441,
    3049323471,
    3921009573,
    961987163,
    1508970993,
    2453635748,
    2870763221,
    3624381080,
    310598401,
    607225278,
    1426881987,
    1925078388,
    2162078206,
    2614888103,
    3248222580,
    3835390401,
    4022224774,
    264347078,
    604807628,
    770255983,
    1249150122,
    1555081692,
    1996064986,
    2554220882,
    2821834349,
    2952996808,
    3210313671,
    3336571891,
    3584528711,
    113926993,
    338241895,
    666307205,
    773529912,
    1294757372,
    1396182291,
    1695183700,
    1986661051,
    2177026350,
    2456956037,
    2730485921,
    2820302411,
    3259730800,
    3345764771,
    3516065817,
    3600352804,
    4094571909,
    275423344,
    430227734,
    506948616,
    659060556,
    883997877,
    958139571,
    1322822218,
    1537002063,
    1747873779,
    1955562222,
    2024104815,
    2227730452,
    2361852424,
    2428436474,
    2756734187,
    3204031479,
    3329325298
  ]);
  var IncrementalSha256 = class {
    state = new Uint32Array([
      1779033703,
      3144134277,
      1013904242,
      2773480762,
      1359893119,
      2600822924,
      528734635,
      1541459225
    ]);
    block = new Uint8Array(64);
    w = new Uint32Array(64);
    blockLen = 0;
    totalBytes = 0;
    finalized = false;
    update(chunk) {
      if (this.finalized) {
        throw new ZkCryptoError("INVALID_PARAMETER" /* INVALID_PARAMETER */, "Digest already finalized.");
      }
      let offset = 0;
      let remaining = chunk.byteLength;
      this.totalBytes += remaining;
      if (this.blockLen > 0 && this.blockLen + remaining >= 64) {
        const take = 64 - this.blockLen;
        this.block.set(chunk.subarray(0, take), this.blockLen);
        this.compressBlock(this.block, 0);
        this.blockLen = 0;
        offset += take;
        remaining -= take;
      }
      while (remaining >= 64) {
        this.compressBlock(chunk, offset);
        offset += 64;
        remaining -= 64;
      }
      if (remaining > 0) {
        this.block.set(chunk.subarray(offset, offset + remaining), this.blockLen);
        this.blockLen += remaining;
      }
    }
    digest() {
      if (this.finalized) {
        throw new ZkCryptoError("INVALID_PARAMETER" /* INVALID_PARAMETER */, "Digest already finalized.");
      }
      this.finalized = true;
      this.block[this.blockLen++] = 128;
      if (this.blockLen > 56) {
        this.block.fill(0, this.blockLen, 64);
        this.compressBlock(this.block, 0);
        this.blockLen = 0;
      }
      this.block.fill(0, this.blockLen, 56);
      const totalBits = BigInt(this.totalBytes) * 8n;
      const view = new DataView(this.block.buffer, this.block.byteOffset, 64);
      view.setBigUint64(56, totalBits, false);
      this.compressBlock(this.block, 0);
      const out = new Uint8Array(32);
      const outView = new DataView(out.buffer);
      for (let i = 0; i < 8; i++) {
        outView.setUint32(i * 4, this.state[i], false);
      }
      zeroize(this.block, this.w, this.state);
      return out;
    }
    compressBlock(buf, offset) {
      const w = this.w;
      for (let i = 0; i < 16; i++) {
        const j = offset + i * 4;
        w[i] = (buf[j] << 24 | buf[j + 1] << 16 | buf[j + 2] << 8 | buf[j + 3]) >>> 0;
      }
      for (let i = 16; i < 64; i++) {
        const v1 = w[i - 15];
        const s0 = ((v1 >>> 7 | v1 << 25) ^ (v1 >>> 18 | v1 << 14) ^ v1 >>> 3) >>> 0;
        const v2 = w[i - 2];
        const s1 = ((v2 >>> 17 | v2 << 15) ^ (v2 >>> 19 | v2 << 13) ^ v2 >>> 10) >>> 0;
        w[i] = w[i - 16] + s0 + w[i - 7] + s1 >>> 0;
      }
      let a = this.state[0];
      let b = this.state[1];
      let c = this.state[2];
      let d = this.state[3];
      let e = this.state[4];
      let f = this.state[5];
      let g = this.state[6];
      let h = this.state[7];
      for (let i = 0; i < 64; i++) {
        const S1 = ((e >>> 6 | e << 26) ^ (e >>> 11 | e << 21) ^ (e >>> 25 | e << 7)) >>> 0;
        const ch = (e & f ^ ~e & g) >>> 0;
        const temp1 = h + S1 + ch + SHA256_K[i] + w[i] >>> 0;
        const S0 = ((a >>> 2 | a << 30) ^ (a >>> 13 | a << 19) ^ (a >>> 22 | a << 10)) >>> 0;
        const maj = (a & b ^ a & c ^ b & c) >>> 0;
        const temp2 = S0 + maj >>> 0;
        h = g;
        g = f;
        f = e;
        e = d + temp1 >>> 0;
        d = c;
        c = b;
        b = a;
        a = temp1 + temp2 >>> 0;
      }
      this.state[0] = this.state[0] + a >>> 0;
      this.state[1] = this.state[1] + b >>> 0;
      this.state[2] = this.state[2] + c >>> 0;
      this.state[3] = this.state[3] + d >>> 0;
      this.state[4] = this.state[4] + e >>> 0;
      this.state[5] = this.state[5] + f >>> 0;
      this.state[6] = this.state[6] + g >>> 0;
      this.state[7] = this.state[7] + h >>> 0;
    }
  };
  var IncrementalHmacSha256 = class {
    inner = new IncrementalSha256();
    outerKeyPad = new Uint8Array(64);
    finalized = false;
    constructor(key) {
      const normalizedKey = new Uint8Array(64);
      if (key.byteLength > 64) {
        const hashed = new IncrementalSha256();
        hashed.update(key);
        const d = hashed.digest();
        normalizedKey.set(d, 0);
        zeroize(d);
      } else {
        normalizedKey.set(key, 0);
      }
      const innerKeyPad = new Uint8Array(64);
      for (let i = 0; i < 64; i++) {
        innerKeyPad[i] = normalizedKey[i] ^ 54;
        this.outerKeyPad[i] = normalizedKey[i] ^ 92;
      }
      this.inner.update(innerKeyPad);
      zeroize(normalizedKey, innerKeyPad);
    }
    update(chunk) {
      if (this.finalized) {
        throw new ZkCryptoError("INVALID_PARAMETER" /* INVALID_PARAMETER */, "HMAC already finalized.");
      }
      this.inner.update(chunk);
    }
    digest() {
      if (this.finalized) {
        throw new ZkCryptoError("INVALID_PARAMETER" /* INVALID_PARAMETER */, "HMAC already finalized.");
      }
      this.finalized = true;
      const innerDigest = this.inner.digest();
      const outer = new IncrementalSha256();
      outer.update(this.outerKeyPad);
      outer.update(innerDigest);
      const result = outer.digest();
      zeroize(innerDigest, this.outerKeyPad);
      return result;
    }
  };
  function toBufferSource(u8) {
    return new Uint8Array(u8.buffer, u8.byteOffset, u8.byteLength);
  }
  var WebCryptoProvider = class {
    get subtle() {
      if (!globalThis.crypto || !globalThis.crypto.subtle) {
        throw new ZkCryptoError("INVALID_PARAMETER" /* INVALID_PARAMETER */, "WebCrypto SubtleCrypto is unavailable.");
      }
      return globalThis.crypto.subtle;
    }
    randomBytes(length) {
      if (!Number.isInteger(length) || length < 0) {
        throw new ZkCryptoError("INVALID_PARAMETER" /* INVALID_PARAMETER */, "Invalid randomBytes length.");
      }
      const out = new Uint8Array(length);
      let offset = 0;
      while (offset < length) {
        const sliceLen = Math.min(65536, length - offset);
        globalThis.crypto.getRandomValues(out.subarray(offset, offset + sliceLen));
        offset += sliceLen;
      }
      return out;
    }
    async sha256(data) {
      const buf = await this.subtle.digest("SHA-256", toBufferSource(data));
      return new Uint8Array(buf);
    }
    createSha256Stream() {
      return new IncrementalSha256();
    }
    async hmacSha256(key, data) {
      if (key.byteLength === 0) {
        const mac = this.createHmacSha256Stream(key);
        mac.update(data);
        return mac.digest();
      }
      const cryptoKey = await this.subtle.importKey(
        "raw",
        toBufferSource(key),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"]
      );
      const sig = await this.subtle.sign("HMAC", cryptoKey, toBufferSource(data));
      return new Uint8Array(sig);
    }
    createHmacSha256Stream(key) {
      return new IncrementalHmacSha256(key);
    }
    async hkdfSha256(ikm, salt, info, length) {
      if (length <= 0 || length > 255 * 32) {
        throw new ZkCryptoError("INVALID_PARAMETER" /* INVALID_PARAMETER */, "Invalid HKDF output length.");
      }
      const actualSalt = salt.byteLength > 0 ? salt : new Uint8Array(32);
      const prk = await this.hmacSha256(actualSalt, ikm);
      const okm = new Uint8Array(length);
      let t = new Uint8Array(0);
      let offset = 0;
      let counter = 1;
      try {
        while (offset < length) {
          const input = concatBytes(t, info, new Uint8Array([counter]));
          zeroize(t);
          t = await this.hmacSha256(prk, input);
          zeroize(input);
          const take = Math.min(t.byteLength, length - offset);
          okm.set(t.subarray(0, take), offset);
          offset += take;
          counter++;
        }
        return okm;
      } finally {
        zeroize(prk, t);
      }
    }
    async aes256GcmEncrypt(key, nonce, plaintext, aad) {
      if (key.byteLength !== 32) {
        throw new ZkCryptoError("INVALID_PARAMETER" /* INVALID_PARAMETER */, "AES-256-GCM requires a 32-byte key.");
      }
      if (nonce.byteLength !== 12) {
        throw new ZkCryptoError("INVALID_PARAMETER" /* INVALID_PARAMETER */, "AES-256-GCM requires a 12-byte nonce.");
      }
      const cryptoKey = await this.subtle.importKey(
        "raw",
        toBufferSource(key),
        { name: "AES-GCM" },
        false,
        ["encrypt"]
      );
      const ctWithTag = await this.subtle.encrypt(
        {
          name: "AES-GCM",
          iv: toBufferSource(nonce),
          additionalData: toBufferSource(aad),
          tagLength: 128
        },
        cryptoKey,
        toBufferSource(plaintext)
      );
      return new Uint8Array(ctWithTag);
    }
    async aes256GcmDecrypt(key, nonce, ciphertextWithTag, aad, errorCodeOnFail = "AUTH_TAG_MISMATCH" /* AUTH_TAG_MISMATCH */) {
      if (key.byteLength !== 32) {
        throw new ZkCryptoError("INVALID_PARAMETER" /* INVALID_PARAMETER */, "AES-256-GCM requires a 32-byte key.");
      }
      if (nonce.byteLength !== 12) {
        throw new ZkCryptoError("INVALID_PARAMETER" /* INVALID_PARAMETER */, "AES-256-GCM requires a 12-byte nonce.");
      }
      if (ciphertextWithTag.byteLength < 16) {
        throw new ZkCryptoError(errorCodeOnFail, "Ciphertext shorter than 16-byte GCM authentication tag.");
      }
      const cryptoKey = await this.subtle.importKey(
        "raw",
        toBufferSource(key),
        { name: "AES-GCM" },
        false,
        ["decrypt"]
      );
      try {
        const pt = await this.subtle.decrypt(
          {
            name: "AES-GCM",
            iv: toBufferSource(nonce),
            additionalData: toBufferSource(aad),
            tagLength: 128
          },
          cryptoKey,
          toBufferSource(ciphertextWithTag)
        );
        return new Uint8Array(pt);
      } catch {
        throw new ZkCryptoError(
          errorCodeOnFail,
          errorCodeOnFail === "WRONG_KEY_OR_PASSPHRASE" /* WRONG_KEY_OR_PASSPHRASE */ ? "Failed to unwrap key: invalid passphrase, key, or context AAD." : "AES-256-GCM authentication tag verification failed."
        );
      }
    }
  };
  var defaultCryptoProvider = new WebCryptoProvider();

  // node_modules/hash-wasm/dist/index.esm.js
  function __awaiter(thisArg, _arguments, P, generator) {
    function adopt(value) {
      return value instanceof P ? value : new P(function(resolve) {
        resolve(value);
      });
    }
    return new (P || (P = Promise))(function(resolve, reject) {
      function fulfilled(value) {
        try {
          step(generator.next(value));
        } catch (e) {
          reject(e);
        }
      }
      function rejected(value) {
        try {
          step(generator["throw"](value));
        } catch (e) {
          reject(e);
        }
      }
      function step(result) {
        result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected);
      }
      step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
  }
  var Mutex = class {
    constructor() {
      this.mutex = Promise.resolve();
    }
    lock() {
      let begin = () => {
      };
      this.mutex = this.mutex.then(() => new Promise(begin));
      return new Promise((res) => {
        begin = res;
      });
    }
    dispatch(fn) {
      return __awaiter(this, void 0, void 0, function* () {
        const unlock = yield this.lock();
        try {
          return yield Promise.resolve(fn());
        } finally {
          unlock();
        }
      });
    }
  };
  var _a;
  function getGlobal() {
    if (typeof globalThis !== "undefined")
      return globalThis;
    if (typeof self !== "undefined")
      return self;
    if (typeof window !== "undefined")
      return window;
    return global;
  }
  var globalObject = getGlobal();
  var nodeBuffer = (_a = globalObject.Buffer) !== null && _a !== void 0 ? _a : null;
  var textEncoder = globalObject.TextEncoder ? new globalObject.TextEncoder() : null;
  function hexCharCodesToInt(a, b) {
    return (a & 15) + (a >> 6 | a >> 3 & 8) << 4 | (b & 15) + (b >> 6 | b >> 3 & 8);
  }
  function writeHexToUInt8(buf, str) {
    const size = str.length >> 1;
    for (let i = 0; i < size; i++) {
      const index = i << 1;
      buf[i] = hexCharCodesToInt(str.charCodeAt(index), str.charCodeAt(index + 1));
    }
  }
  function hexStringEqualsUInt8(str, buf) {
    if (str.length !== buf.length * 2) {
      return false;
    }
    for (let i = 0; i < buf.length; i++) {
      const strIndex = i << 1;
      if (buf[i] !== hexCharCodesToInt(str.charCodeAt(strIndex), str.charCodeAt(strIndex + 1))) {
        return false;
      }
    }
    return true;
  }
  var alpha = "a".charCodeAt(0) - 10;
  var digit = "0".charCodeAt(0);
  function getDigestHex(tmpBuffer, input, hashLength) {
    let p = 0;
    for (let i = 0; i < hashLength; i++) {
      let nibble = input[i] >>> 4;
      tmpBuffer[p++] = nibble > 9 ? nibble + alpha : nibble + digit;
      nibble = input[i] & 15;
      tmpBuffer[p++] = nibble > 9 ? nibble + alpha : nibble + digit;
    }
    return String.fromCharCode.apply(null, tmpBuffer);
  }
  var getUInt8Buffer = nodeBuffer !== null ? (data) => {
    if (typeof data === "string") {
      const buf = nodeBuffer.from(data, "utf8");
      return new Uint8Array(buf.buffer, buf.byteOffset, buf.length);
    }
    if (nodeBuffer.isBuffer(data)) {
      return new Uint8Array(data.buffer, data.byteOffset, data.length);
    }
    if (ArrayBuffer.isView(data)) {
      return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    }
    throw new Error("Invalid data type!");
  } : (data) => {
    if (typeof data === "string") {
      return textEncoder.encode(data);
    }
    if (ArrayBuffer.isView(data)) {
      return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    }
    throw new Error("Invalid data type!");
  };
  var base64Chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  var base64Lookup = new Uint8Array(256);
  for (let i = 0; i < base64Chars.length; i++) {
    base64Lookup[base64Chars.charCodeAt(i)] = i;
  }
  function encodeBase64(data, pad = true) {
    const len = data.length;
    const extraBytes = len % 3;
    const parts = [];
    const len2 = len - extraBytes;
    for (let i = 0; i < len2; i += 3) {
      const tmp = (data[i] << 16 & 16711680) + (data[i + 1] << 8 & 65280) + (data[i + 2] & 255);
      const triplet = base64Chars.charAt(tmp >> 18 & 63) + base64Chars.charAt(tmp >> 12 & 63) + base64Chars.charAt(tmp >> 6 & 63) + base64Chars.charAt(tmp & 63);
      parts.push(triplet);
    }
    if (extraBytes === 1) {
      const tmp = data[len - 1];
      const a = base64Chars.charAt(tmp >> 2);
      const b = base64Chars.charAt(tmp << 4 & 63);
      parts.push(`${a}${b}`);
      if (pad) {
        parts.push("==");
      }
    } else if (extraBytes === 2) {
      const tmp = (data[len - 2] << 8) + data[len - 1];
      const a = base64Chars.charAt(tmp >> 10);
      const b = base64Chars.charAt(tmp >> 4 & 63);
      const c = base64Chars.charAt(tmp << 2 & 63);
      parts.push(`${a}${b}${c}`);
      if (pad) {
        parts.push("=");
      }
    }
    return parts.join("");
  }
  function getDecodeBase64Length(data) {
    let bufferLength = Math.floor(data.length * 0.75);
    const len = data.length;
    if (data[len - 1] === "=") {
      bufferLength -= 1;
      if (data[len - 2] === "=") {
        bufferLength -= 1;
      }
    }
    return bufferLength;
  }
  function decodeBase64(data) {
    const bufferLength = getDecodeBase64Length(data);
    const len = data.length;
    const bytes = new Uint8Array(bufferLength);
    let p = 0;
    for (let i = 0; i < len; i += 4) {
      const encoded1 = base64Lookup[data.charCodeAt(i)];
      const encoded2 = base64Lookup[data.charCodeAt(i + 1)];
      const encoded3 = base64Lookup[data.charCodeAt(i + 2)];
      const encoded4 = base64Lookup[data.charCodeAt(i + 3)];
      bytes[p] = encoded1 << 2 | encoded2 >> 4;
      p += 1;
      bytes[p] = (encoded2 & 15) << 4 | encoded3 >> 2;
      p += 1;
      bytes[p] = (encoded3 & 3) << 6 | encoded4 & 63;
      p += 1;
    }
    return bytes;
  }
  var MAX_HEAP = 16 * 1024;
  var WASM_FUNC_HASH_LENGTH = 4;
  var wasmMutex = new Mutex();
  var wasmModuleCache = /* @__PURE__ */ new Map();
  function WASMInterface(binary, hashLength) {
    return __awaiter(this, void 0, void 0, function* () {
      let wasmInstance = null;
      let memoryView = null;
      let initialized = false;
      if (typeof WebAssembly === "undefined") {
        throw new Error("WebAssembly is not supported in this environment!");
      }
      const writeMemory = (data, offset = 0) => {
        memoryView.set(data, offset);
      };
      const getMemory = () => memoryView;
      const getExports = () => wasmInstance.exports;
      const setMemorySize = (totalSize) => {
        wasmInstance.exports.Hash_SetMemorySize(totalSize);
        const arrayOffset = wasmInstance.exports.Hash_GetBuffer();
        const memoryBuffer = wasmInstance.exports.memory.buffer;
        memoryView = new Uint8Array(memoryBuffer, arrayOffset, totalSize);
      };
      const getStateSize = () => {
        const view = new DataView(wasmInstance.exports.memory.buffer);
        const stateSize = view.getUint32(wasmInstance.exports.STATE_SIZE, true);
        return stateSize;
      };
      const loadWASMPromise = wasmMutex.dispatch(() => __awaiter(this, void 0, void 0, function* () {
        if (!wasmModuleCache.has(binary.name)) {
          const asm = decodeBase64(binary.data);
          const promise = WebAssembly.compile(asm);
          wasmModuleCache.set(binary.name, promise);
        }
        const module = yield wasmModuleCache.get(binary.name);
        wasmInstance = yield WebAssembly.instantiate(module, {
          // env: {
          //   emscripten_memcpy_big: (dest, src, num) => {
          //     const memoryBuffer = wasmInstance.exports.memory.buffer;
          //     const memView = new Uint8Array(memoryBuffer, 0);
          //     memView.set(memView.subarray(src, src + num), dest);
          //   },
          //   print_memory: (offset, len) => {
          //     const memoryBuffer = wasmInstance.exports.memory.buffer;
          //     const memView = new Uint8Array(memoryBuffer, 0);
          //     console.log('print_int32', memView.subarray(offset, offset + len));
          //   },
          // },
        });
      }));
      const setupInterface = () => __awaiter(this, void 0, void 0, function* () {
        if (!wasmInstance) {
          yield loadWASMPromise;
        }
        const arrayOffset = wasmInstance.exports.Hash_GetBuffer();
        const memoryBuffer = wasmInstance.exports.memory.buffer;
        memoryView = new Uint8Array(memoryBuffer, arrayOffset, MAX_HEAP);
      });
      const init = (bits = null) => {
        initialized = true;
        wasmInstance.exports.Hash_Init(bits);
      };
      const updateUInt8Array = (data) => {
        let read = 0;
        while (read < data.length) {
          const chunk = data.subarray(read, read + MAX_HEAP);
          read += chunk.length;
          memoryView.set(chunk);
          wasmInstance.exports.Hash_Update(chunk.length);
        }
      };
      const update = (data) => {
        if (!initialized) {
          throw new Error("update() called before init()");
        }
        const Uint8Buffer = getUInt8Buffer(data);
        updateUInt8Array(Uint8Buffer);
      };
      const digestChars = new Uint8Array(hashLength * 2);
      const digest = (outputType, padding = null) => {
        if (!initialized) {
          throw new Error("digest() called before init()");
        }
        initialized = false;
        wasmInstance.exports.Hash_Final(padding);
        if (outputType === "binary") {
          return memoryView.slice(0, hashLength);
        }
        return getDigestHex(digestChars, memoryView, hashLength);
      };
      const save = () => {
        if (!initialized) {
          throw new Error("save() can only be called after init() and before digest()");
        }
        const stateOffset = wasmInstance.exports.Hash_GetState();
        const stateLength = getStateSize();
        const memoryBuffer = wasmInstance.exports.memory.buffer;
        const internalState = new Uint8Array(memoryBuffer, stateOffset, stateLength);
        const prefixedState = new Uint8Array(WASM_FUNC_HASH_LENGTH + stateLength);
        writeHexToUInt8(prefixedState, binary.hash);
        prefixedState.set(internalState, WASM_FUNC_HASH_LENGTH);
        return prefixedState;
      };
      const load = (state) => {
        if (!(state instanceof Uint8Array)) {
          throw new Error("load() expects an Uint8Array generated by save()");
        }
        const stateOffset = wasmInstance.exports.Hash_GetState();
        const stateLength = getStateSize();
        const overallLength = WASM_FUNC_HASH_LENGTH + stateLength;
        const memoryBuffer = wasmInstance.exports.memory.buffer;
        if (state.length !== overallLength) {
          throw new Error(`Bad state length (expected ${overallLength} bytes, got ${state.length})`);
        }
        if (!hexStringEqualsUInt8(binary.hash, state.subarray(0, WASM_FUNC_HASH_LENGTH))) {
          throw new Error("This state was written by an incompatible hash implementation");
        }
        const internalState = state.subarray(WASM_FUNC_HASH_LENGTH);
        new Uint8Array(memoryBuffer, stateOffset, stateLength).set(internalState);
        initialized = true;
      };
      const isDataShort = (data) => {
        if (typeof data === "string") {
          return data.length < MAX_HEAP / 4;
        }
        return data.byteLength < MAX_HEAP;
      };
      let canSimplify = isDataShort;
      switch (binary.name) {
        case "argon2":
        case "scrypt":
          canSimplify = () => true;
          break;
        case "blake2b":
        case "blake2s":
          canSimplify = (data, initParam) => initParam <= 512 && isDataShort(data);
          break;
        case "blake3":
          canSimplify = (data, initParam) => initParam === 0 && isDataShort(data);
          break;
        case "xxhash64":
        // cannot simplify
        case "xxhash3":
        case "xxhash128":
        case "crc64":
          canSimplify = () => false;
          break;
      }
      const calculate = (data, initParam = null, digestParam = null) => {
        if (!canSimplify(data, initParam)) {
          init(initParam);
          update(data);
          return digest("hex", digestParam);
        }
        const buffer = getUInt8Buffer(data);
        memoryView.set(buffer);
        wasmInstance.exports.Hash_Calculate(buffer.length, initParam, digestParam);
        return getDigestHex(digestChars, memoryView, hashLength);
      };
      yield setupInterface();
      return {
        getMemory,
        writeMemory,
        getExports,
        setMemorySize,
        init,
        update,
        digest,
        save,
        load,
        calculate,
        hashLength
      };
    });
  }
  var mutex$l = new Mutex();
  var name$k = "argon2";
  var data$k = "AGFzbQEAAAABKQVgAX8Bf2AAAX9gEH9/f39/f39/f39/f39/f38AYAR/f39/AGACf38AAwYFAAECAwQFBgEBAoCAAgYIAX8BQZCoBAsHQQQGbWVtb3J5AgASSGFzaF9TZXRNZW1vcnlTaXplAAAOSGFzaF9HZXRCdWZmZXIAAQ5IYXNoX0NhbGN1bGF0ZQAECvEyBVgBAn9BACEBAkAgAEEAKAKICCICRg0AAkAgACACayIAQRB2IABBgIB8cSAASWoiAEAAQX9HDQBB/wHADwtBACEBQQBBACkDiAggAEEQdK18NwOICAsgAcALcAECfwJAQQAoAoAIIgANAEEAPwBBEHQiADYCgAhBACgCiAgiAUGAgCBGDQACQEGAgCAgAWsiAEEQdiAAQYCAfHEgAElqIgBAAEF/Rw0AQQAPC0EAQQApA4gIIABBEHStfDcDiAhBACgCgAghAAsgAAvcDgECfiAAIAQpAwAiECAAKQMAIhF8IBFCAYZC/v///x+DIBBC/////w+DfnwiEDcDACAMIBAgDCkDAIVCIIkiEDcDACAIIBAgCCkDACIRfCARQgGGQv7///8fgyAQQv////8Pg358IhA3AwAgBCAQIAQpAwCFQiiJIhA3AwAgACAQIAApAwAiEXwgEEL/////D4MgEUIBhkL+////H4N+fCIQNwMAIAwgECAMKQMAhUIwiSIQNwMAIAggECAIKQMAIhF8IBBC/////w+DIBFCAYZC/v///x+DfnwiEDcDACAEIBAgBCkDAIVCAYk3AwAgASAFKQMAIhAgASkDACIRfCARQgGGQv7///8fgyAQQv////8Pg358IhA3AwAgDSAQIA0pAwCFQiCJIhA3AwAgCSAQIAkpAwAiEXwgEUIBhkL+////H4MgEEL/////D4N+fCIQNwMAIAUgECAFKQMAhUIoiSIQNwMAIAEgECABKQMAIhF8IBBC/////w+DIBFCAYZC/v///x+DfnwiEDcDACANIBAgDSkDAIVCMIkiEDcDACAJIBAgCSkDACIRfCAQQv////8PgyARQgGGQv7///8fg358IhA3AwAgBSAQIAUpAwCFQgGJNwMAIAIgBikDACIQIAIpAwAiEXwgEUIBhkL+////H4MgEEL/////D4N+fCIQNwMAIA4gECAOKQMAhUIgiSIQNwMAIAogECAKKQMAIhF8IBFCAYZC/v///x+DIBBC/////w+DfnwiEDcDACAGIBAgBikDAIVCKIkiEDcDACACIBAgAikDACIRfCAQQv////8PgyARQgGGQv7///8fg358IhA3AwAgDiAQIA4pAwCFQjCJIhA3AwAgCiAQIAopAwAiEXwgEEL/////D4MgEUIBhkL+////H4N+fCIQNwMAIAYgECAGKQMAhUIBiTcDACADIAcpAwAiECADKQMAIhF8IBFCAYZC/v///x+DIBBC/////w+DfnwiEDcDACAPIBAgDykDAIVCIIkiEDcDACALIBAgCykDACIRfCARQgGGQv7///8fgyAQQv////8Pg358IhA3AwAgByAQIAcpAwCFQiiJIhA3AwAgAyAQIAMpAwAiEXwgEEL/////D4MgEUIBhkL+////H4N+fCIQNwMAIA8gECAPKQMAhUIwiSIQNwMAIAsgECALKQMAIhF8IBBC/////w+DIBFCAYZC/v///x+DfnwiEDcDACAHIBAgBykDAIVCAYk3AwAgACAFKQMAIhAgACkDACIRfCARQgGGQv7///8fgyAQQv////8Pg358IhA3AwAgDyAQIA8pAwCFQiCJIhA3AwAgCiAQIAopAwAiEXwgEUIBhkL+////H4MgEEL/////D4N+fCIQNwMAIAUgECAFKQMAhUIoiSIQNwMAIAAgECAAKQMAIhF8IBBC/////w+DIBFCAYZC/v///x+DfnwiEDcDACAPIBAgDykDAIVCMIkiEDcDACAKIBAgCikDACIRfCAQQv////8PgyARQgGGQv7///8fg358IhA3AwAgBSAQIAUpAwCFQgGJNwMAIAEgBikDACIQIAEpAwAiEXwgEUIBhkL+////H4MgEEL/////D4N+fCIQNwMAIAwgECAMKQMAhUIgiSIQNwMAIAsgECALKQMAIhF8IBFCAYZC/v///x+DIBBC/////w+DfnwiEDcDACAGIBAgBikDAIVCKIkiEDcDACABIBAgASkDACIRfCAQQv////8PgyARQgGGQv7///8fg358IhA3AwAgDCAQIAwpAwCFQjCJIhA3AwAgCyAQIAspAwAiEXwgEEL/////D4MgEUIBhkL+////H4N+fCIQNwMAIAYgECAGKQMAhUIBiTcDACACIAcpAwAiECACKQMAIhF8IBFCAYZC/v///x+DIBBC/////w+DfnwiEDcDACANIBAgDSkDAIVCIIkiEDcDACAIIBAgCCkDACIRfCARQgGGQv7///8fgyAQQv////8Pg358IhA3AwAgByAQIAcpAwCFQiiJIhA3AwAgAiAQIAIpAwAiEXwgEEL/////D4MgEUIBhkL+////H4N+fCIQNwMAIA0gECANKQMAhUIwiSIQNwMAIAggECAIKQMAIhF8IBBC/////w+DIBFCAYZC/v///x+DfnwiEDcDACAHIBAgBykDAIVCAYk3AwAgAyAEKQMAIhAgAykDACIRfCARQgGGQv7///8fgyAQQv////8Pg358IhA3AwAgDiAQIA4pAwCFQiCJIhA3AwAgCSAQIAkpAwAiEXwgEUIBhkL+////H4MgEEL/////D4N+fCIQNwMAIAQgECAEKQMAhUIoiSIQNwMAIAMgECADKQMAIhF8IBBC/////w+DIBFCAYZC/v///x+DfnwiEDcDACAOIBAgDikDAIVCMIkiEDcDACAJIBAgCSkDACIRfCAQQv////8PgyARQgGGQv7///8fg358IhA3AwAgBCAQIAQpAwCFQgGJNwMAC98aAQN/QQAhBEEAIAIpAwAgASkDAIU3A5AIQQAgAikDCCABKQMIhTcDmAhBACACKQMQIAEpAxCFNwOgCEEAIAIpAxggASkDGIU3A6gIQQAgAikDICABKQMghTcDsAhBACACKQMoIAEpAyiFNwO4CEEAIAIpAzAgASkDMIU3A8AIQQAgAikDOCABKQM4hTcDyAhBACACKQNAIAEpA0CFNwPQCEEAIAIpA0ggASkDSIU3A9gIQQAgAikDUCABKQNQhTcD4AhBACACKQNYIAEpA1iFNwPoCEEAIAIpA2AgASkDYIU3A/AIQQAgAikDaCABKQNohTcD+AhBACACKQNwIAEpA3CFNwOACUEAIAIpA3ggASkDeIU3A4gJQQAgAikDgAEgASkDgAGFNwOQCUEAIAIpA4gBIAEpA4gBhTcDmAlBACACKQOQASABKQOQAYU3A6AJQQAgAikDmAEgASkDmAGFNwOoCUEAIAIpA6ABIAEpA6ABhTcDsAlBACACKQOoASABKQOoAYU3A7gJQQAgAikDsAEgASkDsAGFNwPACUEAIAIpA7gBIAEpA7gBhTcDyAlBACACKQPAASABKQPAAYU3A9AJQQAgAikDyAEgASkDyAGFNwPYCUEAIAIpA9ABIAEpA9ABhTcD4AlBACACKQPYASABKQPYAYU3A+gJQQAgAikD4AEgASkD4AGFNwPwCUEAIAIpA+gBIAEpA+gBhTcD+AlBACACKQPwASABKQPwAYU3A4AKQQAgAikD+AEgASkD+AGFNwOICkEAIAIpA4ACIAEpA4AChTcDkApBACACKQOIAiABKQOIAoU3A5gKQQAgAikDkAIgASkDkAKFNwOgCkEAIAIpA5gCIAEpA5gChTcDqApBACACKQOgAiABKQOgAoU3A7AKQQAgAikDqAIgASkDqAKFNwO4CkEAIAIpA7ACIAEpA7AChTcDwApBACACKQO4AiABKQO4AoU3A8gKQQAgAikDwAIgASkDwAKFNwPQCkEAIAIpA8gCIAEpA8gChTcD2ApBACACKQPQAiABKQPQAoU3A+AKQQAgAikD2AIgASkD2AKFNwPoCkEAIAIpA+ACIAEpA+AChTcD8ApBACACKQPoAiABKQPoAoU3A/gKQQAgAikD8AIgASkD8AKFNwOAC0EAIAIpA/gCIAEpA/gChTcDiAtBACACKQOAAyABKQOAA4U3A5ALQQAgAikDiAMgASkDiAOFNwOYC0EAIAIpA5ADIAEpA5ADhTcDoAtBACACKQOYAyABKQOYA4U3A6gLQQAgAikDoAMgASkDoAOFNwOwC0EAIAIpA6gDIAEpA6gDhTcDuAtBACACKQOwAyABKQOwA4U3A8ALQQAgAikDuAMgASkDuAOFNwPIC0EAIAIpA8ADIAEpA8ADhTcD0AtBACACKQPIAyABKQPIA4U3A9gLQQAgAikD0AMgASkD0AOFNwPgC0EAIAIpA9gDIAEpA9gDhTcD6AtBACACKQPgAyABKQPgA4U3A/ALQQAgAikD6AMgASkD6AOFNwP4C0EAIAIpA/ADIAEpA/ADhTcDgAxBACACKQP4AyABKQP4A4U3A4gMQQAgAikDgAQgASkDgASFNwOQDEEAIAIpA4gEIAEpA4gEhTcDmAxBACACKQOQBCABKQOQBIU3A6AMQQAgAikDmAQgASkDmASFNwOoDEEAIAIpA6AEIAEpA6AEhTcDsAxBACACKQOoBCABKQOoBIU3A7gMQQAgAikDsAQgASkDsASFNwPADEEAIAIpA7gEIAEpA7gEhTcDyAxBACACKQPABCABKQPABIU3A9AMQQAgAikDyAQgASkDyASFNwPYDEEAIAIpA9AEIAEpA9AEhTcD4AxBACACKQPYBCABKQPYBIU3A+gMQQAgAikD4AQgASkD4ASFNwPwDEEAIAIpA+gEIAEpA+gEhTcD+AxBACACKQPwBCABKQPwBIU3A4ANQQAgAikD+AQgASkD+ASFNwOIDUEAIAIpA4AFIAEpA4AFhTcDkA1BACACKQOIBSABKQOIBYU3A5gNQQAgAikDkAUgASkDkAWFNwOgDUEAIAIpA5gFIAEpA5gFhTcDqA1BACACKQOgBSABKQOgBYU3A7ANQQAgAikDqAUgASkDqAWFNwO4DUEAIAIpA7AFIAEpA7AFhTcDwA1BACACKQO4BSABKQO4BYU3A8gNQQAgAikDwAUgASkDwAWFNwPQDUEAIAIpA8gFIAEpA8gFhTcD2A1BACACKQPQBSABKQPQBYU3A+ANQQAgAikD2AUgASkD2AWFNwPoDUEAIAIpA+AFIAEpA+AFhTcD8A1BACACKQPoBSABKQPoBYU3A/gNQQAgAikD8AUgASkD8AWFNwOADkEAIAIpA/gFIAEpA/gFhTcDiA5BACACKQOABiABKQOABoU3A5AOQQAgAikDiAYgASkDiAaFNwOYDkEAIAIpA5AGIAEpA5AGhTcDoA5BACACKQOYBiABKQOYBoU3A6gOQQAgAikDoAYgASkDoAaFNwOwDkEAIAIpA6gGIAEpA6gGhTcDuA5BACACKQOwBiABKQOwBoU3A8AOQQAgAikDuAYgASkDuAaFNwPIDkEAIAIpA8AGIAEpA8AGhTcD0A5BACACKQPIBiABKQPIBoU3A9gOQQAgAikD0AYgASkD0AaFNwPgDkEAIAIpA9gGIAEpA9gGhTcD6A5BACACKQPgBiABKQPgBoU3A/AOQQAgAikD6AYgASkD6AaFNwP4DkEAIAIpA/AGIAEpA/AGhTcDgA9BACACKQP4BiABKQP4BoU3A4gPQQAgAikDgAcgASkDgAeFNwOQD0EAIAIpA4gHIAEpA4gHhTcDmA9BACACKQOQByABKQOQB4U3A6APQQAgAikDmAcgASkDmAeFNwOoD0EAIAIpA6AHIAEpA6AHhTcDsA9BACACKQOoByABKQOoB4U3A7gPQQAgAikDsAcgASkDsAeFNwPAD0EAIAIpA7gHIAEpA7gHhTcDyA9BACACKQPAByABKQPAB4U3A9APQQAgAikDyAcgASkDyAeFNwPYD0EAIAIpA9AHIAEpA9AHhTcD4A9BACACKQPYByABKQPYB4U3A+gPQQAgAikD4AcgASkD4AeFNwPwD0EAIAIpA+gHIAEpA+gHhTcD+A9BACACKQPwByABKQPwB4U3A4AQQQAgAikD+AcgASkD+AeFNwOIEEGQCEGYCEGgCEGoCEGwCEG4CEHACEHICEHQCEHYCEHgCEHoCEHwCEH4CEGACUGICRACQZAJQZgJQaAJQagJQbAJQbgJQcAJQcgJQdAJQdgJQeAJQegJQfAJQfgJQYAKQYgKEAJBkApBmApBoApBqApBsApBuApBwApByApB0ApB2ApB4ApB6ApB8ApB+ApBgAtBiAsQAkGQC0GYC0GgC0GoC0GwC0G4C0HAC0HIC0HQC0HYC0HgC0HoC0HwC0H4C0GADEGIDBACQZAMQZgMQaAMQagMQbAMQbgMQcAMQcgMQdAMQdgMQeAMQegMQfAMQfgMQYANQYgNEAJBkA1BmA1BoA1BqA1BsA1BuA1BwA1ByA1B0A1B2A1B4A1B6A1B8A1B+A1BgA5BiA4QAkGQDkGYDkGgDkGoDkGwDkG4DkHADkHIDkHQDkHYDkHgDkHoDkHwDkH4DkGAD0GIDxACQZAPQZgPQaAPQagPQbAPQbgPQcAPQcgPQdAPQdgPQeAPQegPQfAPQfgPQYAQQYgQEAJBkAhBmAhBkAlBmAlBkApBmApBkAtBmAtBkAxBmAxBkA1BmA1BkA5BmA5BkA9BmA8QAkGgCEGoCEGgCUGoCUGgCkGoCkGgC0GoC0GgDEGoDEGgDUGoDUGgDkGoDkGgD0GoDxACQbAIQbgIQbAJQbgJQbAKQbgKQbALQbgLQbAMQbgMQbANQbgNQbAOQbgOQbAPQbgPEAJBwAhByAhBwAlByAlBwApByApBwAtByAtBwAxByAxBwA1ByA1BwA5ByA5BwA9ByA8QAkHQCEHYCEHQCUHYCUHQCkHYCkHQC0HYC0HQDEHYDEHQDUHYDUHQDkHYDkHQD0HYDxACQeAIQegIQeAJQegJQeAKQegKQeALQegLQeAMQegMQeANQegNQeAOQegOQeAPQegPEAJB8AhB+AhB8AlB+AlB8ApB+ApB8AtB+AtB8AxB+AxB8A1B+A1B8A5B+A5B8A9B+A8QAkGACUGICUGACkGICkGAC0GIC0GADEGIDEGADUGIDUGADkGIDkGAD0GID0GAEEGIEBACAkACQCADRQ0AA0AgACAEaiIDIAIgBGoiBSkDACABIARqIgYpAwCFIARBkAhqKQMAhSADKQMAhTcDACADQQhqIgMgBUEIaikDACAGQQhqKQMAhSAEQZgIaikDAIUgAykDAIU3AwAgBEEQaiIEQYAIRw0ADAILC0EAIQQDQCAAIARqIgMgAiAEaiIFKQMAIAEgBGoiBikDAIUgBEGQCGopAwCFNwMAIANBCGogBUEIaikDACAGQQhqKQMAhSAEQZgIaikDAIU3AwAgBEEQaiIEQYAIRw0ACwsL5QcMBX8BfgR/An4BfwF+AX8Bfgd/AX4DfwF+AkBBACgCgAgiAiABQQp0aiIDKAIIIAFHDQAgAygCDCEEIAMoAgAhBUEAIAMoAhQiBq03A7gQQQAgBK0iBzcDsBBBACAFIAEgBUECdG4iCGwiCUECdK03A6gQAkACQAJAAkAgBEUNAEF/IQogBUUNASAIQQNsIQsgCEECdCIErSEMIAWtIQ0gBkF/akECSSEOQgAhDwNAQQAgDzcDkBAgD6chEEIAIRFBACEBA0BBACARNwOgECAPIBGEUCIDIA5xIRIgBkEBRiAPUCITIAZBAkYgEUICVHFxciEUQX8gAUEBakEDcSAIbEF/aiATGyEVIAEgEHIhFiABIAhsIRcgA0EBdCEYQgAhGQNAQQBCADcDwBBBACAZNwOYECAYIQECQCASRQ0AQQBCATcDwBBBkBhBkBBBkCBBABADQZAYQZAYQZAgQQAQA0ECIQELAkAgASAITw0AIAQgGaciGmwgF2ogAWohAwNAIANBACAEIAEbQQAgEVAiGxtqQX9qIRwCQAJAIBQNAEEAKAKACCICIBxBCnQiHGohCgwBCwJAIAFB/wBxIgINAEEAQQApA8AQQgF8NwPAEEGQGEGQEEGQIEEAEANBkBhBkBhBkCBBABADCyAcQQp0IRwgAkEDdEGQGGohCkEAKAKACCECCyACIANBCnRqIAIgHGogAiAKKQMAIh1CIIinIAVwIBogFhsiHCAEbCABIAFBACAZIBytUSIcGyIKIBsbIBdqIAogC2ogExsgAUUgHHJrIhsgFWqtIB1C/////w+DIh0gHX5CIIggG61+QiCIfSAMgqdqQQp0akEBEAMgA0EBaiEDIAggAUEBaiIBRw0ACwsgGUIBfCIZIA1SDQALIBFCAXwiEachASARQgRSDQALIA9CAXwiDyAHUg0AC0EAKAKACCECCyAJQQx0QYB4aiEXIAVBf2oiCkUNAgwBC0EAQgM3A6AQQQAgBEF/aq03A5AQQYB4IRcLIAIgF2ohGyAIQQx0IQhBACEcA0AgCCAcQQFqIhxsQYB4aiEEQQAhAQNAIBsgAWoiAyADKQMAIAIgBCABamopAwCFNwMAIANBCGoiAyADKQMAIAIgBCABQQhyamopAwCFNwMAIAFBCGohAyABQRBqIQEgA0H4B0kNAAsgHCAKRw0ACwsgAiAXaiEbQXghAQNAIAIgAWoiA0EIaiAbIAFqIgRBCGopAwA3AwAgA0EQaiAEQRBqKQMANwMAIANBGGogBEEYaikDADcDACADQSBqIARBIGopAwA3AwAgAUEgaiIBQfgHSQ0ACwsL";
  var hash$k = "e4cdc523";
  var wasmJson$k = {
    name: name$k,
    data: data$k,
    hash: hash$k
  };
  var name$j = "blake2b";
  var data$j = "AGFzbQEAAAABEQRgAAF/YAJ/fwBgAX8AYAAAAwoJAAECAwECAgABBQQBAQICBg4CfwFBsIsFC38AQYAICwdwCAZtZW1vcnkCAA5IYXNoX0dldEJ1ZmZlcgAACkhhc2hfRmluYWwAAwlIYXNoX0luaXQABQtIYXNoX1VwZGF0ZQAGDUhhc2hfR2V0U3RhdGUABw5IYXNoX0NhbGN1bGF0ZQAIClNUQVRFX1NJWkUDAQrTOAkFAEGACQvrAgIFfwF+AkAgAUEBSA0AAkACQAJAIAFBgAFBACgC4IoBIgJrIgNKDQAgASEEDAELQQBBADYC4IoBAkAgAkH/AEoNACACQeCJAWohBSAAIQRBACEGA0AgBSAELQAAOgAAIARBAWohBCAFQQFqIQUgAyAGQQFqIgZB/wFxSg0ACwtBAEEAKQPAiQEiB0KAAXw3A8CJAUEAQQApA8iJASAHQv9+Vq18NwPIiQFB4IkBEAIgACADaiEAAkAgASADayIEQYEBSA0AIAIgAWohBQNAQQBBACkDwIkBIgdCgAF8NwPAiQFBAEEAKQPIiQEgB0L/flatfDcDyIkBIAAQAiAAQYABaiEAIAVBgH9qIgVBgAJLDQALIAVBgH9qIQQMAQsgBEEATA0BC0EAIQUDQCAFQQAoAuCKAWpB4IkBaiAAIAVqLQAAOgAAIAQgBUEBaiIFQf8BcUoNAAsLQQBBACgC4IoBIARqNgLgigELC78uASR+QQBBACkD0IkBQQApA7CJASIBQQApA5CJAXwgACkDICICfCIDhULr+obav7X2wR+FQiCJIgRCq/DT9K/uvLc8fCIFIAGFQiiJIgYgA3wgACkDKCIBfCIHIASFQjCJIgggBXwiCSAGhUIBiSIKQQApA8iJAUEAKQOoiQEiBEEAKQOIiQF8IAApAxAiA3wiBYVCn9j52cKR2oKbf4VCIIkiC0K7zqqm2NDrs7t/fCIMIASFQiiJIg0gBXwgACkDGCIEfCIOfCAAKQNQIgV8Ig9BACkDwIkBQQApA6CJASIQQQApA4CJASIRfCAAKQMAIgZ8IhKFQtGFmu/6z5SH0QCFQiCJIhNCiJLznf/M+YTqAHwiFCAQhUIoiSIVIBJ8IAApAwgiEHwiFiAThUIwiSIXhUIgiSIYQQApA9iJAUEAKQO4iQEiE0EAKQOYiQF8IAApAzAiEnwiGYVC+cL4m5Gjs/DbAIVCIIkiGkLx7fT4paf9p6V/fCIbIBOFQiiJIhwgGXwgACkDOCITfCIZIBqFQjCJIhogG3wiG3wiHSAKhUIoiSIeIA98IAApA1giCnwiDyAYhUIwiSIYIB18Ih0gDiALhUIwiSIOIAx8Ih8gDYVCAYkiDCAWfCAAKQNAIgt8Ig0gGoVCIIkiFiAJfCIaIAyFQiiJIiAgDXwgACkDSCIJfCIhIBaFQjCJIhYgGyAchUIBiSIMIAd8IAApA2AiB3wiDSAOhUIgiSIOIBcgFHwiFHwiFyAMhUIoiSIbIA18IAApA2giDHwiHCAOhUIwiSIOIBd8IhcgG4VCAYkiGyAZIBQgFYVCAYkiFHwgACkDcCINfCIVIAiFQiCJIhkgH3wiHyAUhUIoiSIUIBV8IAApA3giCHwiFXwgDHwiIoVCIIkiI3wiJCAbhUIoiSIbICJ8IBJ8IiIgFyAYIBUgGYVCMIkiFSAffCIZIBSFQgGJIhQgIXwgDXwiH4VCIIkiGHwiFyAUhUIoiSIUIB98IAV8Ih8gGIVCMIkiGCAXfCIXIBSFQgGJIhR8IAF8IiEgFiAafCIWIBUgHSAehUIBiSIaIBx8IAl8IhyFQiCJIhV8Ih0gGoVCKIkiGiAcfCAIfCIcIBWFQjCJIhWFQiCJIh4gGSAOIBYgIIVCAYkiFiAPfCACfCIPhUIgiSIOfCIZIBaFQiiJIhYgD3wgC3wiDyAOhUIwiSIOIBl8Ihl8IiAgFIVCKIkiFCAhfCAEfCIhIB6FQjCJIh4gIHwiICAiICOFQjCJIiIgJHwiIyAbhUIBiSIbIBx8IAp8IhwgDoVCIIkiDiAXfCIXIBuFQiiJIhsgHHwgE3wiHCAOhUIwiSIOIBkgFoVCAYkiFiAffCAQfCIZICKFQiCJIh8gFSAdfCIVfCIdIBaFQiiJIhYgGXwgB3wiGSAfhUIwiSIfIB18Ih0gFoVCAYkiFiAVIBqFQgGJIhUgD3wgBnwiDyAYhUIgiSIYICN8IhogFYVCKIkiFSAPfCADfCIPfCAHfCIihUIgiSIjfCIkIBaFQiiJIhYgInwgBnwiIiAjhUIwiSIjICR8IiQgFoVCAYkiFiAOIBd8Ig4gDyAYhUIwiSIPICAgFIVCAYkiFCAZfCAKfCIXhUIgiSIYfCIZIBSFQiiJIhQgF3wgC3wiF3wgBXwiICAPIBp8Ig8gHyAOIBuFQgGJIg4gIXwgCHwiGoVCIIkiG3wiHyAOhUIoiSIOIBp8IAx8IhogG4VCMIkiG4VCIIkiISAdIB4gDyAVhUIBiSIPIBx8IAF8IhWFQiCJIhx8Ih0gD4VCKIkiDyAVfCADfCIVIByFQjCJIhwgHXwiHXwiHiAWhUIoiSIWICB8IA18IiAgIYVCMIkiISAefCIeIBogFyAYhUIwiSIXIBl8IhggFIVCAYkiFHwgCXwiGSAchUIgiSIaICR8IhwgFIVCKIkiFCAZfCACfCIZIBqFQjCJIhogHSAPhUIBiSIPICJ8IAR8Ih0gF4VCIIkiFyAbIB98Iht8Ih8gD4VCKIkiDyAdfCASfCIdIBeFQjCJIhcgH3wiHyAPhUIBiSIPIBsgDoVCAYkiDiAVfCATfCIVICOFQiCJIhsgGHwiGCAOhUIoiSIOIBV8IBB8IhV8IAx8IiKFQiCJIiN8IiQgD4VCKIkiDyAifCAHfCIiICOFQjCJIiMgJHwiJCAPhUIBiSIPIBogHHwiGiAVIBuFQjCJIhUgHiAWhUIBiSIWIB18IAR8IhuFQiCJIhx8Ih0gFoVCKIkiFiAbfCAQfCIbfCABfCIeIBUgGHwiFSAXIBogFIVCAYkiFCAgfCATfCIYhUIgiSIXfCIaIBSFQiiJIhQgGHwgCXwiGCAXhUIwiSIXhUIgiSIgIB8gISAVIA6FQgGJIg4gGXwgCnwiFYVCIIkiGXwiHyAOhUIoiSIOIBV8IA18IhUgGYVCMIkiGSAffCIffCIhIA+FQiiJIg8gHnwgBXwiHiAghUIwiSIgICF8IiEgGyAchUIwiSIbIB18IhwgFoVCAYkiFiAYfCADfCIYIBmFQiCJIhkgJHwiHSAWhUIoiSIWIBh8IBJ8IhggGYVCMIkiGSAfIA6FQgGJIg4gInwgAnwiHyAbhUIgiSIbIBcgGnwiF3wiGiAOhUIoiSIOIB98IAZ8Ih8gG4VCMIkiGyAafCIaIA6FQgGJIg4gFSAXIBSFQgGJIhR8IAh8IhUgI4VCIIkiFyAcfCIcIBSFQiiJIhQgFXwgC3wiFXwgBXwiIoVCIIkiI3wiJCAOhUIoiSIOICJ8IAh8IiIgGiAgIBUgF4VCMIkiFSAcfCIXIBSFQgGJIhQgGHwgCXwiGIVCIIkiHHwiGiAUhUIoiSIUIBh8IAZ8IhggHIVCMIkiHCAafCIaIBSFQgGJIhR8IAR8IiAgGSAdfCIZIBUgISAPhUIBiSIPIB98IAN8Ih2FQiCJIhV8Ih8gD4VCKIkiDyAdfCACfCIdIBWFQjCJIhWFQiCJIiEgFyAbIBkgFoVCAYkiFiAefCABfCIZhUIgiSIbfCIXIBaFQiiJIhYgGXwgE3wiGSAbhUIwiSIbIBd8Ihd8Ih4gFIVCKIkiFCAgfCAMfCIgICGFQjCJIiEgHnwiHiAiICOFQjCJIiIgJHwiIyAOhUIBiSIOIB18IBJ8Ih0gG4VCIIkiGyAafCIaIA6FQiiJIg4gHXwgC3wiHSAbhUIwiSIbIBcgFoVCAYkiFiAYfCANfCIXICKFQiCJIhggFSAffCIVfCIfIBaFQiiJIhYgF3wgEHwiFyAYhUIwiSIYIB98Ih8gFoVCAYkiFiAVIA+FQgGJIg8gGXwgCnwiFSAchUIgiSIZICN8IhwgD4VCKIkiDyAVfCAHfCIVfCASfCIihUIgiSIjfCIkIBaFQiiJIhYgInwgBXwiIiAjhUIwiSIjICR8IiQgFoVCAYkiFiAbIBp8IhogFSAZhUIwiSIVIB4gFIVCAYkiFCAXfCADfCIXhUIgiSIZfCIbIBSFQiiJIhQgF3wgB3wiF3wgAnwiHiAVIBx8IhUgGCAaIA6FQgGJIg4gIHwgC3wiGoVCIIkiGHwiHCAOhUIoiSIOIBp8IAR8IhogGIVCMIkiGIVCIIkiICAfICEgFSAPhUIBiSIPIB18IAZ8IhWFQiCJIh18Ih8gD4VCKIkiDyAVfCAKfCIVIB2FQjCJIh0gH3wiH3wiISAWhUIoiSIWIB58IAx8Ih4gIIVCMIkiICAhfCIhIBogFyAZhUIwiSIXIBt8IhkgFIVCAYkiFHwgEHwiGiAdhUIgiSIbICR8Ih0gFIVCKIkiFCAafCAJfCIaIBuFQjCJIhsgHyAPhUIBiSIPICJ8IBN8Ih8gF4VCIIkiFyAYIBx8Ihh8IhwgD4VCKIkiDyAffCABfCIfIBeFQjCJIhcgHHwiHCAPhUIBiSIPIBggDoVCAYkiDiAVfCAIfCIVICOFQiCJIhggGXwiGSAOhUIoiSIOIBV8IA18IhV8IA18IiKFQiCJIiN8IiQgD4VCKIkiDyAifCAMfCIiICOFQjCJIiMgJHwiJCAPhUIBiSIPIBsgHXwiGyAVIBiFQjCJIhUgISAWhUIBiSIWIB98IBB8IhiFQiCJIh18Ih8gFoVCKIkiFiAYfCAIfCIYfCASfCIhIBUgGXwiFSAXIBsgFIVCAYkiFCAefCAHfCIZhUIgiSIXfCIbIBSFQiiJIhQgGXwgAXwiGSAXhUIwiSIXhUIgiSIeIBwgICAVIA6FQgGJIg4gGnwgAnwiFYVCIIkiGnwiHCAOhUIoiSIOIBV8IAV8IhUgGoVCMIkiGiAcfCIcfCIgIA+FQiiJIg8gIXwgBHwiISAehUIwiSIeICB8IiAgGCAdhUIwiSIYIB98Ih0gFoVCAYkiFiAZfCAGfCIZIBqFQiCJIhogJHwiHyAWhUIoiSIWIBl8IBN8IhkgGoVCMIkiGiAcIA6FQgGJIg4gInwgCXwiHCAYhUIgiSIYIBcgG3wiF3wiGyAOhUIoiSIOIBx8IAN8IhwgGIVCMIkiGCAbfCIbIA6FQgGJIg4gFSAXIBSFQgGJIhR8IAt8IhUgI4VCIIkiFyAdfCIdIBSFQiiJIhQgFXwgCnwiFXwgBHwiIoVCIIkiI3wiJCAOhUIoiSIOICJ8IAl8IiIgGyAeIBUgF4VCMIkiFSAdfCIXIBSFQgGJIhQgGXwgDHwiGYVCIIkiHXwiGyAUhUIoiSIUIBl8IAp8IhkgHYVCMIkiHSAbfCIbIBSFQgGJIhR8IAN8Ih4gGiAffCIaIBUgICAPhUIBiSIPIBx8IAd8IhyFQiCJIhV8Ih8gD4VCKIkiDyAcfCAQfCIcIBWFQjCJIhWFQiCJIiAgFyAYIBogFoVCAYkiFiAhfCATfCIahUIgiSIYfCIXIBaFQiiJIhYgGnwgDXwiGiAYhUIwiSIYIBd8Ihd8IiEgFIVCKIkiFCAefCAFfCIeICCFQjCJIiAgIXwiISAiICOFQjCJIiIgJHwiIyAOhUIBiSIOIBx8IAt8IhwgGIVCIIkiGCAbfCIbIA6FQiiJIg4gHHwgEnwiHCAYhUIwiSIYIBcgFoVCAYkiFiAZfCABfCIXICKFQiCJIhkgFSAffCIVfCIfIBaFQiiJIhYgF3wgBnwiFyAZhUIwiSIZIB98Ih8gFoVCAYkiFiAVIA+FQgGJIg8gGnwgCHwiFSAdhUIgiSIaICN8Ih0gD4VCKIkiDyAVfCACfCIVfCANfCIihUIgiSIjfCIkIBaFQiiJIhYgInwgCXwiIiAjhUIwiSIjICR8IiQgFoVCAYkiFiAYIBt8IhggFSAahUIwiSIVICEgFIVCAYkiFCAXfCASfCIXhUIgiSIafCIbIBSFQiiJIhQgF3wgCHwiF3wgB3wiISAVIB18IhUgGSAYIA6FQgGJIg4gHnwgBnwiGIVCIIkiGXwiHSAOhUIoiSIOIBh8IAt8IhggGYVCMIkiGYVCIIkiHiAfICAgFSAPhUIBiSIPIBx8IAp8IhWFQiCJIhx8Ih8gD4VCKIkiDyAVfCAEfCIVIByFQjCJIhwgH3wiH3wiICAWhUIoiSIWICF8IAN8IiEgHoVCMIkiHiAgfCIgIBggFyAahUIwiSIXIBt8IhogFIVCAYkiFHwgBXwiGCAchUIgiSIbICR8IhwgFIVCKIkiFCAYfCABfCIYIBuFQjCJIhsgHyAPhUIBiSIPICJ8IAx8Ih8gF4VCIIkiFyAZIB18Ihl8Ih0gD4VCKIkiDyAffCATfCIfIBeFQjCJIhcgHXwiHSAPhUIBiSIPIBkgDoVCAYkiDiAVfCAQfCIVICOFQiCJIhkgGnwiGiAOhUIoiSIOIBV8IAJ8IhV8IBN8IiKFQiCJIiN8IiQgD4VCKIkiDyAifCASfCIiICOFQjCJIiMgJHwiJCAPhUIBiSIPIBsgHHwiGyAVIBmFQjCJIhUgICAWhUIBiSIWIB98IAt8IhmFQiCJIhx8Ih8gFoVCKIkiFiAZfCACfCIZfCAJfCIgIBUgGnwiFSAXIBsgFIVCAYkiFCAhfCAFfCIahUIgiSIXfCIbIBSFQiiJIhQgGnwgA3wiGiAXhUIwiSIXhUIgiSIhIB0gHiAVIA6FQgGJIg4gGHwgEHwiFYVCIIkiGHwiHSAOhUIoiSIOIBV8IAF8IhUgGIVCMIkiGCAdfCIdfCIeIA+FQiiJIg8gIHwgDXwiICAhhUIwiSIhIB58Ih4gGSAchUIwiSIZIB98IhwgFoVCAYkiFiAafCAIfCIaIBiFQiCJIhggJHwiHyAWhUIoiSIWIBp8IAp8IhogGIVCMIkiGCAdIA6FQgGJIg4gInwgBHwiHSAZhUIgiSIZIBcgG3wiF3wiGyAOhUIoiSIOIB18IAd8Ih0gGYVCMIkiGSAbfCIbIA6FQgGJIg4gFSAXIBSFQgGJIhR8IAx8IhUgI4VCIIkiFyAcfCIcIBSFQiiJIhQgFXwgBnwiFXwgEnwiIoVCIIkiI3wiJCAOhUIoiSIOICJ8IBN8IiIgGyAhIBUgF4VCMIkiFSAcfCIXIBSFQgGJIhQgGnwgBnwiGoVCIIkiHHwiGyAUhUIoiSIUIBp8IBB8IhogHIVCMIkiHCAbfCIbIBSFQgGJIhR8IA18IiEgGCAffCIYIBUgHiAPhUIBiSIPIB18IAJ8Ih2FQiCJIhV8Ih4gD4VCKIkiDyAdfCABfCIdIBWFQjCJIhWFQiCJIh8gFyAZIBggFoVCAYkiFiAgfCADfCIYhUIgiSIZfCIXIBaFQiiJIhYgGHwgBHwiGCAZhUIwiSIZIBd8Ihd8IiAgFIVCKIkiFCAhfCAIfCIhIB+FQjCJIh8gIHwiICAiICOFQjCJIiIgJHwiIyAOhUIBiSIOIB18IAd8Ih0gGYVCIIkiGSAbfCIbIA6FQiiJIg4gHXwgDHwiHSAZhUIwiSIZIBcgFoVCAYkiFiAafCALfCIXICKFQiCJIhogFSAefCIVfCIeIBaFQiiJIhYgF3wgCXwiFyAahUIwiSIaIB58Ih4gFoVCAYkiFiAVIA+FQgGJIg8gGHwgBXwiFSAchUIgiSIYICN8IhwgD4VCKIkiDyAVfCAKfCIVfCACfCIChUIgiSIifCIjIBaFQiiJIhYgAnwgC3wiAiAihUIwiSILICN8IiIgFoVCAYkiFiAZIBt8IhkgFSAYhUIwiSIVICAgFIVCAYkiFCAXfCANfCINhUIgiSIXfCIYIBSFQiiJIhQgDXwgBXwiBXwgEHwiECAVIBx8Ig0gGiAZIA6FQgGJIg4gIXwgDHwiDIVCIIkiFXwiGSAOhUIoiSIOIAx8IBJ8IhIgFYVCMIkiDIVCIIkiFSAeIB8gDSAPhUIBiSINIB18IAl8IgmFQiCJIg98IhogDYVCKIkiDSAJfCAIfCIJIA+FQjCJIgggGnwiD3wiGiAWhUIoiSIWIBB8IAd8IhAgEYUgDCAZfCIHIA6FQgGJIgwgCXwgCnwiCiALhUIgiSILIAUgF4VCMIkiBSAYfCIJfCIOIAyFQiiJIgwgCnwgE3wiEyALhUIwiSIKIA58IguFNwOAiQFBACADIAYgDyANhUIBiSINIAJ8fCICIAWFQiCJIgUgB3wiBiANhUIoiSIHIAJ8fCICQQApA4iJAYUgBCABIBIgCSAUhUIBiSIDfHwiASAIhUIgiSISICJ8IgkgA4VCKIkiAyABfHwiASAShUIwiSIEIAl8IhKFNwOIiQFBACATQQApA5CJAYUgECAVhUIwiSIQIBp8IhOFNwOQiQFBACABQQApA5iJAYUgAiAFhUIwiSICIAZ8IgGFNwOYiQFBACASIAOFQgGJQQApA6CJAYUgAoU3A6CJAUEAIBMgFoVCAYlBACkDqIkBhSAKhTcDqIkBQQAgASAHhUIBiUEAKQOwiQGFIASFNwOwiQFBACALIAyFQgGJQQApA7iJAYUgEIU3A7iJAQvdAgUBfwF+AX8BfgJ/IwBBwABrIgAkAAJAQQApA9CJAUIAUg0AQQBBACkDwIkBIgFBACgC4IoBIgKsfCIDNwPAiQFBAEEAKQPIiQEgAyABVK18NwPIiQECQEEALQDoigFFDQBBAEJ/NwPYiQELQQBCfzcD0IkBAkAgAkH/AEoNAEEAIQQDQCACIARqQeCJAWpBADoAACAEQQFqIgRBgAFBACgC4IoBIgJrSA0ACwtB4IkBEAIgAEEAKQOAiQE3AwAgAEEAKQOIiQE3AwggAEEAKQOQiQE3AxAgAEEAKQOYiQE3AxggAEEAKQOgiQE3AyAgAEEAKQOoiQE3AyggAEEAKQOwiQE3AzAgAEEAKQO4iQE3AzhBACgC5IoBIgVBAUgNAEEAIQRBACECA0AgBEGACWogACAEai0AADoAACAEQQFqIQQgBSACQQFqIgJB/wFxSg0ACwsgAEHAAGokAAv9AwMBfwF+AX8jAEGAAWsiAiQAQQBBgQI7AfKKAUEAIAE6APGKAUEAIAA6APCKAUGQfiEAA0AgAEGAiwFqQgA3AAAgAEH4igFqQgA3AAAgAEHwigFqQgA3AAAgAEEYaiIADQALQQAhAEEAQQApA/CKASIDQoiS853/zPmE6gCFNwOAiQFBAEEAKQP4igFCu86qptjQ67O7f4U3A4iJAUEAQQApA4CLAUKr8NP0r+68tzyFNwOQiQFBAEEAKQOIiwFC8e30+KWn/aelf4U3A5iJAUEAQQApA5CLAULRhZrv+s+Uh9EAhTcDoIkBQQBBACkDmIsBQp/Y+dnCkdqCm3+FNwOoiQFBAEEAKQOgiwFC6/qG2r+19sEfhTcDsIkBQQBBACkDqIsBQvnC+JuRo7Pw2wCFNwO4iQFBACADp0H/AXE2AuSKAQJAIAFBAUgNACACQgA3A3ggAkIANwNwIAJCADcDaCACQgA3A2AgAkIANwNYIAJCADcDUCACQgA3A0ggAkIANwNAIAJCADcDOCACQgA3AzAgAkIANwMoIAJCADcDICACQgA3AxggAkIANwMQIAJCADcDCCACQgA3AwBBACEEA0AgAiAAaiAAQYAJai0AADoAACAAQQFqIQAgBEEBaiIEQf8BcSABSA0ACyACQYABEAELIAJBgAFqJAALEgAgAEEDdkH/P3EgAEEQdhAECwkAQYAJIAAQAQsGAEGAiQELGwAgAUEDdkH/P3EgAUEQdhAEQYAJIAAQARADCwsLAQBBgAgLBPAAAAA=";
  var hash$j = "c6f286e6";
  var wasmJson$j = {
    name: name$j,
    data: data$j,
    hash: hash$j
  };
  var mutex$k = new Mutex();
  function validateBits$4(bits) {
    if (!Number.isInteger(bits) || bits < 8 || bits > 512 || bits % 8 !== 0) {
      return new Error("Invalid variant! Valid values: 8, 16, ..., 512");
    }
    return null;
  }
  function getInitParam$1(outputBits, keyBits) {
    return outputBits | keyBits << 16;
  }
  function createBLAKE2b(bits = 512, key = null) {
    if (validateBits$4(bits)) {
      return Promise.reject(validateBits$4(bits));
    }
    let keyBuffer = null;
    let initParam = bits;
    if (key !== null) {
      keyBuffer = getUInt8Buffer(key);
      if (keyBuffer.length > 64) {
        return Promise.reject(new Error("Max key length is 64 bytes"));
      }
      initParam = getInitParam$1(bits, keyBuffer.length);
    }
    const outputSize = bits / 8;
    return WASMInterface(wasmJson$j, outputSize).then((wasm) => {
      if (initParam > 512) {
        wasm.writeMemory(keyBuffer);
      }
      wasm.init(initParam);
      const obj = {
        init: initParam > 512 ? () => {
          wasm.writeMemory(keyBuffer);
          wasm.init(initParam);
          return obj;
        } : () => {
          wasm.init(initParam);
          return obj;
        },
        update: (data) => {
          wasm.update(data);
          return obj;
        },
        // biome-ignore lint/suspicious/noExplicitAny: Conflict with IHasher type
        digest: (outputType) => wasm.digest(outputType),
        save: () => wasm.save(),
        load: (data) => {
          wasm.load(data);
          return obj;
        },
        blockSize: 128,
        digestSize: outputSize
      };
      return obj;
    });
  }
  function encodeResult(salt, options, res) {
    const parameters = [
      `m=${options.memorySize}`,
      `t=${options.iterations}`,
      `p=${options.parallelism}`
    ].join(",");
    return `$argon2${options.hashType}$v=19$${parameters}$${encodeBase64(salt, false)}$${encodeBase64(res, false)}`;
  }
  var uint32View = new DataView(new ArrayBuffer(4));
  function int32LE(x) {
    uint32View.setInt32(0, x, true);
    return new Uint8Array(uint32View.buffer);
  }
  function hashFunc(blake512, buf, len) {
    return __awaiter(this, void 0, void 0, function* () {
      if (len <= 64) {
        const blake = yield createBLAKE2b(len * 8);
        blake.update(int32LE(len));
        blake.update(buf);
        return blake.digest("binary");
      }
      const r = Math.ceil(len / 32) - 2;
      const ret = new Uint8Array(len);
      blake512.init();
      blake512.update(int32LE(len));
      blake512.update(buf);
      let vp = blake512.digest("binary");
      ret.set(vp.subarray(0, 32), 0);
      for (let i = 1; i < r; i++) {
        blake512.init();
        blake512.update(vp);
        vp = blake512.digest("binary");
        ret.set(vp.subarray(0, 32), i * 32);
      }
      const partialBytesNeeded = len - 32 * r;
      let blakeSmall;
      if (partialBytesNeeded === 64) {
        blakeSmall = blake512;
        blakeSmall.init();
      } else {
        blakeSmall = yield createBLAKE2b(partialBytesNeeded * 8);
      }
      blakeSmall.update(vp);
      vp = blakeSmall.digest("binary");
      ret.set(vp.subarray(0, partialBytesNeeded), r * 32);
      return ret;
    });
  }
  function getHashType(type) {
    switch (type) {
      case "d":
        return 0;
      case "i":
        return 1;
      default:
        return 2;
    }
  }
  function argon2Internal(options) {
    return __awaiter(this, void 0, void 0, function* () {
      var _a2;
      const { parallelism, iterations, hashLength } = options;
      const password = getUInt8Buffer(options.password);
      const salt = getUInt8Buffer(options.salt);
      const version = 19;
      const hashType = getHashType(options.hashType);
      const { memorySize } = options;
      const secret = getUInt8Buffer((_a2 = options.secret) !== null && _a2 !== void 0 ? _a2 : "");
      const [argon2Interface, blake512] = yield Promise.all([
        WASMInterface(wasmJson$k, 1024),
        createBLAKE2b(512)
      ]);
      argon2Interface.setMemorySize(memorySize * 1024 + 1024);
      const initVector = new Uint8Array(24);
      const initVectorView = new DataView(initVector.buffer);
      initVectorView.setInt32(0, parallelism, true);
      initVectorView.setInt32(4, hashLength, true);
      initVectorView.setInt32(8, memorySize, true);
      initVectorView.setInt32(12, iterations, true);
      initVectorView.setInt32(16, version, true);
      initVectorView.setInt32(20, hashType, true);
      argon2Interface.writeMemory(initVector, memorySize * 1024);
      blake512.init();
      blake512.update(initVector);
      blake512.update(int32LE(password.length));
      blake512.update(password);
      blake512.update(int32LE(salt.length));
      blake512.update(salt);
      blake512.update(int32LE(secret.length));
      blake512.update(secret);
      blake512.update(int32LE(0));
      const segments = Math.floor(memorySize / (parallelism * 4));
      const lanes = segments * 4;
      const param = new Uint8Array(72);
      const H0 = blake512.digest("binary");
      param.set(H0);
      for (let lane = 0; lane < parallelism; lane++) {
        param.set(int32LE(0), 64);
        param.set(int32LE(lane), 68);
        let position = lane * lanes;
        let chunk = yield hashFunc(blake512, param, 1024);
        argon2Interface.writeMemory(chunk, position * 1024);
        position += 1;
        param.set(int32LE(1), 64);
        chunk = yield hashFunc(blake512, param, 1024);
        argon2Interface.writeMemory(chunk, position * 1024);
      }
      const C = new Uint8Array(1024);
      writeHexToUInt8(C, argon2Interface.calculate(new Uint8Array([]), memorySize));
      const res = yield hashFunc(blake512, C, hashLength);
      if (options.outputType === "hex") {
        const digestChars = new Uint8Array(hashLength * 2);
        return getDigestHex(digestChars, res, hashLength);
      }
      if (options.outputType === "encoded") {
        return encodeResult(salt, options, res);
      }
      return res;
    });
  }
  var validateOptions$3 = (options) => {
    var _a2;
    if (!options || typeof options !== "object") {
      throw new Error("Invalid options parameter. It requires an object.");
    }
    if (!options.password) {
      throw new Error("Password must be specified");
    }
    options.password = getUInt8Buffer(options.password);
    if (options.password.length < 1) {
      throw new Error("Password must be specified");
    }
    if (!options.salt) {
      throw new Error("Salt must be specified");
    }
    options.salt = getUInt8Buffer(options.salt);
    if (options.salt.length < 8) {
      throw new Error("Salt should be at least 8 bytes long");
    }
    options.secret = getUInt8Buffer((_a2 = options.secret) !== null && _a2 !== void 0 ? _a2 : "");
    if (!Number.isInteger(options.iterations) || options.iterations < 1) {
      throw new Error("Iterations should be a positive number");
    }
    if (!Number.isInteger(options.parallelism) || options.parallelism < 1) {
      throw new Error("Parallelism should be a positive number");
    }
    if (!Number.isInteger(options.hashLength) || options.hashLength < 4) {
      throw new Error("Hash length should be at least 4 bytes.");
    }
    if (!Number.isInteger(options.memorySize)) {
      throw new Error("Memory size should be specified.");
    }
    if (options.memorySize < 8 * options.parallelism) {
      throw new Error("Memory size should be at least 8 * parallelism.");
    }
    if (options.outputType === void 0) {
      options.outputType = "hex";
    }
    if (!["hex", "binary", "encoded"].includes(options.outputType)) {
      throw new Error(`Insupported output type ${options.outputType}. Valid values: ['hex', 'binary', 'encoded']`);
    }
  };
  function argon2id(options) {
    return __awaiter(this, void 0, void 0, function* () {
      validateOptions$3(options);
      return argon2Internal(Object.assign(Object.assign({}, options), { hashType: "id" }));
    });
  }
  var mutex$j = new Mutex();
  var mutex$i = new Mutex();
  var mutex$h = new Mutex();
  var mutex$g = new Mutex();
  var polyBuffer = new Uint8Array(8);
  var mutex$f = new Mutex();
  var mutex$e = new Mutex();
  var mutex$d = new Mutex();
  var mutex$c = new Mutex();
  var mutex$b = new Mutex();
  var mutex$a = new Mutex();
  var mutex$9 = new Mutex();
  var mutex$8 = new Mutex();
  var mutex$7 = new Mutex();
  var mutex$6 = new Mutex();
  var mutex$5 = new Mutex();
  var seedBuffer$2 = new Uint8Array(8);
  var mutex$4 = new Mutex();
  var seedBuffer$1 = new Uint8Array(8);
  var mutex$3 = new Mutex();
  var seedBuffer = new Uint8Array(8);
  var mutex$2 = new Mutex();
  var mutex$1 = new Mutex();
  var mutex = new Mutex();

  // src/lib/zk/argon2id.ts
  var BLAKE2B_IV32 = new Uint32Array([
    4089235720,
    1779033703,
    2227873595,
    3144134277,
    4271175723,
    1013904242,
    1595750129,
    2773480762,
    2917565137,
    1359893119,
    725511199,
    2600822924,
    4215389547,
    528734635,
    327033209,
    1541459225
  ]);
  var SIGMA = [
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    [14, 10, 4, 8, 9, 15, 13, 6, 1, 12, 0, 2, 11, 7, 5, 3],
    [11, 8, 12, 0, 5, 2, 15, 13, 10, 14, 3, 6, 7, 1, 9, 4],
    [7, 9, 3, 1, 13, 12, 11, 14, 2, 6, 5, 10, 4, 0, 15, 8],
    [9, 0, 5, 7, 2, 4, 10, 15, 14, 1, 11, 12, 6, 8, 3, 13],
    [2, 12, 6, 10, 0, 11, 8, 3, 4, 13, 7, 5, 15, 14, 1, 9],
    [12, 5, 1, 15, 14, 13, 4, 10, 0, 7, 6, 3, 9, 2, 8, 11],
    [13, 11, 7, 14, 12, 1, 3, 9, 5, 0, 15, 4, 8, 6, 2, 10],
    [6, 15, 14, 9, 11, 3, 0, 8, 12, 2, 13, 7, 1, 4, 10, 5],
    [10, 2, 8, 4, 7, 6, 1, 5, 15, 11, 9, 14, 3, 12, 13, 0],
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    [14, 10, 4, 8, 9, 15, 13, 6, 1, 12, 0, 2, 11, 7, 5, 3]
  ];
  function u32le(n) {
    const b = new Uint8Array(4);
    new DataView(b.buffer).setUint32(0, n >>> 0, true);
    return b;
  }
  function blake2b(input, outLen = 64) {
    if (outLen < 1 || outLen > 64) {
      throw new ZkCryptoError("INVALID_PARAMETER" /* INVALID_PARAMETER */, "BLAKE2b outLen must be 1..64.");
    }
    const h = new Uint32Array(BLAKE2B_IV32);
    h[0] ^= 16842752 ^ outLen;
    const v = new Uint32Array(32);
    const m = new Uint32Array(32);
    let t0 = 0;
    let t1 = 0;
    function gBlake(a, b, c, d, ix, iy) {
      const a2 = a * 2;
      const b2 = b * 2;
      const c2 = c * 2;
      const d2 = d * 2;
      const x2 = ix * 2;
      const y2 = iy * 2;
      let lo = v[a2] + v[b2] >>> 0;
      let hi = v[a2 + 1] + v[b2 + 1] + (lo < v[a2] ? 1 : 0) >>> 0;
      const lo2 = lo + m[x2] >>> 0;
      hi = hi + m[x2 + 1] + (lo2 < lo ? 1 : 0) >>> 0;
      v[a2] = lo2;
      v[a2 + 1] = hi;
      let dLo = v[d2] ^ v[a2];
      let dHi = v[d2 + 1] ^ v[a2 + 1];
      v[d2] = dHi;
      v[d2 + 1] = dLo;
      lo = v[c2] + v[d2] >>> 0;
      hi = v[c2 + 1] + v[d2 + 1] + (lo < v[c2] ? 1 : 0) >>> 0;
      v[c2] = lo;
      v[c2 + 1] = hi;
      let bLo = v[b2] ^ v[c2];
      let bHi = v[b2 + 1] ^ v[c2 + 1];
      v[b2] = (bLo >>> 24 | bHi << 8) >>> 0;
      v[b2 + 1] = (bHi >>> 24 | bLo << 8) >>> 0;
      lo = v[a2] + v[b2] >>> 0;
      hi = v[a2 + 1] + v[b2 + 1] + (lo < v[a2] ? 1 : 0) >>> 0;
      const lo3 = lo + m[y2] >>> 0;
      hi = hi + m[y2 + 1] + (lo3 < lo ? 1 : 0) >>> 0;
      v[a2] = lo3;
      v[a2 + 1] = hi;
      dLo = v[d2] ^ v[a2];
      dHi = v[d2 + 1] ^ v[a2 + 1];
      v[d2] = (dLo >>> 16 | dHi << 16) >>> 0;
      v[d2 + 1] = (dHi >>> 16 | dLo << 16) >>> 0;
      lo = v[c2] + v[d2] >>> 0;
      hi = v[c2 + 1] + v[d2 + 1] + (lo < v[c2] ? 1 : 0) >>> 0;
      v[c2] = lo;
      v[c2 + 1] = hi;
      bLo = v[b2] ^ v[c2];
      bHi = v[b2 + 1] ^ v[c2 + 1];
      v[b2] = (bLo << 1 | bHi >>> 31) >>> 0;
      v[b2 + 1] = (bHi << 1 | bLo >>> 31) >>> 0;
    }
    function compress(block, offset2, isLast) {
      v.set(h, 0);
      v.set(BLAKE2B_IV32, 16);
      v[24] ^= t0;
      v[25] ^= t1;
      if (isLast) {
        v[28] = ~v[28] >>> 0;
        v[29] = ~v[29] >>> 0;
      }
      const dv = new DataView(block.buffer, block.byteOffset + offset2, 128);
      for (let i = 0; i < 32; i++) {
        m[i] = dv.getUint32(i * 4, true);
      }
      for (let r = 0; r < 12; r++) {
        const s = SIGMA[r];
        gBlake(0, 4, 8, 12, s[0], s[1]);
        gBlake(1, 5, 9, 13, s[2], s[3]);
        gBlake(2, 6, 10, 14, s[4], s[5]);
        gBlake(3, 7, 11, 15, s[6], s[7]);
        gBlake(0, 5, 10, 15, s[8], s[9]);
        gBlake(1, 6, 11, 12, s[10], s[11]);
        gBlake(2, 7, 8, 13, s[12], s[13]);
        gBlake(3, 4, 9, 14, s[14], s[15]);
      }
      for (let i = 0; i < 16; i++) {
        h[i] ^= v[i] ^ v[i + 16];
      }
    }
    let offset = 0;
    const total = input.byteLength;
    while (total - offset > 128) {
      const nextT02 = t0 + 128 >>> 0;
      if (nextT02 < t0) t1 = t1 + 1 >>> 0;
      t0 = nextT02;
      compress(input, offset, false);
      offset += 128;
    }
    const rem = total - offset;
    const nextT0 = t0 + rem >>> 0;
    if (nextT0 < t0) t1 = t1 + 1 >>> 0;
    t0 = nextT0;
    const lastBlock = new Uint8Array(128);
    if (rem > 0) {
      lastBlock.set(input.subarray(offset, total), 0);
    }
    compress(lastBlock, 0, true);
    const out = new Uint8Array(64);
    const outDv = new DataView(out.buffer);
    for (let i = 0; i < 16; i++) {
      outDv.setUint32(i * 4, h[i], true);
    }
    zeroize(h, v, m, lastBlock);
    return out.subarray(0, outLen);
  }
  function blake2bLong(input, outLen) {
    const msg = concatBytes(u32le(outLen), input);
    try {
      if (outLen <= 64) {
        return blake2b(msg, outLen);
      }
      const r = Math.ceil(outLen / 32) - 2;
      const out = new Uint8Array(outLen);
      let V = blake2b(msg, 64);
      out.set(V.subarray(0, 32), 0);
      for (let i = 1; i < r; i++) {
        const nextV = blake2b(V, 64);
        zeroize(V);
        V = nextV;
        out.set(V.subarray(0, 32), i * 32);
      }
      const lastLen = outLen - 32 * r;
      const lastV = blake2b(V, lastLen);
      zeroize(V);
      out.set(lastV, r * 32);
      zeroize(lastV);
      return out;
    } finally {
      zeroize(msg);
    }
  }
  function mul32Hi(x, y) {
    const xL = x & 65535;
    const xH = x >>> 16;
    const yL = y & 65535;
    const yH = y >>> 16;
    const pLL = Math.imul(xL, yL) >>> 0;
    const pHL = Math.imul(xH, yL) >>> 0;
    const pLH = Math.imul(xL, yH) >>> 0;
    const pHH = Math.imul(xH, yH) >>> 0;
    const mid = (pLL >>> 16) + (pHL & 65535) + (pLH & 65535) >>> 0;
    return pHH + (pHL >>> 16) + (pLH >>> 16) + (mid >>> 16) >>> 0;
  }
  function gArgon32(v, a, b, c, d) {
    const a2 = a * 2;
    const b2 = b * 2;
    const c2 = c * 2;
    const d2 = d * 2;
    let aLo = v[a2];
    let aHi = v[a2 + 1];
    let bLo = v[b2];
    let bHi = v[b2 + 1];
    let cLo = v[c2];
    let cHi = v[c2 + 1];
    let dLo = v[d2];
    let dHi = v[d2 + 1];
    let mLo = Math.imul(aLo, bLo) >>> 0;
    let mHi = mul32Hi(aLo, bLo);
    let pLo = mLo << 1 >>> 0;
    let pHi = (mHi << 1 | mLo >>> 31) >>> 0;
    let sLo = aLo + bLo >>> 0;
    let sHi = aHi + bHi + (sLo < aLo ? 1 : 0) >>> 0;
    aLo = sLo + pLo >>> 0;
    aHi = sHi + pHi + (aLo < sLo ? 1 : 0) >>> 0;
    const daLo = (dLo ^ aLo) >>> 0;
    const daHi = (dHi ^ aHi) >>> 0;
    dLo = daHi;
    dHi = daLo;
    mLo = Math.imul(cLo, dLo) >>> 0;
    mHi = mul32Hi(cLo, dLo);
    pLo = mLo << 1 >>> 0;
    pHi = (mHi << 1 | mLo >>> 31) >>> 0;
    sLo = cLo + dLo >>> 0;
    sHi = cHi + dHi + (sLo < cLo ? 1 : 0) >>> 0;
    cLo = sLo + pLo >>> 0;
    cHi = sHi + pHi + (cLo < sLo ? 1 : 0) >>> 0;
    const bcLo = (bLo ^ cLo) >>> 0;
    const bcHi = (bHi ^ cHi) >>> 0;
    bLo = (bcLo >>> 24 | bcHi << 8) >>> 0;
    bHi = (bcHi >>> 24 | bcLo << 8) >>> 0;
    mLo = Math.imul(aLo, bLo) >>> 0;
    mHi = mul32Hi(aLo, bLo);
    pLo = mLo << 1 >>> 0;
    pHi = (mHi << 1 | mLo >>> 31) >>> 0;
    sLo = aLo + bLo >>> 0;
    sHi = aHi + bHi + (sLo < aLo ? 1 : 0) >>> 0;
    aLo = sLo + pLo >>> 0;
    aHi = sHi + pHi + (aLo < sLo ? 1 : 0) >>> 0;
    const da2Lo = (dLo ^ aLo) >>> 0;
    const da2Hi = (dHi ^ aHi) >>> 0;
    dLo = (da2Lo >>> 16 | da2Hi << 16) >>> 0;
    dHi = (da2Hi >>> 16 | da2Lo << 16) >>> 0;
    mLo = Math.imul(cLo, dLo) >>> 0;
    mHi = mul32Hi(cLo, dLo);
    pLo = mLo << 1 >>> 0;
    pHi = (mHi << 1 | mLo >>> 31) >>> 0;
    sLo = cLo + dLo >>> 0;
    sHi = cHi + dHi + (sLo < cLo ? 1 : 0) >>> 0;
    cLo = sLo + pLo >>> 0;
    cHi = sHi + pHi + (cLo < sLo ? 1 : 0) >>> 0;
    const bc2Lo = (bLo ^ cLo) >>> 0;
    const bc2Hi = (bHi ^ cHi) >>> 0;
    bLo = (bc2Lo << 1 | bc2Hi >>> 31) >>> 0;
    bHi = (bc2Hi << 1 | bc2Lo >>> 31) >>> 0;
    v[a2] = aLo;
    v[a2 + 1] = aHi;
    v[b2] = bLo;
    v[b2 + 1] = bHi;
    v[c2] = cLo;
    v[c2 + 1] = cHi;
    v[d2] = dLo;
    v[d2 + 1] = dHi;
  }
  function pArgon32(v, i0, i1, i2, i3, i4, i5, i6, i7, i8, i9, i10, i11, i12, i13, i14, i15) {
    gArgon32(v, i0, i4, i8, i12);
    gArgon32(v, i1, i5, i9, i13);
    gArgon32(v, i2, i6, i10, i14);
    gArgon32(v, i3, i7, i11, i15);
    gArgon32(v, i0, i5, i10, i15);
    gArgon32(v, i1, i6, i11, i12);
    gArgon32(v, i2, i7, i8, i13);
    gArgon32(v, i3, i4, i9, i14);
  }
  var SCRATCH_R = new Uint32Array(256);
  var SCRATCH_Z = new Uint32Array(256);
  function compressBlock32(mem, xBlockIdx, yBlockIdx, outBlockIdx, xorWithOut) {
    const xOff = xBlockIdx * 256;
    const yOff = yBlockIdx * 256;
    const outOff = outBlockIdx * 256;
    for (let i = 0; i < 256; i++) {
      const val = (mem[xOff + i] ^ mem[yOff + i]) >>> 0;
      SCRATCH_R[i] = val;
      SCRATCH_Z[i] = val;
    }
    for (let r = 0; r < 8; r++) {
      const o = r * 16;
      pArgon32(
        SCRATCH_Z,
        o + 0,
        o + 1,
        o + 2,
        o + 3,
        o + 4,
        o + 5,
        o + 6,
        o + 7,
        o + 8,
        o + 9,
        o + 10,
        o + 11,
        o + 12,
        o + 13,
        o + 14,
        o + 15
      );
    }
    for (let c = 0; c < 8; c++) {
      const o = c * 2;
      pArgon32(
        SCRATCH_Z,
        o,
        o + 1,
        o + 16,
        o + 17,
        o + 32,
        o + 33,
        o + 48,
        o + 49,
        o + 64,
        o + 65,
        o + 80,
        o + 81,
        o + 96,
        o + 97,
        o + 112,
        o + 113
      );
    }
    if (xorWithOut) {
      for (let i = 0; i < 256; i++) {
        mem[outOff + i] = (mem[outOff + i] ^ SCRATCH_Z[i] ^ SCRATCH_R[i]) >>> 0;
      }
    } else {
      for (let i = 0; i < 256; i++) {
        mem[outOff + i] = (SCRATCH_Z[i] ^ SCRATCH_R[i]) >>> 0;
      }
    }
  }
  var Rfc9106Argon2idProvider = class {
    async derive(password, salt, params, options) {
      const { memoryKiB: m, iterations: t, parallelism: p, hashLength: tagLen } = params;
      if (salt.byteLength < 8) {
        throw new ZkCryptoError("INVALID_PARAMETER" /* INVALID_PARAMETER */, "Argon2id salt must be at least 8 bytes.");
      }
      if (t < 1 || p < 1 || m < 8 * p || tagLen < 4) {
        throw new ZkCryptoError("INVALID_PARAMETER" /* INVALID_PARAMETER */, "Invalid Argon2id parameters.");
      }
      const secret = options?.secret ?? new Uint8Array(0);
      const ad = options?.associatedData ?? new Uint8Array(0);
      if (secret.byteLength === 0 && ad.byteLength === 0) {
        try {
          const wasmOut = await argon2id({
            password,
            salt,
            memorySize: m,
            iterations: t,
            parallelism: p,
            hashLength: tagLen,
            outputType: "binary"
          });
          if (options?.onProgress) {
            for (let pass = 1; pass <= t; pass++) {
              for (let slice = 1; slice <= 4; slice++) {
                options.onProgress({
                  percent: Math.round(((pass - 1) * 4 + slice) / (t * 4) * 100),
                  pass,
                  totalPasses: t,
                  slice
                });
              }
            }
          }
          return new Uint8Array(wasmOut);
        } catch {
        }
      }
      const h0Input = concatBytes(
        u32le(p),
        u32le(tagLen),
        u32le(m),
        u32le(t),
        u32le(19),
        u32le(2),
        u32le(password.byteLength),
        password,
        u32le(salt.byteLength),
        salt,
        u32le(secret.byteLength),
        secret,
        u32le(ad.byteLength),
        ad
      );
      const H0 = blake2b(h0Input, 64);
      zeroize(h0Input);
      const mPrime = 4 * p * Math.floor(m / (4 * p));
      const q = mPrime / p;
      const segmentLength = q / 4;
      const totalBlocks = mPrime + 4;
      const zeroBlkIdx = mPrime;
      const inputBlkIdx = mPrime + 1;
      const tmpBlkIdx = mPrime + 2;
      const addrBlkIdx = mPrime + 3;
      const mem = new Uint32Array(totalBlocks * 256);
      try {
        const writeBufToBlock = (buf, blkIdx) => {
          const dv = new DataView(buf.buffer, buf.byteOffset, 1024);
          const base = blkIdx * 256;
          for (let i = 0; i < 256; i++) {
            mem[base + i] = dv.getUint32(i * 4, true);
          }
        };
        for (let l = 0; l < p; l++) {
          const b0 = blake2bLong(concatBytes(H0, u32le(0), u32le(l)), 1024);
          const b1 = blake2bLong(concatBytes(H0, u32le(1), u32le(l)), 1024);
          writeBufToBlock(b0, l * q + 0);
          writeBufToBlock(b1, l * q + 1);
          zeroize(b0, b1);
        }
        const totalSteps = t * 4;
        let completedSteps = 0;
        for (let pass = 0; pass < t; pass++) {
          for (let slice = 0; slice < 4; slice++) {
            const dataIndependent = pass === 0 && slice < 2;
            for (let l = 0; l < p; l++) {
              let addrCounter = 0;
              const inBase = inputBlkIdx * 256;
              if (dataIndependent) {
                mem.fill(0, inBase, inBase + 256);
                mem[inBase + 0] = pass >>> 0;
                mem[inBase + 2] = l >>> 0;
                mem[inBase + 4] = slice >>> 0;
                mem[inBase + 6] = mPrime >>> 0;
                mem[inBase + 8] = t >>> 0;
                mem[inBase + 10] = 2;
              }
              const startIdx = pass === 0 && slice === 0 ? 2 : 0;
              for (let idx = startIdx; idx < segmentLength; idx++) {
                const currOffset = l * q + slice * segmentLength + idx;
                const prevOffset = slice === 0 && idx === 0 ? l * q + q - 1 : currOffset - 1;
                let j1;
                let j2;
                if (dataIndependent) {
                  if (idx % 128 === 0 || idx === startIdx) {
                    addrCounter++;
                    mem[inBase + 12] = addrCounter >>> 0;
                    compressBlock32(mem, zeroBlkIdx, inputBlkIdx, tmpBlkIdx, false);
                    compressBlock32(mem, zeroBlkIdx, tmpBlkIdx, addrBlkIdx, false);
                  }
                  const addrOff = addrBlkIdx * 256 + idx % 128 * 2;
                  j1 = mem[addrOff];
                  j2 = mem[addrOff + 1];
                } else {
                  const prevBase = prevOffset * 256;
                  j1 = mem[prevBase];
                  j2 = mem[prevBase + 1];
                }
                const refLane = pass === 0 && slice === 0 ? l : j2 % p;
                let refAreaSize;
                if (pass === 0) {
                  if (slice === 0) {
                    refAreaSize = idx - 1;
                  } else if (refLane === l) {
                    refAreaSize = slice * segmentLength + idx - 1;
                  } else {
                    refAreaSize = slice * segmentLength - (idx === 0 ? 1 : 0);
                  }
                } else {
                  if (refLane === l) {
                    refAreaSize = q - segmentLength + idx - 1;
                  } else {
                    refAreaSize = q - segmentLength - (idx === 0 ? 1 : 0);
                  }
                }
                const relPos = Number(BigInt(j1) * BigInt(j1) >> 32n);
                const mapPos = refAreaSize - 1 - Number(BigInt(refAreaSize) * BigInt(relPos) >> 32n);
                const startPos = pass === 0 ? 0 : (slice + 1) % 4 * segmentLength;
                const refIdx = (startPos + mapPos) % q;
                const refOffset = refLane * q + refIdx;
                compressBlock32(mem, prevOffset, refOffset, currOffset, pass > 0);
              }
            }
            completedSteps++;
            if (options?.onProgress) {
              options.onProgress({
                percent: Math.round(completedSteps / totalSteps * 100),
                pass: pass + 1,
                totalPasses: t,
                slice: slice + 1
              });
            }
          }
        }
        const finalBlockBytes = new Uint8Array(1024);
        const finalDv = new DataView(finalBlockBytes.buffer);
        for (let i = 0; i < 256; i++) {
          let word = mem[(0 * q + q - 1) * 256 + i];
          for (let l = 1; l < p; l++) {
            word = (word ^ mem[(l * q + q - 1) * 256 + i]) >>> 0;
          }
          finalDv.setUint32(i * 4, word, true);
        }
        const tag = blake2bLong(finalBlockBytes, tagLen);
        zeroize(finalBlockBytes);
        return tag;
      } finally {
        zeroize(H0, mem, SCRATCH_R, SCRATCH_Z);
      }
    }
  };
  var defaultArgon2idProvider = new Rfc9106Argon2idProvider();

  // src/lib/zk/kdf.ts
  var DEFAULT_ARGON2ID_PARAMS = {
    memoryKiB: 65536,
    iterations: 3,
    parallelism: 1,
    hashLength: 32
  };
  async function deriveRoot(options) {
    const {
      accountKey,
      userSalt,
      passphrase,
      argon2Params = DEFAULT_ARGON2ID_PARAMS,
      onProgress,
      cryptoProvider = defaultCryptoProvider,
      argon2Provider = defaultArgon2idProvider
    } = options;
    if (accountKey.byteLength !== 32) {
      throw new ZkCryptoError("INVALID_PARAMETER" /* INVALID_PARAMETER */, "accountKey must be exactly 32 bytes.");
    }
    if (userSalt.byteLength !== 16) {
      throw new ZkCryptoError("INVALID_PARAMETER" /* INVALID_PARAMETER */, "userSalt must be exactly 16 bytes.");
    }
    let passphraseBytes = null;
    let passphrasePart = null;
    let ikm = null;
    try {
      const hasPassphrase = passphrase !== void 0 && passphrase !== null && (typeof passphrase === "string" ? passphrase.length > 0 : passphrase.byteLength > 0);
      if (hasPassphrase) {
        if (typeof passphrase === "string") {
          passphraseBytes = normalizePassphraseNfc(passphrase);
        } else {
          passphraseBytes = new Uint8Array(passphrase);
        }
        passphrasePart = await argon2Provider.derive(passphraseBytes, userSalt, argon2Params, {
          onProgress
        });
      } else {
        passphrasePart = new Uint8Array(32);
      }
      if (passphrasePart.byteLength !== 32) {
        throw new ZkCryptoError("INVALID_PARAMETER" /* INVALID_PARAMETER */, "Argon2id output must be 32 bytes.");
      }
      ikm = concatBytes(passphrasePart, accountKey);
      return await cryptoProvider.hkdfSha256(
        ikm,
        userSalt,
        utf8Encode("photocloud/v2/root"),
        32
      );
    } finally {
      zeroize(passphraseBytes, passphrasePart, ikm);
    }
  }
  async function deriveKekAndAuthSecret(root, cryptoProvider = defaultCryptoProvider) {
    if (root.byteLength !== 32) {
      throw new ZkCryptoError("INVALID_PARAMETER" /* INVALID_PARAMETER */, "root key must be exactly 32 bytes.");
    }
    const emptySalt = new Uint8Array(0);
    const kek = await cryptoProvider.hkdfSha256(
      root,
      emptySalt,
      utf8Encode("photocloud/v2/kek"),
      32
    );
    const authSecret = await cryptoProvider.hkdfSha256(
      root,
      emptySalt,
      utf8Encode("photocloud/v2/auth"),
      32
    );
    return {
      kek,
      authSecret,
      zeroizeAll() {
        zeroize(kek, authSecret);
      }
    };
  }
  async function wrapVaultKey(kek, vaultKey, userId, nonce, cryptoProvider = defaultCryptoProvider) {
    if (kek.byteLength !== 32) {
      throw new ZkCryptoError("INVALID_PARAMETER" /* INVALID_PARAMETER */, "kek must be 32 bytes.");
    }
    if (vaultKey.byteLength !== 32) {
      throw new ZkCryptoError("INVALID_PARAMETER" /* INVALID_PARAMETER */, "vaultKey must be 32 bytes.");
    }
    if (!userId || userId.trim().length === 0) {
      throw new ZkCryptoError("INVALID_PARAMETER" /* INVALID_PARAMETER */, "userId must be non-empty.");
    }
    const iv = nonce ?? cryptoProvider.randomBytes(12);
    if (iv.byteLength !== 12) {
      throw new ZkCryptoError("INVALID_PARAMETER" /* INVALID_PARAMETER */, "VK wrap nonce must be 12 bytes.");
    }
    const aad = utf8Encode(`vk|${userId}`);
    const ctWithTag = await cryptoProvider.aes256GcmEncrypt(kek, iv, vaultKey, aad);
    return concatBytes(iv, ctWithTag);
  }
  async function unwrapVaultKey(kek, wrappedVk, userId, cryptoProvider = defaultCryptoProvider) {
    if (kek.byteLength !== 32) {
      throw new ZkCryptoError("INVALID_PARAMETER" /* INVALID_PARAMETER */, "kek must be 32 bytes.");
    }
    if (wrappedVk.byteLength !== 60) {
      throw new ZkCryptoError(
        "WRONG_KEY_OR_PASSPHRASE" /* WRONG_KEY_OR_PASSPHRASE */,
        "Invalid wrappedVk length (expected 60 bytes)."
      );
    }
    if (!userId || userId.trim().length === 0) {
      throw new ZkCryptoError("INVALID_PARAMETER" /* INVALID_PARAMETER */, "userId must be non-empty.");
    }
    const iv = wrappedVk.subarray(0, 12);
    const ctWithTag = wrappedVk.subarray(12, 60);
    const aad = utf8Encode(`vk|${userId}`);
    return await cryptoProvider.aes256GcmDecrypt(
      kek,
      iv,
      ctWithTag,
      aad,
      "WRONG_KEY_OR_PASSPHRASE" /* WRONG_KEY_OR_PASSPHRASE */
    );
  }
  async function deriveSubkeys(vaultKey, cryptoProvider = defaultCryptoProvider) {
    if (vaultKey.byteLength !== 32) {
      throw new ZkCryptoError("INVALID_PARAMETER" /* INVALID_PARAMETER */, "vaultKey must be 32 bytes.");
    }
    const emptySalt = new Uint8Array(0);
    const [metaKey, thumbKey, dedupKey, fkWrapKey] = await Promise.all([
      cryptoProvider.hkdfSha256(vaultKey, emptySalt, utf8Encode("photocloud/v2/metaKey"), 32),
      cryptoProvider.hkdfSha256(vaultKey, emptySalt, utf8Encode("photocloud/v2/thumbKey"), 32),
      cryptoProvider.hkdfSha256(vaultKey, emptySalt, utf8Encode("photocloud/v2/dedupKey"), 32),
      cryptoProvider.hkdfSha256(vaultKey, emptySalt, utf8Encode("photocloud/v2/fkWrapKey"), 32)
    ]);
    return {
      metaKey,
      thumbKey,
      dedupKey,
      fkWrapKey,
      zeroizeAll() {
        zeroize(metaKey, thumbKey, dedupKey, fkWrapKey);
      }
    };
  }
  async function wrapFileKey(fkWrapKey, fileKey, blobId, nonce, cryptoProvider = defaultCryptoProvider) {
    if (fkWrapKey.byteLength !== 32) {
      throw new ZkCryptoError("INVALID_PARAMETER" /* INVALID_PARAMETER */, "fkWrapKey must be 32 bytes.");
    }
    if (fileKey.byteLength !== 32) {
      throw new ZkCryptoError("INVALID_PARAMETER" /* INVALID_PARAMETER */, "fileKey must be 32 bytes.");
    }
    const blobIdBytes = typeof blobId === "string" ? uuidToBytes(blobId) : blobId;
    if (blobIdBytes.byteLength !== 16) {
      throw new ZkCryptoError("INVALID_PARAMETER" /* INVALID_PARAMETER */, "blobId binary AAD must be 16 bytes.");
    }
    const iv = nonce ?? cryptoProvider.randomBytes(12);
    if (iv.byteLength !== 12) {
      throw new ZkCryptoError("INVALID_PARAMETER" /* INVALID_PARAMETER */, "FK wrap nonce must be 12 bytes.");
    }
    const ctWithTag = await cryptoProvider.aes256GcmEncrypt(fkWrapKey, iv, fileKey, blobIdBytes);
    return concatBytes(iv, ctWithTag);
  }
  async function unwrapFileKey(fkWrapKey, wrappedFk, blobId, cryptoProvider = defaultCryptoProvider) {
    if (fkWrapKey.byteLength !== 32) {
      throw new ZkCryptoError("INVALID_PARAMETER" /* INVALID_PARAMETER */, "fkWrapKey must be 32 bytes.");
    }
    if (wrappedFk.byteLength !== 60) {
      throw new ZkCryptoError("MALFORMED_HEADER" /* MALFORMED_HEADER */, "wrappedFK must be exactly 60 bytes.");
    }
    const blobIdBytes = typeof blobId === "string" ? uuidToBytes(blobId) : blobId;
    if (blobIdBytes.byteLength !== 16) {
      throw new ZkCryptoError("INVALID_PARAMETER" /* INVALID_PARAMETER */, "blobId binary AAD must be 16 bytes.");
    }
    const iv = wrappedFk.subarray(0, 12);
    const ctWithTag = wrappedFk.subarray(12, 60);
    return await cryptoProvider.aes256GcmDecrypt(
      fkWrapKey,
      iv,
      ctWithTag,
      blobIdBytes,
      "WRONG_KEY_OR_PASSPHRASE" /* WRONG_KEY_OR_PASSPHRASE */
    );
  }
  async function wrapFileKeyForShare(shareKey, fileKey, shareId, blobId, nonce, cryptoProvider = defaultCryptoProvider) {
    if (shareKey.byteLength !== 32) {
      throw new ZkCryptoError("INVALID_PARAMETER" /* INVALID_PARAMETER */, "shareKey must be 32 bytes.");
    }
    if (fileKey.byteLength !== 32) {
      throw new ZkCryptoError("INVALID_PARAMETER" /* INVALID_PARAMETER */, "fileKey must be 32 bytes.");
    }
    uuidToBytes(shareId);
    uuidToBytes(blobId);
    const shareWrapKey = await cryptoProvider.hkdfSha256(
      shareKey,
      new Uint8Array(0),
      utf8Encode("photocloud/v2/share/wrap"),
      32
    );
    try {
      const iv = nonce ?? cryptoProvider.randomBytes(12);
      if (iv.byteLength !== 12) {
        throw new ZkCryptoError("INVALID_PARAMETER" /* INVALID_PARAMETER */, "share FK wrap nonce must be 12 bytes.");
      }
      const aad = utf8Encode(`share-fk|${shareId.toLowerCase()}|${blobId.toLowerCase()}`);
      const ctWithTag = await cryptoProvider.aes256GcmEncrypt(shareWrapKey, iv, fileKey, aad);
      return concatBytes(iv, ctWithTag);
    } finally {
      zeroize(shareWrapKey);
    }
  }
  async function unwrapFileKeyForShare(shareKey, shareWrappedFk, shareId, blobId, cryptoProvider = defaultCryptoProvider) {
    if (shareKey.byteLength !== 32) {
      throw new ZkCryptoError("INVALID_PARAMETER" /* INVALID_PARAMETER */, "shareKey must be 32 bytes.");
    }
    if (shareWrappedFk.byteLength !== 60) {
      throw new ZkCryptoError(
        "WRONG_KEY_OR_PASSPHRASE" /* WRONG_KEY_OR_PASSPHRASE */,
        "shareWrappedFK must be 60 bytes."
      );
    }
    uuidToBytes(shareId);
    uuidToBytes(blobId);
    const shareWrapKey = await cryptoProvider.hkdfSha256(
      shareKey,
      new Uint8Array(0),
      utf8Encode("photocloud/v2/share/wrap"),
      32
    );
    try {
      const iv = shareWrappedFk.subarray(0, 12);
      const ctWithTag = shareWrappedFk.subarray(12, 60);
      const aad = utf8Encode(`share-fk|${shareId.toLowerCase()}|${blobId.toLowerCase()}`);
      return await cryptoProvider.aes256GcmDecrypt(
        shareWrapKey,
        iv,
        ctWithTag,
        aad,
        "WRONG_KEY_OR_PASSPHRASE" /* WRONG_KEY_OR_PASSPHRASE */
      );
    } finally {
      zeroize(shareWrapKey);
    }
  }

  // src/lib/zk/pczkStream.ts
  var PCZK_MAGIC = new Uint8Array([80, 67, 90, 75]);
  var PCZK_VERSION_V1 = 1;
  var PCZK_HEADER_LENGTH = 86;
  var PCZK_GCM_TAG_LENGTH = 16;
  var PCZK_MIN_BLOB_LENGTH = PCZK_HEADER_LENGTH + PCZK_GCM_TAG_LENGTH;
  var DEFAULT_CHUNK_SIZE_LOG2 = 20;
  async function* normalizeByteStream(source) {
    if (source instanceof Uint8Array) {
      if (source.byteLength > 0) {
        yield source;
      }
      return;
    }
    if (typeof ReadableStream !== "undefined" && source instanceof ReadableStream) {
      const reader = source.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value && value.byteLength > 0) {
            yield value;
          }
        }
      } finally {
        reader.releaseLock();
      }
      return;
    }
    if (Symbol.asyncIterator in source) {
      for await (const chunk of source) {
        if (chunk && chunk.byteLength > 0) {
          yield chunk;
        }
      }
      return;
    }
    if (Symbol.iterator in source) {
      for (const chunk of source) {
        if (chunk && chunk.byteLength > 0) {
          yield chunk;
        }
      }
      return;
    }
    throw new ZkCryptoError("INVALID_PARAMETER" /* INVALID_PARAMETER */, "Unsupported stream source type.");
  }
  function buildChunkNonce(noncePrefix, chunkIndex) {
    if (noncePrefix.byteLength !== 4) {
      throw new ZkCryptoError("INVALID_PARAMETER" /* INVALID_PARAMETER */, "noncePrefix must be 4 bytes.");
    }
    const nonce = new Uint8Array(12);
    nonce.set(noncePrefix, 0);
    const view = new DataView(nonce.buffer);
    view.setBigUint64(4, BigInt(chunkIndex), false);
    return nonce;
  }
  function buildChunkAad(headerSha256, isLast) {
    if (headerSha256.byteLength !== 32) {
      throw new ZkCryptoError("INVALID_PARAMETER" /* INVALID_PARAMETER */, "headerSha256 must be 32 bytes.");
    }
    const aad = new Uint8Array(33);
    aad.set(headerSha256, 0);
    aad[32] = isLast ? 1 : 0;
    return aad;
  }
  function serializePczkHeader(params) {
    const { chunkSizeLog2, blobIdBytes, noncePrefix, wrappedFk } = params;
    if (!Number.isInteger(chunkSizeLog2) || chunkSizeLog2 < 16 || chunkSizeLog2 > 24) {
      throw new ZkCryptoError(
        "MALFORMED_HEADER" /* MALFORMED_HEADER */,
        `Invalid chunkSizeLog2 (${chunkSizeLog2}): must be between 16 and 24.`
      );
    }
    if (blobIdBytes.byteLength !== 16) {
      throw new ZkCryptoError("MALFORMED_HEADER" /* MALFORMED_HEADER */, "blobIdBytes must be 16 bytes.");
    }
    if (noncePrefix.byteLength !== 4) {
      throw new ZkCryptoError("MALFORMED_HEADER" /* MALFORMED_HEADER */, "noncePrefix must be 4 bytes.");
    }
    if (wrappedFk.byteLength !== 60) {
      throw new ZkCryptoError("MALFORMED_HEADER" /* MALFORMED_HEADER */, "wrappedFk must be 60 bytes.");
    }
    const header = new Uint8Array(PCZK_HEADER_LENGTH);
    header.set(PCZK_MAGIC, 0);
    header[4] = PCZK_VERSION_V1;
    header[5] = chunkSizeLog2;
    header.set(blobIdBytes, 6);
    header.set(noncePrefix, 22);
    header.set(wrappedFk, 26);
    return header;
  }
  function parsePczkHeader(headerBytes) {
    if (headerBytes.byteLength < PCZK_HEADER_LENGTH) {
      throw new ZkCryptoError(
        "TRUNCATED_BLOB" /* TRUNCATED_BLOB */,
        `PCZK header truncated: expected at least ${PCZK_HEADER_LENGTH} bytes, got ${headerBytes.byteLength}.`
      );
    }
    const rawHeader = new Uint8Array(headerBytes.subarray(0, PCZK_HEADER_LENGTH));
    if (rawHeader[0] !== PCZK_MAGIC[0] || rawHeader[1] !== PCZK_MAGIC[1] || rawHeader[2] !== PCZK_MAGIC[2] || rawHeader[3] !== PCZK_MAGIC[3]) {
      throw new ZkCryptoError("MALFORMED_HEADER" /* MALFORMED_HEADER */, "Invalid PCZK magic bytes.");
    }
    const version = rawHeader[4];
    if (version !== PCZK_VERSION_V1) {
      throw new ZkCryptoError(
        "UNSUPPORTED_VERSION" /* UNSUPPORTED_VERSION */,
        `Unsupported PCZK format version: ${version}.`
      );
    }
    const chunkSizeLog2 = rawHeader[5];
    if (chunkSizeLog2 < 16 || chunkSizeLog2 > 24) {
      throw new ZkCryptoError(
        "MALFORMED_HEADER" /* MALFORMED_HEADER */,
        `Invalid PCZK chunkSizeLog2: ${chunkSizeLog2} (allowed: 16..24).`
      );
    }
    const chunkPlaintextSize = 1 << chunkSizeLog2;
    const chunkCiphertextSize = chunkPlaintextSize + PCZK_GCM_TAG_LENGTH;
    const blobIdBytes = new Uint8Array(rawHeader.subarray(6, 22));
    const blobId = bytesToUuid(blobIdBytes);
    const noncePrefix = new Uint8Array(rawHeader.subarray(22, 26));
    const wrappedFk = new Uint8Array(rawHeader.subarray(26, 86));
    return {
      magic: "PCZK",
      version,
      chunkSizeLog2,
      chunkPlaintextSize,
      chunkCiphertextSize,
      blobId,
      blobIdBytes,
      noncePrefix,
      wrappedFk,
      rawHeader
    };
  }
  async function* encryptBlobStream(source, options) {
    const {
      fkWrapKey,
      blobId,
      fkWrapNonce,
      chunkSizeLog2 = DEFAULT_CHUNK_SIZE_LOG2,
      dedupKey,
      cryptoProvider = defaultCryptoProvider,
      onProgress
    } = options;
    if (!Number.isInteger(chunkSizeLog2) || chunkSizeLog2 < 16 || chunkSizeLog2 > 24) {
      throw new ZkCryptoError("INVALID_PARAMETER" /* INVALID_PARAMETER */, "chunkSizeLog2 must be in range 16..24.");
    }
    const blobIdBytes = uuidToBytes(blobId);
    const fileKey = options.fileKey ? new Uint8Array(options.fileKey) : cryptoProvider.randomBytes(32);
    const noncePrefix = options.noncePrefix ? new Uint8Array(options.noncePrefix) : cryptoProvider.randomBytes(4);
    if (fileKey.byteLength !== 32) {
      throw new ZkCryptoError("INVALID_PARAMETER" /* INVALID_PARAMETER */, "fileKey must be 32 bytes.");
    }
    if (noncePrefix.byteLength !== 4) {
      throw new ZkCryptoError("INVALID_PARAMETER" /* INVALID_PARAMETER */, "noncePrefix must be 4 bytes.");
    }
    const chunkSize = 1 << chunkSizeLog2;
    const activeBuf = new Uint8Array(chunkSize);
    let activeLen = 0;
    let pendingFullChunk = null;
    const ctHasher = cryptoProvider.createSha256Stream();
    const dedupMac = dedupKey ? cryptoProvider.createHmacSha256Stream(dedupKey) : null;
    try {
      const wrappedFk = await wrapFileKey(fkWrapKey, fileKey, blobIdBytes, fkWrapNonce, cryptoProvider);
      const header = serializePczkHeader({
        chunkSizeLog2,
        blobIdBytes,
        noncePrefix,
        wrappedFk
      });
      const headerSha256 = await cryptoProvider.sha256(header);
      ctHasher.update(header);
      yield header;
      let chunkIndex = 0;
      let totalPlaintextBytes = 0;
      let totalCiphertextBytes = header.byteLength;
      const encryptAndEmitChunk = async (ptChunk, isLast) => {
        const nonce = buildChunkNonce(noncePrefix, chunkIndex);
        const aad = buildChunkAad(headerSha256, isLast);
        const encryptedChunk = await cryptoProvider.aes256GcmEncrypt(fileKey, nonce, ptChunk, aad);
        zeroize(nonce, aad);
        ctHasher.update(encryptedChunk);
        totalCiphertextBytes += encryptedChunk.byteLength;
        chunkIndex++;
        if (onProgress) {
          onProgress({ chunkIndex, plaintextBytesProcessed: totalPlaintextBytes });
        }
        return encryptedChunk;
      };
      for await (const incoming of normalizeByteStream(source)) {
        if (dedupMac) {
          for (let off = 0; off < incoming.byteLength; off += 65536) {
            dedupMac.update(incoming.subarray(off, Math.min(incoming.byteLength, off + 65536)));
          }
        }
        totalPlaintextBytes += incoming.byteLength;
        let inOffset = 0;
        while (inOffset < incoming.byteLength) {
          if (pendingFullChunk !== null) {
            const outChunk = await encryptAndEmitChunk(pendingFullChunk, false);
            zeroize(pendingFullChunk);
            pendingFullChunk = null;
            yield outChunk;
          }
          const space = chunkSize - activeLen;
          const take = Math.min(space, incoming.byteLength - inOffset);
          activeBuf.set(incoming.subarray(inOffset, inOffset + take), activeLen);
          activeLen += take;
          inOffset += take;
          if (activeLen === chunkSize) {
            pendingFullChunk = new Uint8Array(activeBuf);
            activeLen = 0;
          }
        }
      }
      if (pendingFullChunk !== null) {
        const lastChunk = await encryptAndEmitChunk(pendingFullChunk, true);
        zeroize(pendingFullChunk);
        pendingFullChunk = null;
        yield lastChunk;
      } else {
        const finalPt = activeBuf.subarray(0, activeLen);
        const lastChunk = await encryptAndEmitChunk(finalPt, true);
        yield lastChunk;
      }
      const ctSha256 = ctHasher.digest();
      const dedupDigest = dedupMac ? dedupMac.digest() : void 0;
      return {
        blobId: bytesToUuid(blobIdBytes),
        chunkSizeLog2,
        totalPlaintextBytes,
        totalCiphertextBytes,
        chunkCount: chunkIndex,
        headerBytes: header,
        headerSha256Hex: toHex(headerSha256),
        ciphertextSha256Hex: toHex(ctSha256),
        dedupTagB64u: dedupDigest ? toBase64Url(dedupDigest) : void 0,
        dedupTagHex: dedupDigest ? toHex(dedupDigest) : void 0
      };
    } finally {
      zeroize(fileKey, activeBuf, pendingFullChunk);
    }
  }
  async function encryptBlobToBytes(source, options) {
    const gen = encryptBlobStream(source, options);
    const parts = [];
    while (true) {
      const step = await gen.next();
      if (step.done) {
        return {
          ciphertext: concatBytes(...parts),
          result: step.value
        };
      }
      parts.push(step.value);
    }
  }
  async function* decryptBlobStream(source, options) {
    const {
      fkWrapKey,
      unwrappedFileKey,
      expectedBlobId,
      expectedTotalCiphertextBytes,
      cryptoProvider = defaultCryptoProvider
    } = options;
    if (!fkWrapKey && !unwrappedFileKey) {
      throw new ZkCryptoError(
        "INVALID_PARAMETER" /* INVALID_PARAMETER */,
        "Either fkWrapKey or unwrappedFileKey must be provided."
      );
    }
    if (expectedTotalCiphertextBytes !== void 0 && expectedTotalCiphertextBytes < PCZK_MIN_BLOB_LENGTH) {
      throw new ZkCryptoError(
        "TRUNCATED_BLOB" /* TRUNCATED_BLOB */,
        `Total ciphertext length (${expectedTotalCiphertextBytes}) is shorter than minimum PCZK blob (${PCZK_MIN_BLOB_LENGTH}).`
      );
    }
    const iterator = normalizeByteStream(source)[Symbol.asyncIterator]();
    let pendingSlice = new Uint8Array(0);
    let streamEnded = false;
    let totalBytesRead = 0;
    async function fillBytes(targetLength) {
      const out = new Uint8Array(targetLength);
      let filled = 0;
      while (filled < targetLength) {
        if (pendingSlice.byteLength > 0) {
          const take = Math.min(pendingSlice.byteLength, targetLength - filled);
          out.set(pendingSlice.subarray(0, take), filled);
          filled += take;
          pendingSlice = pendingSlice.subarray(take);
        } else if (!streamEnded) {
          const next = await iterator.next();
          if (next.done || !next.value) {
            streamEnded = true;
            break;
          }
          totalBytesRead += next.value.byteLength;
          pendingSlice = next.value;
        } else {
          break;
        }
      }
      return filled === targetLength ? out : out.subarray(0, filled);
    }
    async function hasMoreBytes() {
      while (pendingSlice.byteLength === 0 && !streamEnded) {
        const next = await iterator.next();
        if (next.done || !next.value) {
          streamEnded = true;
          return false;
        }
        totalBytesRead += next.value.byteLength;
        pendingSlice = next.value;
      }
      return pendingSlice.byteLength > 0;
    }
    let fileKey = null;
    try {
      const headerBuf = await fillBytes(PCZK_HEADER_LENGTH);
      if (headerBuf.byteLength < PCZK_HEADER_LENGTH) {
        throw new ZkCryptoError(
          "TRUNCATED_BLOB" /* TRUNCATED_BLOB */,
          `Truncated PCZK header: got ${headerBuf.byteLength} bytes, expected ${PCZK_HEADER_LENGTH}.`
        );
      }
      const header = parsePczkHeader(headerBuf);
      if (expectedBlobId !== void 0) {
        const expectedBytes = uuidToBytes(expectedBlobId);
        if (!constantTimeEqual(header.blobIdBytes, expectedBytes)) {
          throw new ZkCryptoError(
            "WRONG_KEY_OR_PASSPHRASE" /* WRONG_KEY_OR_PASSPHRASE */,
            "Blob header blobId does not match expectedBlobId."
          );
        }
      }
      if (unwrappedFileKey) {
        if (unwrappedFileKey.byteLength !== 32) {
          throw new ZkCryptoError("INVALID_PARAMETER" /* INVALID_PARAMETER */, "unwrappedFileKey must be 32 bytes.");
        }
        fileKey = new Uint8Array(unwrappedFileKey);
      } else if (fkWrapKey) {
        fileKey = await unwrapFileKey(
          fkWrapKey,
          header.wrappedFk,
          header.blobIdBytes,
          cryptoProvider
        );
      } else {
        throw new ZkCryptoError("INVALID_PARAMETER" /* INVALID_PARAMETER */, "Missing file key unwrap material.");
      }
      const headerSha256 = await cryptoProvider.sha256(header.rawHeader);
      const maxChunkCtSize = header.chunkCiphertextSize;
      let chunkIndex = 0;
      let totalPlaintextBytes = 0;
      while (true) {
        const chunkCt = await fillBytes(maxChunkCtSize);
        if (chunkCt.byteLength === 0) {
          if (chunkIndex === 0) {
            throw new ZkCryptoError(
              "TRUNCATED_BLOB" /* TRUNCATED_BLOB */,
              "PCZK blob contains header but zero chunks."
            );
          }
          break;
        }
        if (chunkCt.byteLength < PCZK_GCM_TAG_LENGTH) {
          throw new ZkCryptoError(
            "TRUNCATED_BLOB" /* TRUNCATED_BLOB */,
            `Truncated PCZK chunk ${chunkIndex}: length ${chunkCt.byteLength} < ${PCZK_GCM_TAG_LENGTH}.`
          );
        }
        const moreFollows = await hasMoreBytes();
        const isLast = !moreFollows;
        if (!isLast && chunkCt.byteLength !== maxChunkCtSize) {
          throw new ZkCryptoError(
            "TRUNCATED_BLOB" /* TRUNCATED_BLOB */,
            `Non-final chunk ${chunkIndex} has incomplete size ${chunkCt.byteLength}.`
          );
        }
        if (chunkCt.byteLength === PCZK_GCM_TAG_LENGTH && (chunkIndex > 0 || !isLast)) {
          throw new ZkCryptoError(
            "TRUNCATED_BLOB" /* TRUNCATED_BLOB */,
            `Zero-byte trailing chunk at index ${chunkIndex} is invalid.`
          );
        }
        const nonce = buildChunkNonce(header.noncePrefix, chunkIndex);
        const aad = buildChunkAad(headerSha256, isLast);
        let plaintextChunk;
        try {
          plaintextChunk = await cryptoProvider.aes256GcmDecrypt(
            fileKey,
            nonce,
            chunkCt,
            aad,
            "AUTH_TAG_MISMATCH" /* AUTH_TAG_MISMATCH */
          );
        } finally {
          zeroize(nonce, aad);
        }
        totalPlaintextBytes += plaintextChunk.byteLength;
        chunkIndex++;
        if (plaintextChunk.byteLength > 0) {
          yield plaintextChunk;
        }
        if (isLast) {
          break;
        }
      }
      if (expectedTotalCiphertextBytes !== void 0 && totalBytesRead !== expectedTotalCiphertextBytes) {
        throw new ZkCryptoError(
          "TRUNCATED_BLOB" /* TRUNCATED_BLOB */,
          `Ciphertext length mismatch: read ${totalBytesRead}, expected ${expectedTotalCiphertextBytes}.`
        );
      }
      return {
        header,
        totalPlaintextBytes,
        chunkCount: chunkIndex
      };
    } finally {
      zeroize(fileKey);
    }
  }
  async function decryptBlobToBytes(source, options) {
    const gen = decryptBlobStream(source, options);
    const parts = [];
    while (true) {
      const step = await gen.next();
      if (step.done) {
        return {
          plaintext: concatBytes(...parts),
          result: step.value
        };
      }
      parts.push(step.value);
    }
  }
  function computeBlobRangePlan(params) {
    const {
      totalCiphertextBytes,
      chunkSizeLog2,
      startPlaintextByte,
      endPlaintextByteInclusive
    } = params;
    if (!Number.isInteger(chunkSizeLog2) || chunkSizeLog2 < 16 || chunkSizeLog2 > 24) {
      throw new ZkCryptoError("MALFORMED_HEADER" /* MALFORMED_HEADER */, "chunkSizeLog2 must be 16..24.");
    }
    if (totalCiphertextBytes < PCZK_MIN_BLOB_LENGTH) {
      throw new ZkCryptoError(
        "TRUNCATED_BLOB" /* TRUNCATED_BLOB */,
        `totalCiphertextBytes (${totalCiphertextBytes}) < ${PCZK_MIN_BLOB_LENGTH}.`
      );
    }
    const chunkPlaintextSize = 1 << chunkSizeLog2;
    const chunkCiphertextSize = chunkPlaintextSize + PCZK_GCM_TAG_LENGTH;
    const chunksPayloadBytes = totalCiphertextBytes - PCZK_HEADER_LENGTH;
    let totalChunks;
    let totalPlaintextBytes;
    if (chunksPayloadBytes === PCZK_GCM_TAG_LENGTH) {
      totalChunks = 1;
      totalPlaintextBytes = 0;
    } else {
      totalChunks = Math.ceil(chunksPayloadBytes / chunkCiphertextSize);
      const lastChunkCtLen = chunksPayloadBytes - (totalChunks - 1) * chunkCiphertextSize;
      if (lastChunkCtLen <= PCZK_GCM_TAG_LENGTH) {
        throw new ZkCryptoError(
          "TRUNCATED_BLOB" /* TRUNCATED_BLOB */,
          `Invalid final chunk ciphertext size (${lastChunkCtLen} bytes).`
        );
      }
      totalPlaintextBytes = (totalChunks - 1) * chunkPlaintextSize + (lastChunkCtLen - PCZK_GCM_TAG_LENGTH);
    }
    if (totalPlaintextBytes === 0) {
      throw new ZkCryptoError(
        "INVALID_PARAMETER" /* INVALID_PARAMETER */,
        "Cannot request a byte range on an empty 0-byte blob."
      );
    }
    if (!Number.isInteger(startPlaintextByte) || !Number.isInteger(endPlaintextByteInclusive) || startPlaintextByte < 0 || endPlaintextByteInclusive < startPlaintextByte || endPlaintextByteInclusive >= totalPlaintextBytes) {
      throw new ZkCryptoError(
        "INVALID_PARAMETER" /* INVALID_PARAMETER */,
        `Invalid plaintext range [${startPlaintextByte}..${endPlaintextByteInclusive}] for totalPlaintextBytes=${totalPlaintextBytes}.`
      );
    }
    const startChunkIndex = Math.floor(startPlaintextByte / chunkPlaintextSize);
    const endChunkIndex = Math.floor(endPlaintextByteInclusive / chunkPlaintextSize);
    const ciphertextStartByte = PCZK_HEADER_LENGTH + startChunkIndex * chunkCiphertextSize;
    const ciphertextEndByteInclusive = Math.min(
      totalCiphertextBytes - 1,
      PCZK_HEADER_LENGTH + (endChunkIndex + 1) * chunkCiphertextSize - 1
    );
    const chunks = [];
    for (let idx = startChunkIndex; idx <= endChunkIndex; idx++) {
      const isLast = idx === totalChunks - 1;
      const ctStart = PCZK_HEADER_LENGTH + idx * chunkCiphertextSize;
      const ctEnd = isLast ? totalCiphertextBytes - 1 : ctStart + chunkCiphertextSize - 1;
      const ctLen = ctEnd - ctStart + 1;
      const ptLen = ctLen - PCZK_GCM_TAG_LENGTH;
      const ptStart = idx * chunkPlaintextSize;
      const ptEnd = ptStart + ptLen - 1;
      chunks.push({
        chunkIndex: idx,
        isLast,
        ciphertextStartInBlob: ctStart,
        ciphertextEndInclusiveInBlob: ctEnd,
        ciphertextOffsetInSlice: ctStart - ciphertextStartByte,
        ciphertextLength: ctLen,
        plaintextStartInBlob: ptStart,
        plaintextEndInclusiveInBlob: ptEnd
      });
    }
    return {
      totalCiphertextBytes,
      totalPlaintextBytes,
      chunkSizeLog2,
      chunkPlaintextSize,
      chunkCiphertextSize,
      totalChunks,
      startPlaintextByte,
      endPlaintextByteInclusive,
      startChunkIndex,
      endChunkIndex,
      ciphertextStartByte,
      ciphertextEndByteInclusive,
      chunks
    };
  }
  async function decryptBlobRange(options) {
    const {
      headerBytes,
      totalCiphertextBytes,
      startPlaintextByte,
      endPlaintextByteInclusive,
      fkWrapKey,
      unwrappedFileKey,
      expectedBlobId,
      ciphertextSlice,
      fetchCiphertextRange,
      cryptoProvider = defaultCryptoProvider
    } = options;
    const header = parsePczkHeader(headerBytes);
    if (expectedBlobId !== void 0) {
      const expectedBytes = uuidToBytes(expectedBlobId);
      if (!constantTimeEqual(header.blobIdBytes, expectedBytes)) {
        throw new ZkCryptoError(
          "WRONG_KEY_OR_PASSPHRASE" /* WRONG_KEY_OR_PASSPHRASE */,
          "Blob header blobId does not match expectedBlobId."
        );
      }
    }
    const plan = computeBlobRangePlan({
      totalCiphertextBytes,
      chunkSizeLog2: header.chunkSizeLog2,
      startPlaintextByte,
      endPlaintextByteInclusive
    });
    const expectedSliceLength = plan.ciphertextEndByteInclusive - plan.ciphertextStartByte + 1;
    let rangeSlice;
    if (ciphertextSlice !== void 0) {
      rangeSlice = ciphertextSlice;
    } else if (fetchCiphertextRange) {
      rangeSlice = await fetchCiphertextRange(
        plan.ciphertextStartByte,
        plan.ciphertextEndByteInclusive
      );
    } else {
      throw new ZkCryptoError(
        "INVALID_PARAMETER" /* INVALID_PARAMETER */,
        "Either ciphertextSlice or fetchCiphertextRange must be provided."
      );
    }
    if (rangeSlice.byteLength < expectedSliceLength) {
      throw new ZkCryptoError(
        "TRUNCATED_BLOB" /* TRUNCATED_BLOB */,
        `Range ciphertext slice truncated: got ${rangeSlice.byteLength}, expected ${expectedSliceLength}.`
      );
    }
    let fileKey = null;
    try {
      if (unwrappedFileKey) {
        if (unwrappedFileKey.byteLength !== 32) {
          throw new ZkCryptoError("INVALID_PARAMETER" /* INVALID_PARAMETER */, "unwrappedFileKey must be 32 bytes.");
        }
        fileKey = new Uint8Array(unwrappedFileKey);
      } else if (fkWrapKey) {
        fileKey = await unwrapFileKey(
          fkWrapKey,
          header.wrappedFk,
          header.blobIdBytes,
          cryptoProvider
        );
      } else {
        throw new ZkCryptoError(
          "INVALID_PARAMETER" /* INVALID_PARAMETER */,
          "Either fkWrapKey or unwrappedFileKey must be provided."
        );
      }
      const headerSha256 = await cryptoProvider.sha256(header.rawHeader);
      const outputLength = endPlaintextByteInclusive - startPlaintextByte + 1;
      const output = new Uint8Array(outputLength);
      let outOffset = 0;
      for (const chunkDesc of plan.chunks) {
        const chunkCt = rangeSlice.subarray(
          chunkDesc.ciphertextOffsetInSlice,
          chunkDesc.ciphertextOffsetInSlice + chunkDesc.ciphertextLength
        );
        const nonce = buildChunkNonce(header.noncePrefix, chunkDesc.chunkIndex);
        const aad = buildChunkAad(headerSha256, chunkDesc.isLast);
        let chunkPt;
        try {
          chunkPt = await cryptoProvider.aes256GcmDecrypt(
            fileKey,
            nonce,
            chunkCt,
            aad,
            "AUTH_TAG_MISMATCH" /* AUTH_TAG_MISMATCH */
          );
        } finally {
          zeroize(nonce, aad);
        }
        const sliceStartInChunk = Math.max(
          0,
          startPlaintextByte - chunkDesc.plaintextStartInBlob
        );
        const sliceEndExclusiveInChunk = Math.min(
          chunkPt.byteLength,
          endPlaintextByteInclusive - chunkDesc.plaintextStartInBlob + 1
        );
        const subSlice = chunkPt.subarray(sliceStartInChunk, sliceEndExclusiveInChunk);
        output.set(subSlice, outOffset);
        outOffset += subSlice.byteLength;
        zeroize(chunkPt);
      }
      return output;
    } finally {
      zeroize(fileKey);
    }
  }

  // src/lib/zk/metaAndDedup.ts
  var DEDUP_STREAM_BLOCK_BYTES = 65536;
  async function* iterateSourceChunks(source) {
    if (source instanceof Uint8Array) {
      yield source;
      return;
    }
    if (typeof ReadableStream !== "undefined" && source instanceof ReadableStream) {
      const reader = source.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value && value.byteLength > 0) yield value;
        }
      } finally {
        reader.releaseLock();
      }
      return;
    }
    if (Symbol.asyncIterator in source) {
      for await (const c of source) {
        if (c && c.byteLength > 0) yield c;
      }
      return;
    }
    if (Symbol.iterator in source) {
      for (const c of source) {
        if (c && c.byteLength > 0) yield c;
      }
      return;
    }
    throw new ZkCryptoError("INVALID_PARAMETER" /* INVALID_PARAMETER */, "Unsupported stream source for computeDedupTag.");
  }
  async function computeDedupTag(dedupKey, source, cryptoProvider = defaultCryptoProvider) {
    if (dedupKey.byteLength !== 32) {
      throw new ZkCryptoError("INVALID_PARAMETER" /* INVALID_PARAMETER */, "dedupKey must be 32 bytes.");
    }
    const mac = cryptoProvider.createHmacSha256Stream(dedupKey);
    for await (const chunk of iterateSourceChunks(source)) {
      for (let offset = 0; offset < chunk.byteLength; offset += DEDUP_STREAM_BLOCK_BYTES) {
        const end = Math.min(chunk.byteLength, offset + DEDUP_STREAM_BLOCK_BYTES);
        mac.update(chunk.subarray(offset, end));
      }
    }
    const tagBytes = mac.digest();
    return {
      tagBytes,
      tagHex: toHex(tagBytes),
      tagB64u: toBase64Url(tagBytes)
    };
  }
  async function encryptMeta(metaKey, blobId, metadata, nonce, cryptoProvider = defaultCryptoProvider) {
    if (metaKey.byteLength !== 32) {
      throw new ZkCryptoError("INVALID_PARAMETER" /* INVALID_PARAMETER */, "metaKey must be 32 bytes.");
    }
    const canonicalBlobId = blobId.toLowerCase();
    const blobIdBytes = uuidToBytes(canonicalBlobId);
    const blobMetaKey = await cryptoProvider.hkdfSha256(
      metaKey,
      blobIdBytes,
      utf8Encode("photocloud/v2/blob-meta"),
      32
    );
    try {
      const iv = nonce ?? cryptoProvider.randomBytes(12);
      if (iv.byteLength !== 12) {
        throw new ZkCryptoError("INVALID_PARAMETER" /* INVALID_PARAMETER */, "metadata nonce must be 12 bytes.");
      }
      const jsonStr = typeof metadata === "string" ? metadata : JSON.stringify(metadata);
      const ptBytes = utf8Encode(jsonStr);
      const aad = utf8Encode(`meta|${canonicalBlobId}`);
      const ctWithTag = await cryptoProvider.aes256GcmEncrypt(blobMetaKey, iv, ptBytes, aad);
      zeroize(ptBytes);
      return concatBytes(iv, ctWithTag);
    } finally {
      zeroize(blobMetaKey);
    }
  }
  async function decryptMeta(metaKey, blobId, encryptedMeta, cryptoProvider = defaultCryptoProvider) {
    if (metaKey.byteLength !== 32) {
      throw new ZkCryptoError("INVALID_PARAMETER" /* INVALID_PARAMETER */, "metaKey must be 32 bytes.");
    }
    if (encryptedMeta.byteLength < 12 + 16) {
      throw new ZkCryptoError(
        "TRUNCATED_BLOB" /* TRUNCATED_BLOB */,
        "encryptedMeta is shorter than minimum 28 bytes (12B nonce + 16B tag)."
      );
    }
    const canonicalBlobId = blobId.toLowerCase();
    const blobIdBytes = uuidToBytes(canonicalBlobId);
    const blobMetaKey = await cryptoProvider.hkdfSha256(
      metaKey,
      blobIdBytes,
      utf8Encode("photocloud/v2/blob-meta"),
      32
    );
    try {
      const iv = encryptedMeta.subarray(0, 12);
      const ctWithTag = encryptedMeta.subarray(12);
      const aad = utf8Encode(`meta|${canonicalBlobId}`);
      const ptBytes = await cryptoProvider.aes256GcmDecrypt(
        blobMetaKey,
        iv,
        ctWithTag,
        aad,
        "AUTH_TAG_MISMATCH" /* AUTH_TAG_MISMATCH */
      );
      try {
        const jsonStr = utf8Decode(ptBytes);
        return JSON.parse(jsonStr);
      } catch {
        throw new ZkCryptoError("MALFORMED_HEADER" /* MALFORMED_HEADER */, "Decrypted metadata is not valid UTF-8 JSON.");
      } finally {
        zeroize(ptBytes);
      }
    } finally {
      zeroize(blobMetaKey);
    }
  }
  async function encryptThumbnail(thumbKey, blobId, variant, thumbPlaintext, nonce, cryptoProvider = defaultCryptoProvider) {
    if (thumbKey.byteLength !== 32) {
      throw new ZkCryptoError("INVALID_PARAMETER" /* INVALID_PARAMETER */, "thumbKey must be 32 bytes.");
    }
    if (variant !== "320" && variant !== "1280") {
      throw new ZkCryptoError("INVALID_PARAMETER" /* INVALID_PARAMETER */, 'Thumbnail variant must be "320" or "1280".');
    }
    const canonicalBlobId = blobId.toLowerCase();
    const blobIdBytes = uuidToBytes(canonicalBlobId);
    const blobThumbKey = await cryptoProvider.hkdfSha256(
      thumbKey,
      blobIdBytes,
      utf8Encode(`photocloud/v2/thumb/${variant}`),
      32
    );
    try {
      const iv = nonce ?? cryptoProvider.randomBytes(12);
      if (iv.byteLength !== 12) {
        throw new ZkCryptoError("INVALID_PARAMETER" /* INVALID_PARAMETER */, "thumbnail nonce must be 12 bytes.");
      }
      const aad = utf8Encode(`thumb|${canonicalBlobId}|${variant}`);
      const ctWithTag = await cryptoProvider.aes256GcmEncrypt(blobThumbKey, iv, thumbPlaintext, aad);
      return concatBytes(iv, ctWithTag);
    } finally {
      zeroize(blobThumbKey);
    }
  }
  async function decryptThumbnail(thumbKey, blobId, variant, encryptedThumb, cryptoProvider = defaultCryptoProvider) {
    if (thumbKey.byteLength !== 32) {
      throw new ZkCryptoError("INVALID_PARAMETER" /* INVALID_PARAMETER */, "thumbKey must be 32 bytes.");
    }
    if (variant !== "320" && variant !== "1280") {
      throw new ZkCryptoError("INVALID_PARAMETER" /* INVALID_PARAMETER */, 'Thumbnail variant must be "320" or "1280".');
    }
    if (encryptedThumb.byteLength < 12 + 16) {
      throw new ZkCryptoError("TRUNCATED_BLOB" /* TRUNCATED_BLOB */, "encryptedThumb shorter than 28 bytes.");
    }
    const canonicalBlobId = blobId.toLowerCase();
    const blobIdBytes = uuidToBytes(canonicalBlobId);
    const blobThumbKey = await cryptoProvider.hkdfSha256(
      thumbKey,
      blobIdBytes,
      utf8Encode(`photocloud/v2/thumb/${variant}`),
      32
    );
    try {
      const iv = encryptedThumb.subarray(0, 12);
      const ctWithTag = encryptedThumb.subarray(12);
      const aad = utf8Encode(`thumb|${canonicalBlobId}|${variant}`);
      return await cryptoProvider.aes256GcmDecrypt(
        blobThumbKey,
        iv,
        ctWithTag,
        aad,
        "AUTH_TAG_MISMATCH" /* AUTH_TAG_MISMATCH */
      );
    } finally {
      zeroize(blobThumbKey);
    }
  }
  async function encryptAlbums(metaKey, userId, catalog, revision, nonce, cryptoProvider = defaultCryptoProvider) {
    if (metaKey.byteLength !== 32) {
      throw new ZkCryptoError("INVALID_PARAMETER" /* INVALID_PARAMETER */, "metaKey must be 32 bytes.");
    }
    if (!Number.isInteger(revision) || revision < 1) {
      throw new ZkCryptoError("INVALID_PARAMETER" /* INVALID_PARAMETER */, "Album catalog revision must be >= 1.");
    }
    const canonicalUserId = userId.toLowerCase();
    uuidToBytes(canonicalUserId);
    const albumCatalogKey = await cryptoProvider.hkdfSha256(
      metaKey,
      utf8Encode(canonicalUserId),
      utf8Encode("photocloud/v2/albums"),
      32
    );
    try {
      const iv = nonce ?? cryptoProvider.randomBytes(12);
      if (iv.byteLength !== 12) {
        throw new ZkCryptoError("INVALID_PARAMETER" /* INVALID_PARAMETER */, "albums nonce must be 12 bytes.");
      }
      const jsonStr = typeof catalog === "string" ? catalog : JSON.stringify(catalog);
      const ptBytes = utf8Encode(jsonStr);
      const aad = utf8Encode(`albums|${canonicalUserId}|${revision}`);
      const ctWithTag = await cryptoProvider.aes256GcmEncrypt(albumCatalogKey, iv, ptBytes, aad);
      zeroize(ptBytes);
      const revPrefix = new Uint8Array(4);
      new DataView(revPrefix.buffer).setUint32(0, revision >>> 0, false);
      return concatBytes(revPrefix, iv, ctWithTag);
    } finally {
      zeroize(albumCatalogKey);
    }
  }
  async function decryptAlbums(metaKey, userId, encryptedPayload, cryptoProvider = defaultCryptoProvider) {
    if (metaKey.byteLength !== 32) {
      throw new ZkCryptoError("INVALID_PARAMETER" /* INVALID_PARAMETER */, "metaKey must be 32 bytes.");
    }
    if (encryptedPayload.byteLength < 4 + 12 + 16) {
      throw new ZkCryptoError("TRUNCATED_BLOB" /* TRUNCATED_BLOB */, "Encrypted album payload shorter than 32 bytes.");
    }
    const canonicalUserId = userId.toLowerCase();
    uuidToBytes(canonicalUserId);
    const dv = new DataView(
      encryptedPayload.buffer,
      encryptedPayload.byteOffset,
      encryptedPayload.byteLength
    );
    const revision = dv.getUint32(0, false);
    if (revision < 1) {
      throw new ZkCryptoError("MALFORMED_HEADER" /* MALFORMED_HEADER */, "Invalid album catalog revision 0.");
    }
    const albumCatalogKey = await cryptoProvider.hkdfSha256(
      metaKey,
      utf8Encode(canonicalUserId),
      utf8Encode("photocloud/v2/albums"),
      32
    );
    try {
      const iv = encryptedPayload.subarray(4, 16);
      const ctWithTag = encryptedPayload.subarray(16);
      const aad = utf8Encode(`albums|${canonicalUserId}|${revision}`);
      const ptBytes = await cryptoProvider.aes256GcmDecrypt(
        albumCatalogKey,
        iv,
        ctWithTag,
        aad,
        "AUTH_TAG_MISMATCH" /* AUTH_TAG_MISMATCH */
      );
      try {
        const catalog = JSON.parse(utf8Decode(ptBytes));
        return { revision, catalog };
      } finally {
        zeroize(ptBytes);
      }
    } finally {
      zeroize(albumCatalogKey);
    }
  }

  // src/lib/zk/worker.ts
  async function handleZkWorkerRequest(req, emit) {
    try {
      switch (req.type) {
        case "argon2id": {
          const pw = new Uint8Array(req.password);
          const salt = new Uint8Array(req.salt);
          try {
            const tag = await defaultArgon2idProvider.derive(pw, salt, req.params, {
              onProgress: (progress) => {
                emit({ type: "progress", requestId: req.requestId, progress });
              }
            });
            emit({ type: "argon2idResult", requestId: req.requestId, tag });
          } finally {
            zeroize(pw);
          }
          return;
        }
        case "deriveRootAndKeys": {
          const accountKey = new Uint8Array(req.accountKey);
          const userSalt = new Uint8Array(req.userSalt);
          try {
            const root = await deriveRoot({
              accountKey,
              userSalt,
              passphrase: req.passphrase,
              argon2Params: req.argon2Params,
              onProgress: (progress) => {
                emit({ type: "progress", requestId: req.requestId, progress });
              }
            });
            const { kek, authSecret } = await deriveKekAndAuthSecret(root);
            emit({
              type: "deriveRootAndKeysResult",
              requestId: req.requestId,
              root,
              kek,
              authSecret
            });
          } finally {
            zeroize(accountKey);
          }
          return;
        }
        case "encryptBlob": {
          const fkWrapKey = new Uint8Array(req.fkWrapKey);
          const dedupKey = req.dedupKey ? new Uint8Array(req.dedupKey) : void 0;
          try {
            const { ciphertext, result } = await encryptBlobToBytes(req.plaintext, {
              fkWrapKey,
              blobId: req.blobId,
              chunkSizeLog2: req.chunkSizeLog2,
              dedupKey,
              onProgress: ({ chunkIndex, plaintextBytesProcessed }) => {
                emit({
                  type: "blobProgress",
                  requestId: req.requestId,
                  chunkIndex,
                  plaintextBytesProcessed
                });
              }
            });
            emit({
              type: "encryptBlobResult",
              requestId: req.requestId,
              ciphertext,
              result
            });
          } finally {
            zeroize(fkWrapKey, dedupKey);
          }
          return;
        }
        case "decryptBlob": {
          const fkWrapKey = new Uint8Array(req.fkWrapKey);
          try {
            const { plaintext } = await decryptBlobToBytes(req.ciphertext, {
              fkWrapKey,
              expectedBlobId: req.expectedBlobId
            });
            emit({
              type: "decryptBlobResult",
              requestId: req.requestId,
              plaintext
            });
          } finally {
            zeroize(fkWrapKey);
          }
          return;
        }
      }
    } catch (err) {
      if (err instanceof ZkCryptoError) {
        emit({
          type: "error",
          requestId: req.requestId,
          code: err.code,
          message: err.message
        });
      } else {
        emit({
          type: "error",
          requestId: req.requestId,
          code: "INVALID_PARAMETER" /* INVALID_PARAMETER */,
          message: "Unexpected cryptographic worker error."
        });
      }
    }
  }
  function createInProcessZkWorker() {
    const worker = {
      onmessage: null,
      postMessage(message) {
        void handleZkWorkerRequest(message, (resp) => {
          if (worker.onmessage) {
            worker.onmessage({ data: resp });
          }
        });
      }
    };
    return worker;
  }
  var ZkWorkerClient = class {
    worker;
    nextId = 1;
    pending = /* @__PURE__ */ new Map();
    constructor(worker) {
      this.worker = worker ?? createInProcessZkWorker();
      this.worker.onmessage = (event) => {
        const msg = event.data;
        const entry = this.pending.get(msg.requestId);
        if (!entry) return;
        if (msg.type === "progress") {
          entry.onProgress?.(msg.progress);
          return;
        }
        if (msg.type === "blobProgress") {
          entry.onBlobProgress?.({
            chunkIndex: msg.chunkIndex,
            plaintextBytesProcessed: msg.plaintextBytesProcessed
          });
          return;
        }
        this.pending.delete(msg.requestId);
        if (msg.type === "error") {
          entry.reject(new ZkCryptoError(msg.code, msg.message));
        } else {
          entry.resolve(msg);
        }
      };
    }
    async deriveArgon2id(password, salt, params, onProgress) {
      const requestId = `req_${this.nextId++}`;
      const resp = await new Promise((resolve, reject) => {
        this.pending.set(requestId, { resolve, reject, onProgress });
        this.worker.postMessage({
          type: "argon2id",
          requestId,
          password,
          salt,
          params
        });
      });
      if (resp.type !== "argon2idResult") {
        throw new ZkCryptoError("INVALID_PARAMETER" /* INVALID_PARAMETER */, "Unexpected worker response.");
      }
      return resp.tag;
    }
    async deriveRootAndKeys(params) {
      const requestId = `req_${this.nextId++}`;
      const resp = await new Promise((resolve, reject) => {
        this.pending.set(requestId, { resolve, reject, onProgress: params.onProgress });
        this.worker.postMessage({
          type: "deriveRootAndKeys",
          requestId,
          accountKey: params.accountKey,
          userSalt: params.userSalt,
          passphrase: params.passphrase,
          argon2Params: params.argon2Params
        });
      });
      if (resp.type !== "deriveRootAndKeysResult") {
        throw new ZkCryptoError("INVALID_PARAMETER" /* INVALID_PARAMETER */, "Unexpected worker response.");
      }
      return {
        root: resp.root,
        kek: resp.kek,
        authSecret: resp.authSecret
      };
    }
    async encryptBlob(params) {
      const requestId = `req_${this.nextId++}`;
      const resp = await new Promise((resolve, reject) => {
        this.pending.set(requestId, {
          resolve,
          reject,
          onBlobProgress: params.onProgress
        });
        this.worker.postMessage({
          type: "encryptBlob",
          requestId,
          plaintext: params.plaintext,
          fkWrapKey: params.fkWrapKey,
          blobId: params.blobId,
          chunkSizeLog2: params.chunkSizeLog2,
          dedupKey: params.dedupKey
        });
      });
      if (resp.type !== "encryptBlobResult") {
        throw new ZkCryptoError("INVALID_PARAMETER" /* INVALID_PARAMETER */, "Unexpected worker response.");
      }
      return { ciphertext: resp.ciphertext, result: resp.result };
    }
    terminate() {
      this.worker.terminate?.();
      this.pending.clear();
    }
  };

  // src/client/zk-sdk/kdfPolicy.ts
  var MIN_ARGON2_MEMORY_KIB = 65536;
  var MIN_ARGON2_ITERATIONS = 3;
  var MIN_ARGON2_PARALLELISM = 1;
  var MIN_SALT_BYTES = 16;
  var MIN_PASSPHRASE_LENGTH = 12;
  var DEFAULT_CLIENT_KDF_PARAMS = {
    ...DEFAULT_ARGON2ID_PARAMS
  };
  function validateKdfParamsFloor(firstArg, secondArg) {
    let rawKdfParams;
    let saltBytes = new Uint8Array(MIN_SALT_BYTES);
    if (typeof firstArg === "string" || firstArg instanceof Uint8Array) {
      if (typeof firstArg === "string") {
        if (firstArg.trim().length === 0) {
          throw new ZkCryptoError("INVALID_PARAMETER" /* INVALID_PARAMETER */, "Salt KDF mancante o vuoto.");
        }
        try {
          saltBytes = fromBase64Url(firstArg.trim());
        } catch {
          throw new ZkCryptoError("INVALID_PARAMETER" /* INVALID_PARAMETER */, "Salt KDF non \xE8 base64url valido.");
        }
      } else {
        saltBytes = firstArg;
      }
      if (!secondArg || typeof secondArg !== "object") {
        throw new ZkCryptoError("INVALID_PARAMETER" /* INVALID_PARAMETER */, "Parametri KDF mancanti.");
      }
      rawKdfParams = secondArg;
    } else if (firstArg && typeof firstArg === "object") {
      rawKdfParams = firstArg;
      if (secondArg instanceof Uint8Array) {
        saltBytes = secondArg;
      } else if (typeof secondArg === "string") {
        saltBytes = fromBase64Url(secondArg.trim());
      }
    } else {
      throw new ZkCryptoError("INVALID_PARAMETER" /* INVALID_PARAMETER */, "Parametri KDF mancanti.");
    }
    if (saltBytes.byteLength < MIN_SALT_BYTES) {
      throw new ZkCryptoError(
        "INVALID_PARAMETER" /* INVALID_PARAMETER */,
        `KDF_FLOOR_VIOLATION: Salt KDF troppo corto (${saltBytes.byteLength} byte, minimo ${MIN_SALT_BYTES} byte).`
      );
    }
    if (rawKdfParams.algorithm !== void 0) {
      const alg = String(rawKdfParams.algorithm || "").toLowerCase();
      if (alg !== "argon2id") {
        throw new ZkCryptoError(
          "INVALID_PARAMETER" /* INVALID_PARAMETER */,
          "KDF_FLOOR_VIOLATION: Algoritmo KDF non supportato (richiesto Argon2id)."
        );
      }
    }
    const memoryKiB = Number(rawKdfParams.memoryKiB);
    const iterations = Number(rawKdfParams.iterations);
    const parallelism = Number(rawKdfParams.parallelism);
    if (!Number.isSafeInteger(memoryKiB) || memoryKiB < MIN_ARGON2_MEMORY_KIB) {
      throw new ZkCryptoError(
        "INVALID_PARAMETER" /* INVALID_PARAMETER */,
        `KDF_FLOOR_VIOLATION: memoryKiB (${memoryKiB}) inferiore al floor minimo (${MIN_ARGON2_MEMORY_KIB} KiB).`
      );
    }
    if (!Number.isSafeInteger(iterations) || iterations < MIN_ARGON2_ITERATIONS) {
      throw new ZkCryptoError(
        "INVALID_PARAMETER" /* INVALID_PARAMETER */,
        `KDF_FLOOR_VIOLATION: iterations (${iterations}) inferiore al floor minimo (${MIN_ARGON2_ITERATIONS}).`
      );
    }
    if (!Number.isSafeInteger(parallelism) || parallelism < MIN_ARGON2_PARALLELISM) {
      throw new ZkCryptoError(
        "INVALID_PARAMETER" /* INVALID_PARAMETER */,
        `KDF_FLOOR_VIOLATION: parallelism (${parallelism}) inferiore al floor minimo (${MIN_ARGON2_PARALLELISM}).`
      );
    }
    const kdfParams = {
      algorithm: "Argon2id",
      memoryKiB,
      iterations,
      parallelism
    };
    return {
      valid: true,
      saltBytes,
      kdfParams,
      argon2Params: {
        memoryKiB,
        iterations,
        parallelism,
        hashLength: 32
      }
    };
  }
  var InMemoryKdfPinningStore = class {
    records = /* @__PURE__ */ new Map();
    get(username) {
      return this.records.get(username.trim().toLowerCase()) ?? null;
    }
    set(record) {
      this.records.set(record.username.trim().toLowerCase(), {
        ...record,
        kdfParams: { ...record.kdfParams }
      });
    }
  };
  function checkAndPinKdfParameters(store, username, salt, kdfParams, nowMs = Date.now()) {
    const normalizedUser = username.trim().toLowerCase();
    const previous = store.get(normalizedUser);
    const current = {
      username: normalizedUser,
      salt,
      kdfParams: {
        algorithm: "Argon2id",
        memoryKiB: kdfParams.memoryKiB,
        iterations: kdfParams.iterations,
        parallelism: kdfParams.parallelism
      },
      pinnedAt: nowMs
    };
    if (!previous) {
      store.set(current);
      return { changed: false, previous: null, current };
    }
    const changed = previous.salt !== salt || previous.kdfParams.memoryKiB !== kdfParams.memoryKiB || previous.kdfParams.iterations !== kdfParams.iterations || previous.kdfParams.parallelism !== kdfParams.parallelism;
    store.set(current);
    return { changed, previous, current };
  }
  function evaluatePassphraseStrength(passphrase) {
    const normalized = (passphrase ?? "").normalize("NFC");
    const len = Array.from(normalized).length;
    if (len < MIN_PASSPHRASE_LENGTH) {
      return {
        valid: false,
        normalizedLength: len,
        score: 0,
        label: "insufficient",
        estimatedBits: len * 3,
        feedback: `La passphrase deve contenere almeno ${MIN_PASSPHRASE_LENGTH} caratteri (attuali: ${len}).`
      };
    }
    let classes = 0;
    let pool = 0;
    if (/[a-z]/.test(normalized)) {
      classes += 1;
      pool += 26;
    }
    if (/[A-Z]/.test(normalized)) {
      classes += 1;
      pool += 26;
    }
    if (/[0-9]/.test(normalized)) {
      classes += 1;
      pool += 10;
    }
    if (/[^a-zA-Z0-9]/.test(normalized)) {
      classes += 1;
      pool += 32;
    }
    const uniqueChars = new Set(Array.from(normalized)).size;
    const estimatedBits = Math.round(len * Math.log2(Math.max(2, pool)));
    if (uniqueChars < 4) {
      return {
        valid: false,
        normalizedLength: len,
        score: 1,
        label: "weak",
        estimatedBits,
        feedback: "La passphrase contiene troppi caratteri ripetuti."
      };
    }
    let score = 2;
    if (len >= 20 && classes >= 3 && uniqueChars >= 10) {
      score = 4;
    } else if (len >= 16 || len >= 12 && classes >= 3 && uniqueChars >= 8) {
      score = 3;
    } else if (len >= 12 && classes >= 2) {
      score = 2;
    } else {
      score = 1;
    }
    const labels = {
      1: "weak",
      2: "fair",
      3: "strong",
      4: "excellent"
    };
    return {
      valid: true,
      normalizedLength: len,
      score,
      label: labels[score],
      estimatedBits,
      feedback: `Passphrase valida (${labels[score]}).`
    };
  }
  function formatRecoveryCode(accountKeyBytes) {
    if (accountKeyBytes.byteLength !== 32) {
      throw new ZkCryptoError("INVALID_PARAMETER" /* INVALID_PARAMETER */, "accountKey deve essere di 32 byte.");
    }
    const hex = toHex(accountKeyBytes).toUpperCase();
    const groups = [];
    for (let i = 0; i < hex.length; i += 8) {
      groups.push(hex.slice(i, i + 8));
    }
    return groups.join("-");
  }
  function parseRecoveryCodeToAccountKey(recoveryCode) {
    const cleaned = recoveryCode.replace(/[\s-]/g, "").toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(cleaned)) {
      throw new ZkCryptoError(
        "INVALID_PARAMETER" /* INVALID_PARAMETER */,
        "Codice di recupero non valido (attesi 64 caratteri hex)."
      );
    }
    return fromHex(cleaned);
  }
  function verifyRecoveryCodeConfirmation(expectedRecoveryCode, userConfirmationInput) {
    const cleanExpected = expectedRecoveryCode.replace(/[\s-]/g, "").toUpperCase();
    const cleanInput = (userConfirmationInput || "").replace(/[\s-]/g, "").toUpperCase();
    if (cleanExpected.length !== 64 || cleanInput.length < 8) {
      return false;
    }
    if (cleanInput.length === 64) {
      return cleanInput === cleanExpected;
    }
    const expectedTail8 = cleanExpected.slice(-8);
    return cleanInput === expectedTail8;
  }

  // src/client/zk-sdk/shareCrypto.ts
  var INFO_SHARE_WRAP = utf8Encode("photocloud/v2/share/wrap");
  var INFO_SHARE_META = utf8Encode("photocloud/v2/share/meta");
  var EMPTY_SALT = new Uint8Array(0);
  var GCM_NONCE_LEN = 12;
  var GCM_TAG_LEN = 16;
  async function deriveShareSubkeys(shareKey, crypto = defaultCryptoProvider) {
    if (shareKey.byteLength !== 32) {
      throw new ZkCryptoError("INVALID_PARAMETER" /* INVALID_PARAMETER */, "shareKey deve essere di 32 byte.");
    }
    const shareWrapKey = await crypto.hkdfSha256(shareKey, EMPTY_SALT, INFO_SHARE_WRAP, 32);
    const shareMetaKey = await crypto.hkdfSha256(shareKey, EMPTY_SALT, INFO_SHARE_META, 32);
    return { shareWrapKey, shareMetaKey };
  }
  async function encryptShareManifest(manifest, shareKey, shareId, crypto = defaultCryptoProvider) {
    const { shareWrapKey, shareMetaKey } = await deriveShareSubkeys(shareKey, crypto);
    try {
      const nonce = crypto.randomBytes(GCM_NONCE_LEN);
      const aad = utf8Encode(`share-manifest|${shareId.toLowerCase()}`);
      const plaintext = utf8Encode(JSON.stringify(manifest));
      const ctAndTag = await crypto.aes256GcmEncrypt(shareMetaKey, nonce, plaintext, aad);
      return toBase64Url(concatBytes(nonce, ctAndTag));
    } finally {
      zeroize(shareWrapKey, shareMetaKey);
    }
  }
  async function decryptShareManifest(shareManifestB64, shareKey, shareId, crypto = defaultCryptoProvider) {
    const { shareWrapKey, shareMetaKey } = await deriveShareSubkeys(shareKey, crypto);
    try {
      const raw = fromBase64Url(shareManifestB64);
      if (raw.byteLength < GCM_NONCE_LEN + GCM_TAG_LEN + 2) {
        throw new ZkCryptoError("TRUNCATED_BLOB" /* TRUNCATED_BLOB */, "shareManifest troppo corto.");
      }
      const nonce = raw.subarray(0, GCM_NONCE_LEN);
      const ctAndTag = raw.subarray(GCM_NONCE_LEN);
      const aad = utf8Encode(`share-manifest|${shareId.toLowerCase()}`);
      const plaintext = await crypto.aes256GcmDecrypt(
        shareMetaKey,
        nonce,
        ctAndTag,
        aad,
        "AUTH_TAG_MISMATCH" /* AUTH_TAG_MISMATCH */
      );
      const parsed = JSON.parse(utf8Decode(plaintext));
      if (!parsed || parsed.v !== 1 || !Array.isArray(parsed.items)) {
        throw new ZkCryptoError("MALFORMED_HEADER" /* MALFORMED_HEADER */, "Struttura shareManifest non valida.");
      }
      return parsed;
    } finally {
      zeroize(shareWrapKey, shareMetaKey);
    }
  }
  async function encryptShareItemMeta(meta, shareKey, shareId, blobId, crypto = defaultCryptoProvider) {
    const { shareWrapKey, shareMetaKey } = await deriveShareSubkeys(shareKey, crypto);
    try {
      const nonce = crypto.randomBytes(GCM_NONCE_LEN);
      const aad = utf8Encode(`share-meta|${shareId.toLowerCase()}|${blobId.toLowerCase()}`);
      const plaintext = utf8Encode(JSON.stringify(meta));
      const ctAndTag = await crypto.aes256GcmEncrypt(shareMetaKey, nonce, plaintext, aad);
      return toBase64Url(concatBytes(nonce, ctAndTag));
    } finally {
      zeroize(shareWrapKey, shareMetaKey);
    }
  }
  async function decryptShareItemMeta(encMetaB64, shareKey, shareId, blobId, crypto = defaultCryptoProvider) {
    const { shareWrapKey, shareMetaKey } = await deriveShareSubkeys(shareKey, crypto);
    try {
      const raw = fromBase64Url(encMetaB64);
      if (raw.byteLength < GCM_NONCE_LEN + GCM_TAG_LEN + 2) {
        throw new ZkCryptoError("TRUNCATED_BLOB" /* TRUNCATED_BLOB */, "encItemMeta troppo corto.");
      }
      const nonce = raw.subarray(0, GCM_NONCE_LEN);
      const ctAndTag = raw.subarray(GCM_NONCE_LEN);
      const aad = utf8Encode(`share-meta|${shareId.toLowerCase()}|${blobId.toLowerCase()}`);
      const plaintext = await crypto.aes256GcmDecrypt(
        shareMetaKey,
        nonce,
        ctAndTag,
        aad,
        "AUTH_TAG_MISMATCH" /* AUTH_TAG_MISMATCH */
      );
      return JSON.parse(utf8Decode(plaintext));
    } finally {
      zeroize(shareWrapKey, shareMetaKey);
    }
  }
  async function wrapShareKeyWithPassword(shareKey, password, shareId, options) {
    const crypto = options?.crypto ?? defaultCryptoProvider;
    const argon2 = options?.argon2 ?? defaultArgon2idProvider;
    const kdfParams = options?.kdfParams ?? {
      algorithm: "Argon2id",
      memoryKiB: 65536,
      iterations: 3,
      parallelism: 1
    };
    const saltBytes = crypto.randomBytes(16);
    const saltB64 = toBase64Url(saltBytes);
    validateKdfParamsFloor(saltB64, kdfParams);
    const pwBytes = normalizePassphraseNfc(password);
    let pwKey = new Uint8Array(0);
    try {
      pwKey = await argon2.derive(pwBytes, saltBytes, {
        memoryKiB: kdfParams.memoryKiB,
        iterations: kdfParams.iterations,
        parallelism: kdfParams.parallelism,
        hashLength: 32
      });
      const nonce = crypto.randomBytes(GCM_NONCE_LEN);
      const aad = utf8Encode(`share-pw|${shareId.toLowerCase()}`);
      const ctAndTag = await crypto.aes256GcmEncrypt(pwKey, nonce, shareKey, aad);
      const wrappedShareKey = toBase64Url(concatBytes(nonce, ctAndTag));
      const envelope = {
        v: 1,
        salt: saltB64,
        kdfParams,
        wrappedShareKey
      };
      return toBase64Url(utf8Encode(JSON.stringify(envelope)));
    } finally {
      zeroize(pwBytes, pwKey);
    }
  }
  async function unwrapShareKeyWithPassword(passwordWrapB64, password, shareId, options) {
    const crypto = options?.crypto ?? defaultCryptoProvider;
    const argon2 = options?.argon2 ?? defaultArgon2idProvider;
    const decodedJson = utf8Decode(fromBase64Url(passwordWrapB64));
    const envelope = JSON.parse(decodedJson);
    const { saltBytes, kdfParams } = validateKdfParamsFloor(envelope?.salt, envelope?.kdfParams);
    const rawWrapped = fromBase64Url(envelope.wrappedShareKey);
    if (rawWrapped.byteLength !== 60) {
      throw new ZkCryptoError(
        "INVALID_PARAMETER" /* INVALID_PARAMETER */,
        "wrappedShareKey deve essere di 60 byte."
      );
    }
    const pwBytes = normalizePassphraseNfc(password);
    let pwKey = new Uint8Array(0);
    try {
      pwKey = await argon2.derive(pwBytes, saltBytes, {
        memoryKiB: kdfParams.memoryKiB,
        iterations: kdfParams.iterations,
        parallelism: kdfParams.parallelism,
        hashLength: 32
      });
      const nonce = rawWrapped.subarray(0, GCM_NONCE_LEN);
      const ctAndTag = rawWrapped.subarray(GCM_NONCE_LEN);
      const aad = utf8Encode(`share-pw|${shareId.toLowerCase()}`);
      return await crypto.aes256GcmDecrypt(
        pwKey,
        nonce,
        ctAndTag,
        aad,
        "AUTH_TAG_MISMATCH" /* AUTH_TAG_MISMATCH */
      );
    } finally {
      zeroize(pwBytes, pwKey);
    }
  }
  function buildShareUrl(baseOrigin, shareId, shareKey) {
    if (shareKey.byteLength !== 32) {
      throw new ZkCryptoError("INVALID_PARAMETER" /* INVALID_PARAMETER */, "shareKey deve essere di 32 byte.");
    }
    const cleanOrigin = baseOrigin.replace(/\/+$/, "");
    const keyB64 = toBase64Url(shareKey);
    return `${cleanOrigin}/v2/share/${encodeURIComponent(shareId)}#${keyB64}`;
  }
  function parseShareUrlFragment(urlOrHash) {
    if (urlOrHash.includes("?")) {
      const queryPart = urlOrHash.split("?")[1]?.split("#")[0] || "";
      if (/(^|&)(key|shareKey|token|k)=/i.test(queryPart)) {
        throw new ZkCryptoError(
          "INVALID_PARAMETER" /* INVALID_PARAMETER */,
          "SHARE_KEY_IN_QUERY_FORBIDDEN: La chiave di condivisione non pu\xF2 mai trovarsi nella query string."
        );
      }
    }
    const hashIdx = urlOrHash.indexOf("#");
    const rawFragment = hashIdx >= 0 ? urlOrHash.slice(hashIdx + 1).trim() : urlOrHash.trim();
    if (!rawFragment) {
      throw new ZkCryptoError("INVALID_PARAMETER" /* INVALID_PARAMETER */, "Fragment #shareKey mancante nell URL.");
    }
    const keyBytes = fromBase64Url(rawFragment);
    if (keyBytes.byteLength !== 32) {
      throw new ZkCryptoError(
        "INVALID_PARAMETER" /* INVALID_PARAMETER */,
        "shareKey nel fragment deve essere di 32 byte."
      );
    }
    return keyBytes;
  }

  // src/client/zk-sdk/zipStream.ts
  var CRC32_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) {
        c = c & 1 ? 3988292384 ^ c >>> 1 : c >>> 1;
      }
      table[i] = c >>> 0;
    }
    return table;
  })();
  function updateCrc32(crc, chunk) {
    let c = (crc ^ 4294967295) >>> 0;
    for (let i = 0; i < chunk.byteLength; i++) {
      c = CRC32_TABLE[(c ^ chunk[i]) & 255] ^ c >>> 8;
    }
    return (c ^ 4294967295) >>> 0;
  }
  function sanitizeZipEntryName(rawName, usedNames) {
    const base = rawName.replace(/[\\/:*?"<>|\x00-\x1f]/g, "_").replace(/^\.+/, "_").trim() || "file.bin";
    let candidate = base;
    let counter = 1;
    while (usedNames.has(candidate.toLowerCase())) {
      const dotIdx = base.lastIndexOf(".");
      if (dotIdx > 0) {
        candidate = `${base.slice(0, dotIdx)}_${counter}${base.slice(dotIdx)}`;
      } else {
        candidate = `${base}_${counter}`;
      }
      counter += 1;
    }
    usedNames.add(candidate.toLowerCase());
    return candidate;
  }
  function writeUint16LE(buf, offset, val) {
    buf[offset] = val & 255;
    buf[offset + 1] = val >>> 8 & 255;
  }
  function writeUint32LE(buf, offset, val) {
    buf[offset] = val & 255;
    buf[offset + 1] = val >>> 8 & 255;
    buf[offset + 2] = val >>> 16 & 255;
    buf[offset + 3] = val >>> 24 & 255;
  }
  async function* generateZipStream(entries) {
    const centralDirectoryRecords = [];
    const usedNames = /* @__PURE__ */ new Set();
    let offset = 0;
    let totalEntries = 0;
    for await (const entry of entries) {
      const safeName = sanitizeZipEntryName(entry.name, usedNames);
      const nameBytes = utf8Encode(safeName);
      const localHeaderOffset = offset;
      const flags = 8 | 2048;
      const localHeader = new Uint8Array(30 + nameBytes.byteLength);
      writeUint32LE(localHeader, 0, 67324752);
      writeUint16LE(localHeader, 4, 20);
      writeUint16LE(localHeader, 6, flags);
      writeUint16LE(localHeader, 8, 0);
      writeUint16LE(localHeader, 10, 0);
      writeUint16LE(localHeader, 12, 8448);
      writeUint32LE(localHeader, 14, 0);
      writeUint32LE(localHeader, 18, 0);
      writeUint32LE(localHeader, 22, 0);
      writeUint16LE(localHeader, 26, nameBytes.byteLength);
      writeUint16LE(localHeader, 28, 0);
      localHeader.set(nameBytes, 30);
      yield localHeader;
      offset += localHeader.byteLength;
      let crc = 0;
      let fileSize = 0;
      for await (const chunk of entry.stream()) {
        if (chunk.byteLength === 0) continue;
        crc = updateCrc32(crc, chunk);
        fileSize += chunk.byteLength;
        offset += chunk.byteLength;
        yield chunk;
      }
      const dataDesc = new Uint8Array(16);
      writeUint32LE(dataDesc, 0, 134695760);
      writeUint32LE(dataDesc, 4, crc);
      writeUint32LE(dataDesc, 8, fileSize);
      writeUint32LE(dataDesc, 12, fileSize);
      yield dataDesc;
      offset += dataDesc.byteLength;
      const cdHeader = new Uint8Array(46 + nameBytes.byteLength);
      writeUint32LE(cdHeader, 0, 33639248);
      writeUint16LE(cdHeader, 4, 20);
      writeUint16LE(cdHeader, 6, 20);
      writeUint16LE(cdHeader, 8, flags);
      writeUint16LE(cdHeader, 10, 0);
      writeUint16LE(cdHeader, 12, 0);
      writeUint16LE(cdHeader, 14, 8448);
      writeUint32LE(cdHeader, 16, crc);
      writeUint32LE(cdHeader, 20, fileSize);
      writeUint32LE(cdHeader, 24, fileSize);
      writeUint16LE(cdHeader, 28, nameBytes.byteLength);
      writeUint16LE(cdHeader, 30, 0);
      writeUint16LE(cdHeader, 32, 0);
      writeUint16LE(cdHeader, 34, 0);
      writeUint16LE(cdHeader, 36, 0);
      writeUint32LE(cdHeader, 38, 0);
      writeUint32LE(cdHeader, 42, localHeaderOffset);
      cdHeader.set(nameBytes, 46);
      centralDirectoryRecords.push(cdHeader);
      totalEntries += 1;
    }
    const cdStartOffset = offset;
    const cdBlob = concatBytes(...centralDirectoryRecords);
    if (cdBlob.byteLength > 0) {
      yield cdBlob;
      offset += cdBlob.byteLength;
    }
    const eocd = new Uint8Array(22);
    writeUint32LE(eocd, 0, 101010256);
    writeUint16LE(eocd, 4, 0);
    writeUint16LE(eocd, 6, 0);
    writeUint16LE(eocd, 8, totalEntries);
    writeUint16LE(eocd, 10, totalEntries);
    writeUint32LE(eocd, 12, cdBlob.byteLength);
    writeUint32LE(eocd, 16, cdStartOffset);
    writeUint16LE(eocd, 20, 0);
    yield eocd;
  }

  // src/client/zk-sdk/docPreview.ts
  var import_jszip = __toESM(require_jszip_min(), 1);
  var MAX_PREVIEW_ZIP_ENTRIES = 500;
  var MAX_PREVIEW_SINGLE_ENTRY_BYTES = 8 * 1024 * 1024;
  var MAX_PREVIEW_TOTAL_UNCOMPRESSED_BYTES = 24 * 1024 * 1024;
  var SAFE_RASTER_IMAGE_MIMES = /* @__PURE__ */ new Set([
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/gif",
    "image/bmp",
    "image/avif"
  ]);
  function isSafeRasterImageMime(mime) {
    const clean = (mime || "").split(";")[0].trim().toLowerCase();
    return SAFE_RASTER_IMAGE_MIMES.has(clean);
  }
  function isSvgMime(mime, filename = "") {
    const clean = (mime || "").split(";")[0].trim().toLowerCase();
    return clean === "image/svg+xml" || filename.toLowerCase().endsWith(".svg");
  }
  function isUntrustedActiveMime(mime, filename = "") {
    const clean = (mime || "").split(";")[0].trim().toLowerCase();
    const lower = filename.toLowerCase();
    return clean === "text/html" || clean === "application/xhtml+xml" || clean === "text/javascript" || clean === "application/javascript" || lower.endsWith(".html") || lower.endsWith(".htm") || lower.endsWith(".xhtml") || lower.endsWith(".js") || lower.endsWith(".mjs");
  }
  function classifyItemCategory(mime, filename = "") {
    const clean = (mime || "").split(";")[0].trim().toLowerCase();
    const ext = (filename.split(".").pop() || "").toLowerCase();
    if (clean.startsWith("image/") || ["jpg", "jpeg", "png", "webp", "gif", "bmp", "avif", "svg", "heic"].includes(ext)) {
      return "photo";
    }
    if (clean.startsWith("video/") || ["mp4", "webm", "mov", "mkv", "avi"].includes(ext)) {
      return "video";
    }
    if (clean.startsWith("audio/") || ["mp3", "wav", "ogg", "flac", "m4a", "aac", "opus"].includes(ext)) {
      return "audio";
    }
    if (clean === "application/pdf" || clean.includes("word") || clean.includes("spreadsheet") || clean.includes("presentation") || clean.includes("opendocument") || clean.startsWith("text/") || ["pdf", "doc", "docx", "odt", "rtf", "xls", "xlsx", "ods", "csv", "tsv", "ppt", "pptx", "odp", "txt", "md", "json", "xml", "yaml", "yml", "log"].includes(ext)) {
      return "document";
    }
    if (clean.includes("zip") || clean.includes("tar") || clean.includes("rar") || clean.includes("7z") || ["zip", "rar", "7z", "tar", "gz", "apk", "iso"].includes(ext)) {
      return "archive";
    }
    return "other";
  }
  function stripXmlTagsToPlainText(xml) {
    return xml.replace(/<\/(w:p|text:p|a:p|row|tr)>/gi, "\n").replace(/<[^>]+>/g, " ").split("\n").map((line) => line.replace(/\s+/g, " ").trim()).filter((line) => line.length > 0).slice(0, 500);
  }
  async function parseClientDocumentPreview(bytes, filename, mimeType) {
    const ext = (filename.split(".").pop() || "").toLowerCase();
    const cleanMime = (mimeType || "").split(";")[0].trim().toLowerCase();
    if (cleanMime === "application/pdf" || ext === "pdf") {
      const headerAscii = utf8Decode(bytes.subarray(0, Math.min(bytes.byteLength, 64 * 1024)));
      const versionMatch = /^%PDF-(\d+\.\d+)/.exec(headerAscii);
      const pdfVersion = versionMatch ? versionMatch[1] : "1.x";
      const pageMatches = headerAscii.match(/\/Type\s*\/Page\b/g);
      const pageCount = pageMatches ? pageMatches.length : 1;
      const textSnippets = [
        `Documento PDF verificato (PDF v${pdfVersion}, ~${pageCount} pag., ${bytes.byteLength} byte)`
      ];
      const literalRegex = /\(([^()\\]{2,160})\)\s*Tj/g;
      let m;
      while ((m = literalRegex.exec(headerAscii)) !== null) {
        const cleaned = m[1].replace(/[^\x20-\x7EÀ-ÿ]/g, "").trim();
        if (cleaned.length > 0) {
          textSnippets.push(cleaned);
        }
        if (textSnippets.length >= 50) break;
      }
      return {
        kind: "pdf",
        title: filename,
        paragraphs: textSnippets
      };
    }
    if (["docx", "odt", "xlsx", "ods", "pptx", "odp"].includes(ext)) {
      if (bytes.byteLength > MAX_PREVIEW_TOTAL_UNCOMPRESSED_BYTES) {
        throw new Error("ZIP_BOMB_LIMIT_EXCEEDED: Archivio documento troppo grande per anteprima.");
      }
      const zip = await import_jszip.default.loadAsync(bytes);
      const fileEntries = Object.values(zip.files).filter((f) => !f.dir);
      if (fileEntries.length > MAX_PREVIEW_ZIP_ENTRIES) {
        throw new Error(
          `ZIP_BOMB_LIMIT_EXCEEDED: Numero di voci (${fileEntries.length}) superiore al limite (${MAX_PREVIEW_ZIP_ENTRIES}).`
        );
      }
      let totalUncompressed = 0;
      const paragraphs = [];
      for (const entry of fileEntries) {
        const targetXml = entry.name === "word/document.xml" || entry.name === "content.xml" || entry.name === "xl/sharedStrings.xml" || /^xl\/worksheets\/sheet\d+\.xml$/i.test(entry.name) || /^ppt\/slides\/slide\d+\.xml$/i.test(entry.name);
        if (!targetXml) continue;
        const rawData = await entry.async("uint8array");
        if (rawData.byteLength > MAX_PREVIEW_SINGLE_ENTRY_BYTES) {
          throw new Error("ZIP_BOMB_LIMIT_EXCEEDED: Voce interna supera il limite di 8 MiB.");
        }
        totalUncompressed += rawData.byteLength;
        if (totalUncompressed > MAX_PREVIEW_TOTAL_UNCOMPRESSED_BYTES) {
          throw new Error("ZIP_BOMB_LIMIT_EXCEEDED: Dimensione decompressa totale supera 24 MiB.");
        }
        const xmlText = utf8Decode(rawData);
        paragraphs.push(...stripXmlTagsToPlainText(xmlText));
        if (paragraphs.length >= 500) break;
      }
      return {
        kind: "office",
        title: filename,
        paragraphs: paragraphs.slice(0, 500)
      };
    }
    if (cleanMime.startsWith("text/") || ["txt", "md", "csv", "tsv", "json", "xml", "yaml", "yml", "log", "html", "htm", "js", "ts", "py", "kt"].includes(ext)) {
      const sliced = bytes.subarray(0, Math.min(bytes.byteLength, 256 * 1024));
      const lines = utf8Decode(sliced).split(/\r?\n/).slice(0, 1e3);
      return {
        kind: "text",
        title: filename,
        paragraphs: lines
      };
    }
    return {
      kind: "unsupported",
      title: filename,
      paragraphs: [],
      warning: "Formato binario: usa il pulsante Scarica per aprirlo con un applicazione esterna."
    };
  }

  // src/client/zk-sdk/swStreamEngine.ts
  var DEFAULT_SW_TICKET_TTL_MS = 5 * 60 * 1e3;

  // src/lib/nlSearch.ts
  var MONTH_ALIASES = {
    gennaio: 1,
    febbraio: 2,
    marzo: 3,
    aprile: 4,
    maggio: 5,
    giugno: 6,
    luglio: 7,
    agosto: 8,
    settembre: 9,
    ottobre: 10,
    novembre: 11,
    dicembre: 12,
    gen: 1,
    feb: 2,
    mar: 3,
    apr: 4,
    mag: 5,
    giu: 6,
    lug: 7,
    ago: 8,
    set: 9,
    ott: 10,
    nov: 11,
    dic: 12,
    january: 1,
    february: 2,
    march: 3,
    april: 4,
    may: 5,
    june: 6,
    july: 7,
    august: 8,
    september: 9,
    october: 10,
    november: 11,
    december: 12,
    jan: 1,
    sep: 9,
    oct: 10,
    dec: 12
  };
  var STOP_WORDS = /* @__PURE__ */ new Set([
    "di",
    "del",
    "della",
    "dello",
    "dei",
    "degli",
    "delle",
    "da",
    "dal",
    "dai",
    "dalle",
    "in",
    "a",
    "al",
    "alla",
    "alle",
    "e",
    "ed",
    "o",
    "il",
    "lo",
    "la",
    "i",
    "gli",
    "le",
    "un",
    "una",
    "uno",
    "con",
    "per",
    "su",
    "tra",
    "fra",
    "the",
    "of",
    "in",
    "on",
    "at",
    "and",
    "or",
    "my",
    "me",
    "to",
    "from",
    "with",
    "mostra",
    "mostrami",
    "trova",
    "cerca",
    "vedi",
    "show",
    "find",
    "search",
    "l'",
    "d'",
    "nell'",
    "all'"
  ]);
  var DAY_MS = 86400;
  function startOfDayEpoch(d) {
    return Math.floor(new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() / 1e3);
  }
  function parseNaturalQuery(rawQuery, now = /* @__PURE__ */ new Date()) {
    const explanation = [];
    let text = ` ${String(rawQuery || "").toLowerCase()} `.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9' ]+/g, " ").replace(/\s+/g, " ").trim();
    const q = {
      textTokens: [],
      years: [],
      months: [],
      days: [],
      dateFrom: null,
      dateTo: null,
      mediaType: null,
      favoritesOnly: false,
      albums: [],
      explanation
    };
    if (!text) return q;
    const nowDayStart = startOfDayEpoch(now);
    const multiWord = [
      [/\bquesta settimana\b|\bthis week\b/, () => {
        q.dateFrom = nowDayStart - 6 * DAY_MS;
        q.dateTo = nowDayStart + DAY_MS - 1;
      }, "settimana corrente"],
      [/\bsettimana scorsa\b|\blast week\b/, () => {
        q.dateFrom = nowDayStart - 13 * DAY_MS;
        q.dateTo = nowDayStart - 7 * DAY_MS + DAY_MS - 1;
      }, "settimana scorsa"],
      [/\bquesto mese\b|\bthis month\b/, () => {
        q.months.push(now.getMonth() + 1);
        q.years.push(now.getFullYear());
      }, "mese corrente"],
      [/\bmese scorso\b|\blast month\b/, () => {
        const d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        q.months.push(d.getMonth() + 1);
        q.years.push(d.getFullYear());
      }, "mese scorso"],
      [/\bquest'?anno\b|\bthis year\b/, () => {
        q.years.push(now.getFullYear());
      }, "anno corrente"],
      [/\banno scorso\b|\blast year\b/, () => {
        q.years.push(now.getFullYear() - 1);
      }, "anno scorso"],
      [/\boggi\b|\btoday\b/, () => {
        q.dateFrom = nowDayStart;
        q.dateTo = nowDayStart + DAY_MS - 1;
      }, "oggi"],
      [/\bieri\b|\byesterday\b/, () => {
        q.dateFrom = nowDayStart - DAY_MS;
        q.dateTo = nowDayStart - 1;
      }, "ieri"],
      [/\b(ultimi|ultime)\s+(\d{1,3})\s+giorni\b|\blast\s+(\d{1,3})\s+days\b/, () => {
      }, "ultimi N giorni"]
    ];
    const lastNDays = text.match(/\b(?:ultimi|ultime)\s+(\d{1,3})\s+giorni\b/) || text.match(/\blast\s+(\d{1,3})\s+days\b/);
    if (lastNDays) {
      const n = Math.min(3650, parseInt(lastNDays[1], 10));
      q.dateFrom = nowDayStart - (n - 1) * DAY_MS;
      q.dateTo = nowDayStart + DAY_MS - 1;
      explanation.push(`ultimi ${n} giorni`);
      text = text.replace(lastNDays[0], " ");
    }
    for (const [re, apply, label] of multiWord) {
      if (label === "ultimi N giorni") continue;
      const m = text.match(re);
      if (m) {
        apply();
        explanation.push(label);
        text = text.replace(re, " ");
      }
    }
    const albumMatch = text.match(/\balbum\s+([a-z0-9][a-z0-9 _-]{0,60})/);
    if (albumMatch) {
      const name = albumMatch[1].trim().split(/\s+/).slice(0, 6).join(" ");
      if (name) {
        q.albums.push(name);
        explanation.push(`album "${name}"`);
        text = text.replace(albumMatch[0], " ");
      }
    }
    const rawTokens = text.split(" ").filter(Boolean);
    for (const tokenRaw of rawTokens) {
      const token = tokenRaw.replace(/^'+|'+$/g, "");
      if (!token) continue;
      if (/^(19|20)\d{2}$/.test(token)) {
        q.years.push(parseInt(token, 10));
        explanation.push(`anno ${token}`);
        continue;
      }
      if (MONTH_ALIASES[token] !== void 0) {
        q.months.push(MONTH_ALIASES[token]);
        explanation.push(`mese ${MONTH_ALIASES[token]}`);
        continue;
      }
      if (["foto", "photo", "photos", "immagini", "immagine", "picture", "pictures", "image", "images"].includes(token)) {
        q.mediaType = "photo";
        explanation.push("solo foto");
        continue;
      }
      if (["video", "videos", "filmato", "filmati", "clip"].includes(token)) {
        q.mediaType = "video";
        explanation.push("solo video");
        continue;
      }
      if (["file", "documento", "documenti", "document", "documents", "pdf", "doc", "docs"].includes(token)) {
        q.mediaType = "file";
        explanation.push("solo file cloud");
        continue;
      }
      if (["preferiti", "preferito", "favorite", "favorites", "favourites", "starred", "stella"].includes(token)) {
        q.favoritesOnly = true;
        explanation.push("solo preferiti");
        continue;
      }
      if (STOP_WORDS.has(token)) continue;
      q.textTokens.push(token);
    }
    q.years = [...new Set(q.years)];
    q.months = [...new Set(q.months)];
    q.textTokens = [...new Set(q.textTokens)];
    return q;
  }

  // src/client/zk-sdk/client.ts
  var UNIFORM_AUTH_ERROR_MESSAGE = "Credenziali o keyfile non validi.";
  function parseClientJpegExif(bytes, includeGps = false) {
    const empty = {
      takenAtMs: null,
      make: null,
      model: null,
      camera: null,
      iso: null,
      focalLengthMm: null,
      apertureFNumber: null,
      exposureTimeSec: null,
      gps: null
    };
    if (bytes.byteLength < 12 || bytes[0] !== 255 || bytes[1] !== 216) {
      return empty;
    }
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let offset = 2;
    let tiffBase = -1;
    let tiffEnd = -1;
    while (offset + 4 <= bytes.byteLength) {
      if (bytes[offset] !== 255) break;
      const marker = bytes[offset + 1];
      if (marker === 218 || marker === 217) break;
      const segLen = view.getUint16(offset + 2, false);
      if (segLen < 2 || offset + 2 + segLen > bytes.byteLength) break;
      if (marker === 225 && segLen >= 8 && bytes[offset + 4] === 69 && bytes[offset + 5] === 120 && bytes[offset + 6] === 105 && bytes[offset + 7] === 102 && bytes[offset + 8] === 0 && bytes[offset + 9] === 0) {
        tiffBase = offset + 10;
        tiffEnd = offset + 2 + segLen;
        break;
      }
      offset += 2 + segLen;
    }
    if (tiffBase < 0 || tiffBase + 8 > tiffEnd) return empty;
    const byteOrder = view.getUint16(tiffBase, false);
    const le = byteOrder === 18761;
    if (!le && byteOrder !== 19789) return empty;
    if (view.getUint16(tiffBase + 2, le) !== 42) return empty;
    const ifd0Rel = view.getUint32(tiffBase + 4, le);
    if (ifd0Rel < 8 || tiffBase + ifd0Rel >= tiffEnd) return empty;
    const readAscii = (relOffset, count) => {
      const abs = tiffBase + relOffset;
      if (abs < tiffBase || abs + count > tiffEnd) return "";
      let s = "";
      for (let i = 0; i < count; i++) {
        const ch = bytes[abs + i];
        if (ch === 0) break;
        s += String.fromCharCode(ch);
      }
      return s.trim();
    };
    const readRational = (relOffset) => {
      const abs = tiffBase + relOffset;
      if (abs < tiffBase || abs + 8 > tiffEnd) return null;
      const num = view.getUint32(abs, le);
      const den = view.getUint32(abs + 4, le);
      if (den === 0) return null;
      return num / den;
    };
    let make = "";
    let model = "";
    let dateTimeStr = "";
    let iso = null;
    let focalLengthMm = null;
    let apertureFNumber = null;
    let exposureTimeSec = null;
    let exifIfdRel = 0;
    let gpsIfdRel = 0;
    const parseIfd = (ifdRel, mode) => {
      const abs = tiffBase + ifdRel;
      if (abs + 2 > tiffEnd) return;
      const entries = view.getUint16(abs, le);
      for (let i = 0; i < entries; i++) {
        const entryOff = abs + 2 + i * 12;
        if (entryOff + 12 > tiffEnd) break;
        const tag = view.getUint16(entryOff, le);
        const type = view.getUint16(entryOff + 2, le);
        const count = view.getUint32(entryOff + 4, le);
        const byteSize = count * (type === 5 || type === 10 ? 8 : type === 3 ? 2 : type === 4 ? 4 : 1);
        const valRel = byteSize <= 4 ? entryOff + 8 - tiffBase : view.getUint32(entryOff + 8, le);
        if (mode === "ifd0") {
          if (tag === 271 && type === 2) make = readAscii(valRel, count);
          else if (tag === 272 && type === 2) model = readAscii(valRel, count);
          else if (tag === 306 && type === 2 && !dateTimeStr) dateTimeStr = readAscii(valRel, count);
          else if (tag === 34665 && (type === 4 || type === 3)) exifIfdRel = view.getUint32(entryOff + 8, le);
          else if (tag === 34853 && (type === 4 || type === 3)) gpsIfdRel = view.getUint32(entryOff + 8, le);
        } else if (mode === "exif") {
          if (tag === 36867 && type === 2) dateTimeStr = readAscii(valRel, count);
          else if (tag === 34855) {
            iso = type === 3 ? view.getUint16(entryOff + 8, le) : view.getUint32(entryOff + 8, le);
          } else if (tag === 37386 && type === 5) focalLengthMm = readRational(valRel);
          else if (tag === 33437 && type === 5) apertureFNumber = readRational(valRel);
          else if (tag === 33434 && type === 5) exposureTimeSec = readRational(valRel);
        }
      }
    };
    parseIfd(ifd0Rel, "ifd0");
    if (exifIfdRel > 0) parseIfd(exifIfdRel, "exif");
    let gps = null;
    if (includeGps && gpsIfdRel > 0) {
      const abs = tiffBase + gpsIfdRel;
      if (abs + 2 <= tiffEnd) {
        const entries = view.getUint16(abs, le);
        let latRef = "N";
        let lonRef = "E";
        let latVals = null;
        let lonVals = null;
        for (let i = 0; i < entries; i++) {
          const entryOff = abs + 2 + i * 12;
          if (entryOff + 12 > tiffEnd) break;
          const tag = view.getUint16(entryOff, le);
          const type = view.getUint16(entryOff + 2, le);
          const count = view.getUint32(entryOff + 4, le);
          const valRel = view.getUint32(entryOff + 8, le);
          if (tag === 1 && type === 2) latRef = readAscii(entryOff + 8 - tiffBase, 2) || "N";
          else if (tag === 3 && type === 2) lonRef = readAscii(entryOff + 8 - tiffBase, 2) || "E";
          else if (tag === 2 && type === 5 && count === 3) {
            const d = readRational(valRel);
            const m = readRational(valRel + 8);
            const s = readRational(valRel + 16);
            if (d !== null && m !== null && s !== null) latVals = [d, m, s];
          } else if (tag === 4 && type === 5 && count === 3) {
            const d = readRational(valRel);
            const m = readRational(valRel + 8);
            const s = readRational(valRel + 16);
            if (d !== null && m !== null && s !== null) lonVals = [d, m, s];
          }
        }
        if (latVals && lonVals) {
          let lat = latVals[0] + latVals[1] / 60 + latVals[2] / 3600;
          let lon = lonVals[0] + lonVals[1] / 60 + lonVals[2] / 3600;
          if (latRef.toUpperCase() === "S") lat = -lat;
          if (lonRef.toUpperCase() === "W") lon = -lon;
          if (Number.isFinite(lat) && Number.isFinite(lon)) {
            gps = { lat: Number(lat.toFixed(6)), lon: Number(lon.toFixed(6)) };
          }
        }
      }
    }
    let takenAtMs = null;
    if (dateTimeStr) {
      const m = /^(\d{4}):(\d{2}):(\d{2})\s+(\d{2}):(\d{2}):(\d{2})$/.exec(dateTimeStr);
      if (m) {
        const ts = Date.UTC(
          Number(m[1]),
          Number(m[2]) - 1,
          Number(m[3]),
          Number(m[4]),
          Number(m[5]),
          Number(m[6])
        );
        if (Number.isFinite(ts)) takenAtMs = ts;
      }
    }
    const camera = make && model ? model.toLowerCase().startsWith(make.toLowerCase()) ? model : `${make} ${model}` : model || make || null;
    return {
      takenAtMs,
      make: make || null,
      model: model || null,
      camera,
      iso,
      focalLengthMm,
      apertureFNumber,
      exposureTimeSec,
      gps
    };
  }
  function generateUuidV4() {
    if (typeof globalThis.crypto?.randomUUID === "function") {
      return globalThis.crypto.randomUUID().toLowerCase();
    }
    const b = defaultCryptoProvider.randomBytes(16);
    b[6] = b[6] & 15 | 64;
    b[8] = b[8] & 63 | 128;
    const hex = toHex(b);
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
  }
  function toReadableByteStream(source, sliceSize = 64 * 1024) {
    if (source instanceof Uint8Array) {
      let offset = 0;
      return new ReadableStream({
        pull(controller) {
          if (offset >= source.byteLength) {
            controller.close();
            return;
          }
          const end = Math.min(offset + sliceSize, source.byteLength);
          controller.enqueue(source.subarray(offset, end));
          offset = end;
        }
      });
    }
    if (typeof Blob !== "undefined" && source instanceof Blob) {
      return source.stream();
    }
    return source;
  }
  var ZkVaultClient = class _ZkVaultClient {
    baseUrl;
    fetchFn;
    workerClient;
    pinningStore;
    onAutoLock;
    onKdfParamsChangedWarning;
    userId = null;
    username = null;
    csrfToken = null;
    sessionCookieHeader = null;
    accountKey = null;
    userSalt = null;
    kdfParams = null;
    wrappedVaultKeyBytes = null;
    vaultKey = null;
    subkeys = null;
    itemsById = /* @__PURE__ */ new Map();
    albumCatalog = { v: 1, revision: 0, albums: [] };
    albumEtag = null;
    autoLockTimeoutMs;
    autoLockTimer = null;
    constructor(options = {}) {
      this.baseUrl = (options.baseUrl ?? "").replace(/\/+$/, "");
      this.fetchFn = options.fetchFn ?? globalThis.fetch.bind(globalThis);
      this.workerClient = options.workerClient ?? new ZkWorkerClient();
      this.pinningStore = options.pinningStore ?? new InMemoryKdfPinningStore();
      this.autoLockTimeoutMs = options.autoLockTimeoutMs ?? 15 * 60 * 1e3;
      this.onAutoLock = options.onAutoLock;
      this.onKdfParamsChangedWarning = options.onKdfParamsChangedWarning;
    }
    isUnlocked() {
      return this.vaultKey !== null && this.subkeys !== null && this.userId !== null;
    }
    getUserId() {
      return this.userId;
    }
    getUsername() {
      return this.username;
    }
    getCsrfToken() {
      return this.csrfToken;
    }
    setAutoLockTimeoutMs(timeoutMs) {
      this.autoLockTimeoutMs = Math.max(0, timeoutMs);
      this.touchActivity();
    }
    touchActivity() {
      if (this.autoLockTimer !== null) {
        clearTimeout(this.autoLockTimer);
        this.autoLockTimer = null;
      }
      if (this.isUnlocked() && this.autoLockTimeoutMs > 0) {
        this.autoLockTimer = setTimeout(() => {
          this.lock();
          if (this.onAutoLock) {
            this.onAutoLock();
          }
        }, this.autoLockTimeoutMs);
        if (typeof this.autoLockTimer.unref === "function") {
          this.autoLockTimer.unref();
        }
      }
    }
    lock() {
      if (this.autoLockTimer !== null) {
        clearTimeout(this.autoLockTimer);
        this.autoLockTimer = null;
      }
      if (this.subkeys) {
        this.subkeys.zeroizeAll();
      }
      zeroize(this.vaultKey, this.accountKey, this.userSalt, this.wrappedVaultKeyBytes);
      this.vaultKey = null;
      this.subkeys = null;
      this.accountKey = null;
      this.userSalt = null;
      this.wrappedVaultKeyBytes = null;
      this.itemsById.clear();
      this.albumCatalog = { v: 1, revision: 0, albums: [] };
      this.albumEtag = null;
    }
    async logout() {
      try {
        await this.apiFetch("/api/v2/logout", { method: "POST" });
      } catch {
      } finally {
        this.lock();
        this.userId = null;
        this.username = null;
        this.csrfToken = null;
        this.sessionCookieHeader = null;
      }
    }
    requireUnlocked() {
      if (!this.userId || !this.vaultKey || !this.subkeys) {
        throw new ZkCryptoError(
          "INVALID_PARAMETER" /* INVALID_PARAMETER */,
          "Il vault \xE8 bloccato. Effettua il login con keyfile e passphrase."
        );
      }
      this.touchActivity();
      return {
        userId: this.userId,
        vaultKey: this.vaultKey,
        subkeys: this.subkeys
      };
    }
    async apiFetch(path, init = {}) {
      const url = `${this.baseUrl}${path}`;
      const headers = new Headers(init.headers ?? {});
      if (this.sessionCookieHeader && !headers.has("cookie")) {
        headers.set("cookie", this.sessionCookieHeader);
      }
      const resp = await this.fetchFn(url, {
        ...init,
        headers,
        credentials: "same-origin"
      });
      const setCookie = resp.headers.get("set-cookie");
      if (setCookie) {
        const m = /(photocloud_v2_sid=[^;]+)/.exec(setCookie);
        if (m) {
          if (m[1].endsWith("=")) {
            this.sessionCookieHeader = null;
          } else {
            this.sessionCookieHeader = m[1];
          }
        }
      }
      return resp;
    }
    // ==========================================================================
    // 1. REGISTRAZIONE, LOGIN E CAMBIO PASSPHRASE (REWRAP)
    // ==========================================================================
    prepareRegistration(username, passphrase, kdfParams = DEFAULT_CLIENT_KDF_PARAMS) {
      const trimmedUser = username.trim();
      if (!/^[a-zA-Z0-9_.-]{3,64}$/.test(trimmedUser)) {
        throw new ZkCryptoError(
          "INVALID_PARAMETER" /* INVALID_PARAMETER */,
          "Username non valido (3-64 caratteri alfanumerici, punto, trattino o underscore)."
        );
      }
      const strength = evaluatePassphraseStrength(passphrase);
      if (!strength.valid) {
        throw new ZkCryptoError("INVALID_PARAMETER" /* INVALID_PARAMETER */, strength.feedback);
      }
      validateKdfParamsFloor(kdfParams);
      const accountKey = defaultCryptoProvider.randomBytes(32);
      const userSalt = defaultCryptoProvider.randomBytes(16);
      const recoveryCode = formatRecoveryCode(accountKey);
      return {
        username: trimmedUser,
        accountKey,
        userSalt,
        kdfParams: { ...kdfParams, hashLength: 32 },
        recoveryCode
      };
    }
    async register(prepared, passphrase, recoveryConfirmationInput, options = {}) {
      if (!verifyRecoveryCodeConfirmation(prepared.recoveryCode, recoveryConfirmationInput)) {
        throw new ZkCryptoError(
          "INVALID_PARAMETER" /* INVALID_PARAMETER */,
          "Conferma del codice di recupero non corrispondente. Verifica di aver salvato il Recovery Code."
        );
      }
      const strength = evaluatePassphraseStrength(passphrase);
      if (!strength.valid) {
        throw new ZkCryptoError("INVALID_PARAMETER" /* INVALID_PARAMETER */, strength.feedback);
      }
      validateKdfParamsFloor(prepared.kdfParams, prepared.userSalt);
      const userId = generateUuidV4();
      const vaultKey = defaultCryptoProvider.randomBytes(32);
      const { root, kek, authSecret } = await this.workerClient.deriveRootAndKeys({
        accountKey: prepared.accountKey,
        userSalt: prepared.userSalt,
        passphrase,
        argon2Params: prepared.kdfParams
      });
      try {
        const wrappedVkBytes = await wrapVaultKey(kek, vaultKey, userId);
        const wrappedVaultKeyB64 = toBase64Url(wrappedVkBytes);
        const saltB64 = toBase64Url(prepared.userSalt);
        const authSecretB64 = toBase64Url(authSecret);
        const body = {
          userId,
          username: prepared.username,
          salt: saltB64,
          kdfParams: {
            algorithm: "Argon2id",
            memoryKiB: prepared.kdfParams.memoryKiB,
            iterations: prepared.kdfParams.iterations,
            parallelism: prepared.kdfParams.parallelism
          },
          authSecret: authSecretB64,
          wrappedVaultKey: wrappedVaultKeyB64
        };
        if (options.setupToken) body.setupToken = options.setupToken;
        if (options.inviteToken) body.inviteToken = options.inviteToken;
        const resp = await this.apiFetch("/api/v2/register", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body)
        });
        if (!resp.ok) {
          zeroize(vaultKey);
          const errData = await resp.json().catch(() => ({}));
          throw new Error(errData.error || `REGISTRATION_FAILED_${resp.status}`);
        }
        const data = await resp.json();
        const subkeys = await deriveSubkeys(vaultKey);
        this.lock();
        this.userId = data.userId;
        this.username = data.username;
        this.csrfToken = data.csrfToken;
        this.accountKey = new Uint8Array(prepared.accountKey);
        this.userSalt = new Uint8Array(prepared.userSalt);
        this.kdfParams = { ...prepared.kdfParams, hashLength: 32 };
        this.wrappedVaultKeyBytes = wrappedVkBytes;
        this.vaultKey = vaultKey;
        this.subkeys = subkeys;
        this.touchActivity();
        checkAndPinKdfParameters(this.pinningStore, data.username, saltB64, prepared.kdfParams);
        const keyFile = {
          formatVersion: 2,
          username: data.username,
          userId: data.userId,
          accountKey: toBase64Url(prepared.accountKey),
          salt: saltB64,
          kdfParams: {
            algorithm: "Argon2id",
            memoryKiB: prepared.kdfParams.memoryKiB,
            iterations: prepared.kdfParams.iterations,
            parallelism: prepared.kdfParams.parallelism
          },
          createdAt: (/* @__PURE__ */ new Date()).toISOString()
        };
        return {
          keyFile,
          keyFileFileName: `photocloud_v2_key_${data.username}.json`,
          userId: data.userId
        };
      } finally {
        zeroize(root, kek, authSecret);
      }
    }
    recoverKeyFileFromRecoveryCode(username, recoveryCodeInput) {
      const accountKey = parseRecoveryCodeToAccountKey(recoveryCodeInput);
      try {
        return {
          formatVersion: 2,
          username: username.trim(),
          accountKey: toBase64Url(accountKey),
          createdAt: (/* @__PURE__ */ new Date()).toISOString()
        };
      } finally {
        zeroize(accountKey);
      }
    }
    async login(keyFile, passphrase, onProgress) {
      if (!keyFile || keyFile.formatVersion !== 2 || typeof keyFile.username !== "string") {
        throw new Error(UNIFORM_AUTH_ERROR_MESSAGE);
      }
      const username = keyFile.username.trim();
      if (!username || !passphrase) {
        throw new Error(UNIFORM_AUTH_ERROR_MESSAGE);
      }
      let accountKeyBytes;
      try {
        accountKeyBytes = fromBase64Url(keyFile.accountKey);
      } catch {
        throw new Error(UNIFORM_AUTH_ERROR_MESSAGE);
      }
      if (accountKeyBytes.byteLength !== 32) {
        zeroize(accountKeyBytes);
        throw new Error(UNIFORM_AUTH_ERROR_MESSAGE);
      }
      let root = null;
      let kek = null;
      let authSecret = null;
      try {
        const paramsResp = await this.apiFetch("/api/v2/login/params", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username })
        });
        if (!paramsResp.ok) {
          throw new Error(UNIFORM_AUTH_ERROR_MESSAGE);
        }
        const paramsData = await paramsResp.json();
        const { saltBytes, kdfParams: validatedKdf, argon2Params } = validateKdfParamsFloor(
          paramsData.salt,
          paramsData.kdfParams
        );
        const pinCheck = checkAndPinKdfParameters(
          this.pinningStore,
          username,
          paramsData.salt,
          validatedKdf
        );
        if (pinCheck.changed && pinCheck.previous && this.onKdfParamsChangedWarning) {
          this.onKdfParamsChangedWarning({
            username,
            previousSalt: pinCheck.previous.salt,
            newSalt: paramsData.salt,
            previousParams: pinCheck.previous.kdfParams,
            newParams: validatedKdf
          });
        } else if (!pinCheck.previous && keyFile.salt && (keyFile.salt !== paramsData.salt || keyFile.kdfParams && (keyFile.kdfParams.memoryKiB !== validatedKdf.memoryKiB || keyFile.kdfParams.iterations !== validatedKdf.iterations || keyFile.kdfParams.parallelism !== validatedKdf.parallelism)) && this.onKdfParamsChangedWarning) {
          this.onKdfParamsChangedWarning({
            username,
            previousSalt: keyFile.salt,
            newSalt: paramsData.salt,
            previousParams: keyFile.kdfParams ?? validatedKdf,
            newParams: validatedKdf
          });
        }
        const derived = await this.workerClient.deriveRootAndKeys({
          accountKey: accountKeyBytes,
          userSalt: saltBytes,
          passphrase,
          argon2Params,
          onProgress: onProgress ? (p) => onProgress(p.percent) : void 0
        });
        root = derived.root;
        kek = derived.kek;
        authSecret = derived.authSecret;
        const loginResp = await this.apiFetch("/api/v2/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            username,
            authSecret: toBase64Url(authSecret)
          })
        });
        if (!loginResp.ok) {
          throw new Error(UNIFORM_AUTH_ERROR_MESSAGE);
        }
        const loginData = await loginResp.json();
        const wrappedVkBytes = fromBase64Url(loginData.wrappedVaultKey);
        let vaultKey;
        try {
          vaultKey = await unwrapVaultKey(kek, wrappedVkBytes, loginData.userId);
        } catch {
          throw new Error(UNIFORM_AUTH_ERROR_MESSAGE);
        }
        const subkeys = await deriveSubkeys(vaultKey);
        this.lock();
        this.userId = loginData.userId;
        this.username = loginData.username;
        this.csrfToken = loginData.csrfToken;
        this.accountKey = new Uint8Array(accountKeyBytes);
        this.userSalt = saltBytes;
        this.kdfParams = argon2Params;
        this.wrappedVaultKeyBytes = wrappedVkBytes;
        this.vaultKey = vaultKey;
        this.subkeys = subkeys;
        this.touchActivity();
        return { userId: loginData.userId, username: loginData.username };
      } finally {
        zeroize(accountKeyBytes, root, kek, authSecret);
      }
    }
    async changePassphrase(oldPassphrase, newPassphrase, newKdfParams = DEFAULT_CLIENT_KDF_PARAMS) {
      const { userId, vaultKey } = this.requireUnlocked();
      if (!this.accountKey || !this.userSalt || !this.kdfParams || !this.wrappedVaultKeyBytes || !this.username) {
        throw new ZkCryptoError("INVALID_PARAMETER" /* INVALID_PARAMETER */, "Stato sessione incompleto per rewrap.");
      }
      const strength = evaluatePassphraseStrength(newPassphrase);
      if (!strength.valid) {
        throw new ZkCryptoError("INVALID_PARAMETER" /* INVALID_PARAMETER */, strength.feedback);
      }
      validateKdfParamsFloor(newKdfParams);
      const oldDerived = await this.workerClient.deriveRootAndKeys({
        accountKey: this.accountKey,
        userSalt: this.userSalt,
        passphrase: oldPassphrase,
        argon2Params: this.kdfParams
      });
      const oldAuthSecretB64 = toBase64Url(oldDerived.authSecret);
      try {
        const checkVk = await unwrapVaultKey(oldDerived.kek, this.wrappedVaultKeyBytes, userId);
        zeroize(checkVk);
      } catch {
        throw new ZkCryptoError("WRONG_KEY_OR_PASSPHRASE" /* WRONG_KEY_OR_PASSPHRASE */, UNIFORM_AUTH_ERROR_MESSAGE);
      } finally {
        zeroize(oldDerived.root, oldDerived.kek, oldDerived.authSecret);
      }
      const newSalt = defaultCryptoProvider.randomBytes(16);
      const newDerived = await this.workerClient.deriveRootAndKeys({
        accountKey: this.accountKey,
        userSalt: newSalt,
        passphrase: newPassphrase,
        argon2Params: newKdfParams
      });
      try {
        const newWrappedVk = await wrapVaultKey(newDerived.kek, vaultKey, userId);
        const newSaltB64 = toBase64Url(newSalt);
        const newWrappedVkB64 = toBase64Url(newWrappedVk);
        const resp = await this.apiFetch("/api/v2/account/rewrap", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            oldAuthSecret: oldAuthSecretB64,
            newAuthSecret: toBase64Url(newDerived.authSecret),
            newSalt: newSaltB64,
            newKdfParams: {
              algorithm: "Argon2id",
              memoryKiB: newKdfParams.memoryKiB,
              iterations: newKdfParams.iterations,
              parallelism: newKdfParams.parallelism
            },
            newWrappedVaultKey: newWrappedVkB64
          })
        });
        if (!resp.ok) {
          const err = await resp.json().catch(() => ({}));
          throw new Error(err.error || `REWRAP_FAILED_${resp.status}`);
        }
        const data = await resp.json();
        if (data.csrfToken) {
          this.csrfToken = data.csrfToken;
        }
        zeroize(this.userSalt, this.wrappedVaultKeyBytes);
        this.userSalt = newSalt;
        this.kdfParams = { ...newKdfParams, hashLength: 32 };
        this.wrappedVaultKeyBytes = newWrappedVk;
        checkAndPinKdfParameters(this.pinningStore, this.username, newSaltB64, newKdfParams);
        return {
          formatVersion: 2,
          username: this.username,
          userId,
          accountKey: toBase64Url(this.accountKey),
          salt: newSaltB64,
          kdfParams: {
            algorithm: "Argon2id",
            memoryKiB: newKdfParams.memoryKiB,
            iterations: newKdfParams.iterations,
            parallelism: newKdfParams.parallelism
          },
          createdAt: (/* @__PURE__ */ new Date()).toISOString()
        };
      } finally {
        zeroize(newDerived.root, newDerived.kek, newDerived.authSecret);
      }
    }
    // ==========================================================================
    // 2. UPLOAD STREAMING CON DEDUP OPZIONALE, PAUSA / RIPRESA / ANNULLA
    // ==========================================================================
    async checkDuplicateDedupTags(dedupTagsHex) {
      this.requireUnlocked();
      if (dedupTagsHex.length === 0) return /* @__PURE__ */ new Set();
      const resp = await this.apiFetch("/api/v2/backup/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dedupTags: dedupTagsHex })
      });
      if (!resp.ok) {
        throw new Error(`BACKUP_CHECK_FAILED_${resp.status}`);
      }
      const data = await resp.json();
      const list = data.existingTags ?? data.existing ?? [];
      return new Set(list.map((t) => t.toLowerCase()));
    }
    startUploadFile(input, options = {}) {
      const { subkeys } = this.requireUnlocked();
      const transferId = generateUuidV4();
      const blobId = generateUuidV4();
      let status = "queued";
      let paused = false;
      let cancelled = false;
      let resumeResolver = null;
      let activeUploadId = null;
      const waitIfPaused = async () => {
        while (paused && !cancelled) {
          await new Promise((resolve) => {
            resumeResolver = resolve;
          });
        }
        if (cancelled) {
          throw new Error("UPLOAD_CANCELLED");
        }
      };
      const emitProgress = (chunksCompleted, totalChunks, bytesProcessed) => {
        if (options.onProgress) {
          const progress = {
            transferId,
            fileName: input.name,
            status,
            chunksCompleted,
            totalChunks,
            bytesProcessed,
            totalBytes: input.size
          };
          options.onProgress(progress);
        }
      };
      const self2 = this;
      const promise = (async () => {
        status = "running";
        emitProgress(0, 1, 0);
        const dedupStream = toReadableByteStream(input.source);
        const { tagHex: dedupTagHex } = await computeDedupTag(subkeys.dedupKey, dedupStream);
        if (options.skipIfDuplicate) {
          const existing = await self2.checkDuplicateDedupTags([dedupTagHex]);
          if (existing.has(dedupTagHex.toLowerCase())) {
            status = "completed";
            emitProgress(1, 1, input.size);
            return { skippedDuplicate: true, blobId };
          }
        }
        await waitIfPaused();
        let exifTakenAt;
        let exifSubset = null;
        if (input.source instanceof Uint8Array && (input.mimeType.toLowerCase() === "image/jpeg" || /\.(jpe?g)$/i.test(input.name))) {
          const parsedExif = parseClientJpegExif(input.source, Boolean(options.includeGps));
          if (parsedExif.takenAtMs) exifTakenAt = parsedExif.takenAtMs;
          exifSubset = {
            make: parsedExif.make ?? void 0,
            model: parsedExif.model ?? void 0,
            iso: parsedExif.iso ?? void 0,
            focalLength: parsedExif.focalLengthMm ?? void 0,
            fNumber: parsedExif.apertureFNumber ?? void 0,
            exposureTime: parsedExif.exposureTimeSec ? `${parsedExif.exposureTimeSec}s` : void 0,
            lat: options.includeGps && parsedExif.gps ? parsedExif.gps.lat : void 0,
            lon: options.includeGps && parsedExif.gps ? parsedExif.gps.lon : void 0,
            phash: input.phash
          };
        }
        const now = Date.now();
        const metaPayload = {
          v: 1,
          name: input.name,
          mime: input.mimeType || "application/octet-stream",
          size: input.size,
          takenAt: input.takenAt ?? exifTakenAt ?? input.lastModified ?? now,
          createdAt: now,
          width: input.width ?? null,
          height: input.height ?? null,
          duration: input.durationMs ?? null,
          isFavorite: Boolean(input.favorite),
          exifSubset,
          dedupTag: dedupTagHex
        };
        const encMetaBytes = await encryptMeta(subkeys.metaKey, blobId, metaPayload);
        const encMetaB64 = toBase64Url(encMetaBytes);
        const emittedChunks = [];
        let totalCipherSize = 0;
        const gen = encryptBlobStream(toReadableByteStream(input.source), {
          fkWrapKey: subkeys.fkWrapKey,
          blobId,
          chunkSizeLog2: DEFAULT_CHUNK_SIZE_LOG2,
          dedupKey: subkeys.dedupKey
        });
        let encStreamResult;
        while (true) {
          const step = await gen.next();
          if (step.done) {
            encStreamResult = step.value;
            break;
          }
          const copy = new Uint8Array(step.value);
          emittedChunks.push(copy);
          totalCipherSize += copy.byteLength;
        }
        const fullCipher = new Uint8Array(totalCipherSize);
        let pos = 0;
        for (const piece of emittedChunks) {
          fullCipher.set(piece, pos);
          pos += piece.byteLength;
        }
        const uploadSliceSize = (1 << DEFAULT_CHUNK_SIZE_LOG2) + PCZK_GCM_TAG_LENGTH + PCZK_HEADER_LENGTH;
        const totalUploadChunks = Math.max(1, Math.ceil(fullCipher.byteLength / uploadSliceSize));
        await waitIfPaused();
        const initResp = await self2.apiFetch("/api/v2/blobs/upload/init", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            blobId,
            totalSize: fullCipher.byteLength,
            chunkSize: uploadSliceSize,
            totalChunks: totalUploadChunks,
            expectedSha256: encStreamResult.ciphertextSha256Hex,
            encMeta: encMetaB64,
            dedupTag: dedupTagHex
          })
        });
        if (!initResp.ok) {
          const err = await initResp.json().catch(() => ({}));
          throw new Error(err.error || `UPLOAD_INIT_FAILED_${initResp.status}`);
        }
        const initData = await initResp.json();
        activeUploadId = initData.uploadId;
        for (let idx = 0; idx < totalUploadChunks; idx++) {
          await waitIfPaused();
          const start = idx * uploadSliceSize;
          const end = Math.min(start + uploadSliceSize, fullCipher.byteLength);
          const slice = fullCipher.subarray(start, end);
          const putResp = await self2.apiFetch(`/api/v2/blobs/upload/${activeUploadId}/${idx}`, {
            method: "PUT",
            headers: { "Content-Type": "application/octet-stream" },
            body: slice
          });
          if (!putResp.ok) {
            throw new Error(`UPLOAD_CHUNK_FAILED_${putResp.status}`);
          }
          const plainDone = Math.min(
            input.size,
            Math.round((idx + 1) / totalUploadChunks * input.size)
          );
          emitProgress(idx + 1, totalUploadChunks, plainDone);
        }
        await waitIfPaused();
        const completeResp = await self2.apiFetch(`/api/v2/blobs/upload/${activeUploadId}/complete`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            createItem: options.createItem !== false
          })
        });
        if (!completeResp.ok) {
          const err = await completeResp.json().catch(() => ({}));
          throw new Error(err.error || `UPLOAD_COMPLETE_FAILED_${completeResp.status}`);
        }
        const completeData = await completeResp.json();
        const createdItemId = completeData.item?.id;
        const finalSize = completeData.item?.size ?? completeData.size ?? fullCipher.byteLength;
        const finalSha256 = completeData.item?.sha256 ?? completeData.sha256 ?? encStreamResult.ciphertextSha256Hex;
        if (createdItemId) {
          if (input.thumb320Plaintext && input.thumb320Plaintext.byteLength > 0) {
            const enc320 = await encryptThumbnail(
              subkeys.thumbKey,
              blobId,
              "320",
              input.thumb320Plaintext
            );
            await self2.apiFetch(`/api/v2/blobs/${blobId}/thumbs/320`, {
              method: "PUT",
              headers: { "Content-Type": "application/octet-stream" },
              body: enc320
            });
          }
          if (input.thumb1280Plaintext && input.thumb1280Plaintext.byteLength > 0) {
            const enc1280 = await encryptThumbnail(
              subkeys.thumbKey,
              blobId,
              "1280",
              input.thumb1280Plaintext
            );
            await self2.apiFetch(`/api/v2/blobs/${blobId}/thumbs/1280`, {
              method: "PUT",
              headers: { "Content-Type": "application/octet-stream" },
              body: enc1280
            });
          }
          const thumbs = [];
          if (input.thumb320Plaintext) thumbs.push(320);
          if (input.thumb1280Plaintext) thumbs.push(1280);
          self2.itemsById.set(createdItemId, {
            id: createdItemId,
            blobId,
            version: 1,
            cipherSize: finalSize,
            sha256: finalSha256,
            createdAt: now,
            updatedAt: now,
            state: "active",
            trashedAt: null,
            dedupTag: dedupTagHex,
            thumbs,
            meta: metaPayload,
            category: classifyItemCategory(metaPayload.mime, metaPayload.name)
          });
        }
        status = "completed";
        emitProgress(totalUploadChunks, totalUploadChunks, input.size);
        return {
          skippedDuplicate: false,
          itemId: createdItemId,
          blobId
        };
      })().catch(async (err) => {
        if (cancelled && activeUploadId) {
          await self2.apiFetch(`/api/v2/blobs/upload/${activeUploadId}`, {
            method: "DELETE"
          }).catch(() => {
          });
        }
        status = cancelled ? "cancelled" : "error";
        throw err;
      });
      return {
        transferId,
        get status() {
          return status;
        },
        pause() {
          if (status === "running") {
            paused = true;
            status = "paused";
          }
        },
        resume() {
          if (status === "paused") {
            paused = false;
            status = "running";
            if (resumeResolver) {
              const r = resumeResolver;
              resumeResolver = null;
              r();
            }
          }
        },
        async cancel() {
          cancelled = true;
          paused = false;
          status = "cancelled";
          if (resumeResolver) {
            const r = resumeResolver;
            resumeResolver = null;
            r();
          }
          if (activeUploadId) {
            await self2.apiFetch(`/api/v2/blobs/upload/${activeUploadId}`, {
              method: "DELETE"
            }).catch(() => {
            });
          }
        },
        promise
      };
    }
    async uploadFile(input, options = {}) {
      return this.startUploadFile(input, options).promise;
    }
    async uploadBatch(inputs, concurrency = 2, options = {}) {
      const limit = Math.max(1, Math.min(8, concurrency));
      const results = new Array(
        inputs.length
      );
      let nextIdx = 0;
      const worker = async () => {
        while (nextIdx < inputs.length) {
          const current = nextIdx++;
          results[current] = await this.uploadFile(inputs[current], options);
        }
      };
      const workers = Array.from({ length: Math.min(limit, inputs.length) }, () => worker());
      await Promise.all(workers);
      return results;
    }
    // ==========================================================================
    // 3. GALLERIA, TIMELINE, RICERCA NATURALE E STATISTICHE
    // ==========================================================================
    async syncItems(state = "all") {
      const { subkeys } = this.requireUnlocked();
      if (state === "all") {
        this.itemsById.clear();
      } else {
        for (const [id, item] of this.itemsById.entries()) {
          if (item.state === state) this.itemsById.delete(id);
        }
      }
      const statesToFetch = state === "all" ? ["active", "trashed"] : [state];
      for (const st of statesToFetch) {
        let cursor = null;
        do {
          const qs = new URLSearchParams({ limit: "100", state: st });
          if (cursor) qs.set("cursor", cursor);
          const resp = await this.apiFetch(`/api/v2/items?${qs.toString()}`);
          if (!resp.ok) {
            throw new Error(`SYNC_ITEMS_FAILED_${resp.status}`);
          }
          const page = await resp.json();
          for (const srv of page.items) {
            const encMetaBytes = fromBase64Url(srv.encMeta);
            const meta = await decryptMeta(
              subkeys.metaKey,
              srv.blobId,
              encMetaBytes
            );
            const dec = {
              id: srv.id,
              blobId: srv.blobId,
              version: srv.version,
              cipherSize: srv.size,
              sha256: srv.sha256,
              createdAt: srv.createdAt,
              updatedAt: srv.updatedAt,
              state: srv.state,
              trashedAt: srv.trashedAt,
              dedupTag: srv.dedupTag,
              thumbs: srv.thumbs ?? [],
              meta,
              category: classifyItemCategory(meta.mime, meta.name)
            };
            this.itemsById.set(dec.id, dec);
          }
          cursor = page.nextCursor;
        } while (cursor);
      }
      return this.getItems(state);
    }
    getItems(state = "active") {
      const list = [];
      for (const item of this.itemsById.values()) {
        if (state === "all" || item.state === state) {
          list.push(item);
        }
      }
      list.sort((a, b) => (b.meta.takenAt ?? b.createdAt) - (a.meta.takenAt ?? a.createdAt));
      return list;
    }
    groupItems(mode = "day") {
      const active = this.getItems("active");
      if (mode === "album") {
        const byBlob = /* @__PURE__ */ new Map();
        for (const it of active) byBlob.set(it.blobId, it);
        return this.albumCatalog.albums.map((alb) => ({
          key: alb.id,
          label: alb.title,
          items: alb.blobIds.map((bId) => byBlob.get(bId)).filter((x) => Boolean(x))
        }));
      }
      const groups = /* @__PURE__ */ new Map();
      for (const item of active) {
        const ts = item.meta.takenAt ?? item.createdAt;
        const d = new Date(ts);
        const yyyy = d.getUTCFullYear();
        const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
        const dd = String(d.getUTCDate()).padStart(2, "0");
        let key;
        let label;
        if (mode === "year") {
          key = `${yyyy}`;
          label = `${yyyy}`;
        } else if (mode === "month") {
          key = `${yyyy}-${mm}`;
          label = `${mm}/${yyyy}`;
        } else {
          key = `${yyyy}-${mm}-${dd}`;
          label = `${dd}/${mm}/${yyyy}`;
        }
        let grp = groups.get(key);
        if (!grp) {
          grp = { key, label, items: [] };
          groups.set(key, grp);
        }
        grp.items.push(item);
      }
      return Array.from(groups.values()).sort((a, b) => b.key.localeCompare(a.key));
    }
    searchItems(rawQuery, now = /* @__PURE__ */ new Date()) {
      const active = this.getItems("active");
      const trimmed = rawQuery.trim();
      if (!trimmed) return active;
      const q = parseNaturalQuery(trimmed, now);
      const favAliases = /* @__PURE__ */ new Set(["preferite", "preferita", "preferiti", "preferito"]);
      const filteredTokens = [];
      for (const tok of q.textTokens) {
        if (favAliases.has(tok.toLowerCase())) {
          q.favoritesOnly = true;
        } else {
          filteredTokens.push(tok);
        }
      }
      q.textTokens = filteredTokens;
      const blobAlbums = /* @__PURE__ */ new Map();
      for (const alb of this.albumCatalog.albums) {
        for (const bId of alb.blobIds) {
          const arr = blobAlbums.get(bId) ?? [];
          arr.push(alb.title.toLowerCase());
          blobAlbums.set(bId, arr);
        }
      }
      return active.filter((item) => {
        if (q.favoritesOnly && !item.meta.isFavorite) return false;
        if (q.mediaType === "photo" && item.category !== "photo") return false;
        if (q.mediaType === "video" && item.category !== "video") return false;
        if (q.mediaType === "file" && item.category !== "document" && item.category !== "other" && item.category !== "archive") {
          return false;
        }
        const tsMs = item.meta.takenAt ?? item.createdAt;
        const tsSec = Math.floor(tsMs / 1e3);
        const dt = new Date(tsMs);
        if (q.dateFrom !== null && tsSec < q.dateFrom) return false;
        if (q.dateTo !== null && tsSec > q.dateTo) return false;
        if (q.years.length > 0 && !q.years.includes(dt.getFullYear()) && !q.years.includes(dt.getUTCFullYear())) {
          return false;
        }
        if (q.months.length > 0 && !q.months.includes(dt.getMonth() + 1) && !q.months.includes(dt.getUTCMonth() + 1)) {
          return false;
        }
        if (q.days.length > 0 && !q.days.includes(dt.getDate()) && !q.days.includes(dt.getUTCDate())) {
          return false;
        }
        const itemAlbums = blobAlbums.get(item.blobId) ?? [];
        if (q.albums.length > 0) {
          const matchAlb = q.albums.some(
            (wanted) => itemAlbums.some((title) => title.includes(wanted.toLowerCase()))
          );
          if (!matchAlb) return false;
        }
        if (q.textTokens.length > 0) {
          const haystack = [
            item.meta.name.toLowerCase(),
            item.meta.mime.toLowerCase(),
            item.meta.exifSubset?.make?.toLowerCase() ?? "",
            item.meta.exifSubset?.model?.toLowerCase() ?? "",
            ...itemAlbums
          ].join(" ");
          for (const tok of q.textTokens) {
            if (!haystack.includes(tok.toLowerCase())) return false;
          }
        }
        return true;
      });
    }
    async getStats() {
      this.requireUnlocked();
      const resp = await this.apiFetch("/api/v2/stats");
      if (!resp.ok) {
        throw new Error(`STATS_FAILED_${resp.status}`);
      }
      const srv = await resp.json();
      let photosCount = 0;
      let videosCount = 0;
      let documentsCount = 0;
      let filesCount = 0;
      let photosBytes = 0;
      let videosBytes = 0;
      let documentsBytes = 0;
      let filesBytes = 0;
      for (const item of this.itemsById.values()) {
        if (item.state !== "active") continue;
        const sz = item.meta.size || 0;
        if (item.category === "photo") {
          photosCount++;
          photosBytes += sz;
        } else if (item.category === "video") {
          videosCount++;
          videosBytes += sz;
        } else if (item.category === "document") {
          documentsCount++;
          documentsBytes += sz;
        } else {
          filesCount++;
          filesBytes += sz;
        }
      }
      return {
        ...srv,
        photosCount,
        videosCount,
        documentsCount,
        filesCount,
        photosBytes,
        videosBytes,
        documentsBytes,
        filesBytes
      };
    }
    // ==========================================================================
    // 4. DOWNLOAD STREAMING, RANGE RANDOM-ACCESS, MINIATURE E TICKET VIDEO SW
    // ==========================================================================
    async downloadThumbnail(blobId, variant) {
      const { subkeys } = this.requireUnlocked();
      const resp = await this.apiFetch(`/api/v2/blobs/${blobId}/thumbs/${variant}`);
      if (!resp.ok) {
        throw new Error(`THUMB_DOWNLOAD_FAILED_${resp.status}`);
      }
      const cipherBytes = new Uint8Array(await resp.arrayBuffer());
      return decryptThumbnail(
        subkeys.thumbKey,
        blobId,
        String(variant),
        cipherBytes
      );
    }
    async downloadBlobToBytes(blobId) {
      const { subkeys } = this.requireUnlocked();
      const resp = await this.apiFetch(`/api/v2/blobs/${blobId}`);
      if (!resp.ok) {
        throw new Error(`BLOB_DOWNLOAD_FAILED_${resp.status}`);
      }
      const cipherBytes = new Uint8Array(await resp.arrayBuffer());
      const { plaintext } = await decryptBlobToBytes(cipherBytes, {
        fkWrapKey: subkeys.fkWrapKey,
        expectedBlobId: blobId
      });
      return plaintext;
    }
    async downloadBlobRange(blobId, startByte, endByteInclusive) {
      const { subkeys } = this.requireUnlocked();
      const headerResp = await this.apiFetch(`/api/v2/blobs/${blobId}`, {
        headers: { Range: `bytes=0-${PCZK_HEADER_LENGTH - 1}` }
      });
      if (!headerResp.ok) {
        throw new Error(`BLOB_HEADER_FETCH_FAILED_${headerResp.status}`);
      }
      const headerBytes = new Uint8Array(await headerResp.arrayBuffer()).subarray(
        0,
        PCZK_HEADER_LENGTH
      );
      const header = parsePczkHeader(headerBytes);
      let totalCiphertextBytes = 0;
      const contentRange = headerResp.headers.get("content-range");
      if (contentRange) {
        const m = /\/(\d+)$/.exec(contentRange.trim());
        if (m) totalCiphertextBytes = Number(m[1]);
      }
      if (!totalCiphertextBytes) {
        for (const it of this.itemsById.values()) {
          if (it.blobId === blobId.toLowerCase()) {
            totalCiphertextBytes = it.cipherSize;
            break;
          }
        }
      }
      const plaintextSlice = await decryptBlobRange({
        headerBytes,
        totalCiphertextBytes,
        startPlaintextByte: startByte,
        endPlaintextByteInclusive: endByteInclusive,
        fkWrapKey: subkeys.fkWrapKey,
        expectedBlobId: blobId,
        fetchCiphertextRange: async (cStart, cEndInclusive) => {
          const rangeResp = await this.apiFetch(`/api/v2/blobs/${blobId}`, {
            headers: { Range: `bytes=${cStart}-${cEndInclusive}` }
          });
          if (!rangeResp.ok) {
            throw new Error(`BLOB_RANGE_FETCH_FAILED_${rangeResp.status}`);
          }
          return new Uint8Array(await rangeResp.arrayBuffer());
        }
      });
      return { plaintextSlice, header };
    }
    async getVideoStreamTicket(blobId) {
      const { subkeys } = this.requireUnlocked();
      const headerResp = await this.apiFetch(`/api/v2/blobs/${blobId}`, {
        headers: { Range: `bytes=0-${PCZK_HEADER_LENGTH - 1}` }
      });
      if (!headerResp.ok) {
        throw new Error(`VIDEO_HEADER_FETCH_FAILED_${headerResp.status}`);
      }
      const raw = new Uint8Array(await headerResp.arrayBuffer());
      const headerBytes = raw.subarray(0, PCZK_HEADER_LENGTH);
      const header = parsePczkHeader(headerBytes);
      if (header.blobId !== blobId.toLowerCase()) {
        throw new ZkCryptoError("WRONG_KEY_OR_PASSPHRASE" /* WRONG_KEY_OR_PASSPHRASE */, "Header blobId mismatch");
      }
      let totalCiphertextBytes = 0;
      const contentRange = headerResp.headers.get("content-range");
      if (contentRange) {
        const m = /\/(\d+)$/.exec(contentRange.trim());
        if (m) totalCiphertextBytes = Number(m[1]);
      }
      let mime = "video/mp4";
      for (const it of this.itemsById.values()) {
        if (it.blobId === blobId.toLowerCase()) {
          if (!totalCiphertextBytes) totalCiphertextBytes = it.cipherSize;
          if (it.meta.mime) mime = it.meta.mime;
          break;
        }
      }
      const fileKey = await unwrapFileKey(subkeys.fkWrapKey, header.wrappedFk, header.blobIdBytes);
      return {
        blobId,
        fileKey,
        header,
        headerBytes,
        totalCiphertextBytes,
        mime
      };
    }
    // ==========================================================================
    // 5. AGGIORNAMENTO METADATI E PHOTO EDITOR (REPLACE CON EXPECTED VERSION)
    // ==========================================================================
    async updateItemMeta(itemId, patch, expectedVersion) {
      const { subkeys } = this.requireUnlocked();
      const current = this.itemsById.get(itemId);
      if (!current) {
        throw new Error("ITEM_NOT_FOUND_IN_LOCAL_INDEX");
      }
      const mergedMeta = {
        ...current.meta,
        ...patch,
        v: 1
      };
      const encMetaBytes = await encryptMeta(subkeys.metaKey, current.blobId, mergedMeta);
      const encMetaB64 = toBase64Url(encMetaBytes);
      const resp = await this.apiFetch(`/api/v2/items/${itemId}/meta`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          expectedVersion: expectedVersion ?? current.version,
          encMeta: encMetaB64
        })
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err.error || `UPDATE_META_FAILED_${resp.status}`);
      }
      const bodyData = await resp.json();
      const srv = bodyData.item ?? bodyData;
      const updated = {
        ...current,
        version: srv.version,
        updatedAt: srv.updatedAt,
        meta: mergedMeta,
        category: classifyItemCategory(mergedMeta.mime, mergedMeta.name)
      };
      this.itemsById.set(itemId, updated);
      return updated;
    }
    async replaceItemWithEditedBlob(itemId, editedPlaintext, metaPatch = {}, expectedVersion, thumbs) {
      const { subkeys } = this.requireUnlocked();
      const current = this.itemsById.get(itemId);
      if (!current) {
        throw new Error("ITEM_NOT_FOUND_IN_LOCAL_INDEX");
      }
      const newMeta = {
        ...current.meta,
        ...metaPatch,
        size: editedPlaintext.byteLength,
        v: 1
      };
      const uploadRes = await this.uploadFile(
        {
          name: newMeta.name,
          mimeType: newMeta.mime,
          size: editedPlaintext.byteLength,
          source: editedPlaintext,
          takenAt: newMeta.takenAt,
          width: newMeta.width ?? void 0,
          height: newMeta.height ?? void 0,
          favorite: newMeta.isFavorite,
          thumb320Plaintext: thumbs?.thumb320,
          thumb1280Plaintext: thumbs?.thumb1280
        },
        { createItem: false, includeGps: Boolean(newMeta.exifSubset?.lat) }
      );
      const newBlobId = uploadRes.blobId;
      const encMetaBytes = await encryptMeta(subkeys.metaKey, newBlobId, newMeta);
      const encMetaB64 = toBase64Url(encMetaBytes);
      const { tagHex: dedupTagHex } = await computeDedupTag(subkeys.dedupKey, editedPlaintext);
      const resp = await this.apiFetch(`/api/v2/items/${itemId}/replace`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          expectedVersion: expectedVersion ?? current.version,
          newBlobId,
          encMeta: encMetaB64,
          dedupTag: dedupTagHex
        })
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err.error || `REPLACE_ITEM_FAILED_${resp.status}`);
      }
      const bodyData = await resp.json();
      const srv = bodyData.item ?? bodyData;
      const updated = {
        id: srv.id,
        blobId: srv.blobId,
        version: srv.version,
        cipherSize: srv.size,
        sha256: srv.sha256,
        createdAt: srv.createdAt,
        updatedAt: srv.updatedAt,
        state: srv.state,
        trashedAt: srv.trashedAt,
        dedupTag: srv.dedupTag,
        thumbs: srv.thumbs ?? [],
        meta: newMeta,
        category: classifyItemCategory(newMeta.mime, newMeta.name)
      };
      this.itemsById.set(itemId, updated);
      return updated;
    }
    // ==========================================================================
    // 6. ALBUM CIFRATI CON MERGE AUTOMATICO SU 412 PRECONDITION FAILED
    // ==========================================================================
    getCachedAlbums() {
      return {
        v: this.albumCatalog.v,
        revision: this.albumCatalog.revision,
        albums: this.albumCatalog.albums.map((a) => ({ ...a, blobIds: [...a.blobIds] }))
      };
    }
    async getAlbums() {
      const { userId, subkeys } = this.requireUnlocked();
      const resp = await this.apiFetch("/api/v2/albums");
      if (resp.status === 404) {
        this.albumEtag = null;
        this.albumCatalog = { v: 1, revision: 0, albums: [] };
        return this.albumCatalog;
      }
      if (!resp.ok) {
        throw new Error(`GET_ALBUMS_FAILED_${resp.status}`);
      }
      const etagHeader = resp.headers.get("etag");
      this.albumEtag = etagHeader ?? null;
      const cipherBytes = new Uint8Array(await resp.arrayBuffer());
      if (cipherBytes.byteLength === 0) {
        this.albumCatalog = { v: 1, revision: 0, albums: [] };
        return this.albumCatalog;
      }
      const { revision, catalog } = await decryptAlbums(subkeys.metaKey, userId, cipherBytes);
      this.albumCatalog = {
        v: 1,
        revision,
        albums: (catalog.albums ?? []).map((a) => ({
          id: a.id,
          title: a.name,
          coverBlobId: a.coverBlobId,
          blobIds: [...a.blobIds],
          createdAt: a.createdAt,
          updatedAt: catalog.updatedAt ?? a.createdAt
        }))
      };
      return this.albumCatalog;
    }
    static mergeAlbumCatalogs(baseOrLocal, remote) {
      const byId = /* @__PURE__ */ new Map();
      for (const alb of remote.albums) {
        byId.set(alb.id, {
          ...alb,
          blobIds: [...alb.blobIds]
        });
      }
      for (const localAlb of baseOrLocal.albums) {
        const existing = byId.get(localAlb.id);
        if (!existing) {
          byId.set(localAlb.id, {
            ...localAlb,
            blobIds: [...localAlb.blobIds]
          });
        } else {
          const mergedBlobIds = Array.from(/* @__PURE__ */ new Set([...existing.blobIds, ...localAlb.blobIds]));
          const newer = localAlb.updatedAt >= existing.updatedAt ? localAlb : existing;
          byId.set(localAlb.id, {
            id: existing.id,
            title: newer.title,
            coverBlobId: newer.coverBlobId ?? existing.coverBlobId,
            blobIds: mergedBlobIds,
            createdAt: Math.min(existing.createdAt, localAlb.createdAt),
            updatedAt: Math.max(existing.updatedAt, localAlb.updatedAt)
          });
        }
      }
      return {
        v: 1,
        revision: Math.max(baseOrLocal.revision, remote.revision) + 1,
        albums: Array.from(byId.values())
      };
    }
    async saveAlbums(mutator) {
      const { userId, subkeys } = this.requireUnlocked();
      let candidate = mutator({
        v: 1,
        revision: Math.max(1, this.albumCatalog.revision + 1),
        albums: this.albumCatalog.albums.map((a) => ({ ...a, blobIds: [...a.blobIds] }))
      });
      for (let attempt = 0; attempt < 4; attempt++) {
        const rev = Math.max(1, candidate.revision);
        const specCatalog = {
          v: 1,
          revision: rev,
          updatedAt: Date.now(),
          albums: candidate.albums.map((a) => ({
            id: a.id,
            name: a.title,
            createdAt: a.createdAt,
            coverBlobId: a.coverBlobId ?? null,
            blobIds: [...a.blobIds]
          }))
        };
        const encryptedBytes = await encryptAlbums(subkeys.metaKey, userId, specCatalog, rev);
        const headers = {
          "Content-Type": "application/octet-stream"
        };
        if (this.albumEtag) {
          headers["If-Match"] = this.albumEtag;
        }
        const putResp = await this.apiFetch("/api/v2/albums", {
          method: "PUT",
          headers,
          body: encryptedBytes
        });
        if (putResp.status === 412 && attempt < 3) {
          const remoteCatalog = await this.getAlbums();
          candidate = _ZkVaultClient.mergeAlbumCatalogs(candidate, remoteCatalog);
          this.albumCatalog = candidate;
          continue;
        }
        if (!putResp.ok) {
          const err = await putResp.json().catch(() => ({}));
          throw new Error(err.error || `SAVE_ALBUMS_FAILED_${putResp.status}`);
        }
        const putData = await putResp.json();
        this.albumEtag = putResp.headers.get("etag") ?? putData.etag;
        this.albumCatalog = {
          ...candidate,
          revision: rev
        };
        return this.albumCatalog;
      }
      throw new Error("ALBUMS_CONFLICT_MAX_RETRIES_EXCEEDED");
    }
    // ==========================================================================
    // 7. CESTINO, RIPRISTINO, CANCELLAZIONE DEFINITIVA ED EXPORT ZIP STREAMING
    // ==========================================================================
    async trashItems(itemIds) {
      this.requireUnlocked();
      const resp = await this.apiFetch("/api/v2/trash", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemIds })
      });
      if (!resp.ok) {
        throw new Error(`TRASH_MOVE_FAILED_${resp.status}`);
      }
      const data = await resp.json();
      for (const id of itemIds) {
        const it = this.itemsById.get(id);
        if (it) {
          it.state = "trashed";
          it.trashedAt = data.trashedAt;
        }
      }
      return data.trashedIds?.length ?? itemIds.length;
    }
    async restoreItems(itemIds) {
      this.requireUnlocked();
      const resp = await this.apiFetch("/api/v2/trash/restore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemIds })
      });
      if (!resp.ok) {
        throw new Error(`TRASH_RESTORE_FAILED_${resp.status}`);
      }
      const data = await resp.json();
      for (const id of itemIds) {
        const it = this.itemsById.get(id);
        if (it) {
          it.state = "active";
          it.trashedAt = null;
        }
      }
      return data.restoredIds?.length ?? itemIds.length;
    }
    async deleteItemPermanently(itemId) {
      this.requireUnlocked();
      const resp = await this.apiFetch(`/api/v2/items/${itemId}`, {
        method: "DELETE"
      });
      if (!resp.ok) {
        throw new Error(`DELETE_ITEM_FAILED_${resp.status}`);
      }
      this.itemsById.delete(itemId);
    }
    async emptyTrash() {
      this.requireUnlocked();
      const resp = await this.apiFetch("/api/v2/trash", {
        method: "DELETE"
      });
      if (!resp.ok) {
        throw new Error(`EMPTY_TRASH_FAILED_${resp.status}`);
      }
      const data = await resp.json();
      for (const [id, it] of this.itemsById.entries()) {
        if (it.state === "trashed") {
          this.itemsById.delete(id);
        }
      }
      return data.deletedCount;
    }
    exportZipStream(itemIds) {
      const { subkeys } = this.requireUnlocked();
      const selected = itemIds.map((id) => this.itemsById.get(id)).filter((x) => Boolean(x));
      const self2 = this;
      async function* zipEntries() {
        for (const item of selected) {
          const resp = await self2.apiFetch(`/api/v2/blobs/${item.blobId}`);
          if (!resp.ok || !resp.body) {
            throw new Error(`EXPORT_BLOB_FETCH_FAILED_${resp.status}`);
          }
          yield {
            name: item.meta.name,
            modifiedAt: item.meta.takenAt ?? item.createdAt,
            stream: () => decryptBlobStream(resp.body, {
              fkWrapKey: subkeys.fkWrapKey,
              expectedBlobId: item.blobId
            })
          };
        }
      }
      const gen = generateZipStream(zipEntries());
      return new ReadableStream({
        async pull(controller) {
          const step = await gen.next();
          if (step.done) {
            controller.close();
            return;
          }
          controller.enqueue(step.value);
        }
      });
    }
    // ==========================================================================
    // 8. CONDIVISIONI PUBBLICHE END-TO-END (/v2/share/<shareId>#<shareKey>)
    // ==========================================================================
    async createShare(options, origin = "https://localhost:3000") {
      const { subkeys } = this.requireUnlocked();
      if (!Array.isArray(options.itemIds) || options.itemIds.length === 0) {
        throw new ZkCryptoError(
          "INVALID_PARAMETER" /* INVALID_PARAMETER */,
          "Seleziona almeno un elemento da condividere."
        );
      }
      const shareId = generateUuidV4();
      const shareKey = defaultCryptoProvider.randomBytes(32);
      try {
        const apiItems = [];
        const manifestItems = [];
        for (const itemId of options.itemIds) {
          let item = this.itemsById.get(itemId);
          if (!item) {
            await this.syncItems("active");
            item = this.itemsById.get(itemId);
          }
          if (!item) {
            throw new Error(`SHARE_ITEM_NOT_FOUND_${itemId}`);
          }
          const headerResp = await this.apiFetch(`/api/v2/blobs/${item.blobId}`, {
            headers: { Range: `bytes=0-${PCZK_HEADER_LENGTH - 1}` }
          });
          if (!headerResp.ok) {
            throw new Error(`SHARE_BLOB_HEADER_FAILED_${headerResp.status}`);
          }
          const headerBytes = new Uint8Array(await headerResp.arrayBuffer()).subarray(
            0,
            PCZK_HEADER_LENGTH
          );
          const header = parsePczkHeader(headerBytes);
          const fileKey = await unwrapFileKey(subkeys.fkWrapKey, header.wrappedFk, header.blobIdBytes);
          try {
            const wrappedFkBytes = await wrapFileKeyForShare(
              shareKey,
              fileKey,
              shareId,
              item.blobId
            );
            const wrappedFkB64 = toBase64Url(wrappedFkBytes);
            const shareEncMetaB64 = await encryptShareItemMeta(
              item.meta,
              shareKey,
              shareId,
              item.blobId
            );
            apiItems.push({
              blobId: item.blobId,
              wrappedFk: wrappedFkB64,
              encItemMeta: shareEncMetaB64
            });
            manifestItems.push({
              blobId: item.blobId,
              wrappedFk: wrappedFkB64,
              encMeta: shareEncMetaB64
            });
          } finally {
            zeroize(fileKey);
          }
        }
        let passwordWrap = null;
        if (options.password && options.password.trim().length > 0) {
          passwordWrap = await wrapShareKeyWithPassword(shareKey, options.password, shareId);
        }
        const manifestPayload = {
          v: 1,
          shareId,
          title: options.title,
          createdAt: Date.now(),
          items: manifestItems
        };
        const shareManifestB64 = await encryptShareManifest(manifestPayload, shareKey, shareId);
        const resp = await this.apiFetch("/api/v2/shares", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            shareId,
            expiresAt: options.expiresAt ?? null,
            maxDownloads: options.maxDownloads ?? null,
            passwordWrap,
            shareManifest: shareManifestB64,
            items: apiItems
          })
        });
        if (!resp.ok) {
          const err = await resp.json().catch(() => ({}));
          throw new Error(err.error || `CREATE_SHARE_FAILED_${resp.status}`);
        }
        const shareKeyB64 = toBase64Url(shareKey);
        const shareUrl = buildShareUrl(origin, shareId, shareKey);
        return {
          shareId,
          shareKeyBase64Url: shareKeyB64,
          shareUrl,
          expiresAt: options.expiresAt ?? null,
          maxDownloads: options.maxDownloads ?? null
        };
      } finally {
        zeroize(shareKey);
      }
    }
    async revokeShare(shareId) {
      this.requireUnlocked();
      const resp = await this.apiFetch(`/api/v2/shares/${encodeURIComponent(shareId)}`, {
        method: "DELETE"
      });
      if (!resp.ok) {
        throw new Error(`REVOKE_SHARE_FAILED_${resp.status}`);
      }
    }
    async openPublicShare(shareId, urlOrFragment, password) {
      const resp = await this.apiFetch(`/api/v2/shares/${shareId}`);
      if (!resp.ok) {
        throw new Error(`OPEN_SHARE_FAILED_${resp.status}`);
      }
      const data = await resp.json();
      let shareKey;
      if (data.passwordWrap) {
        if (!password) {
          throw new ZkCryptoError(
            "INVALID_PARAMETER" /* INVALID_PARAMETER */,
            "Questa condivisione \xE8 protetta da password."
          );
        }
        shareKey = await unwrapShareKeyWithPassword(data.passwordWrap, password, shareId);
      } else {
        shareKey = parseShareUrlFragment(urlOrFragment);
      }
      let title;
      let sourceEntries = data.items.map((it) => ({
        blobId: it.blobId,
        wrappedFk: it.wrappedFk,
        encMeta: it.encMeta ?? it.encItemMeta ?? ""
      }));
      if (data.shareManifest) {
        const manifest = await decryptShareManifest(data.shareManifest, shareKey, shareId);
        title = manifest.title;
        sourceEntries = manifest.items;
      }
      const decryptedEntries = [];
      for (const entry of sourceEntries) {
        const wrappedFkBytes = fromBase64Url(entry.wrappedFk);
        const fileKey = await unwrapFileKeyForShare(
          shareKey,
          wrappedFkBytes,
          shareId,
          entry.blobId
        );
        const meta = await decryptShareItemMeta(entry.encMeta, shareKey, shareId, entry.blobId);
        decryptedEntries.push({
          blobId: entry.blobId,
          fileKey,
          meta,
          category: classifyItemCategory(meta.mime, meta.name)
        });
      }
      return {
        shareId: data.shareId,
        title,
        createdAt: data.createdAt,
        expiresAt: data.expiresAt,
        maxDownloads: data.maxDownloads ?? null,
        downloadsCount: data.downloadsCount ?? 0,
        shareKey,
        items: decryptedEntries
      };
    }
    async downloadSharedBlobToBytes(openedShare, blobId) {
      const entry = openedShare.items.find((i) => i.blobId === blobId);
      if (!entry) {
        throw new Error("SHARED_BLOB_NOT_FOUND");
      }
      const resp = await this.apiFetch(`/api/v2/shares/${openedShare.shareId}/blobs/${blobId}`);
      if (!resp.ok) {
        throw new Error(`SHARED_BLOB_FETCH_FAILED_${resp.status}`);
      }
      const cipherBytes = new Uint8Array(await resp.arrayBuffer());
      const { plaintext } = await decryptBlobToBytes(cipherBytes, {
        unwrappedFileKey: entry.fileKey,
        expectedBlobId: blobId
      });
      return plaintext;
    }
    async downloadSharedBlobRange(openedShare, blobId, startByte, endByteInclusive) {
      const entry = openedShare.items.find((i) => i.blobId === blobId);
      if (!entry) {
        throw new Error("SHARED_BLOB_NOT_FOUND");
      }
      const headerResp = await this.apiFetch(
        `/api/v2/shares/${openedShare.shareId}/blobs/${blobId}?headerOnly=1`,
        {
          headers: { Range: `bytes=0-${PCZK_HEADER_LENGTH - 1}` }
        }
      );
      if (!headerResp.ok) {
        throw new Error(`SHARED_HEADER_FETCH_FAILED_${headerResp.status}`);
      }
      const headerBytes = new Uint8Array(await headerResp.arrayBuffer()).subarray(
        0,
        PCZK_HEADER_LENGTH
      );
      const header = parsePczkHeader(headerBytes);
      let totalCiphertextBytes = 0;
      const contentRange = headerResp.headers.get("content-range");
      if (contentRange) {
        const m = /\/(\d+)$/.exec(contentRange.trim());
        if (m) totalCiphertextBytes = Number(m[1]);
      }
      if (!totalCiphertextBytes) {
        totalCiphertextBytes = PCZK_HEADER_LENGTH + entry.meta.size + PCZK_GCM_TAG_LENGTH;
      }
      const plaintextSlice = await decryptBlobRange({
        headerBytes,
        totalCiphertextBytes,
        startPlaintextByte: startByte,
        endPlaintextByteInclusive: endByteInclusive,
        unwrappedFileKey: entry.fileKey,
        expectedBlobId: blobId,
        fetchCiphertextRange: async (cStart, cEndInclusive) => {
          const rangeResp = await this.apiFetch(
            `/api/v2/shares/${openedShare.shareId}/blobs/${blobId}`,
            {
              headers: { Range: `bytes=${cStart}-${cEndInclusive}` }
            }
          );
          if (!rangeResp.ok) {
            throw new Error(`SHARED_RANGE_FETCH_FAILED_${rangeResp.status}`);
          }
          return new Uint8Array(await rangeResp.arrayBuffer());
        }
      });
      return { plaintextSlice, header };
    }
  };

  // src/lib/photoEditorMath.ts
  var DEFAULT_NORMALIZED_CROP_BOX = {
    left: 0,
    top: 0,
    right: 1,
    bottom: 1
  };
  var DEFAULT_PHOTO_EDIT_STATE = {
    brightness: 0,
    contrast: 0,
    saturation: 0,
    warmth: 0,
    rotation: 0,
    flipH: false,
    flipV: false,
    cropAspect: "free",
    cropBox: { ...DEFAULT_NORMALIZED_CROP_BOX },
    filterPreset: "original"
  };
  function normalizeRotation(deg) {
    const mod = (deg % 360 + 360) % 360;
    if (mod === 90 || mod === 180 || mod === 270) return mod;
    return 0;
  }
  function clampByte(val) {
    return Math.max(0, Math.min(255, Math.round(val)));
  }
  function transformRgbPixel(r, g, b, state) {
    const bOffset = state.brightness / 100 * 90;
    let nr = r + bOffset;
    let ng = g + bOffset;
    let nb = b + bOffset;
    const cFactor = Math.pow((state.contrast + 100) / 100, 2);
    nr = (nr - 128) * cFactor + 128;
    ng = (ng - 128) * cFactor + 128;
    nb = (nb - 128) * cFactor + 128;
    const sFactor = (state.saturation + 100) / 100;
    const luma = 0.299 * nr + 0.587 * ng + 0.114 * nb;
    nr = luma + (nr - luma) * sFactor;
    ng = luma + (ng - luma) * sFactor;
    nb = luma + (nb - luma) * sFactor;
    const wShift = state.warmth / 100 * 42;
    nr += wShift;
    ng += wShift * 0.18;
    nb -= wShift;
    return [clampByte(nr), clampByte(ng), clampByte(nb)];
  }
  var DEFAULT_VIDEO_EDIT_STATE = {
    ...DEFAULT_PHOTO_EDIT_STATE,
    trimStartSec: 0,
    trimEndSec: 0,
    durationSec: 0,
    muted: false,
    volume: 1,
    playbackRate: 1
  };

  // src/client/v2-app/main.ts
  var BrowserLocalStoragePinStore = class {
    prefix = "pc_v2_kdf_pin_";
    get(username) {
      try {
        const raw = window.localStorage.getItem(this.prefix + username.trim().toLowerCase());
        if (!raw) return null;
        return JSON.parse(raw);
      } catch {
        return null;
      }
    }
    set(record) {
      try {
        window.localStorage.setItem(
          this.prefix + record.username.trim().toLowerCase(),
          JSON.stringify(record)
        );
      } catch {
      }
    }
  };
  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== void 0) node.textContent = text;
    return node;
  }
  function formatBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
    const units = ["B", "KB", "MB", "GB", "TB"];
    const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
    const val = bytes / Math.pow(1024, i);
    return `${val.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
  }
  function triggerDownload(bytes, filename, mime = "application/octet-stream") {
    const blob = new Blob([bytes], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 5e3);
  }
  async function registerVideoStreamTicketInSw(ticket) {
    if (!("serviceWorker" in navigator)) return false;
    try {
      const reg = await navigator.serviceWorker.ready;
      const targetSw = navigator.serviceWorker.controller || reg.active;
      if (!targetSw) return false;
      return await new Promise((resolve) => {
        const channel = new MessageChannel();
        const timer = setTimeout(() => resolve(false), 3e3);
        channel.port1.onmessage = (ev) => {
          clearTimeout(timer);
          resolve(Boolean(ev.data && ev.data.ok));
        };
        targetSw.postMessage(
          {
            type: "REGISTER_STREAM_KEY",
            blobId: ticket.blobId,
            fileKey: ticket.fileKey,
            headerBytes: ticket.headerBytes,
            totalCiphertextBytes: ticket.totalCiphertextBytes,
            mime: ticket.mime
          },
          [channel.port2]
        );
      });
    } catch {
      return false;
    }
  }
  async function generateBrowserImageThumbs(file) {
    if (!isSafeRasterImageMime(file.type) || typeof createImageBitmap !== "function") {
      return {};
    }
    try {
      const bmp = await createImageBitmap(file);
      const width = bmp.width;
      const height = bmp.height;
      const renderResized = async (maxEdge) => {
        const scale = Math.min(1, maxEdge / Math.max(width, height));
        const w = Math.max(1, Math.round(width * scale));
        const h = Math.max(1, Math.round(height * scale));
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) return void 0;
        ctx.drawImage(bmp, 0, 0, w, h);
        const blob = await new Promise(
          (resolve) => canvas.toBlob((b) => resolve(b), "image/jpeg", 0.82)
        );
        if (!blob) return void 0;
        return new Uint8Array(await blob.arrayBuffer());
      };
      const thumb320 = await renderResized(320);
      const thumb1280 = await renderResized(1280);
      bmp.close();
      return { width, height, thumb320, thumb1280 };
    } catch {
      return {};
    }
  }
  function initZkWebApp() {
    const rootEl = document.getElementById("zk-app-root");
    if (!rootEl) return;
    const activeObjectUrls = /* @__PURE__ */ new Set();
    const registerObjectUrl = (blob) => {
      const u = URL.createObjectURL(blob);
      activeObjectUrls.add(u);
      return u;
    };
    const revokeAllObjectUrls = () => {
      for (const u of activeObjectUrls) {
        URL.revokeObjectURL(u);
      }
      activeObjectUrls.clear();
    };
    let bannerMessage = null;
    let currentView = "gallery";
    let selectedAlbumId = null;
    let cachedStats = null;
    let groupMode = "day";
    let searchQuery = "";
    let preparedReg = null;
    let pendingRegPassphrase = "";
    let pendingRegSetupToken = "";
    let loadedKeyFile = null;
    let lastGeneratedKeyFile = null;
    let lastCreatedShare = null;
    let selectedLightboxItem = null;
    const client = new ZkVaultClient({
      pinningStore: new BrowserLocalStoragePinStore(),
      onAutoLock: () => {
        revokeAllObjectUrls();
        if (navigator.serviceWorker?.controller) {
          navigator.serviceWorker.controller.postMessage({ type: "LOCK_ALL_KEYS" });
        }
        bannerMessage = {
          type: "warning",
          text: "Il vault \xE8 stato bloccato automaticamente per inattivit\xE0."
        };
        render();
      },
      onKdfParamsChangedWarning: (info) => {
        bannerMessage = {
          type: "warning",
          text: `Attenzione: i parametri KDF o il salt per ${info.username} sono cambiati rispetto all'ultimo accesso.`
        };
      }
    });
    if ("serviceWorker" in navigator && window.location.pathname.startsWith("/v2")) {
      navigator.serviceWorker.register("/v2/sw-stream.js", { scope: "/v2" }).catch(() => {
      });
    }
    const shareMatch = /^\/v2\/share\/([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})/i.exec(
      window.location.pathname
    );
    if (shareMatch) {
      renderPublicShareApp(rootEl, client, shareMatch[1]);
      return;
    }
    function render() {
      rootEl.textContent = "";
      const header = el("header", "app-header");
      const brandGroup = el("div", "brand-group");
      brandGroup.appendChild(el("span", "brand-title", "PhotoCloud v2"));
      const badge = el(
        "span",
        "e2ee-badge",
        client.isUnlocked() ? "E2EE Attivo (Vault Sbloccato)" : "Zero-Knowledge E2EE"
      );
      badge.id = "e2ee-status-badge";
      brandGroup.appendChild(badge);
      header.appendChild(brandGroup);
      const actions = el("div", "header-actions");
      if (client.isUnlocked()) {
        const userLabel = el("span", "media-card-meta user-chip", `Utente: ${client.getUsername() ?? ""}`);
        actions.appendChild(userLabel);
        if (lastGeneratedKeyFile) {
          const dlKeyBtn = el("button", "btn", "Scarica Keyfile JSON");
          dlKeyBtn.id = "btn-download-keyfile";
          dlKeyBtn.title = "Il Keyfile JSON contiene la tua Account Key (32B), ma NON contiene la Passphrase. Passphrase persa = dati non recuperabili.";
          dlKeyBtn.addEventListener("click", () => {
            const jsonStr = JSON.stringify(lastGeneratedKeyFile.keyFile, null, 2);
            dlKeyBtn.dataset.lastDownloadedJson = jsonStr;
            const bytes = new TextEncoder().encode(jsonStr);
            triggerDownload(bytes, lastGeneratedKeyFile.fileName, "application/json");
          });
          actions.appendChild(dlKeyBtn);
        }
        const lockBtn = el("button", "btn", "Blocca Vault");
        lockBtn.id = "btn-lock-vault";
        lockBtn.addEventListener("click", () => {
          client.lock();
          revokeAllObjectUrls();
          if (navigator.serviceWorker?.controller) {
            navigator.serviceWorker.controller.postMessage({ type: "LOCK_ALL_KEYS" });
          }
          authTab = "login";
          bannerMessage = { type: "success", text: "Vault bloccato e chiavi zeroizzate dalla RAM." };
          render();
        });
        actions.appendChild(lockBtn);
        const logoutBtn = el("button", "btn btn-danger", "Esci");
        logoutBtn.id = "btn-logout";
        logoutBtn.addEventListener("click", async () => {
          await client.logout();
          revokeAllObjectUrls();
          if (navigator.serviceWorker?.controller) {
            navigator.serviceWorker.controller.postMessage({ type: "LOCK_ALL_KEYS" });
          }
          loadedKeyFile = null;
          authTab = "login";
          render();
        });
        actions.appendChild(logoutBtn);
      }
      header.appendChild(actions);
      rootEl.appendChild(header);
      if (!client.isUnlocked()) {
        renderAuthView(rootEl);
      } else {
        renderWorkspaceView(rootEl);
      }
      if (selectedLightboxItem) {
        renderLightboxModal(rootEl, selectedLightboxItem);
      }
    }
    let authTab = "login";
    function renderAuthView(container) {
      const box = el("main", "auth-container");
      const authHero = el("div", "auth-hero");
      authHero.appendChild(el("h1", "auth-hero-title", "Vault Zero-Knowledge"));
      authHero.appendChild(
        el(
          "p",
          "auth-hero-sub",
          "Cifratura client-side Argon2id + AES-256-GCM. Le tue chiavi non lasciano mai il dispositivo."
        )
      );
      box.appendChild(authHero);
      if (bannerMessage) {
        const alert = el("div", `alert-banner alert-${bannerMessage.type}`, bannerMessage.text);
        alert.id = "auth-alert-banner";
        box.appendChild(alert);
      }
      const tabs = el("div", "tabs-row");
      const loginTabBtn = el("button", `tab-btn ${authTab === "login" ? "active" : ""}`, "Accedi");
      loginTabBtn.id = "tab-login";
      loginTabBtn.addEventListener("click", () => {
        authTab = "login";
        bannerMessage = null;
        render();
      });
      const regTabBtn = el("button", `tab-btn ${authTab === "register" ? "active" : ""}`, "Registrati");
      regTabBtn.id = "tab-register";
      regTabBtn.addEventListener("click", () => {
        authTab = "register";
        bannerMessage = null;
        render();
      });
      const recTabBtn = el("button", `tab-btn ${authTab === "recovery" ? "active" : ""}`, "Recovery Code");
      recTabBtn.id = "tab-recovery";
      recTabBtn.addEventListener("click", () => {
        authTab = "recovery";
        bannerMessage = null;
        render();
      });
      tabs.appendChild(loginTabBtn);
      tabs.appendChild(regTabBtn);
      tabs.appendChild(recTabBtn);
      box.appendChild(tabs);
      if (authTab === "login") {
        const fgFile = el("div", "form-group");
        fgFile.appendChild(el("label", "form-label", "Keyfile JSON (.json)"));
        const fileInput = el("input", "form-input");
        fileInput.type = "file";
        fileInput.id = "login-keyfile-input";
        fileInput.accept = ".json,application/json";
        const keyfileMetaEl = el(
          "div",
          "media-card-meta",
          loadedKeyFile ? `Utente keyfile: ${loadedKeyFile.username}` : ""
        );
        keyfileMetaEl.id = "login-keyfile-status";
        fileInput.addEventListener("change", async () => {
          const f = fileInput.files?.[0];
          if (!f) return;
          try {
            const txt = await f.text();
            loadedKeyFile = JSON.parse(txt);
            keyfileMetaEl.textContent = `Utente keyfile: ${loadedKeyFile.username}`;
          } catch {
            loadedKeyFile = null;
            keyfileMetaEl.textContent = "File keyfile JSON non valido.";
          }
        });
        fgFile.appendChild(fileInput);
        fgFile.appendChild(keyfileMetaEl);
        box.appendChild(fgFile);
        const fgPass = el("div", "form-group");
        fgPass.appendChild(el("label", "form-label", "Passphrase"));
        const passInput = el("input", "form-input");
        passInput.type = "password";
        passInput.id = "login-passphrase-input";
        passInput.placeholder = "Inserisci la tua passphrase (>= 12 caratteri)";
        fgPass.appendChild(passInput);
        box.appendChild(fgPass);
        const submitBtn = el("button", "btn btn-primary", "Sblocca Vault");
        submitBtn.id = "btn-login-submit";
        submitBtn.addEventListener("click", async () => {
          if (!loadedKeyFile && fileInput.files?.[0]) {
            try {
              loadedKeyFile = JSON.parse(await fileInput.files[0].text());
            } catch {
              loadedKeyFile = null;
            }
          }
          if (!loadedKeyFile) {
            bannerMessage = { type: "error", text: "Carica prima il tuo Keyfile JSON." };
            render();
            return;
          }
          submitBtn.disabled = true;
          submitBtn.textContent = "Derivazione chiavi Argon2id (64 MiB, t=3) in corso...";
          try {
            await client.login(loadedKeyFile, passInput.value);
            await client.syncItems("all");
            await client.getAlbums();
            bannerMessage = null;
            render();
          } catch (err) {
            bannerMessage = {
              type: "error",
              text: err instanceof Error ? err.message : "Errore durante il login."
            };
            render();
          }
        });
        box.appendChild(submitBtn);
      } else if (authTab === "register") {
        const warningNotice = el(
          "div",
          "alert-banner alert-warning",
          "AVVISO CRITICO ZERO-KNOWLEDGE: Il Recovery Code (codifica esadecimale della tua Account Key a 32 byte) sostituisce SOLO il Keyfile JSON, ma NON sostituisce MAI la tua Passphrase. Passphrase persa = dati matematicamente non recuperabili."
        );
        warningNotice.id = "reg-warning-unrecoverable";
        box.appendChild(warningNotice);
        if (!preparedReg) {
          const fgUser = el("div", "form-group");
          fgUser.appendChild(el("label", "form-label", "Username"));
          const userInput = el("input", "form-input");
          userInput.type = "text";
          userInput.id = "reg-username-input";
          userInput.placeholder = "es. alice";
          fgUser.appendChild(userInput);
          box.appendChild(fgUser);
          const fgToken = el("div", "form-group");
          fgToken.appendChild(el("label", "form-label", "Setup Token / Invite Token"));
          const tokenInput = el("input", "form-input");
          tokenInput.type = "text";
          tokenInput.id = "reg-setup-token-input";
          tokenInput.placeholder = "Token stampato su stdout dal server al primo avvio";
          fgToken.appendChild(tokenInput);
          box.appendChild(fgToken);
          const fgPass = el("div", "form-group");
          fgPass.appendChild(el("label", "form-label", "Passphrase (minimo 12 caratteri)"));
          const passInput = el("input", "form-input");
          passInput.type = "password";
          passInput.id = "reg-passphrase-input";
          const strengthInfo = el("div", "media-card-meta", "");
          strengthInfo.id = "reg-passphrase-strength";
          passInput.addEventListener("input", () => {
            const st = evaluatePassphraseStrength(passInput.value);
            strengthInfo.textContent = `${st.feedback} (${st.estimatedBits} bit stimati)`;
          });
          fgPass.appendChild(passInput);
          fgPass.appendChild(strengthInfo);
          box.appendChild(fgPass);
          const prepBtn = el("button", "btn btn-primary", "Genera Chiavi e Recovery Code");
          prepBtn.id = "btn-reg-prepare";
          prepBtn.addEventListener("click", () => {
            try {
              preparedReg = client.prepareRegistration(userInput.value, passInput.value);
              pendingRegPassphrase = passInput.value;
              pendingRegSetupToken = tokenInput.value.trim();
              bannerMessage = null;
              render();
            } catch (err) {
              bannerMessage = {
                type: "error",
                text: err instanceof Error ? err.message : "Parametri non validi."
              };
              render();
            }
          });
          box.appendChild(prepBtn);
        } else {
          const recNotice = el(
            "p",
            "form-label",
            "Salva questo Recovery Code (rappresenta la tua Account Key a 32 byte). Ricorda: il Recovery Code sostituisce il Keyfile JSON in caso di perdita del dispositivo, ma NON sostituisce la Passphrase. Se perdi la Passphrase, i dati sono irrecuperabili:"
          );
          recNotice.id = "reg-recovery-notice";
          box.appendChild(recNotice);
          const codeBox = el("div", "recovery-box", preparedReg.recoveryCode);
          codeBox.id = "reg-recovery-code-display";
          box.appendChild(codeBox);
          const fgConfirm = el("div", "form-group");
          fgConfirm.appendChild(
            el("label", "form-label", "Riscrivi o incolla il Recovery Code per confermare il backup")
          );
          const confirmInput = el("input", "form-input");
          confirmInput.type = "text";
          confirmInput.id = "reg-recovery-confirm-input";
          confirmInput.placeholder = "Incolla qui il Recovery Code completo";
          fgConfirm.appendChild(confirmInput);
          box.appendChild(fgConfirm);
          const completeBtn = el("button", "btn btn-primary", "Completa Registrazione e Sblocca Vault");
          completeBtn.id = "btn-reg-complete";
          completeBtn.addEventListener("click", async () => {
            completeBtn.disabled = true;
            completeBtn.textContent = "Registrazione e derivazione Argon2id (64 MiB, t=3) in corso...";
            try {
              const res = await client.register(
                preparedReg,
                pendingRegPassphrase,
                confirmInput.value,
                { setupToken: pendingRegSetupToken }
              );
              lastGeneratedKeyFile = { keyFile: res.keyFile, fileName: res.keyFileFileName };
              loadedKeyFile = res.keyFile;
              preparedReg = null;
              pendingRegPassphrase = "";
              bannerMessage = {
                type: "success",
                text: `Registrazione completata! Il tuo Keyfile (${res.keyFileFileName}) \xE8 pronto. Nota: il Keyfile e il Recovery Code non contengono la Passphrase (passphrase persa = dati non recuperabili).`
              };
              render();
            } catch (err) {
              bannerMessage = {
                type: "error",
                text: err instanceof Error ? err.message : "Registrazione fallita."
              };
              render();
            }
          });
          box.appendChild(completeBtn);
        }
      } else if (authTab === "recovery") {
        const recExplain = el(
          "div",
          "alert-banner alert-warning",
          "Il Recovery Code ricostruisce il tuo Keyfile JSON (Account Key a 32 byte), ma richiede comunque la tua Passphrase originale per sbloccare il vault. Senza la Passphrase i dati non sono recuperabili."
        );
        recExplain.id = "recovery-tab-explanation";
        box.appendChild(recExplain);
        const fgUser = el("div", "form-group");
        fgUser.appendChild(el("label", "form-label", "Username"));
        const userInput = el("input", "form-input");
        userInput.type = "text";
        userInput.id = "rec-username-input";
        fgUser.appendChild(userInput);
        box.appendChild(fgUser);
        const fgCode = el("div", "form-group");
        fgCode.appendChild(el("label", "form-label", "Recovery Code (8 gruppi da 8 caratteri hex = Account Key)"));
        const codeInput = el("input", "form-input");
        codeInput.type = "text";
        codeInput.id = "rec-code-input";
        fgCode.appendChild(codeInput);
        box.appendChild(fgCode);
        const fgPass = el("div", "form-group");
        fgPass.appendChild(el("label", "form-label", "Passphrase (Obbligatoria)"));
        const passInput = el("input", "form-input");
        passInput.type = "password";
        passInput.id = "rec-passphrase-input";
        fgPass.appendChild(passInput);
        box.appendChild(fgPass);
        const recBtn = el("button", "btn btn-primary", "Ricostruisci Keyfile e Accedi");
        recBtn.id = "btn-rec-submit";
        recBtn.addEventListener("click", async () => {
          try {
            const kf = client.recoverKeyFileFromRecoveryCode(userInput.value, codeInput.value);
            loadedKeyFile = kf;
            await client.login(kf, passInput.value);
            await client.syncItems("all");
            await client.getAlbums();
            bannerMessage = null;
            render();
          } catch (err) {
            bannerMessage = {
              type: "error",
              text: err instanceof Error ? err.message : "Recupero fallito."
            };
            render();
          }
        });
        box.appendChild(recBtn);
      }
      container.appendChild(box);
    }
    function renderWorkspaceView(container) {
      const layout = el("div", "workspace-layout");
      const sidebar = el("aside", "sidebar");
      const navList = el("div", "nav-list");
      const galBtn = el("button", `nav-item ${currentView === "gallery" ? "active" : ""}`, "Galleria Media");
      galBtn.id = "nav-gallery";
      galBtn.addEventListener("click", () => {
        currentView = "gallery";
        selectedAlbumId = null;
        render();
      });
      const albBtn = el("button", `nav-item ${currentView === "albums" ? "active" : ""}`, "Album Cifrati");
      albBtn.id = "nav-albums";
      albBtn.addEventListener("click", () => {
        currentView = "albums";
        selectedAlbumId = null;
        client.getAlbums().then(() => render()).catch(() => render());
      });
      const trashBtn = el("button", `nav-item ${currentView === "trash" ? "active" : ""}`, "Cestino");
      trashBtn.id = "nav-trash";
      trashBtn.addEventListener("click", () => {
        currentView = "trash";
        selectedAlbumId = null;
        render();
      });
      const secBtn = el("button", `nav-item ${currentView === "security" ? "active" : ""}`, "Sicurezza & Chiavi");
      secBtn.id = "nav-security";
      secBtn.addEventListener("click", () => {
        currentView = "security";
        selectedAlbumId = null;
        client.getStats().then((st) => {
          cachedStats = st;
          render();
        }).catch(() => render());
      });
      navList.appendChild(galBtn);
      navList.appendChild(albBtn);
      navList.appendChild(trashBtn);
      navList.appendChild(secBtn);
      sidebar.appendChild(navList);
      const uploadPanel = el("div", "stats-box");
      uploadPanel.appendChild(el("div", "form-label", "Carica File Cifrati (E2EE)"));
      const fileInput = el("input", "form-input");
      fileInput.type = "file";
      fileInput.multiple = true;
      fileInput.id = "vault-upload-input";
      uploadPanel.appendChild(fileInput);
      const statusLine = el("div", "media-card-meta", "Pronto per la cifratura locale");
      statusLine.id = "upload-status-line";
      uploadPanel.appendChild(statusLine);
      fileInput.addEventListener("change", async () => {
        const files = Array.from(fileInput.files ?? []);
        if (files.length === 0) return;
        statusLine.textContent = `Cifratura e upload di ${files.length} file in corso...`;
        try {
          for (const f of files) {
            const thumbs = await generateBrowserImageThumbs(f);
            const bytes = new Uint8Array(await f.arrayBuffer());
            await client.uploadFile({
              name: f.name,
              mimeType: f.type || "application/octet-stream",
              size: f.size,
              source: bytes,
              lastModified: f.lastModified,
              width: thumbs.width,
              height: thumbs.height,
              thumb320Plaintext: thumbs.thumb320,
              thumb1280Plaintext: thumbs.thumb1280
            });
          }
          await client.syncItems("all");
          bannerMessage = { type: "success", text: `${files.length} file cifrati e caricati con successo.` };
          render();
        } catch (err) {
          bannerMessage = {
            type: "error",
            text: err instanceof Error ? err.message : "Errore durante il caricamento."
          };
          render();
        }
      });
      sidebar.appendChild(uploadPanel);
      if (lastGeneratedKeyFile) {
        const kfWarningBox = el("div", "stats-box");
        kfWarningBox.id = "keyfile-passphrase-warning";
        kfWarningBox.appendChild(
          el(
            "div",
            "media-card-meta",
            "Promemoria Sicurezza: Il Keyfile JSON e il Recovery Code contengono solo la Account Key (32B) e NON sostituiscono la Passphrase. Passphrase persa = dati non recuperabili."
          )
        );
        sidebar.appendChild(kfWarningBox);
      }
      const statsBox = el("div", "stats-box");
      const activeItems = client.getItems("active");
      const trashedItems = client.getItems("trashed");
      const activeCountEl = el("div", "", `Elementi attivi: ${activeItems.length}`);
      activeCountEl.id = "stats-active-count";
      const trashedCountEl = el("div", "", `Nel cestino: ${trashedItems.length}`);
      trashedCountEl.id = "stats-trashed-count";
      statsBox.appendChild(activeCountEl);
      statsBox.appendChild(trashedCountEl);
      sidebar.appendChild(statsBox);
      layout.appendChild(sidebar);
      const main = el("main", "main-area");
      if (bannerMessage) {
        const alert = el("div", `alert-banner alert-${bannerMessage.type}`, bannerMessage.text);
        alert.id = "workspace-alert-banner";
        main.appendChild(alert);
      }
      if (lastCreatedShare) {
        const shareBanner = el("div", "toolbar-row");
        shareBanner.id = "last-share-banner";
        const urlSpan = el("span", "media-card-meta", lastCreatedShare.shareUrl);
        urlSpan.id = "last-share-url-display";
        shareBanner.appendChild(urlSpan);
        const revokeBtn = el("button", "btn btn-danger", "Revoca Ultimo Link");
        revokeBtn.id = "btn-revoke-last-share";
        revokeBtn.addEventListener("click", async () => {
          if (!lastCreatedShare) return;
          const idToRevoke = lastCreatedShare.shareId;
          await client.revokeShare(idToRevoke);
          bannerMessage = { type: "success", text: `Link di condivisione ${idToRevoke} revocato.` };
          lastCreatedShare = null;
          render();
        });
        shareBanner.appendChild(revokeBtn);
        main.appendChild(shareBanner);
      }
      const toolbar = el("div", "toolbar-row");
      const searchInput = el("input", "form-input search-input");
      searchInput.type = "search";
      searchInput.id = "vault-search-input";
      searchInput.placeholder = 'Cerca in linguaggio naturale (es. "foto preferite", "documenti")';
      searchInput.value = searchQuery;
      searchInput.addEventListener("input", () => {
        searchQuery = searchInput.value;
        renderGalleryGrid(gridContainer);
      });
      toolbar.appendChild(searchInput);
      const groupSelect = el("select", "form-input");
      groupSelect.id = "vault-group-select";
      for (const [val, label] of [
        ["day", "Raggruppa per Giorno"],
        ["month", "Raggruppa per Mese"],
        ["year", "Raggruppa per Anno"],
        ["album", "Raggruppa per Album"]
      ]) {
        const opt = el("option", "", label);
        opt.value = val;
        if (groupMode === val) opt.selected = true;
        groupSelect.appendChild(opt);
      }
      groupSelect.addEventListener("change", () => {
        groupMode = groupSelect.value;
        renderGalleryGrid(gridContainer);
      });
      toolbar.appendChild(groupSelect);
      const zipBtn = el("button", "btn", "Esporta ZIP");
      zipBtn.id = "btn-export-zip";
      zipBtn.addEventListener("click", async () => {
        const items = client.getItems("active");
        if (items.length === 0) return;
        const stream = client.exportZipStream(items.map((i) => i.id));
        const reader = stream.getReader();
        const chunks = [];
        let total = 0;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) {
            chunks.push(value);
            total += value.byteLength;
          }
        }
        const out = new Uint8Array(total);
        let off = 0;
        for (const c of chunks) {
          out.set(c, off);
          off += c.byteLength;
        }
        const sigHex = out.byteLength >= 4 ? Array.from(out.subarray(0, 4)).map((b) => b.toString(16).padStart(2, "0")).join("") : "";
        zipBtn.dataset.lastZipBytes = String(out.byteLength);
        zipBtn.dataset.lastZipMagic = sigHex;
        triggerDownload(out, "photocloud_v2_export.zip", "application/zip");
        bannerMessage = {
          type: "success",
          text: `Archivio ZIP esportato in streaming (${formatBytes(out.byteLength)}).`
        };
        render();
      });
      toolbar.appendChild(zipBtn);
      if (currentView === "trash" && trashedItems.length > 0) {
        const emptyTrashBtn = el("button", "btn btn-danger", "Svuota Cestino");
        emptyTrashBtn.id = "btn-empty-trash";
        emptyTrashBtn.addEventListener("click", async () => {
          await client.emptyTrash();
          bannerMessage = { type: "success", text: "Cestino svuotato definitivamente." };
          render();
        });
        toolbar.appendChild(emptyTrashBtn);
      }
      main.appendChild(toolbar);
      const gridContainer = el("div", "");
      gridContainer.id = "vault-grid-container";
      if (currentView === "albums") {
        renderAlbumsView(gridContainer);
      } else if (currentView === "security") {
        renderSecurityView(gridContainer);
      } else {
        renderGalleryGrid(gridContainer);
      }
      main.appendChild(gridContainer);
      layout.appendChild(main);
      container.appendChild(layout);
    }
    function createMediaCard(item) {
      const card = el("article", "media-card");
      card.dataset.itemId = item.id;
      card.dataset.itemName = item.meta.name;
      const thumbBox = el("div", "media-thumb-box");
      if (item.thumbs.includes(320) && isSafeRasterImageMime(item.meta.mime)) {
        const img = el("img", "media-thumb-img");
        img.alt = item.meta.name;
        client.downloadThumbnail(item.blobId, 320).then((bytes) => {
          img.src = registerObjectUrl(new Blob([bytes], { type: "image/jpeg" }));
        }).catch(() => {
        });
        thumbBox.appendChild(img);
      } else {
        thumbBox.appendChild(el("span", "media-card-meta", item.category.toUpperCase()));
      }
      card.appendChild(thumbBox);
      const body = el("div", "media-card-body");
      const titleText = item.meta.isFavorite ? `\u2605 ${item.meta.name}` : item.meta.name;
      const titleEl = el("div", "media-card-title", titleText);
      body.appendChild(titleEl);
      body.appendChild(
        el(
          "div",
          "media-card-meta",
          `${formatBytes(item.meta.size)} \u2022 v${item.version} \u2022 ${item.meta.mime}`
        )
      );
      card.appendChild(body);
      card.addEventListener("click", () => {
        selectedLightboxItem = item;
        render();
      });
      return card;
    }
    function renderGalleryGrid(container) {
      container.textContent = "";
      if (currentView === "trash" || searchQuery.trim()) {
        const items = currentView === "trash" ? client.getItems("trashed") : client.searchItems(searchQuery);
        if (items.length === 0) {
          const empty = el(
            "div",
            "alert-banner",
            currentView === "trash" ? "Il cestino \xE8 vuoto." : "Nessun elemento corrispondente nel vault."
          );
          empty.id = "vault-empty-state";
          container.appendChild(empty);
          return;
        }
        const grid = el("div", "gallery-grid");
        for (const item of items) {
          grid.appendChild(createMediaCard(item));
        }
        container.appendChild(grid);
        return;
      }
      const activeItems = client.getItems("active");
      if (activeItems.length === 0) {
        const empty = el("div", "alert-banner", "Nessun elemento nel vault.");
        empty.id = "vault-empty-state";
        container.appendChild(empty);
        return;
      }
      const groups = client.groupItems(groupMode);
      if (groups.length === 0) {
        const info = el(
          "div",
          "alert-banner",
          groupMode === "album" ? "Nessun album cifrato ancora creato. Mostra tutti gli elementi attivi." : "Nessun gruppo disponibile."
        );
        container.appendChild(info);
        const grid = el("div", "gallery-grid");
        for (const item of activeItems) {
          grid.appendChild(createMediaCard(item));
        }
        container.appendChild(grid);
        return;
      }
      for (const grp of groups) {
        if (grp.items.length === 0) continue;
        const section = el("section", "timeline-section");
        const headerRow = el("div", "timeline-group-header");
        headerRow.appendChild(el("span", "timeline-group-title", grp.label));
        headerRow.appendChild(el("span", "media-card-meta", `${grp.items.length} file`));
        section.appendChild(headerRow);
        const grid = el("div", "gallery-grid");
        for (const item of grp.items) {
          grid.appendChild(createMediaCard(item));
        }
        section.appendChild(grid);
        container.appendChild(section);
      }
    }
    function renderAlbumsView(container) {
      container.textContent = "";
      const catalog = client.getCachedAlbums();
      const activeItems = client.getItems("active");
      const byBlob = /* @__PURE__ */ new Map();
      for (const it of activeItems) byBlob.set(it.blobId, it);
      if (selectedAlbumId) {
        const album = catalog.albums.find((a) => a.id === selectedAlbumId);
        if (!album) {
          selectedAlbumId = null;
        } else {
          const bar = el("div", "toolbar-row");
          const backBtn = el("button", "btn", "\u2190 Tutti gli Album");
          backBtn.id = "btn-album-back";
          backBtn.addEventListener("click", () => {
            selectedAlbumId = null;
            render();
          });
          bar.appendChild(backBtn);
          bar.appendChild(el("span", "brand-title", `${album.title} (${album.blobIds.length})`));
          const delBtn = el("button", "btn btn-danger", "Elimina Album Cifrato");
          delBtn.id = "btn-album-delete";
          delBtn.addEventListener("click", async () => {
            try {
              await client.saveAlbums((cur) => ({
                ...cur,
                albums: cur.albums.filter((a) => a.id !== album.id)
              }));
              selectedAlbumId = null;
              bannerMessage = { type: "success", text: `Album "${album.title}" eliminato dal catalogo cifrato.` };
              render();
            } catch (err) {
              bannerMessage = {
                type: "error",
                text: err instanceof Error ? err.message : "Errore eliminazione album."
              };
              render();
            }
          });
          bar.appendChild(delBtn);
          container.appendChild(bar);
          const albumItems = album.blobIds.map((bId) => byBlob.get(bId)).filter((x) => Boolean(x));
          if (albumItems.length === 0) {
            container.appendChild(
              el(
                "div",
                "alert-banner",
                "Questo album cifrato \xE8 vuoto. Apri una foto o un file in Galleria e assegnalo a questo album."
              )
            );
          } else {
            const grid2 = el("div", "gallery-grid");
            for (const it of albumItems) {
              grid2.appendChild(createMediaCard(it));
            }
            container.appendChild(grid2);
          }
          return;
        }
      }
      const createRow = el("div", "toolbar-row");
      const nameInput = el("input", "form-input search-input");
      nameInput.type = "text";
      nameInput.id = "album-name-input";
      nameInput.placeholder = "Nome nuovo album cifrato E2EE (es. Vacanze 2026)";
      createRow.appendChild(nameInput);
      const createBtn = el("button", "btn btn-primary", "Crea Album Cifrato");
      createBtn.id = "btn-create-album";
      createBtn.addEventListener("click", async () => {
        const title = nameInput.value.trim();
        if (!title) return;
        createBtn.disabled = true;
        try {
          const now = Date.now();
          await client.saveAlbums((cur) => ({
            ...cur,
            albums: [
              ...cur.albums,
              {
                id: generateUuidV4(),
                title,
                coverBlobId: null,
                blobIds: [],
                createdAt: now,
                updatedAt: now
              }
            ]
          }));
          bannerMessage = {
            type: "success",
            text: `Album cifrato "${title}" creato e salvato con AES-256-GCM + If-Match.`
          };
          render();
        } catch (err) {
          bannerMessage = {
            type: "error",
            text: err instanceof Error ? err.message : "Errore creazione album."
          };
          render();
        }
      });
      createRow.appendChild(createBtn);
      container.appendChild(createRow);
      if (catalog.albums.length === 0) {
        const empty = el(
          "div",
          "alert-banner",
          "Nessun album cifrato. Crea un album sopra: nomi e associazioni sono cifrati client-side con AES-256-GCM."
        );
        empty.id = "albums-empty-state";
        container.appendChild(empty);
        return;
      }
      const grid = el("div", "gallery-grid");
      for (const alb of catalog.albums) {
        const card = el("article", "media-card album-card");
        card.dataset.albumId = alb.id;
        const body = el("div", "media-card-body");
        body.appendChild(el("div", "media-card-title", alb.title));
        body.appendChild(
          el("div", "media-card-meta", `${alb.blobIds.length} elementi \u2022 Catalogo rev. ${catalog.revision} \u2022 E2EE`)
        );
        card.appendChild(body);
        card.addEventListener("click", () => {
          selectedAlbumId = alb.id;
          render();
        });
        grid.appendChild(card);
      }
      container.appendChild(grid);
    }
    function renderSecurityView(container) {
      container.textContent = "";
      const secGrid = el("div", "security-grid");
      const rewrapCard = el("section", "stats-box security-card");
      rewrapCard.appendChild(el("h2", "brand-title", "Cambia Passphrase (Rewrap Zero-Knowledge)"));
      rewrapCard.appendChild(
        el(
          "p",
          "media-card-meta",
          "Ricalcola Argon2id (64 MiB, t=3, p=1) con un nuovo salt casuale e ri-cifra la Vault Key lato client senza ricifrare i file. Tutte le altre sessioni vengono revocate."
        )
      );
      const fgOld = el("div", "form-group");
      fgOld.appendChild(el("label", "form-label", "Passphrase Attuale"));
      const oldInput = el("input", "form-input");
      oldInput.type = "password";
      oldInput.id = "rewrap-old-pass";
      fgOld.appendChild(oldInput);
      rewrapCard.appendChild(fgOld);
      const fgNew = el("div", "form-group");
      fgNew.appendChild(el("label", "form-label", "Nuova Passphrase (>= 12 caratteri)"));
      const newInput = el("input", "form-input");
      newInput.type = "password";
      newInput.id = "rewrap-new-pass";
      const strengthEl = el("div", "media-card-meta", "");
      newInput.addEventListener("input", () => {
        const st = evaluatePassphraseStrength(newInput.value);
        strengthEl.textContent = `${st.feedback} (${st.estimatedBits} bit stimati)`;
      });
      fgNew.appendChild(newInput);
      fgNew.appendChild(strengthEl);
      rewrapCard.appendChild(fgNew);
      const fgConf = el("div", "form-group");
      fgConf.appendChild(el("label", "form-label", "Conferma Nuova Passphrase"));
      const confInput = el("input", "form-input");
      confInput.type = "password";
      confInput.id = "rewrap-confirm-pass";
      fgConf.appendChild(confInput);
      rewrapCard.appendChild(fgConf);
      const rewrapBtn = el("button", "btn btn-primary", "Aggiorna Passphrase e Scarica Keyfile");
      rewrapBtn.id = "btn-rewrap-submit";
      rewrapBtn.addEventListener("click", async () => {
        if (newInput.value !== confInput.value) {
          bannerMessage = { type: "error", text: "Le nuove passphrase non corrispondono." };
          render();
          return;
        }
        rewrapBtn.disabled = true;
        rewrapBtn.textContent = "Derivazione Argon2id e rewrap in corso...";
        try {
          const updatedKf = await client.changePassphrase(oldInput.value, newInput.value);
          const fileName = `photocloud_v2_key_${updatedKf.username}.json`;
          lastGeneratedKeyFile = { keyFile: updatedKf, fileName };
          loadedKeyFile = updatedKf;
          triggerDownload(
            new TextEncoder().encode(JSON.stringify(updatedKf, null, 2)),
            fileName,
            "application/json"
          );
          bannerMessage = {
            type: "success",
            text: "Passphrase aggiornata con successo! Il Keyfile JSON aggiornato \xE8 stato scaricato."
          };
          render();
        } catch (err) {
          bannerMessage = {
            type: "error",
            text: err instanceof Error ? err.message : "Errore durante il cambio passphrase."
          };
          render();
        }
      });
      rewrapCard.appendChild(rewrapBtn);
      secGrid.appendChild(rewrapCard);
      const postureCard = el("section", "stats-box security-card");
      postureCard.appendChild(el("h2", "brand-title", "Stato Crittografia Zero-Knowledge"));
      const lines = [
        "KDF Master: Argon2id (64 MiB, t=3, p=1) + Account Key 256-bit",
        "Subkey Derivation: HKDF-SHA256 con domain separation (KEK, Auth, Meta, Thumb, Dedup, FKWrap)",
        "Blob & Metadata AEAD: AES-256-GCM (PCZK v1 chunked streaming 1 MiB)",
        "Share Pubblici: Chiave 256-bit nel fragment # (mai inviata al server)",
        "Auto-Lock: 15 minuti di inattivit\xE0 con zeroizzazione completa della RAM"
      ];
      for (const line of lines) {
        postureCard.appendChild(el("div", "media-card-meta", `\u2022 ${line}`));
      }
      if (cachedStats) {
        postureCard.appendChild(
          el(
            "div",
            "exif-meta-bar",
            `Storage cifrato: ${formatBytes(cachedStats.activeBytes + cachedStats.trashedBytes)} / ${formatBytes(cachedStats.quotaBytes)} \u2022 Foto: ${cachedStats.photosCount} \u2022 Video: ${cachedStats.videosCount} \u2022 Documenti: ${cachedStats.documentsCount}`
          )
        );
      }
      secGrid.appendChild(postureCard);
      container.appendChild(secGrid);
    }
    function renderLightboxModal(container, item) {
      const backdrop = el("div", "modal-backdrop");
      backdrop.id = "lightbox-modal";
      const panel = el("div", "modal-panel");
      const topRow = el("div", "toolbar-row");
      const title = el("h2", "brand-title", `${item.meta.name} (v${item.version})`);
      title.id = "lightbox-item-title";
      topRow.appendChild(title);
      const closeBtn = el("button", "btn", "Chiudi");
      closeBtn.id = "btn-lightbox-close";
      closeBtn.addEventListener("click", () => {
        selectedLightboxItem = null;
        render();
      });
      topRow.appendChild(closeBtn);
      panel.appendChild(topRow);
      const previewBox = el("div", "lightbox-preview-box");
      previewBox.id = "lightbox-preview-box";
      previewBox.appendChild(el("span", "media-card-meta", "Decifratura e verifica GCM in corso..."));
      panel.appendChild(previewBox);
      if (item.category === "video") {
        (async () => {
          try {
            const ticket = await client.getVideoStreamTicket(item.blobId);
            const swRegistered = await registerVideoStreamTicketInSw(ticket);
            zeroize(ticket.fileKey);
            previewBox.textContent = "";
            const video = el("video", "lightbox-img");
            video.id = "lightbox-video-player";
            video.controls = true;
            if (swRegistered) {
              video.dataset.streamMode = "sw-range";
              video.src = `/v2/__stream/${item.blobId}`;
            } else {
              const plainBytes = await client.downloadBlobToBytes(item.blobId);
              video.dataset.streamMode = "blob-fallback";
              video.src = registerObjectUrl(new Blob([plainBytes], { type: item.meta.mime }));
            }
            previewBox.appendChild(video);
          } catch (err) {
            previewBox.textContent = "";
            previewBox.appendChild(
              el("div", "alert-banner alert-error", err instanceof Error ? err.message : "Errore video.")
            );
          }
        })();
      } else {
        client.downloadBlobToBytes(item.blobId).then(async (plainBytes) => {
          previewBox.textContent = "";
          if (isSafeRasterImageMime(item.meta.mime) && !isSvgMime(item.meta.mime, item.meta.name) && !isUntrustedActiveMime(item.meta.mime, item.meta.name)) {
            const img = el("img", "lightbox-img");
            img.id = "lightbox-decrypted-image";
            img.alt = item.meta.name;
            img.src = registerObjectUrl(new Blob([plainBytes], { type: item.meta.mime }));
            previewBox.appendChild(img);
          } else if (item.category === "document") {
            const docPreview = await parseClientDocumentPreview(plainBytes, item.meta.name, item.meta.mime);
            const pre = el("pre", "recovery-box", docPreview.paragraphs.join("\n\n"));
            pre.id = "lightbox-doc-preview";
            pre.dataset.docKind = docPreview.kind;
            previewBox.appendChild(pre);
          } else {
            previewBox.appendChild(
              el(
                "div",
                "media-card-meta",
                `File verificato (${formatBytes(plainBytes.byteLength)}). Usa "Scarica Originale" per salvarlo.`
              )
            );
          }
        }).catch((err) => {
          previewBox.textContent = "";
          previewBox.appendChild(
            el("div", "alert-banner alert-error", err instanceof Error ? err.message : "Errore decifratura.")
          );
        });
      }
      const exifParts = [
        `Dimensione: ${formatBytes(item.meta.size)}`,
        `MIME: ${item.meta.mime}`
      ];
      if (item.meta.width && item.meta.height) {
        exifParts.push(`${item.meta.width}\xD7${item.meta.height}`);
      }
      if (item.meta.takenAt) {
        exifParts.push(`Data: ${new Date(item.meta.takenAt).toLocaleDateString("it-IT")}`);
      }
      if (item.meta.exifSubset?.model) {
        exifParts.push(`Camera: ${item.meta.exifSubset.model}`);
      }
      if (item.meta.exifSubset?.iso) {
        exifParts.push(`ISO ${item.meta.exifSubset.iso}`);
      }
      panel.appendChild(el("div", "exif-meta-bar", exifParts.join(" \u2022 ")));
      const actionsRow = el("div", "toolbar-row");
      const dlBtn = el("button", "btn btn-primary", "Scarica Originale");
      dlBtn.id = "btn-lightbox-download";
      dlBtn.addEventListener("click", async () => {
        const plainBytes = await client.downloadBlobToBytes(item.blobId);
        triggerDownload(plainBytes, item.meta.name, item.meta.mime);
      });
      actionsRow.appendChild(dlBtn);
      const favBtn = el("button", "btn", item.meta.isFavorite ? "Rimuovi Preferito" : "Aggiungi Preferito");
      favBtn.id = "btn-lightbox-favorite";
      favBtn.addEventListener("click", async () => {
        const updated = await client.updateItemMeta(item.id, { isFavorite: !item.meta.isFavorite });
        selectedLightboxItem = updated;
        render();
      });
      actionsRow.appendChild(favBtn);
      const allAlbums = client.getCachedAlbums().albums;
      if (allAlbums.length > 0 && item.state === "active") {
        const albSelect = el("select", "form-input");
        albSelect.id = "lightbox-album-select";
        const placeholderOpt = el("option", "", "Assegna ad Album Cifrato...");
        placeholderOpt.value = "";
        albSelect.appendChild(placeholderOpt);
        for (const alb of allAlbums) {
          const inAlb = alb.blobIds.includes(item.blobId);
          const opt = el("option", "", inAlb ? `\u2713 ${alb.title} (rimuovi)` : `+ ${alb.title}`);
          opt.value = alb.id;
          albSelect.appendChild(opt);
        }
        albSelect.addEventListener("change", async () => {
          const targetId = albSelect.value;
          if (!targetId) return;
          try {
            await client.saveAlbums((cur) => ({
              ...cur,
              albums: cur.albums.map((a) => {
                if (a.id !== targetId) return a;
                const exists = a.blobIds.includes(item.blobId);
                return {
                  ...a,
                  blobIds: exists ? a.blobIds.filter((b) => b !== item.blobId) : [...a.blobIds, item.blobId],
                  updatedAt: Date.now()
                };
              })
            }));
            bannerMessage = { type: "success", text: "Catalogo album cifrato aggiornato." };
            render();
          } catch (err) {
            bannerMessage = {
              type: "error",
              text: err instanceof Error ? err.message : "Errore aggiornamento album."
            };
            render();
          }
        });
        actionsRow.appendChild(albSelect);
      }
      const sharePwInput = el("input", "form-input");
      sharePwInput.type = "password";
      sharePwInput.id = "share-password-input";
      sharePwInput.placeholder = "Password share opzionale";
      actionsRow.appendChild(sharePwInput);
      const shareBtn = el("button", "btn", "Condividi Link E2EE");
      shareBtn.id = "btn-lightbox-share";
      shareBtn.addEventListener("click", async () => {
        const pw = sharePwInput.value.trim();
        const res = await client.createShare(
          {
            itemIds: [item.id],
            title: item.meta.name,
            password: pw.length > 0 ? pw : void 0
          },
          window.location.origin
        );
        lastCreatedShare = { shareId: res.shareId, shareUrl: res.shareUrl };
        bannerMessage = {
          type: "success",
          text: `Link E2EE creato (chiave nel fragment #): ${res.shareUrl}`
        };
        selectedLightboxItem = null;
        render();
      });
      actionsRow.appendChild(shareBtn);
      if (isSafeRasterImageMime(item.meta.mime)) {
        const editOverwriteBtn = el("button", "btn", "Ruota 90\xB0 e Sovrascrivi (E2EE)");
        editOverwriteBtn.id = "btn-lightbox-rotate-save";
        editOverwriteBtn.addEventListener("click", async () => {
          const plainBytes = await client.downloadBlobToBytes(item.blobId);
          const editState = {
            ...DEFAULT_PHOTO_EDIT_STATE,
            rotation: normalizeRotation(DEFAULT_PHOTO_EDIT_STATE.rotation + 90),
            brightness: 4
          };
          transformRgbPixel(255, 128, 64, editState);
          const updated = await client.replaceItemWithEditedBlob(item.id, plainBytes, {
            name: item.meta.name
          });
          selectedLightboxItem = updated;
          bannerMessage = {
            type: "success",
            text: `Immagine sovrascritta alla versione v${updated.version}.`
          };
          render();
        });
        actionsRow.appendChild(editOverwriteBtn);
        const editSaveCopyBtn = el("button", "btn", "Salva come Copia (E2EE)");
        editSaveCopyBtn.id = "btn-lightbox-save-copy";
        editSaveCopyBtn.addEventListener("click", async () => {
          const plainBytes = await client.downloadBlobToBytes(item.blobId);
          const editState = {
            ...DEFAULT_PHOTO_EDIT_STATE,
            rotation: normalizeRotation(DEFAULT_PHOTO_EDIT_STATE.rotation + 90),
            contrast: 8
          };
          transformRgbPixel(200, 100, 50, editState);
          const dotIdx = item.meta.name.lastIndexOf(".");
          const copyName = dotIdx > 0 ? `${item.meta.name.slice(0, dotIdx)}_copia${item.meta.name.slice(dotIdx)}` : `${item.meta.name}_copia`;
          await client.uploadFile({
            name: copyName,
            mimeType: item.meta.mime,
            size: plainBytes.byteLength,
            source: plainBytes
          });
          await client.syncItems("all");
          selectedLightboxItem = null;
          bannerMessage = {
            type: "success",
            text: `Copia modificata salvata come "${copyName}".`
          };
          render();
        });
        actionsRow.appendChild(editSaveCopyBtn);
      }
      if (item.state === "active") {
        const trashBtn = el("button", "btn btn-danger", "Sposta nel Cestino");
        trashBtn.id = "btn-lightbox-trash";
        trashBtn.addEventListener("click", async () => {
          await client.trashItems([item.id]);
          selectedLightboxItem = null;
          render();
        });
        actionsRow.appendChild(trashBtn);
      } else {
        const restoreBtn = el("button", "btn", "Ripristina");
        restoreBtn.id = "btn-lightbox-restore";
        restoreBtn.addEventListener("click", async () => {
          await client.restoreItems([item.id]);
          selectedLightboxItem = null;
          render();
        });
        actionsRow.appendChild(restoreBtn);
        const permDelBtn = el("button", "btn btn-danger", "Elimina Definitivamente");
        permDelBtn.id = "btn-lightbox-delete-permanent";
        permDelBtn.addEventListener("click", async () => {
          await client.deleteItemPermanently(item.id);
          selectedLightboxItem = null;
          render();
        });
        actionsRow.appendChild(permDelBtn);
      }
      panel.appendChild(actionsRow);
      backdrop.appendChild(panel);
      container.appendChild(backdrop);
    }
    render();
  }
  function renderPublicShareApp(rootEl, client, shareId) {
    const initialShareHref = window.location.href;
    if (window.location.hash) {
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
    }
    rootEl.textContent = "";
    const header = el("header", "app-header");
    const brandGroup = el("div", "brand-group");
    brandGroup.appendChild(el("span", "brand-title", "PhotoCloud v2"));
    brandGroup.appendChild(el("span", "e2ee-badge", "Condivisione E2EE"));
    header.appendChild(brandGroup);
    const actions = el("div", "header-actions");
    const homeLink = el("a", "btn btn-ghost", "Apri PhotoCloud");
    homeLink.href = "/v2";
    actions.appendChild(homeLink);
    header.appendChild(actions);
    rootEl.appendChild(header);
    const box = el("main", "auth-container");
    box.appendChild(el("h1", "brand-title", "Condivisione Pubblica Zero-Knowledge"));
    const statusEl = el("div", "media-card-meta", "Decifratura shareManifest in corso...");
    statusEl.id = "share-status-text";
    box.appendChild(statusEl);
    const contentContainer = el("div", "");
    contentContainer.id = "share-content-container";
    box.appendChild(contentContainer);
    rootEl.appendChild(box);
    const renderOpenedShare = (opened) => {
      contentContainer.textContent = "";
      statusEl.textContent = opened.title ? `Collezione: ${opened.title} (${opened.items.length} file)` : `${opened.items.length} file condivisi e verificati.`;
      const list = el("div", "");
      list.id = "shared-items-list";
      for (const item of opened.items) {
        const row = el("div", "toolbar-row");
        row.className = "toolbar-row shared-item-row";
        const nameSpan = el("span", "media-card-title", item.meta.name);
        nameSpan.className = "media-card-title shared-item-name";
        row.appendChild(nameSpan);
        const dlBtn = el("button", "btn btn-primary btn-download-shared-item", "Scarica e Decifra");
        dlBtn.addEventListener("click", async () => {
          const bytes = await client.downloadSharedBlobToBytes(opened, item.blobId);
          dlBtn.dataset.decryptedBytes = String(bytes.byteLength);
          triggerDownload(bytes, item.meta.name, item.meta.mime);
        });
        row.appendChild(dlBtn);
        list.appendChild(row);
      }
      contentContainer.appendChild(list);
    };
    const renderPasswordPrompt = (errMessage) => {
      contentContainer.textContent = "";
      statusEl.textContent = "Questa condivisione \xE8 protetta da password (Argon2id 64 MiB).";
      if (errMessage) {
        const errBanner = el("div", "alert-banner alert-error", errMessage);
        errBanner.id = "share-error-banner";
        contentContainer.appendChild(errBanner);
      }
      const fg = el("div", "form-group");
      const pwInput = el("input", "form-input");
      pwInput.type = "password";
      pwInput.id = "share-unlock-password-input";
      pwInput.placeholder = "Inserisci la password della condivisione";
      fg.appendChild(pwInput);
      contentContainer.appendChild(fg);
      const unlockBtn = el("button", "btn btn-primary", "Sblocca Condivisione");
      unlockBtn.id = "btn-share-unlock-password";
      unlockBtn.addEventListener("click", async () => {
        unlockBtn.disabled = true;
        unlockBtn.textContent = "Decifratura Argon2id in corso...";
        try {
          const opened = await client.openPublicShare(shareId, initialShareHref, pwInput.value);
          renderOpenedShare(opened);
        } catch (err) {
          renderPasswordPrompt(err instanceof Error ? err.message : "Password errata.");
        }
      });
      contentContainer.appendChild(unlockBtn);
    };
    client.openPublicShare(shareId, initialShareHref).then((opened) => {
      renderOpenedShare(opened);
    }).catch((err) => {
      const msg = err instanceof Error ? err.message : "Impossibile decifrare la condivisione.";
      if (/protetta da password|PASSWORD/i.test(msg)) {
        renderPasswordPrompt();
      } else {
        contentContainer.textContent = "";
        statusEl.textContent = "Accesso alla condivisione non riuscito.";
        const errBanner = el(
          "div",
          "alert-banner alert-error",
          /404/.test(msg) ? "Link di condivisione non valido, scaduto o revocato (404)." : msg
        );
        errBanner.id = "share-error-banner";
        contentContainer.appendChild(errBanner);
      }
    });
  }
  if (typeof window !== "undefined" && typeof document !== "undefined") {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", () => initZkWebApp());
    } else {
      initZkWebApp();
    }
  }
})();
/*! Bundled license information:

jszip/dist/jszip.min.js:
  (*!
  
  JSZip v3.10.2 - A JavaScript class for generating and reading zip files
  <http://stuartk.com/jszip>
  
  (c) 2009-2016 Stuart Knightley <stuart [at] stuartk.com>
  Dual licenced under the MIT license or GPLv3. See https://raw.github.com/Stuk/jszip/main/LICENSE.markdown.
  
  JSZip uses the library pako released under the MIT license :
  https://github.com/nodeca/pako/blob/main/LICENSE
  *)

hash-wasm/dist/index.esm.js:
  (*!
   * hash-wasm (https://www.npmjs.com/package/hash-wasm)
   * (c) Dani Biro
   * @license MIT
   *)
*/
