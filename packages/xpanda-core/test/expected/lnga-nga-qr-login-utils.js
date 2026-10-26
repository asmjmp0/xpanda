/*
* class name:Lcom.example.nga_oh/entry/ets/common/utils/NgaQrLoginUtils;
* Source code created from a .abc file.
* powered by xpanda decompiler, author: jmp0
*/
import { NGA_HOSTS } from "@bundle:com.example.nga_oh/entry/ets/common/constants/NgaDomains";
let local_0_1, local_0_2;
let local_0_0 = function (p0) {
  return decodeURIComponent(p0);
};
export function isNgaQrLoginUrl(p0) {
  let v1, v3, v4, v5, v6;
  let v0 = p0.trim();
  if (!v0.toLowerCase().startsWith("https://")) {
    return false;
  }
  v6 = [v0.indexOf("/", "https://".length), v0.indexOf("?", "https://".length), v0.indexOf("#", "https://".length)];
  v3 = v0.length;
  for (v4 = 0; v4 < v6.length; v4 += 1) {
    if (v6[v4] >= 0 && v6[v4] < v3) {
      v3 = v6[v4];
    }
  }
  v3 = v0.substring("https://".length, v3);
  v4 = v3.length;
  if ((v4 !== 0 ? v3.indexOf(":") >= 0 : v4 === 0) || v3.indexOf("@") >= 0) {
    return false;
  }
  if (!local_0_1(v3)) {
    return false;
  }
  v1 = v0.indexOf("/", "https://".length);
  if (v1 < 0) {
    v1 = v0.length;
  }
  v3 = v0.length;
  v4 = v0.indexOf("?", v1);
  v5 = v0.indexOf("#", v1);
  if (v4 >= 0 && v4 < v0.length) {
    v3 = v4;
  }
  if (v5 >= 0 && v5 < v3) {
    v3 = v5;
  }
  if (v0.substring(v1, v3) !== "/nuke.php") {
    return false;
  }
  if (v4 < 0) {
    return false;
  }
  v0 = v0.substring(v4 + 1, v5 < 0 ? v0.length : v5);
  return local_0_2(v0);
}
local_0_1 = function (p0) {
  let v1;
  let v0 = 0;
  for (v1 = p0.toLowerCase(); v0 < NGA_HOSTS.length; v0 += 1) {
    if (v1 === NGA_HOSTS[v0]) {
      return true;
    }
  }
  return false;
};
local_0_2 = function (p0) {
  let v8, v10, v11, acc;
  let v2 = p0.split("&");
  let v9 = 0;
  let v3 = "";
  let v4 = false;
  let v6 = false;
  let v7 = "";
  let v5 = false;
  for (v8 = ""; v9 < v2.length; v9 += 1) {
    v10 = v2[v9].indexOf("=");
    if (v10 <= 0) {
      return false;
    }
    v11 = local_0_0(v2[v9].substring(0, v10));
    v10 = v2[v9].substring(v10 + 1);
    acc = local_0_0(v10);
    if (acc.length === 0) {
      return false;
    }
    switch (v11) {
      case "__lib":
        if (v4) {
          return false;
        }
        v4 = true;
        v7 = acc;
        break;
      case "__act":
        if (v6) {
          return false;
        }
        v6 = true;
        v3 = acc;
        break;
      case "qrkey":
        if (v5) {
          return false;
        }
        v5 = true;
        v8 = acc;
        break;
      default:
        return false;
    }
  }
  return v4 && v6 && v5 && v7 === "login" && v3 === "qrlogin_ui" && v8.length > 0;
};