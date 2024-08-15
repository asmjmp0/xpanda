/*
* class name:L_GLOBAL;
* Source code created from a .abc file.
* powered by xpanda decompiler, author: jmp0
*/
let v0, v1;
globalThis.plainText = undefined;
globalThis.cipherText = undefined;
globalThis.bSide = undefined;
globalThis.aSide = undefined;
globalThis.AES = undefined;
v0 = {
  "cipher": false,
  "generateKey": false,
  "keyExpansion": false,
  "rcon": false,
  "shiftRows": false,
  "mixColumns": false,
  "VERSION": "1.2",
  "addRoundKey": false,
  "subWord": false,
  "sbox": false,
  "rotWord": false,
  "subBytes": false
};
v0.sbox = [99, 124, 119, 123, 242, 107, 111, 197, 48, 1, 103, 43, 254, 215, 171, 118, 202, 130, 201, 125, 250, 89, 71, 240, 173, 212, 162, 175, 156, 164, 114, 192, 183, 253, 147, 38, 54, 63, 247, 204, 52, 165, 229, 241, 113, 216, 49, 21, 4, 199, 35, 195, 24, 150, 5, 154, 7, 18, 128, 226, 235, 39, 178, 117, 9, 131, 44, 26, 27, 110, 90, 160, 82, 59, 214, 179, 41, 227, 47, 132, 83, 209, 0, 237, 32, 252, 177, 91, 106, 203, 190, 57, 74, 76, 88, 207, 208, 239, 170, 251, 67, 77, 51, 133, 69, 249, 2, 127, 80, 60, 159, 168, 81, 163, 64, 143, 146, 157, 56, 245, 188, 182, 218, 33, 16, 255, 243, 210, 205, 12, 19, 236, 95, 151, 68, 23, 196, 167, 126, 61, 100, 93, 25, 115, 96, 129, 79, 220, 34, 42, 144, 136, 70, 238, 184, 20, 222, 94, 11, 219, 224, 50, 58, 10, 73, 6, 36, 92, 194, 211, 172, 98, 145, 149, 228, 121, 231, 200, 55, 109, 141, 213, 78, 169, 108, 86, 244, 234, 101, 122, 174, 8, 186, 120, 37, 46, 28, 166, 180, 198, 232, 221, 116, 31, 75, 189, 139, 138, 112, 62, 181, 102, 72, 3, 246, 14, 97, 53, 87, 185, 134, 193, 29, 158, 225, 248, 152, 17, 105, 217, 142, 148, 155, 30, 135, 233, 206, 85, 40, 223, 140, 161, 137, 13, 191, 230, 66, 104, 65, 153, 45, 15, 176, 84, 187, 22];
v1 = [];
v1[0] = [0, 0, 0, 0];
v1[1] = [1, 0, 0, 0];
v1[2] = [2, 0, 0, 0];
v1[3] = [4, 0, 0, 0];
v1[4] = [8, 0, 0, 0];
v1[5] = [16, 0, 0, 0];
v1[6] = [32, 0, 0, 0];
v1[7] = [64, 0, 0, 0];
v1[8] = [128, 0, 0, 0];
v1[9] = [27, 0, 0, 0];
v1[10] = [54, 0, 0, 0];
v0.rcon = v1;
v0.cipher = function cipher(p0, p1) {
  let v0, v1, v3, v4, v5, v6;
  v0 = 0;
  v1 = 1;
  v3 = p1.length / 4 - v1;
  v4 = [];
  v4[0] = new Array(4);
  v4[1] = new Array(4);
  v4[2] = new Array(4);
  v4[3] = new Array(4);
  v5 = new Array(4 * 4);
  for (v6 = v0; v6 < p0.length; ++v6) {
    v4[v6 % 4][Math.floor(v6 / 4)] = p0[v6];
  }
  for (this.addRoundKey(v4, p1, v0, 4); v1 < v3; ++v1) {
    this.subBytes(v4, 4);
    this.shiftRows(v4, 4);
    this.mixColumns(v4, 4);
    this.addRoundKey(v4, p1, v1, 4);
  }
  this.subBytes(v4, 4);
  this.shiftRows(v4, 4);
  for (this.addRoundKey(v4, p1, v1, 4); v0 < v5.length; ++v0) {
    v5[v0] = v4[v0 % 4][Math.floor(v0 / 4)];
  }
  return v5;
};
v0.subBytes = function subBytes(p0, p1) {
  let v2, v3;
  for (v2 = 0; v2 < p1; ++v2) {
    for (v3 = 0; v3 < 4; ++v3) {
      p0[v3][v2] = this.sbox[p0[v3][v2]];
    }
  }
};
v0.shiftRows = function shiftRows(p0, p1) {
  let v2, v3, v4;
  v2 = 1;
  for (v3 = new Array(p1); v2 < 4; ++v2) {
    for (v4 = 0; v4 < p1; ++v4) {
      v3[v4] = p0[v2][(v4 + v2) % p1];
    }
    for (v4 = 0; v4 < 4; ++v4) {
      p0[v2][v4] = v3[v4];
    }
  }
};
v0.mixColumns = function mixColumns(p0, p1) {
  let v7, v8, v9, v10;
  for (v7 = 0; v7 < p1; ++v7) {
    v8 = new Array(4);
    v9 = new Array(4);
    for (v10 = 0; v10 < 4; ++v10) {
      v8[v10] = p0[v10][v7];
      v9[v10] = p0[v10][v7] & 128 ? p0[v10][v7] << 1 ^ 283 : p0[v10][v7] << 1;
    }
    p0[0][v7] = v9[0] ^ v8[3] ^ v8[2] ^ v9[1] ^ v8[1];
    p0[1][v7] = v9[1] ^ v8[0] ^ v8[3] ^ v9[2] ^ v8[2];
    p0[2][v7] = v9[2] ^ v8[1] ^ v8[0] ^ v9[3] ^ v8[3];
    p0[3][v7] = v9[3] ^ v8[2] ^ v8[1] ^ v9[0] ^ v8[0];
  }
};
v0.addRoundKey = function addRoundKey(p0, p1, p2, p3) {
  let v2, v3;
  for (v2 = 0; v2 < p3; ++v2) {
    for (v3 = 0; v3 < 4; ++v3) {
      p0[v3][v2] = p0[v3][v2] ^ p1[p2 * 4 + v2][v3];
    }
  }
};
v0.keyExpansion = function keyExpansion(p0) {
  let v0, v1, v6, v7, v8, v9, v10, acc;
  v0 = 3;
  v1 = 2;
  v6 = p0.length / 4;
  v7 = new Array(4 * (v6 + 6 + 1));
  v8 = new Array(4);
  for (v9 = 0; v9 < v6; ++v9) {
    v10 = [];
    v10[0] = p0[4 * v9];
    v10[1] = p0[4 * v9 + 1];
    v10[2] = p0[4 * v9 + v1];
    v10[3] = p0[4 * v9 + v0];
    v7[v9] = v10;
  }
  for (v0 = v6; v0 < v7.length; ++v0) {
    v7[v0] = new Array(4);
    for (v1 = 0; v1 < 4; ++v1) {
      v8[v1] = v7[v0 - 1][v1];
    }
    v1 = v0 % v6;
    if (v1 === 0) {
      this.rotWord(v8);
      this.subWord(v8);
      for (v1 = 0; v1 < 4; ++v1) {
        v8[v1] = v8[v1] ^ globalThis.AES.rcon[v0 / v6][v1];
      }
    } else if (v6 > 6 && v0 % v6 === 4) {
      this.subWord(v8);
    }
    for (v1 = 0; v1 < 4; ++v1) {
      v7[v0][v1] = v7[v0 - v6][v1] ^ v8[v1];
    }
  }
  return v7;
};
v0.rotWord = function rotWord(p0) {
  let v2, v3;
  v2 = 0;
  for (v3 = p0[v2]; v2 < 3; ++v2) {
    p0[v2] = p0[v2 + 1];
  }
  p0[3] = v3;
};
v0.subWord = function subWord(p0) {
  let v1;
  for (v1 = 0; v1 < 4; ++v1) {
    p0[v1] = this.sbox[p0[v1]];
  }
};
v0.generateKey = function generateKey() {
  let v1, v3;
  v1 = 0;
  for (v3 = new Array(16); v1 < 16; ++v1) {
    v3[v1] = Math.floor(Math.random() * 256);
  }
  return v3;
};
globalThis.AES = v0;
v1 = {
  "encode": false,
  "characters": "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=",
  "decode": false
};
v1.encode = function encode(p0) {
  let v7, v8, v9, v10, v11, v12, v13, v14, acc;
  v7 = 0;
  acc = undefined;
  acc = "";
  for (v8 = acc; v7 < p0.length; v8 = v8 + this.characters.charAt(v12) + this.characters.charAt(v9) + this.characters.charAt(v10) + this.characters.charAt(v11)) {
    acc = v7;
    v7 = acc;
    v10 = ++acc;
    v9 = p0.charCodeAt(v7);
    acc = v10;
    v10 = acc;
    v11 = ++acc;
    v10 = p0.charCodeAt(v10);
    acc = v11;
    v11 = acc;
    v7 = ++acc;
    v11 = p0.charCodeAt(v11);
    v12 = v9 >> 2;
    v9 = (v9 & 3) << 4 | v10 >> 4;
    v13 = (v10 & 15) << 2 | v11 >> 6;
    v14 = v11 & 63;
    if (isNaN(v10)) {
      v10 = 64;
      v11 = 64;
    } else if (isNaN(v11)) {
      v10 = v13;
      v11 = 64;
    } else {
      v10 = v13;
      v11 = v14;
    }
  }
  return v8;
};
v1.decode = function decode(p0) {
  let v6, v7, v8, v9, v10, v11, v12, v13, v14, acc;
  v6 = 0;
  acc = undefined;
  v7 = "";
  v11 = "g";
  v9 = new RegExp("[^A-Za-z0-9\\+\\/\\=]", v11);
  v10 = "";
  acc = p0.replace(v9, v10);
  v8 = acc;
  while (true) {
    if (v6 >= v8.length) break;
    acc = v6;
    v6 = acc;
    v12 = ++acc;
    v9 = this.characters.indexOf(v8.charAt(v6));
    acc = v12;
    v12 = acc;
    v13 = ++acc;
    v10 = this.characters.indexOf(v8.charAt(v12));
    acc = v13;
    v13 = acc;
    v14 = ++acc;
    v11 = this.characters.indexOf(v8.charAt(v13));
    acc = v14;
    v14 = acc;
    v6 = ++acc;
    v12 = this.characters.indexOf(v8.charAt(v14));
    v9 = v9 << 2 | v10 >> 4;
    v10 = (v10 & 15) << 4 | v11 >> 2;
    v13 = (v11 & 3) << 6 | v12;
    v7 = v7 + String.fromCharCode(v9);
    if (v11 !== 64) {
      v7 = v7 + String.fromCharCode(v10);
    }
    if (v12 !== 64) {
      v7 = v7 + String.fromCharCode(v13);
    }
  }
  return v7;
};
globalThis.AES.Base64 = v1;
globalThis.AES.Counter = function () {
  let local0;
  local0 = undefined;
  this.arr = new Array(16);
  for (local0 = 0; local0 < 4; ++local0) {
    this.arr[local0] = 1715592630 >>> local0 * 8 & 255;
  }
  this.arr[4] = 123;
  this.arr[5] = 223;
  this.arr[6] = 13;
  this.arr[7] = 23;
  for (local0 = 8; local0 < 16; ++local0) {
    this.arr[local0] = 0;
  }
  this.increment = function () {
    for (local0 = 15; local0 >= 8; --local0) {
      if (this.arr[local0] !== 255) {
        this.arr[local0] = ++this.arr[local0];
        break;
      }
      this.arr[local0] = 0;
    }
    return this;
  };
  console.log();
};
globalThis.AES.Crypto = function (p0) {
  let local0;
  local0 = undefined;
  this.key = p0;
  this.keySchedule = globalThis.AES.keyExpansion(p0);
  this.counter = new globalThis.AES.Counter();
  this.setCounter = function (p0) {
    for (local0 = 0; local0 < 16; ++local0) {
      this.counter.arr[local0] = p0[local0];
    }
    return this;
  };
  this.getCounter = function () {
    return this.counter.arr;
  };
  this.run = function (p0) {
    let v2, v3, v4, v5, v6, v7, v8, acc;
    v2 = Math.ceil(p0.length / 16);
    v3 = new Array(p0.length);
    for (v4 = 0; v4 < v2; ++v4) {
      v5 = globalThis.AES.cipher(this.counter.arr, this.keySchedule);
      v6 = v4 + 1 === v2 ? p0.length % 16 : 16;
      v7 = v4 * 16;
      for (v8 = 0; v8 < v6; ++v8) {
        v3[v7 + v8] = String.fromCharCode(v5[v8] ^ p0.charCodeAt(v7 + v8));
      }
      this.counter.increment();
    }
    return v3.join("");
  };
  this.encrypt = function (p0) {
    return globalThis.AES.Base64.encode(this.run(p0));
  };
  this.decrypt = function (p0) {
    return this.run(globalThis.AES.Base64.decode(p0));
  };
};
globalThis.aSide = new globalThis.AES.Crypto([190, 100, 76, 127, 43, 253, 149, 65, 72, 90, 40, 65, 6, 211, 77, 37]);
globalThis.bSide = new globalThis.AES.Crypto(globalThis.aSide.key);
globalThis.bSide.setCounter(globalThis.aSide.getCounter());
globalThis.cipherText = globalThis.aSide.encrypt("the quick brown fox jumped over the lazy dog");
globalThis.plainText = globalThis.bSide.decrypt(globalThis.cipherText);
console.log(globalThis.plainText === "the quick brown fox jumped over the lazy dog");