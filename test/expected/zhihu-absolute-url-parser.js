/*
* class name:L&core/src/main/ets/navigation/AbsoluteUrlParser&1.0.0;
* Source code created from a .abc file.
* powered by xpanda decompiler, author: jmp0
*/
let parseAbsoluteUrl;
let local_0_0, local_0_1;
local_0_0 = function (p0) {
  return decodeURIComponent(p0.replace(new RegExp("\\+", "g"), " "));
};
parseAbsoluteUrl = function (p0) {
  let v0, v1, v2, v4, v5, v6, v7, v8, v9;
  v1 = "^([A-Za-z][A-Za-z0-9+.-]*):\\/\\/([^/?#]*)([^?#]*)(?:\\?([^#]*))?(?:#.*)?$";
  v0 = new RegExp("^([A-Za-z][A-Za-z0-9+.-]*):\\/\\/([^/?#]*)([^?#]*)(?:\\?([^#]*))?(?:#.*)?$").exec(p0);
  v1 = 0;
  v2 = 2;
  if (v0 === null || v0[2].length === 0) {
    return undefined;
  }
  v2 = v0[v2];
  v4 = "";
  v5 = "";
  v6 = v2.lastIndexOf("@");
  v7 = v6 >= v1;
  if (v6 >= v1) {
    v4 = v2.slice(v1, v6);
    v6 += 1;
    v2 = v2.slice(v6);
    v5 = v4.indexOf(":");
    v6 = v5 >= v1 ? v4.slice(v1, v5) : v4;
    if (v5 < v1) {
      v5 = "";
      v4 = v6;
    } else {
      v5 += 1;
      v5 = v4.slice(v5);
      v4 = v6;
    }
  }
  if (v2.length === v1 || v2.startsWith("[")) {
    return undefined;
  }
  v6 = "";
  v8 = v2.lastIndexOf(":");
  if (v8 >= v1) {
    v9 = v2.slice(v1, v8);
    v8 += 1;
    v6 = v2.slice(v8);
    if (v6.length === v1) {
      return undefined;
    }
    if (!new RegExp("^\\d+$").test(v6)) {
      return undefined;
    }
    v2 = v9;
  }
  if (v2.length === v1) {
    return undefined;
  } else {
    v8 = v0[4] ?? "";
    v1 = local_0_1(v8);
    return v1 === undefined ? undefined : {
      "protocol": "" + v0[1].toLowerCase() + ":",
      "hostname": v2.toLowerCase(),
      "port": v6,
      "username": v4,
      "password": v5,
      "hasUserInfo": v7,
      "pathname": v0[3],
      "params": v1
    };
  }
};
local_0_1 = function (p0) {
  let v1, v3, v4, v5, v6, v7;
  v1 = new Map();
  if (p0.length === 0) {
    return v1;
  } else {
    v3 = p0.split("&");
    for (v4 = 0; v4 < v3.length; v4 += 1) {
      v6 = v3[v4].indexOf("=");
      v7 = v6 >= 0 ? v3[v4].slice(0, v6) : v3[v4];
      if (v6 < 0) {
        v5 = "";
      } else {
        v6 += 1;
        v5 = v3[v4].slice(v6);
      }
      v6 = local_0_0(v7);
      v5 = local_0_0(v5);
      if (v6 === undefined || v5 === undefined) {
        return undefined;
      }
      if (!v1.has(v6)) {
        v1.set(v6, v5);
      }
    }
    return v1;
  }
};
export { parseAbsoluteUrl };