/*
* class name:L&entry/src/main/ets/features/player/YoutubePageAttestationBootstrap&;
* Source code created from a .abc file.
* powered by xpanda decompiler, author: jmp0
*/
let local_0_0, local_0_1, local_0_3, local_0_4, local_0_6, local_0_7, local_0_8, local_0_9, local_0_10, local_0_11;
let local_0_5 = function (p0) {
  return typeof p0 === "string" && p0.length > 0 ? p0 : undefined;
};
let local_0_2 = function (p0) {
  if (p0 === null ? p0 !== null : typeof p0 === "object") {
    if (!Array.isArray(p0)) {
      return p0;
    }
  }
  return undefined;
};
local_0_8 = function (p0, p1, p2) {
  let v6, v9, v10, v11, v13;
  let v7 = "";
  for (v6 = p1; v6 < p0.length; v7 += v9) {
    v13 = v6;
    v6 += 1;
    v9 = p0.charAt(v13);
    if (v9 === p2) {
      return v7;
    }
    if (v9 === "\\") {
      if (v6 >= p0.length) {
        return "";
      }
      v13 = v6;
      v6 += 1;
      v10 = p0.charAt(v13);
      switch (v10) {
        case "b":
          v7 += "\b";
          continue;
        case "f":
          v7 += "\f";
          continue;
        case "n":
          v7 += "\n";
          continue;
        case "r":
          v7 += "\r";
          continue;
        case "t":
          v7 += "\t";
          continue;
        case "v":
          v7 += "";
          continue;
        case "x":
          v11 = local_0_11(p0, v6, 2);
          if (v11 < 0) {
            return "";
          }
          v7 += String.fromCharCode(v11);
          v6 += 2;
          continue;
        case "u":
          v11 = local_0_11(p0, v6, 4);
          if (v11 < 0) {
            return "";
          }
          v7 += String.fromCharCode(v11);
          v6 += 4;
          continue;
        default:
          if (v10 !== "\n") {
            if (v10 !== "\r") {
              v7 += v10;
            } else if (v6 < p0.length && p0.charAt(v6) === "\n") {
              v6 += 1;
            }
          }
          continue;
      }
    }
  }
  return "";
};
local_0_0 = function (p0, p1) {
  let v8, v9, v10, v11;
  let v5 = [];
  let v6 = 0;
  while (true) {
    v8 = p0.indexOf(p1, v6);
    if (v8 < 0) {
      return v5;
    }
    v11 = v8 + p1.length;
    while (v11 < p0.length && local_0_9(p0.charAt(v11))) {
      v11 += 1;
    }
    if (v11 >= p0.length || p0.charAt(v11) !== "(") {
      v6 = v8 + p1.length;
    } else {
      v10 = v11 + 1;
      while (v10 < p0.length && local_0_9(p0.charAt(v10))) {
        v10 += 1;
      }
      if (v10 >= p0.length || p0.charAt(v10) !== "{") {
        v6 = v11 + 1;
      } else {
        v9 = local_0_10(p0, v10);
        if (v9 < 0) {
          v6 = v10 + 1;
        } else {
          v5.push({
            "start": v8,
            "argument": p0.substring(v10, v9 + 1)
          });
          v6 = v9 + 1;
        }
      }
    }
  }
};
local_0_10 = function (p0, p1) {
  let v10, v11;
  let v5 = 0;
  let v7 = "";
  let v6 = false;
  for (v10 = p1; v10 < p0.length; v10 += 1) {
    v11 = p0.charAt(v10);
    if (v7 !== "") {
      if (v6) {
        v6 = false;
      } else if (v11 === "\\") {
        v6 = true;
      } else if (v11 === v7) {
        v7 = "";
      }
    } else if (v11 === "'" || v11 === "\"") {
      v7 = v11;
    } else if (v11 === "{") {
      v5 += 1;
    } else if (v11 === "}" && (v5 -= 1, v5 === 0)) {
      return v10;
    }
  }
  return -1;
};
local_0_9 = function (p0) {
  return p0 === " " || p0 === "\t" || p0 === "\n" || p0 === "\r" || p0 === "\f" || p0 === "";
};
local_0_6 = function (p0) {
  let v11, v14;
  let v4 = new Map();
  if (p0.length === 0) {
    return v4;
  }
  for (v11 of p0.split("&")) {
    v14 = v11.indexOf("=");
    if (v14 < 0) {
      v4.set(v11, "true");
    } else {
      v4.set(v11.substring(0, v14), v11.substring(v14 + 1));
    }
  }
  return v4;
};
local_0_4 = function (p0) {
  let v5;
  let v6 = local_0_7 /*INITIAL_ATTESTATION_RESPONSE*/.exec(p0);
  if (!v6) {
    return undefined;
  }
  v5 = local_0_8(p0, v6.index + v6[0].length, v6[1]);
  if (v5.length === 0) {
    return undefined;
  }
  try {
    return parseSabrAttChallengeData(v5);
  } catch (catchAcc) {
    return undefined;
  }
};
export function parseSabrAttChallengeData(p0) {
  let v5, v6, v7, v8, v9;
  let v4 = local_0_2(local_0_2(JSON.parse(p0))?.bgChallenge);
  if (!v4) {
    throw new Error("Attestation response has no BotGuard challenge");
  }
  v6 = local_0_5(local_0_2(v4.interpreterJavascript)?.privateDoNotAccessOrElseSafeScriptWrappedValue);
  v9 = local_0_5(local_0_2(v4.interpreterUrl)?.privateDoNotAccessOrElseTrustedResourceUrlWrappedValue);
  v7 = undefined;
  if (v9) {
    v7 = v9.startsWith("//") ? "https:" + v9 + "" : v9;
  }
  if (!v6) {
    if (!v7) {
      throw new Error("Attestation challenge has no interpreter script or URL");
    }
  }
  v8 = local_0_5(v4.program);
  if (!v8) {
    throw new Error("Attestation challenge has no program");
  }
  v5 = local_0_5(v4.globalName);
  if (!v5) {
    throw new Error("Attestation challenge has no global name");
  }
  return {
    "program": v8,
    "globalName": v5,
    "interpreterJavascript": v6,
    "interpreterUrl": v7
  };
}
export function parseYoutubePageAttestationBootstrap(p0) {
  let v4, v5, v6, v7, v8, v9, v10, v11, v12, v13, v14, v15, v16, v17, v24, v26, v27;
  let local_1_0;
  v10 = [];
  for (v24 of local_0_0(p0, local_0_1 /*YTCFG_CALLEE*/)) {
    try {
      v27 = local_0_2(JSON.parse(v24.argument));
      if (v27) {
        v10.push({
          "call": v24,
          "config": v27
        });
      }
    } catch (catchAcc) {
      v27 = catchAcc;
    }
  }
  local_1_0 = undefined;
  for (v24 of local_0_0(p0, local_0_3 /*INITIAL_ATTESTATION_CALLEE*/)) {
    v26 = v24;
    v27 = local_0_4(v24.argument);
    if (v27) {
      local_1_0 = v26;
      v5 = v27;
      break;
    }
  }
  if (local_1_0 /*challengeCall*/) {
    if (!v27) {
      throw new Error("YouTube home has no initial attestation challenge");
    }
    v11 = v10.filter(function (p0) {
      return p0.call.start < local_1_0 /*challengeCall*/.start;
    }).map(function (p0) {
      return p0.config;
    });
    v7 = undefined;
    for (v24 of v11) {
      if (v24.INNERTUBE_CONTEXT !== undefined) {
        v7 = v24;
      }
    }
    if (!v7) {
      throw new Error("YouTube home has no client context");
    }
    v13 = undefined;
    for (v24 of v11) {
      v27 = local_0_5(v24.EVENT_ID);
      if (v27) {
        v13 = v27;
      }
    }
    if (!v13) {
      throw new Error("YouTube home has no EVENT_ID");
    }
    v15 = local_0_5(v7.EOM_VISITOR_DATA) ?? local_0_5(v7.VISITOR_DATA);
    if (!v15) {
      throw new Error("YouTube home has no anonymous visitor data");
    }
    v16 = v15.replace(new RegExp("%3D", "gi"), "=");
    v12 = undefined;
    for (v24 of v11) {
      v27 = local_0_5(v24.DATASYNC_ID);
      if (v27) {
        v12 = v27;
      }
    }
    v6 = local_0_2(local_0_2(v7.INNERTUBE_CONTEXT)?.client);
    if (!v6) {
      throw new Error("YouTube home has no Innertube client context");
    }
    v8 = local_0_5(v6.clientName);
    if (!v8) {
      throw new Error("YouTube home has no client name");
    }
    if (v8 === "WEB") {
      v9 = local_0_5(v6.clientVersion);
      if (!v9) {
        throw new Error("YouTube home has no client version");
      }
      v17 = local_0_2(local_0_2(v7.WEB_PLAYER_CONTEXT_CONFIGS)?.WEB_PLAYER_CONTEXT_CONFIG_ID_KEVLAR_WATCH);
      v14 = local_0_6(local_0_5(v17?.serializedExperimentFlags) ?? "");
      if (v14.get("html5_generate_content_po_token") === "true") {
        v4 = "content";
      } else if (v14.get("html5_generate_session_po_token") === "true") {
        v4 = "session";
      } else {
        v4 = !v17 ? "content" : "none";
      }
      return {
        "visitorData": v16,
        "dataSyncId": v12,
        "clientName": v8,
        "clientVersion": v9,
        "binding": v4,
        "eventId": v13,
        "challenge": v5
      };
    }
    throw new Error("Unsupported YouTube home client: " + v8 + "");
  }
  throw new Error("YouTube home has no initial attestation challenge");
}
local_0_11 = function (p0, p1, p2) {
  let v6, v9, v10;
  if (p1 + p2 > p0.length) {
    return -1;
  }
  v6 = 0;
  for (v9 = 0; v9 < p2; v9 += 1) {
    v10 = parseInt(p0.charAt(p1 + v9), 16);
    if (isNaN(v10)) {
      return -1;
    }
    v6 = v6 * 16 + v10;
  }
  return v6;
};
local_0_1 = "ytcfg.set";
local_0_3 = "window.ytAtN";
local_0_7 = new RegExp("['\"]R['\"]\\s*:\\s*(['\"])");