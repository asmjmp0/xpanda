/*
* class name:L&mediaservice/src/main/ets/subtitle/VttSubtitleParser&1.0.0;
* Source code created from a .abc file.
* powered by xpanda decompiler, author: jmp0
*/
let findActiveSubtitleText, parseVttSubtitles;
let local_0_0, local_0_1, local_0_3;
let local_0_2 = function (p0) {
  let v12;
  let v5 = p0.replace(new RegExp("<[^>]*>", "g"), "");
  for (v12 of [["&amp;", "&"], ["&lt;", "<"], ["&gt;", ">"], ["&quot;", "\""], ["&#39;", "'"], ["&nbsp;", " "]]) {
    v5 = v5.split(v12[0]).join(v12[1]);
  }
  return v5.trim();
};
findActiveSubtitleText = function (p0, p1) {
  let v5, v6, v7, v8, v9, v12, v14;
  if (p0.length === 0) {
    return "";
  }
  v8 = 0;
  v5 = p0.length - 1;
  v6 = -1;
  while (v8 <= v5) {
    if (p0[v8 + v5 >> 1].startMs <= p1) {
      v6 = v8 + v5 >> 1;
      v8 = (v8 + v5 >> 1) + 1;
    } else {
      v5 = (v8 + v5 >> 1) - 1;
    }
  }
  if (v6 < 0) {
    return "";
  }
  v9 = [];
  v7 = v6;
  while (v7 >= 0 && p0[v7].startMs > p1 - local_0_3 /*MAX_CUE_LOOKBACK_MS*/) {
    if (p0[v7].endMs > p1) {
      v12 = p0[v7].text.split("\n");
      for (v14 = v12.length - 1; v14 >= 0; v14 -= 1) {
        if (v9.length === 0 || v9[0] !== v12[v14]) {
          v9.unshift(v12[v14]);
        }
      }
    }
    v7 -= 1;
  }
  return v9.join("\n");
};
local_0_1 = function (p0, p1, p2, p3) {
  return parseInt(p0, 10) * 3600000 + parseInt(p1, 10) * 60000 + parseInt(p2, 10) * 1000 + parseInt(p3, 10);
};
parseVttSubtitles = function (p0) {
  let v9, v11, v12, v13, v14;
  let v4 = [];
  let v7 = new RegExp("^" + local_0_0 /*VTT_TIMESTAMP*/ + "\\s+-->\\s+" + local_0_0 /*VTT_TIMESTAMP*/);
  let v6 = p0.replace(new RegExp("^\\uFEFF"), "").split(new RegExp("\\r?\\n"));
  let v5 = 0;
  while (v5 < v6.length) {
    v11 = v7.exec(v6[v5].trim());
    if (!v11) {
      v5 += 1;
    } else {
      v12 = local_0_1(v11[1], v11[2], v11[3], v11[4]);
      v9 = local_0_1(v11[5], v11[6], v11[7], v11[8]);
      v5 += 1;
      v14 = [];
      while (v5 < v6.length && v6[v5].trim().length > 0) {
        v14.push(v6[v5]);
        v5 += 1;
      }
      v13 = local_0_2(v14.join("\n"));
      if (v13.length > 0 && v9 > v12) {
        v4.push({
          "startMs": v12,
          "endMs": v9,
          "text": v13
        });
      }
    }
  }
  v4.sort(function (p0, p1) {
    return p0.startMs - p1.startMs;
  });
  return v4;
};
local_0_0 = "(\\d{2,}):(\\d{2}):(\\d{2})[.,](\\d{3})";
local_0_3 = 60000;
export { findActiveSubtitleText };
export { parseVttSubtitles };