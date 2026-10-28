/*
* class name:Lpkg_modules/.ohpm/@ohos+flutter_ohos@zl5sgaygqsqrqqtvxitwwita9ctgsvucjvbitoqeitg=/pkg_modules/@ohos/flutter_ohos/src/main/ets/plugin/common/SendableStandardMessageCodec;
* Source code created from a .abc file.
* powered by xpanda decompiler, author: jmp0
*/
import { ByteBuffer } from "@package:pkg_modules/.ohpm/@ohos+flutter_ohos@zl5sgaygqsqrqqtvxitwwita9ctgsvucjvbitoqeitg=/pkg_modules/@ohos/flutter_ohos/src/main/ets/util/ByteBuffer";
import HashMap from "@ohos:util.HashMap";
import LightWeightMap from "@ohos:util.LightWeightMap";
import LinkedList from "@ohos:util.LinkedList";
import List from "@ohos:util.List";
import PlainArray from "@ohos:util.PlainArray";
import StringUtils from "@package:pkg_modules/.ohpm/@ohos+flutter_ohos@zl5sgaygqsqrqqtvxitwwita9ctgsvucjvbitoqeitg=/pkg_modules/@ohos/flutter_ohos/src/main/ets/util/StringUtils";
import TreeMap from "@ohos:util.TreeMap";
@Sendable
class SendableStandardMessageCodec {
  static INSTANCE = new SendableStandardMessageCodec();
  static NULL = 0;
  static TRUE = 1;
  static FALSE = 2;
  static INT32 = 3;
  static INT64 = 4;
  static BIGINT = 5;
  static FLOAT64 = 6;
  static STRING = 7;
  static UINT8_ARRAY = 8;
  static INT32_ARRAY = 9;
  static INT64_ARRAY = 10;
  static FLOAT64_ARRAY = 11;
  static LIST = 12;
  static MAP = 13;
  static FLOAT32_ARRAY = 14;
  constructor() {}
  encodeMessage(p0) {
    let v0 /*ByteBuffer*/ = ByteBuffer.from(new ArrayBuffer(1024));
    this.writeValue(v0, p0);
    return v0.buffer;
  }
  decodeMessage(p0) {
    return p0 == null ? null : this.readValue(ByteBuffer.from(p0));
  }
  writeValue(p0, p1) {
    let v0 /*StringUtils*/;
    let local_0_1;
    let local_0_3 = this;
    let local_0_0 = p0;
    let local_0_2 = p1;
    if (local_0_2 == null || local_0_2 == undefined) {
      local_0_0.writeInt8(SendableStandardMessageCodec.NULL);
    } else if (typeof local_0_2 === "boolean") {
      local_0_0.writeInt8(local_0_2 ? SendableStandardMessageCodec.TRUE : SendableStandardMessageCodec.FALSE);
    } else if (typeof local_0_2 !== "number") {
      if (typeof local_0_2 === "bigint") {
        local_0_0.writeInt8(SendableStandardMessageCodec.BIGINT);
        v0 = Uint8Array.from(local_0_2.toString(16).split("").map(function (p0) {
          return p0.charCodeAt(0);
        }));
        local_0_3.writeBytes(local_0_0, v0);
      } else if (typeof local_0_2 === "string") {
        local_0_0.writeInt8(SendableStandardMessageCodec.STRING);
        local_0_3.writeBytes(local_0_0, new Uint8Array(StringUtils.stringToArrayBuffer(local_0_2)));
      } else if (local_0_2 instanceof Uint8Array) {
        local_0_0.writeInt8(SendableStandardMessageCodec.UINT8_ARRAY);
        local_0_3.writeBytes(local_0_0, local_0_2);
      } else if (local_0_2 instanceof Int32Array) {
        local_0_0.writeInt8(SendableStandardMessageCodec.INT32_ARRAY);
        local_0_3.writeSize(local_0_0, local_0_2.length);
        local_0_3.writeAlignment(local_0_0, 4);
        local_0_2.forEach(function (p0) {
          return local_0_0.writeInt32(p0, true);
        });
      } else if (local_0_2 instanceof BigInt64Array) {
        local_0_0.writeInt8(SendableStandardMessageCodec.INT64_ARRAY);
        local_0_3.writeSize(local_0_0, local_0_2.length);
        local_0_3.writeAlignment(local_0_0, 8);
        local_0_2.forEach(function (p0) {
          return local_0_0.writeBigInt64(p0, true);
        });
      } else if (local_0_2 instanceof Float32Array) {
        local_0_0.writeInt8(SendableStandardMessageCodec.FLOAT32_ARRAY);
        local_0_3.writeSize(local_0_0, local_0_2.length);
        local_0_3.writeAlignment(local_0_0, 4);
        local_0_2.forEach(function (p0) {
          return local_0_0.writeFloat32(p0, true);
        });
      } else if (local_0_2 instanceof Float64Array) {
        local_0_0.writeInt8(SendableStandardMessageCodec.FLOAT64_ARRAY);
        local_0_3.writeSize(local_0_0, local_0_2.length);
        local_0_3.writeAlignment(local_0_0, 8);
        local_0_2.forEach(function (p0) {
          return local_0_0.writeFloat64(p0, true);
        });
      } else if (local_0_2 instanceof Array || local_0_2 instanceof Int8Array || local_0_2 instanceof Int16Array || local_0_2 instanceof Uint16Array || local_0_2 instanceof Uint32Array || local_0_2 instanceof List || local_0_2 instanceof LinkedList) {
        local_0_0.writeInt8(SendableStandardMessageCodec.LIST);
        local_0_3.writeSize(local_0_0, local_0_2.length);
        local_0_2.forEach(function (p0) {
          return local_0_3.writeValue(local_0_0, p0);
        });
      } else if (local_0_2 instanceof Map) {
        local_0_0.writeInt8(SendableStandardMessageCodec.MAP);
        local_0_3.writeSize(local_0_0, local_0_2.size);
        local_0_2.forEach(function (p0, p1) {
          local_0_3.writeValue(local_0_0, p1);
          local_0_3.writeValue(local_0_0, p0);
        });
      } else if (local_0_2 instanceof HashMap || local_0_2 instanceof TreeMap || local_0_2 instanceof LightWeightMap || local_0_2 instanceof PlainArray) {
        local_0_0.writeInt8(SendableStandardMessageCodec.MAP);
        local_0_3.writeSize(local_0_0, local_0_2.length);
        local_0_2.forEach(function (p0, p1) {
          local_0_3.writeValue(local_0_0, p1);
          local_0_3.writeValue(local_0_0, p0);
        });
      } else {
        if (typeof local_0_2 != "object") {
          throw new Error("Unsupported value: " + local_0_2);
        }
        local_0_1 = new Map();
        Object.keys(local_0_2).forEach(function (p0) {
          local_0_1.set(p0, local_0_2[p0]);
        });
        local_0_3.writeValue(local_0_0, local_0_1);
      }
    } else if (!Number.isInteger(local_0_2)) {
      local_0_0.writeInt8(SendableStandardMessageCodec.FLOAT64);
      local_0_3.writeAlignment(local_0_0, 8);
      local_0_0.writeFloat64(local_0_2, true);
    } else if (-2147483647 - 1 <= local_0_2 && local_0_2 <= 2147483647) {
      local_0_0.writeInt8(SendableStandardMessageCodec.INT32);
      local_0_0.writeInt32(local_0_2, true);
    } else if (Number.MIN_SAFE_INTEGER <= local_0_2 && local_0_2 <= Number.MAX_SAFE_INTEGER) {
      local_0_0.writeInt8(SendableStandardMessageCodec.INT64);
      local_0_0.writeInt64(local_0_2, true);
    } else {
      local_0_0.writeInt8(SendableStandardMessageCodec.FLOAT64);
      local_0_3.writeAlignment(local_0_0, 8);
      local_0_0.writeFloat64(local_0_2, true);
    }
    return local_0_0;
  }
  writeAlignment(p0, p1) {
    let v2;
    if (p0.byteOffset % p1 != 0) {
      for (v2 = 0; v2 < p1 - p0.byteOffset % p1; v2 += 1) {
        p0.writeInt8(0);
      }
    }
  }
  writeSize(p0, p1) {
    if (p1 < 254) {
      p0.writeUint8(p1);
    } else if (p1 <= 65535) {
      p0.writeUint8(254);
      p0.writeUint16(p1, true);
    } else {
      p0.writeUint8(255);
      p0.writeUint32(p1, true);
    }
  }
  writeBytes(p0, p1) {
    this.writeSize(p0, p1.length);
    p0.writeUint8Array(p1);
  }
  readSize(p0) {
    let v1 = p0.readUint8() & 255;
    if (v1 < 254) {
      return v1;
    }
    if (v1 == 254) {
      return p0.readUint16(true);
    }
    return p0.readUint32(true);
  }
  readAlignment(p0, p1) {
    if (p0.byteOffset % p1 != 0) {
      p0.skip(p1 - p0.byteOffset % p1);
    }
  }
  readValue(p0) {
    return this.readValueOfType(p0.readUint8(), p0);
  }
  readBytes(p0) {
    let v0 = this.readSize(p0);
    let v1 = new Uint8Array(new ArrayBuffer(v0));
    let v2 = v1.set;
    v0 = p0.readUint8Array(v0);
    v2.call(v1, v0);
    return v1;
  }
  readValueOfType(p0, p1) {
    let v0, v1 /*StringUtils*/, v2, v3, v4;
    switch (p0) {
      case SendableStandardMessageCodec.NULL:
        v0 = null;
        break;
      case SendableStandardMessageCodec.TRUE:
        v0 = true;
        break;
      case SendableStandardMessageCodec.FALSE:
        v0 = false;
        break;
      case SendableStandardMessageCodec.INT32:
        v0 = p1.readInt32(true);
        break;
      case SendableStandardMessageCodec.INT64:
        v0 = p1.readInt64(true);
        if (Number.MIN_SAFE_INTEGER <= v0 && v0 <= Number.MAX_SAFE_INTEGER) {
          v0 = Number(v0);
        }
        break;
      default:
        v1 = 0;
        switch (p0) {
          case SendableStandardMessageCodec.BIGINT:
            v4 = [];
            v4.splice(0, 0, ...this.readBytes(p1));
            v0 = BigInt("0x" + String.fromCharCode(...v4) + "");
            break;
          case SendableStandardMessageCodec.FLOAT64:
            this.readAlignment(p1, 8);
            v0 = p1.readFloat64(true);
            break;
          case SendableStandardMessageCodec.STRING:
            v0 = StringUtils.uint8ArrayToString(this.readBytes(p1));
            break;
          case SendableStandardMessageCodec.UINT8_ARRAY:
            v0 = this.readBytes(p1);
            break;
          case SendableStandardMessageCodec.INT32_ARRAY:
            v2 = this.readSize(p1);
            v0 = new Int32Array(v2);
            for (this.readAlignment(p1, 4); v1 < v2; v1 += 1) {
              v0[v1] = p1.readInt32(true);
            }
            break;
          case SendableStandardMessageCodec.INT64_ARRAY:
            v3 = this.readSize(p1);
            v0 = new BigInt64Array(v3);
            for (this.readAlignment(p1, 8); v1 < v3; v1 += 1) {
              v0[v1] = p1.readBigInt64(true);
            }
            break;
          case SendableStandardMessageCodec.FLOAT64_ARRAY:
            v3 = this.readSize(p1);
            v0 = new Float64Array(v3);
            for (this.readAlignment(p1, 8); v1 < v3; v1 += 1) {
              v0[v1] = p1.readFloat64(true);
            }
            break;
          case SendableStandardMessageCodec.LIST:
            v2 = this.readSize(p1);
            for (v0 = new Array(v2); v1 < v2; v1 += 1) {
              v0[v1] = this.readValue(p1);
            }
            break;
          case SendableStandardMessageCodec.MAP:
            v2 = this.readSize(p1);
            for (v0 = new Map(); v1 < v2; v1 += 1) {
              v0.set(this.readValue(p1), this.readValue(p1));
            }
            break;
          case SendableStandardMessageCodec.FLOAT32_ARRAY:
            v2 = this.readSize(p1);
            v0 = new Float32Array(v2);
            for (this.readAlignment(p1, 4); v1 < v2; v1 += 1) {
              v0[v1] = p1.readFloat32(true);
            }
            break;
          default:
            throw new Error("Message corrupted, type=" + p0);
        }
    }
    return v0;
  }
}
export default SendableStandardMessageCodec;