/*
* class name:L_GLOBAL;
* Source code created from a .abc file.
* powered by xpanda decompiler, author: jmp0
*/
(function () {
    let local0, local1, local2, local3, local4, local5, local6, local7, local8, local9, local10, local11;
    local4 = function add32(p0, p1) {
      return p0 + p1 & 4294967295;
    };
    local9 = function rhex(p0) {
      let v3, v4;
      v3 = 0;
      for (v4 = ""; v3 < 4; ++v3) {
        v4 = v4 + (local8[p0 >> v3 * 8 + 4 & 15] + local8[p0 >> v3 * 8 & 15]);
      }
      return v4;
    };
    local1 = function gg(p0, p1, p2, p3, p4, p5, p6) {
      return local5(p1 & p3 | p2 & ~p3, p0, p1, p4, p5, p6);
    };
    local7 = function md5blk(p0) {
      let v8, v9;
      v8 = 0;
      for (v9 = []; v8 < 64; v8 = v8 + 4) {
        v9[v8 >> 2] = p0.charCodeAt(v8) + (p0.charCodeAt(v8 + 1) << 8) + (p0.charCodeAt(v8 + 2) << 16) + (p0.charCodeAt(v8 + 3) << 24);
      }
      return v9;
    };
    local8 = undefined;
    local11 = function md51(p0) {
      let v0, v2, v3, v4, v6, v8, acc;
      acc = undefined;
      acc = new RegExp("[\\x80-\\xFF]");
      if (acc.test(p0)) {
        p0 = unescape(encodeURI(p0));
      }
      v0 = 64;
      globalThis.txt = "";
      v2 = [1732584193];
      v2[1] = -271733879;
      v2[2] = -1732584194;
      v2[3] = 271733878;
      for (v3 = v0; v3 <= p0.length; v3 = v3 + v0) {
        acc = local6(v2, local7(p0.substring(v3 - v0, v3)));
      }
      v4 = 3;
      v6 = 2;
      v0 = p0.substring(v3 - v0);
      v3 = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
      for (v8 = 0; v8 < v0.length; ++v8) {
        v3[v8 >> v6] = v3[v8 >> v6] | v0.charCodeAt(v8) << (v8 % 4 << v4);
      }
      acc = v8 >> v6;
      v0 = acc;
      v6 = v3[acc];
      v4 = v8 % 4 << v4;
      v3[v0] = v6 | 128 << v4;
      if (v8 > 55) {
        acc = local6(v2, v3);
        for (v4 = 0; v4 < 16; ++v4) {
          v3[v4] = 0;
        }
      }
      v3[14] = p0.length * 8;
      acc = local6(v2, v3);
      return v2;
    };
    local0 = function ff(p0, p1, p2, p3, p4, p5, p6) {
      return local5(p1 & p2 | ~p1 & p3, p0, p1, p4, p5, p6);
    };
    local10 = function hex(p0) {
      let v0;
      for (v0 = 0; v0 < p0.length; ++v0) {
        p0[v0] = local9(p0[v0]);
      }
      return p0.join("");
    };
    local3 = function ii(p0, p1, p2, p3, p4, p5, p6) {
      return local5(p2 ^ (p1 | ~p3), p0, p1, p4, p5, p6);
    };
    local2 = function hh(p0, p1, p2, p3, p4, p5, p6) {
      return local5(p1 ^ p2 ^ p3, p0, p1, p4, p5, p6);
    };
    local6 = function md5cycle(p0, p1) {
      let v1, v3, v5, v7;
      v1 = local0(p0[0], p0[1], p0[2], p0[3], p1[0], 7, -680876936);
      v7 = local0(p0[3], v1, p0[1], p0[2], p1[1], 12, -389564586);
      v5 = local0(p0[2], v7, v1, p0[1], p1[2], 17, 606105819);
      v3 = local0(p0[1], v5, v7, v1, p1[3], 22, -1044525330);
      v1 = local0(v1, v3, v5, v7, p1[4], 7, -176418897);
      v7 = local0(v7, v1, v3, v5, p1[5], 12, 1200080426);
      v5 = local0(v5, v7, v1, v3, p1[6], 17, -1473231341);
      v3 = local0(v3, v5, v7, v1, p1[7], 22, -45705983);
      v1 = local0(v1, v3, v5, v7, p1[8], 7, 1770035416);
      v7 = local0(v7, v1, v3, v5, p1[9], 12, -1958414417);
      v5 = local0(v5, v7, v1, v3, p1[10], 17, -42063);
      v3 = local0(v3, v5, v7, v1, p1[11], 22, -1990404162);
      v1 = local0(v1, v3, v5, v7, p1[12], 7, 1804603682);
      v7 = local0(v7, v1, v3, v5, p1[13], 12, -40341101);
      v5 = local0(v5, v7, v1, v3, p1[14], 17, -1502002290);
      v3 = local0(v3, v5, v7, v1, p1[15], 22, 1236535329);
      v1 = local1(v1, v3, v5, v7, p1[1], 5, -165796510);
      v7 = local1(v7, v1, v3, v5, p1[6], 9, -1069501632);
      v5 = local1(v5, v7, v1, v3, p1[11], 14, 643717713);
      v3 = local1(v3, v5, v7, v1, p1[0], 20, -373897302);
      v1 = local1(v1, v3, v5, v7, p1[5], 5, -701558691);
      v7 = local1(v7, v1, v3, v5, p1[10], 9, 38016083);
      v5 = local1(v5, v7, v1, v3, p1[15], 14, -660478335);
      v3 = local1(v3, v5, v7, v1, p1[4], 20, -405537848);
      v1 = local1(v1, v3, v5, v7, p1[9], 5, 568446438);
      v7 = local1(v7, v1, v3, v5, p1[14], 9, -1019803690);
      v5 = local1(v5, v7, v1, v3, p1[3], 14, -187363961);
      v3 = local1(v3, v5, v7, v1, p1[8], 20, 1163531501);
      v1 = local1(v1, v3, v5, v7, p1[13], 5, -1444681467);
      v7 = local1(v7, v1, v3, v5, p1[2], 9, -51403784);
      v5 = local1(v5, v7, v1, v3, p1[7], 14, 1735328473);
      v3 = local1(v3, v5, v7, v1, p1[12], 20, -1926607734);
      v1 = local2(v1, v3, v5, v7, p1[5], 4, -378558);
      v7 = local2(v7, v1, v3, v5, p1[8], 11, -2022574463);
      v5 = local2(v5, v7, v1, v3, p1[11], 16, 1839030562);
      v3 = local2(v3, v5, v7, v1, p1[14], 23, -35309556);
      v1 = local2(v1, v3, v5, v7, p1[1], 4, -1530992060);
      v7 = local2(v7, v1, v3, v5, p1[4], 11, 1272893353);
      v5 = local2(v5, v7, v1, v3, p1[7], 16, -155497632);
      v3 = local2(v3, v5, v7, v1, p1[10], 23, -1094730640);
      v1 = local2(v1, v3, v5, v7, p1[13], 4, 681279174);
      v7 = local2(v7, v1, v3, v5, p1[0], 11, -358537222);
      v5 = local2(v5, v7, v1, v3, p1[3], 16, -722521979);
      v3 = local2(v3, v5, v7, v1, p1[6], 23, 76029189);
      v1 = local2(v1, v3, v5, v7, p1[9], 4, -640364487);
      v7 = local2(v7, v1, v3, v5, p1[12], 11, -421815835);
      v5 = local2(v5, v7, v1, v3, p1[15], 16, 530742520);
      v3 = local2(v3, v5, v7, v1, p1[2], 23, -995338651);
      v1 = local3(v1, v3, v5, v7, p1[0], 6, -198630844);
      v7 = local3(v7, v1, v3, v5, p1[7], 10, 1126891415);
      v5 = local3(v5, v7, v1, v3, p1[14], 15, -1416354905);
      v3 = local3(v3, v5, v7, v1, p1[5], 21, -57434055);
      v1 = local3(v1, v3, v5, v7, p1[12], 6, 1700485571);
      v7 = local3(v7, v1, v3, v5, p1[3], 10, -1894986606);
      v5 = local3(v5, v7, v1, v3, p1[10], 15, -1051523);
      v3 = local3(v3, v5, v7, v1, p1[1], 21, -2054922799);
      v1 = local3(v1, v3, v5, v7, p1[8], 6, 1873313359);
      v7 = local3(v7, v1, v3, v5, p1[15], 10, -30611744);
      v5 = local3(v5, v7, v1, v3, p1[6], 15, -1560198380);
      v3 = local3(v3, v5, v7, v1, p1[13], 21, 1309151649);
      v1 = local3(v1, v3, v5, v7, p1[4], 6, -145523070);
      v7 = local3(v7, v1, v3, v5, p1[11], 10, -1120210379);
      v5 = local3(v5, v7, v1, v3, p1[2], 15, 718787259);
      p0[0] = local4(v1, p0[0]);
      p0[1] = local4(local3(v3, v5, v7, v1, p1[9], 21, -343485551), p0[1]);
      p0[2] = local4(v5, p0[2]);
      p0[3] = local4(v7, p0[3]);
    };
    local5 = function cmn(p0, p1, p2, p3, p4, p5) {
      let v0;
      v0 = local4(local4(p1, p0), local4(p3, p5));
      v0 = v0 << p4 | v0 >>> 32 - p4;
      return local4(v0, p2);
    };
    local8 = "0123456789abcdef".split("");
    globalThis.md5 = function md5(p0) {
      return local10(local11(p0));
    };
    console.log("md5 of admin is ", md5("admin"));
  })();