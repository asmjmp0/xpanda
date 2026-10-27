/*
* class name:L&launch/src/main/ets/r16&1.0.0;
* Source code created from a .abc file.
* powered by xpanda decompiler, author: jmp0
*/
export function t1511(p0, p1) {
  return p0 === "-Djna.tmpdir=${natives_directory}" || p0 === "-Djna.tmpdir=${natives_directory}/jna" ? "-Djna.tmpdir=" + p1 + "/natives/jna" : p0;
}
export function u1511(p0) {
  let v1, v4;
  if (p0.indexOf("-D") === 0) {
    v1 = p0.indexOf("=");
    if (v1 >= 0) {
      p0 = p0.substring(0, v1);
    }
    return p0;
  }
  for (v4 of ["-Xmx", "-Xms", "-Xss", "-Xmn"]) {
    if (p0.indexOf(v4) === 0) return v4;
  }
  return "";
}
export function v1511(p0) {
  let v4, v5;
  let v1 = new Set();
  let v2 = [];
  let v3 = p0.length - 1;
  while (true) {
    if (v3 < 0) {
      return v2.reverse();
    }
    v4 = p0[v3];
    v5 = u1511(p0[v3]);
    if (v5.length > 0) {
      if (v1.has(v5)) {
        v3 -= 1;
        continue;
      }
      v1.add(v5);
    }
    v2.push(v4);
    v3 -= 1;
  }
}