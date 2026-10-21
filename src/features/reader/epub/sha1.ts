/**
 * SHA-1 over a UTF-8 string, returning the 20 raw bytes.
 *
 * foliate-js deobfuscates IDPF-obfuscated fonts with Web Crypto
 * (`epub.js:577`), which only exists in a secure context. `EPUB.init()` awaits
 * that path unguarded, so a plain-HTTP deployment (the normal case for this
 * self-hosted app) would fail to open any book carrying
 * `META-INF/encryption.xml`. Passing this implementation as the loader's
 * `sha1` keeps those books readable; the Adobe algorithm needs no digest at
 * all.
 *
 * Inputs are EPUB identifiers (a few dozen bytes), so the 64-bit length field
 * is computed exactly but never exercised past the low word.
 */
const BLOCK_SIZE = 64;
const INITIAL = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476, 0xc3d2e1f0];

const rotl = (value: number, bits: number): number =>
  ((value << bits) | (value >>> (32 - bits))) >>> 0;

/**
 * Typed-array read for the message schedule and state words. Every call site
 * indexes a block the loop has already proven in range; this only satisfies
 * `noUncheckedIndexedAccess`.
 */
const word = (array: Uint32Array, index: number): number => array[index] ?? 0;

export function sha1Bytes(bytes: Uint8Array): Uint8Array {
  const paddedLength = Math.ceil((bytes.length + 9) / BLOCK_SIZE) * BLOCK_SIZE;
  const padded = new Uint8Array(paddedLength);
  padded.set(bytes);
  padded[bytes.length] = 0x80;

  // Message length in bits, big-endian, in the last 8 bytes.
  const bits = bytes.length * 8;
  const view = new DataView(padded.buffer);
  view.setUint32(paddedLength - 8, Math.floor(bits / 0x1_0000_0000), false);
  view.setUint32(paddedLength - 4, bits % 0x1_0000_0000, false);

  const words = new Uint32Array(80);
  const hash = Uint32Array.from(INITIAL);

  for (let block = 0; block < paddedLength; block += BLOCK_SIZE) {
    for (let index = 0; index < 16; index += 1) {
      words[index] = view.getUint32(block + index * 4, false);
    }
    for (let index = 16; index < 80; index += 1) {
      words[index] = rotl(
        word(words, index - 3) ^
          word(words, index - 8) ^
          word(words, index - 14) ^
          word(words, index - 16),
        1,
      );
    }

    let a = word(hash, 0);
    let b = word(hash, 1);
    let c = word(hash, 2);
    let d = word(hash, 3);
    let e = word(hash, 4);

    for (let index = 0; index < 80; index += 1) {
      const round = Math.floor(index / 20);
      let f: number;
      let k: number;
      if (round === 0) {
        f = (b & c) | (~b & d);
        k = 0x5a827999;
      } else if (round === 1) {
        f = b ^ c ^ d;
        k = 0x6ed9eba1;
      } else if (round === 2) {
        f = (b & c) | (b & d) | (c & d);
        k = 0x8f1bbcdc;
      } else {
        f = b ^ c ^ d;
        k = 0xca62c1d6;
      }
      const temp = (rotl(a, 5) + f + e + k + word(words, index)) >>> 0;
      e = d;
      d = c;
      c = rotl(b, 30);
      b = a;
      a = temp;
    }

    hash[0] = (word(hash, 0) + a) >>> 0;
    hash[1] = (word(hash, 1) + b) >>> 0;
    hash[2] = (word(hash, 2) + c) >>> 0;
    hash[3] = (word(hash, 3) + d) >>> 0;
    hash[4] = (word(hash, 4) + e) >>> 0;
  }

  const digest = new Uint8Array(20);
  const digestView = new DataView(digest.buffer);
  for (let index = 0; index < 5; index += 1) {
    digestView.setUint32(index * 4, word(hash, index), false);
  }
  return digest;
}
