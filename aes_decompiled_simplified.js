/*
* class name:L_GLOBAL;
* Source code recreated from a .abc file.
* powered by xpanda decompiler, author: jmp0
*/
let v0, v1, acc;
globalThis["plainText"] = undefined;
globalThis["cipherText"] = undefined;
globalThis["bSide"] = undefined;
globalThis["aSide"] = undefined;
globalThis["AES"] = undefined;
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
v0["sbox"] = [99, 124, 119, 123, 242, 107, 111, 197, 48, 1, 103, 43, 254, 215, 171, 118, 202, 130, 201, 125, 250, 89, 71, 240, 173, 212, 162, 175, 156, 164, 114, 192, 183, 253, 147, 38, 54, 63, 247, 204, 52, 165, 229, 241, 113, 216, 49, 21, 4, 199, 35, 195, 24, 150, 5, 154, 7, 18, 128, 226, 235, 39, 178, 117, 9, 131, 44, 26, 27, 110, 90, 160, 82, 59, 214, 179, 41, 227, 47, 132, 83, 209, 0, 237, 32, 252, 177, 91, 106, 203, 190, 57, 74, 76, 88, 207, 208, 239, 170, 251, 67, 77, 51, 133, 69, 249, 2, 127, 80, 60, 159, 168, 81, 163, 64, 143, 146, 157, 56, 245, 188, 182, 218, 33, 16, 255, 243, 210, 205, 12, 19, 236, 95, 151, 68, 23, 196, 167, 126, 61, 100, 93, 25, 115, 96, 129, 79, 220, 34, 42, 144, 136, 70, 238, 184, 20, 222, 94, 11, 219, 224, 50, 58, 10, 73, 6, 36, 92, 194, 211, 172, 98, 145, 149, 228, 121, 231, 200, 55, 109, 141, 213, 78, 169, 108, 86, 244, 234, 101, 122, 174, 8, 186, 120, 37, 46, 28, 166, 180, 198, 232, 221, 116, 31, 75, 189, 139, 138, 112, 62, 181, 102, 72, 3, 246, 14, 97, 53, 87, 185, 134, 193, 29, 158, 225, 248, 152, 17, 105, 217, 142, 148, 155, 30, 135, 233, 206, 85, 40, 223, 140, 161, 137, 13, 191, 230, 66, 104, 65, 153, 45, 15, 176, 84, 187, 22];
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
v0["rcon"] = v1;
v0["cipher"] = function cipher(p0, p1) {
  let v0, v1, v3, v4, v5, v6, v7, v10, v14, acc;
  v0 = 0;
  v1 = 1;
  acc = undefined;
  v3 = p1["length"] / 4 - v1;
  v4 = [];
  v4[0] = new Array(4);
  v4[1] = new Array(4);
  v4[2] = new Array(4);
  v4[3] = new Array(4);
  acc = new Array(4 * 4);
  v5 = acc;
  v6 = v0;
  while (true) {
    if (v6 >= p0["length"]) break;
    v7 = v4[v6 % 4];
    v10 = v6 / 4;
    v7[Math["floor"](v10)] = p0[v6];
    acc = ++v6;
    v6 = acc;
  }
  v14 = v0;
  acc = this["addRoundKey"](v4, p1, v14, 4);
  while (true) {
    if (v1 >= v3) break;
    acc = this["subBytes"](v4, 4);
    acc = this["shiftRows"](v4, 4);
    acc = this["mixColumns"](v4, 4);
    v14 = v1;
    acc = this["addRoundKey"](v4, p1, v14, 4);
    acc = ++v1;
    v1 = acc;
  }
  acc = this["subBytes"](v4, 4);
  acc = this["shiftRows"](v4, 4);
  v14 = v1;
  acc = this["addRoundKey"](v4, p1, v14, 4);
  while (true) {
    if (v0 >= v5["length"]) break;
    v1 = v4[v0 % 4];
    v7 = v0 / 4;
    v5[v0] = v1[Math["floor"](v7)];
    acc = ++v0;
    v0 = acc;
  }
  return v5;
};
v0["subBytes"] = function subBytes(p0, p1) {
  let v2, v3, v4, v6, acc;
  acc = undefined;
  v2 = 0;
  while (true) {
    if (v2 >= p1) break;
    v3 = 0;
    while (true) {
      if (v3 >= 4) break;
      v4 = p0[v3];
      v6 = p0[v3];
      v4[v2] = this["sbox"][v6[v2]];
      acc = ++v3;
      v3 = acc;
    }
    acc = ++v2;
    v2 = acc;
  }
  acc = undefined;
  return;
};
v0["shiftRows"] = function shiftRows(p0, p1) {
  let v2, v3, v4, v6, acc;
  v2 = 1;
  acc = undefined;
  acc = new Array(p1);
  v3 = acc;
  while (true) {
    if (v2 >= 4) break;
    v4 = 0;
    while (true) {
      if (v4 >= p1) break;
      v6 = v4 + v2;
      v3[v4] = p0[v2][v6 % p1];
      acc = ++v4;
      v4 = acc;
    }
    v4 = 0;
    while (true) {
      if (v4 >= 4) break;
      p0[v2][v4] = v3[v4];
      acc = ++v4;
      v4 = acc;
    }
    acc = ++v2;
    v2 = acc;
  }
  acc = undefined;
  return;
};
v0["mixColumns"] = function mixColumns(p0, p1) {
  let v7, v8, v9, v10, v11, acc;
  acc = undefined;
  v7 = 0;
  while (true) {
    if (v7 >= p1) break;
    v8 = new Array(4);
    acc = new Array(4);
    v9 = acc;
    v10 = 0;
    while (true) {
      if (v10 >= 4) break;
      v8[v10] = p0[v10][v7];
      v11 = p0[v10][v7];
      if (v11 & 128) {
        acc = p0[v10][v7] << 1 ^ 283;
      } else {
        acc = p0[v10][v7] << 1;
      }
      v9[v10] = acc;
      acc = ++v10;
      v10 = acc;
    }
    p0[0][v7] = v9[0] ^ v8[3] ^ v8[2] ^ v9[1] ^ v8[1];
    p0[1][v7] = v9[1] ^ v8[0] ^ v8[3] ^ v9[2] ^ v8[2];
    p0[2][v7] = v9[2] ^ v8[1] ^ v8[0] ^ v9[3] ^ v8[3];
    v11 = v9[3] ^ v8[2] ^ v8[1];
    acc = v11 ^ v9[0];
    v9 = acc;
    p0[3][v7] = v9 ^ v8[0];
    acc = ++v7;
    v7 = acc;
  }
  acc = undefined;
  return;
};
v0["addRoundKey"] = function addRoundKey(p0, p1, p2, p3) {
  let v2, v3, v4, acc;
  acc = undefined;
  v2 = 0;
  while (true) {
    if (v2 >= p3) break;
    v3 = 0;
    while (true) {
      if (v3 >= 4) break;
      v4 = p0[v3];
      v4[v2] = v4[v2] ^ p1[p2 * 4 + v2][v3];
      acc = ++v3;
      v3 = acc;
    }
    acc = ++v2;
    v2 = acc;
  }
  acc = undefined;
  return;
};
v0["keyExpansion"] = function keyExpansion(p0) {
  let v0, v1, v7, v8, v9, v10, v11, acc;
  v0 = 3;
  v1 = 2;
  acc = undefined;
  v7 = new Array(4 * (p0["length"] / 4 + 6 + 1));
  acc = new Array(4);
  v8 = acc;
  v9 = 0;
  while (true) {
    if (v9 >= p0["length"] / 4) break;
    v10 = [];
    v10[0] = p0[4 * v9];
    v10[1] = p0[4 * v9 + 1];
    v10[2] = p0[4 * v9 + v1];
    v11 = 4 * v9;
    v10[3] = p0[v11 + v0];
    v7[v9] = v10;
    acc = ++v9;
    v9 = acc;
  }
  v0 = p0["length"] / 4;
  while (true) {
    if (v0 >= v7["length"]) break;
    acc = new Array(4);
    v7[v0] = acc;
    v1 = 0;
    while (true) {
      if (v1 >= 4) break;
      v8[v1] = v7[v0 - 1][v1];
      acc = ++v1;
      v1 = acc;
    }
    v1 = v0 % (p0["length"] / 4);
    if (v1 === 0) {
      acc = this["rotWord"](v8);
      acc = this["subWord"](v8);
      v1 = 0;
      while (true) {
        if (v1 >= 4) break;
        v9 = v8[v1];
        v8[v1] = v9 ^ globalThis["AES"]["rcon"][v0 / (p0["length"] / 4)][v1];
        acc = ++v1;
        v1 = acc;
      }
    } else {
      if (!!(p0["length"] / 4 > 6) && !!(v0 % (p0["length"] / 4) === 4)) {
        acc = this["subWord"](v8);
      }
    }
    v1 = 0;
    while (true) {
      if (v1 >= 4) break;
      v10 = v7[v0 - p0["length"] / 4][v1];
      v7[v0][v1] = v10 ^ v8[v1];
      acc = ++v1;
      v1 = acc;
    }
    acc = ++v0;
    v0 = acc;
  }
  return v7;
};
v0["rotWord"] = function rotWord(p0) {
  let v2, v3, acc;
  v2 = 0;
  acc = undefined;
  acc = p0[v2];
  v3 = acc;
  while (true) {
    if (v2 >= 3) break;
    p0[v2] = p0[v2 + 1];
    acc = ++v2;
    v2 = acc;
  }
  p0[3] = v3;
  acc = undefined;
  return;
};
v0["subWord"] = function subWord(p0) {
  let v1, v2, acc;
  v1 = 0;
  acc = undefined;
  while (true) {
    if (v1 >= 4) break;
    p0[v1] = this["sbox"][p0[v1]];
    acc = ++v1;
    v1 = acc;
  }
  acc = undefined;
  return;
};
v0["generateKey"] = function generateKey() {
  let v1, v3, acc;
  v1 = 0;
  acc = undefined;
  acc = new Array(16);
  v3 = acc;
  while (true) {
    if (v1 >= 16) break;
    v3[v1] = Math["floor"](Math["random"]() * 256);
    acc = ++v1;
    v1 = acc;
  }
  return v3;
};
globalThis["AES"] = v0;
v1 = {
  "encode": false,
  "characters": "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=",
  "decode": false
};
v1["encode"] = function encode(p0) {
  let v7, v8, v9, v10, v11, v12, v13, v14, acc;
  v7 = 0;
  acc = undefined;
  acc = "";
  v8 = acc;
  while (true) {
    if (v7 >= p0["length"]) break;
    acc = v7;
    v7 = acc;
    v10 = ++acc;
    v9 = p0["charCodeAt"](v7);
    acc = v10;
    v10 = acc;
    v11 = ++acc;
    acc = p0["charCodeAt"](v10);
    v10 = acc;
    acc = v11;
    v11 = acc;
    v7 = ++acc;
    acc = p0["charCodeAt"](v11);
    v11 = acc;
    v12 = v9 >> 2;
    acc = v9 & 3;
    v9 = acc;
    acc = v9 << 4;
    v9 = acc;
    acc = v9 | v10 >> 4;
    v9 = acc;
    v13 = (v10 & 15) << 2 | v11 >> 6;
    v14 = v11 & 63;
    if (!isNaN(v10)) {
      if (isNaN(v11)) {
        v10 = v13;
        v11 = 64;
      } else {
        v10 = v13;
        v11 = v14;
      }
    } else {
      v10 = 64;
      v11 = 64;
    }
    acc = v8 + this["characters"]["charAt"](v12);
    v8 = acc;
    acc = v8 + this["characters"]["charAt"](v9);
    v8 = acc;
    acc = v8 + this["characters"]["charAt"](v10);
    v8 = acc;
    acc = v8 + this["characters"]["charAt"](v11);
    v8 = acc;
  }
  return v8;
};
v1["decode"] = function decode(p0) {
  let v6, v7, v8, v9, v10, v11, v12, v13, v14, v18, acc;
  v6 = 0;
  acc = undefined;
  v7 = "";
  v11 = "g";
  v18 = v11;
  v9 = new RegExp("[^A-Za-z0-9\\+\\/\\=]", v18);
  v10 = "";
  acc = p0["replace"](v9, v10);
  v8 = acc;
  while (true) {
    if (v6 >= v8["length"]) break;
    acc = v6;
    v6 = acc;
    v12 = ++acc;
    v9 = this["characters"]["indexOf"](v8["charAt"](v6));
    acc = v12;
    v12 = acc;
    v13 = ++acc;
    v10 = this["characters"]["indexOf"](v8["charAt"](v12));
    acc = v13;
    v13 = acc;
    v14 = ++acc;
    v11 = this["characters"]["indexOf"](v8["charAt"](v13));
    acc = v14;
    v14 = acc;
    v6 = ++acc;
    acc = v8["charAt"](v14);
    v14 = acc;
    v12 = this["characters"]["indexOf"](v14);
    acc = v9 << 2;
    v9 = acc;
    acc = v9 | v10 >> 4;
    v9 = acc;
    acc = v10 & 15;
    v10 = acc;
    acc = v10 << 4;
    v10 = acc;
    acc = v10 | v11 >> 2;
    v10 = acc;
    acc = v7 + String["fromCharCode"](v9);
    v7 = acc;
    if (v11 !== 64) {
      acc = v7 + String["fromCharCode"](v10);
      v7 = acc;
    }
    if (v12 !== 64) {
      acc = v7 + String["fromCharCode"]((v11 & 3) << 6 | v12);
      v7 = acc;
    }
  }
  return v7;
};
globalThis["AES"]["Base64"] = v1;
globalThis["AES"]["Counter"] = function () {
  let v1, v7, v8, acc;
  v1 = 8;
  let local0;
  local0 = undefined;
  acc = undefined;
  this["arr"] = new Array(16);
  acc = 0;
  local0 = acc;
  while (true) {
    if (local0 >= 4) break;
    v7 = local0;
    v8 = 1715592630 >>> local0 * v1;
    this["arr"][v7] = v8 & 255;
    acc = ++local0;
    local0 = acc;
  }
  this["arr"][4] = 123;
  this["arr"][5] = 223;
  this["arr"][6] = 13;
  this["arr"][7] = 23;
  acc = v1;
  local0 = acc;
  while (true) {
    if (local0 >= 16) break;
    v1 = local0;
    this["arr"][v1] = 0;
    acc = ++local0;
    local0 = acc;
  }
  this["increment"] = function () {
    let v0, v1, v3, v4, acc;
    v0 = 0;
    v1 = 255;
    acc = 15;
    local0 = acc;
    while (true) {
      if (local0 < 8) break;
      if (this["arr"][local0] !== v1) {
        this["arr"][local0] = ++this["arr"][local0];
        break;
      }
      v4 = local0;
      this["arr"][v4] = v0;
      acc = --local0;
      local0 = acc;
    }
    return this;
  };
  acc = console["log"]();
  acc = undefined;
  return;
};
globalThis["AES"]["Crypto"] = function (p0) {
  let local0;
  local0 = undefined;
  this["key"] = p0;
  this["keySchedule"] = globalThis["AES"]["keyExpansion"](p0);
  this["counter"] = new globalThis["AES"]["Counter"]();
  this["setCounter"] = function (p0) {
    let v1, v2, acc;
    acc = 0;
    local0 = acc;
    while (true) {
      if (local0 >= 16) break;
      v2 = local0;
      this["counter"]["arr"][v2] = p0[local0];
      acc = ++local0;
      local0 = acc;
    }
    return this;
  };
  this["getCounter"] = function () {
    return this["counter"]["arr"];
  };
  this["run"] = function (p0) {
    let v2, v3, v4, v5, v6, v7, v8, v9, v12, v14, acc;
    acc = undefined;
    v2 = Math["ceil"](p0["length"] / 16);
    acc = new Array(p0["length"]);
    v3 = acc;
    v4 = 0;
    while (true) {
      if (v4 >= v2) break;
      v5 = globalThis["AES"]["cipher"](this["counter"]["arr"], this["keySchedule"]);
      v6 = v4 + 1;
      if (v6 === v2) {
        v6 = p0["length"] % 16;
      } else {
        v6 = 16;
      }
      acc = v4 * 16;
      v7 = acc;
      v8 = 0;
      while (true) {
        if (v8 >= v6) break;
        v9 = v7 + v8;
        v14 = v7 + v8;
        v12 = v5[v8] ^ p0["charCodeAt"](v14);
        v3[v9] = String["fromCharCode"](v12);
        acc = ++v8;
        v8 = acc;
      }
      acc = this["counter"]["increment"]();
      acc = ++v4;
      v4 = acc;
    }
    return v3["join"]("");
  };
  this["encrypt"] = function (p0) {
    return globalThis["AES"]["Base64"]["encode"](this["run"](p0));
  };
  this["decrypt"] = function (p0) {
    return this["run"](globalThis["AES"]["Base64"]["decode"](p0));
  };
  return;
};
globalThis["aSide"] = new globalThis["AES"]["Crypto"]([190, 100, 76, 127, 43, 253, 149, 65, 72, 90, 40, 65, 6, 211, 77, 37]);
globalThis["bSide"] = new globalThis["AES"]["Crypto"](globalThis["aSide"]["key"]);
acc = globalThis["bSide"]["setCounter"](globalThis["aSide"]["getCounter"]());
globalThis["cipherText"] = globalThis["aSide"]["encrypt"]("the quick brown fox jumped over the lazy dog");
globalThis["plainText"] = globalThis["bSide"]["decrypt"](globalThis["cipherText"]);
acc = console["log"](globalThis["plainText"] === "the quick brown fox jumped over the lazy dog");
acc = undefined;