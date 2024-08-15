/*
 * JavaScript AES implementation using Counter Mode
 *
 * Copyright (c) 2010 Robert Sosinski (http://www.robertsosinski.com)
 * Offical Web Site (http://github.com/robertsosinski/js-aes)
 *
 * Permission is hereby granted, free of charge, to any person
 * obtaining a copy of this software and associated documentation
 * files (the "Software"), to deal in the Software without
 * restriction, including without limitation the rights to use,
 * copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the
 * Software is furnished to do so, subject to the following
 * conditions:
 *
 * The above copyright notice and this permission notice shall be
 * included in all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
 * EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES
 * OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
 * NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT
 * HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
 * WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
 * FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR
 * OTHER DEALINGS IN THE SOFTWARE.
 */
var AES = {
    VERSION: "1.2",

    sbox: [0x63, 0x7c, 0x77, 0x7b, 0xf2, 0x6b, 0x6f, 0xc5, 0x30, 0x01, 0x67, 0x2b, 0xfe, 0xd7, 0xab, 0x76,
        0xca, 0x82, 0xc9, 0x7d, 0xfa, 0x59, 0x47, 0xf0, 0xad, 0xd4, 0xa2, 0xaf, 0x9c, 0xa4, 0x72, 0xc0,
        0xb7, 0xfd, 0x93, 0x26, 0x36, 0x3f, 0xf7, 0xcc, 0x34, 0xa5, 0xe5, 0xf1, 0x71, 0xd8, 0x31, 0x15,
        0x04, 0xc7, 0x23, 0xc3, 0x18, 0x96, 0x05, 0x9a, 0x07, 0x12, 0x80, 0xe2, 0xeb, 0x27, 0xb2, 0x75,
        0x09, 0x83, 0x2c, 0x1a, 0x1b, 0x6e, 0x5a, 0xa0, 0x52, 0x3b, 0xd6, 0xb3, 0x29, 0xe3, 0x2f, 0x84,
        0x53, 0xd1, 0x00, 0xed, 0x20, 0xfc, 0xb1, 0x5b, 0x6a, 0xcb, 0xbe, 0x39, 0x4a, 0x4c, 0x58, 0xcf,
        0xd0, 0xef, 0xaa, 0xfb, 0x43, 0x4d, 0x33, 0x85, 0x45, 0xf9, 0x02, 0x7f, 0x50, 0x3c, 0x9f, 0xa8,
        0x51, 0xa3, 0x40, 0x8f, 0x92, 0x9d, 0x38, 0xf5, 0xbc, 0xb6, 0xda, 0x21, 0x10, 0xff, 0xf3, 0xd2,
        0xcd, 0x0c, 0x13, 0xec, 0x5f, 0x97, 0x44, 0x17, 0xc4, 0xa7, 0x7e, 0x3d, 0x64, 0x5d, 0x19, 0x73,
        0x60, 0x81, 0x4f, 0xdc, 0x22, 0x2a, 0x90, 0x88, 0x46, 0xee, 0xb8, 0x14, 0xde, 0x5e, 0x0b, 0xdb,
        0xe0, 0x32, 0x3a, 0x0a, 0x49, 0x06, 0x24, 0x5c, 0xc2, 0xd3, 0xac, 0x62, 0x91, 0x95, 0xe4, 0x79,
        0xe7, 0xc8, 0x37, 0x6d, 0x8d, 0xd5, 0x4e, 0xa9, 0x6c, 0x56, 0xf4, 0xea, 0x65, 0x7a, 0xae, 0x08,
        0xba, 0x78, 0x25, 0x2e, 0x1c, 0xa6, 0xb4, 0xc6, 0xe8, 0xdd, 0x74, 0x1f, 0x4b, 0xbd, 0x8b, 0x8a,
        0x70, 0x3e, 0xb5, 0x66, 0x48, 0x03, 0xf6, 0x0e, 0x61, 0x35, 0x57, 0xb9, 0x86, 0xc1, 0x1d, 0x9e,
        0xe1, 0xf8, 0x98, 0x11, 0x69, 0xd9, 0x8e, 0x94, 0x9b, 0x1e, 0x87, 0xe9, 0xce, 0x55, 0x28, 0xdf,
        0x8c, 0xa1, 0x89, 0x0d, 0xbf, 0xe6, 0x42, 0x68, 0x41, 0x99, 0x2d, 0x0f, 0xb0, 0x54, 0xbb, 0x16],

    rcon: [[0x00, 0x00, 0x00, 0x00],
        [0x01, 0x00, 0x00, 0x00],
        [0x02, 0x00, 0x00, 0x00],
        [0x04, 0x00, 0x00, 0x00],
        [0x08, 0x00, 0x00, 0x00],
        [0x10, 0x00, 0x00, 0x00],
        [0x20, 0x00, 0x00, 0x00],
        [0x40, 0x00, 0x00, 0x00],
        [0x80, 0x00, 0x00, 0x00],
        [0x1b, 0x00, 0x00, 0x00],
        [0x36, 0x00, 0x00, 0x00]],

    cipher: function(input, w) {
        var nb     = 4;
        var nr     = w.length / nb - 1;
        var state  = [new Array(nb), new Array(nb), new Array(nb), new Array(nb)];
        var output = new Array(4 * nb);

        var i, round;

        for (i = 0; i < input.length; i++) {
            state[i % 4][Math.floor(i / 4)] = input[i];
        }

        this.addRoundKey(state, w, 0, nb);

        for (round = 1; round < nr; round++) {
            this.subBytes(state, nb);
            this.shiftRows(state, nb);
            this.mixColumns(state, nb);
            this.addRoundKey(state, w, round, nb);
        }

        this.subBytes(state, nb);
        this.shiftRows(state, nb);
        this.addRoundKey(state, w, round, nb);

        for (i = 0; i < output.length; i++) {
            output[i] = state[i % 4][Math.floor(i / 4)];
        }

        return output;
    },

    subBytes: function(state, nb) {
        var r, c;

        for (c = 0; c < nb; c++) {
            for (r = 0; r < 4; r++) {
                state[r][c] = this.sbox[state[r][c]];
            }
        }
    },

    shiftRows: function(state, nb) {
        var temp = new Array(nb);

        var r, c;

        for (r = 1; r < 4; r++) {
            for (c = 0; c < nb; c++) {
                temp[c] = state[r][(c + r) % nb];
            }
            for (c = 0; c < 4; c++) {
                state[r][c] = temp[c];
            }
        }
    },

    mixColumns: function(state, nb) {
        var r, c, a, b;

        for (c = 0; c < nb; c++) {
            a = new Array(4);
            b = new Array(4);

            for (r = 0; r < 4; r++) {
                a[r] = state[r][c];
                b[r] = state[r][c] & 0x80 ? state[r][c] << 1 ^ 0x11b : state[r][c] << 1;
            }

            state[0][c] = b[0] ^ a[3] ^ a[2] ^ b[1] ^ a[1];
            state[1][c] = b[1] ^ a[0] ^ a[3] ^ b[2] ^ a[2];
            state[2][c] = b[2] ^ a[1] ^ a[0] ^ b[3] ^ a[3];
            state[3][c] = b[3] ^ a[2] ^ a[1] ^ b[0] ^ a[0];
        }
    },

    addRoundKey: function(state, w, round, nb) {
        var r, c;

        for (c = 0; c < nb; c++) {
            for (r = 0; r < 4; r++) {
                state[r][c] ^= w[round * 4 + c][r];
            }
        }
    },

    keyExpansion: function(key) {
        var nk   = key.length / 4;
        var nb   = 4;
        var nr   = nk + 6;
        var w    = new Array(nb * (nr + 1));
        var temp = new Array(4);

        var i, j;

        for (i = 0; i < nk; i++) {
            w[i] = [key[4 * i], key[4 * i + 1], key[4 * i + 2], key[4 * i + 3]];
        }

        for (i = nk; i < w.length; i++) {
            w[i] = new Array(4);

            for (j = 0; j < 4; j++) {
                temp[j] = w[i - 1][j];
            }

            if (i % nk === 0) {
                this.rotWord(temp);
                this.subWord(temp);

                for (j = 0; j < 4; j++) {
                    temp[j] ^= AES.rcon[i / nk][j];
                }
            }
            else if (nk > 6 && i % nk === 4) {
                this.subWord(temp);
            }

            for (j = 0; j < 4; j++) {
                w[i][j] = w[i - nk][j] ^ temp[j];
            }
        }

        return w;
    },

    rotWord: function(w) {
        var temp = w[0];

        var i;

        for (i = 0; i < 3; i++) {
            w[i] = w[i + 1];
        }

        w[3] = temp;
    },

    subWord: function(w) {
        var i;

        for (i = 0; i < 4; i++) {
            w[i] = this.sbox[w[i]];
        }
    },

    generateKey: function() {
        var key = new Array(16);

        var i;

        for (i = 0; i < 16; i++) {
            key[i] = Math.floor(Math.random() * 0x100);
        }

        return key;
    }
};

AES.Base64 = {
    characters: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=",

    encode: function (input) {
        var output = "";

        var chr1, chr2, chr3, enc1, enc2, enc3, enc4;

        var i;

        for (i = 0; i < input.length;) {
            chr1 = input.charCodeAt(i++);
            chr2 = input.charCodeAt(i++);
            chr3 = input.charCodeAt(i++);

            enc1 = chr1 >> 2;
            enc2 = ((chr1 & 0x3) << 4) | (chr2 >> 4);
            enc3 = ((chr2 & 0xf) << 2) | (chr3 >> 6);
            enc4 = chr3 & 0x3f;

            if (isNaN(chr2)) {
                enc3 = enc4 = 64;
            }
            else if (isNaN(chr3)) {
                enc4 = 64;
            }

            output = output + this.characters.charAt(enc1) +
                this.characters.charAt(enc2) +
                this.characters.charAt(enc3) +
                this.characters.charAt(enc4);
        }

        return output;
    },

    decode: function (input) {
        var output = "";

        var chr1, chr2, chr3, dec1, dec2, dec3, dec4;

        var i;

        input = input.replace(/[^A-Za-z0-9\+\/\=]/g, "");

        for (i = 0; i < input.length;) {
            dec1 = this.characters.indexOf(input.charAt(i++));
            dec2 = this.characters.indexOf(input.charAt(i++));
            dec3 = this.characters.indexOf(input.charAt(i++));
            dec4 = this.characters.indexOf(input.charAt(i++));

            chr1 = (dec1 << 2) | (dec2 >> 4);
            chr2 = ((dec2 & 0xf) << 4) | (dec3 >> 2);
            chr3 = ((dec3 & 0x3) << 6) | dec4;

            output = output + String.fromCharCode(chr1);

            if (dec3 !== 64) {
                output = output + String.fromCharCode(chr2);
            }
            if (dec4 !== 64) {
                output = output + String.fromCharCode(chr3);
            }
        }

        return output;
    }
};

AES.Counter = function() {
    var time = 1715592630;//Math.floor((new Date()).getTime() / 1000);

    this.arr = new Array(16);

    var i;

    for (i = 0; i < 4; i++) {
        this.arr[i] = (time >>> i * 8) & 0xff;
    }
    // for (i = 4; i < 8; i++) {
    //     this.arr[i] = Math.floor(Math.random() * 0x100);
    // }
    this.arr[4] = 123;
    this.arr[5] = 223;
    this.arr[6] = 13;
    this.arr[7] = 23;

    for (i = 8; i < 16; i++) {
        this.arr[i] = 0;
    }

    this.increment = function() {
        for (i = 15; i >= 8; i--) {
            if (this.arr[i] === 0xff) {
                this.arr[i] = 0;
            }
            else {
                this.arr[i]++;
                break;
            }
        }

        return this;
    };
    console.log()
};

AES.Crypto = function(key) {
    var blockSize = 16;

    this.key         = key;
    this.keySchedule = AES.keyExpansion(key);
    this.counter     = new AES.Counter();

    var i;

    this.setCounter = function(arr) {
        for (i = 0; i < 16; i++) {
            this.counter.arr[i] = arr[i];
        }

        return this;
    };

    this.getCounter = function() {
        return this.counter.arr;
    };

    this.run = function(input) {
        var blockCount = Math.ceil(input.length / blockSize);
        var output     = new Array(input.length);

        var counterBlock, byteCount, offset;

        var block, c;

        for (block = 0; block < blockCount; block++) {
            counterBlock = AES.cipher(this.counter.arr, this.keySchedule);
            byteCount    = block + 1 === blockCount ? input.length % blockSize : blockSize;
            offset       = block * blockSize;

            for (c = 0; c < byteCount; c++) {
                output[offset + c] = String.fromCharCode(counterBlock[c] ^ input.charCodeAt(offset + c));
            }

            this.counter.increment();
        }

        return output.join("");
    };

    this.encrypt = function(text) {
        return AES.Base64.encode(this.run(text));
    };

    this.decrypt = function(text) {
        return this.run(AES.Base64.decode(text));
    };
};
var aSide = new AES.Crypto([190, 100, 76, 127, 43, 253, 149, 65, 72, 90, 40, 65, 6, 211, 77, 37]);
var bSide = new AES.Crypto(aSide.key);
bSide.setCounter(aSide.getCounter());
var cipherText = aSide.encrypt("the quick brown fox jumped over the lazy dog");
var plainText = bSide.decrypt(cipherText);
console.log(plainText === "the quick brown fox jumped over the lazy dog")