/*
* class name:L&mediaservice/src/main/ets/sabr/SabrOfflineDownloader&1.0.0;
* Source code created from a .abc file.
* powered by xpanda decompiler, author: jmp0
*/
import Logger from "@normalized:N&&&mediaservice/src/main/ets/utils/Logger&1.0.0";
import { PlayerModel } from "@normalized:N&&&mediaservice/src/main/ets/model/PlayerModel&1.0.0";
import { SabrProtocolException } from "@normalized:N&&&youtube_core/Index&1.0.0";
import { SabrTrackBuffer } from "@normalized:N&&&mediaservice/src/main/ets/sabr/SabrTrackBuffer&1.0.0";
import { sabrSessionStore } from "@normalized:N&&&mediaservice/src/main/ets/sabr/SabrSessionStore&1.0.0";
let local_0_0 = "[SabrOfflineDownloader]";
export class SabrOfflineDownloader {
  constructor() {}
  static isSabrStream(p0) {
    return PlayerModel.isSabrStream(p0);
  }
  static async downloadTracks(p0) {
    let v4, v6, v8, v9, v10, v14, v15;
    let v7 = p0.video.sabrInfo || p0.audio.sabrInfo;
    if (v7) {
      if (!v7.serverAbrStreamingUrl) {
        throw new Error("SABR download: missing sabrInfo/serverAbrStreamingUrl");
      }
      if (p0.video.itag === undefined || p0.audio.itag === undefined) {
        throw new Error("SABR download: missing itags");
      }
      v10 = SabrOfflineDownloader.resolveVideoFormat(v7, p0.video, p0.video.itag);
      v4 = SabrOfflineDownloader.resolveAudioFormat(v7, p0.audio, p0.audio.itag);
      v6 = p0.durationMs || p0.video.approxDurationMs || p0.audio.approxDurationMs || 0;
      v9 = !!p0.useAuth;
      Logger.info(local_0_0 /*TAG*/, "download start dual-track video=" + p0.video.itag + " audio=" + p0.audio.itag + " " + ("track=" + (p0.audio.audioTrackId || v4.audioTrackId || "-") + " ") + ("durationMs=" + v6 + " useAuth=" + v9 + ""));
      v14 = sabrSessionStore;
      v8 = sabrSessionStore.acquire(v7, v4, v10, v9, "|dl");
      try {
        v15 = new SabrTrackBuffer(v8, false, v6);
        v14 = new SabrTrackBuffer(v8, true, v6);
        await v15.ensureReady();
        if (p0.isCancelled !== null && p0.isCancelled !== undefined ? p0.isCancelled() : undefined) {
          throw new Error("cancelled");
        }
        await v14.ensureReady();
        if (p0.isCancelled !== null && p0.isCancelled !== undefined ? p0.isCancelled() : undefined) {
          throw new Error("cancelled");
        }
        await SabrOfflineDownloader.dumpDualTrack(v15, v14, v8, p0.writeVideo, p0.writeAudio, p0.onProgress, p0.isCancelled);
        Logger.info(local_0_0 /*TAG*/, "download complete dual-track video=" + p0.video.itag + " audio=" + p0.audio.itag + "");
      } catch (catchAcc) {
        v14 = catchAcc;
      }
      sabrSessionStore.release(v8.key);
      if (hole == v14) {
        return undefined;
      }
      throw v14;
    } else {
      throw new Error("SABR download: missing sabrInfo/serverAbrStreamingUrl");
    }
    /* xpanda: try/finally not restored */
    ;
  }
  static resolveVideoFormat(p0, p1, p2) {
    let v6 = p0.findFormatByItag(p2);
    return v6 || {
      "itag": p2,
      "mimeType": p1.mimeType,
      "bitrate": p1.bitrate,
      "width": p1.width,
      "height": p1.height,
      "isAudio": false,
      "isVideo": true,
      "qualityLabel": p1.quality,
      "codecs": p1.codecs,
      "approxDurationMs": p1.approxDurationMs
    };
  }
  static resolveAudioFormat(p0, p1, p2) {
    let v6 = p0.findFormatByItagAndTrack(p2, p1.audioTrackId);
    if (v6 && p1.audioTrackId && v6.audioTrackId !== p1.audioTrackId) {
      v6 = undefined;
    }
    if (v6) {
      return v6;
    }
    return {
      "itag": p2,
      "mimeType": p1.mimeType,
      "bitrate": p1.bitrate,
      "isAudio": true,
      "isVideo": false,
      "codecs": p1.codecs,
      "audioTrackId": p1.audioTrackId,
      "audioTrackName": p1.audioTrackName,
      "isOriginalAudio": (p1.audioTrackType || "").toLowerCase() === "original",
      "approxDurationMs": p1.approxDurationMs
    };
  }
  static async dumpDualTrack(p0, p1, p2, p3, p4, p5, p6) {
    let v11, v12, v13, v15, v16, v17, v18, v19, v20, v21, v22, v23, v26, v28, acc;
    let local_2_2, local_2_6;
    let local_2_0 = 0;
    let local_2_4 = 0;
    let local_2_1 = 0;
    let local_2_5 = 0;
    let local_2_3 = false;
    let local_2_7 = false;
    v11 = 0;
    v15 = await p0.readSegment(true, -1, false);
    if (!v15 || v15.length === 0) {
      throw new Error("SABR download: empty video init itag=" + p0.getItag() + "");
    }
    await p3(v15);
    local_2_0 += v15.length;
    if (p5 != null) {
      acc = {
        "track": "video",
        "phase": "init",
        "sequence": 0,
        "endSegment": p0.getEndSegment(),
        "bytesWritten": local_2_0 /*videoBytes*/,
        "percent": 1,
        "videoBytes": local_2_0 /*videoBytes*/,
        "audioBytes": local_2_4 /*audioBytes*/,
        "videoSeq": local_2_1 /*videoSeq*/,
        "audioSeq": local_2_5 /*audioSeq*/
      };
      p5(acc);
    }
    v15 = await p1.readSegment(true, -1, false);
    if (!v15 || v15.length === 0) {
      throw new Error("SABR download: empty audio init itag=" + p1.getItag() + "");
    }
    await p4(v15);
    local_2_4 += v15.length;
    if (p5 != null) {
      acc = {
        "track": "audio",
        "phase": "init",
        "sequence": 0,
        "endSegment": p1.getEndSegment(),
        "bytesWritten": local_2_4 /*audioBytes*/,
        "percent": 1,
        "videoBytes": local_2_0 /*videoBytes*/,
        "audioBytes": local_2_4 /*audioBytes*/,
        "videoSeq": local_2_1 /*videoSeq*/,
        "audioSeq": local_2_5 /*audioSeq*/
      };
      p5(acc);
    }
    local_2_2 = 1;
    local_2_6 = 1;
    while (true) {
      if (local_2_3 /*videoDone*/) {
        if (!local_2_7 /*audioDone*/) {
          if (p6 == null ? undefined : p6()) {
            throw new Error("cancelled");
          }
          v20 = p0.getEndSegment();
          v16 = p1.getEndSegment();
          if (!local_2_3 /*videoDone*/ && v20 > 0 && local_2_2 /*nextVideoSeq*/ > v20) {
            local_2_3 = true;
          }
          if (!local_2_7 /*audioDone*/ && v16 > 0 && local_2_6 /*nextAudioSeq*/ > v16) {
            local_2_7 = true;
          }
          if (local_2_3 /*videoDone*/ && local_2_7 /*audioDone*/) {
            v13 = p0.getEndSegment();
            v12 = p1.getEndSegment();
            if (local_2_1 /*videoSeq*/ <= 0 || local_2_5 /*audioSeq*/ <= 0) {
              throw new Error("SABR download incomplete: missing media videoSeq=" + local_2_1 /*videoSeq*/ + " audioSeq=" + local_2_5 /*audioSeq*/ + "");
            }
            if (v13 > 0 && local_2_1 /*videoSeq*/ < v13) {
              throw new Error("SABR video incomplete: last=" + local_2_1 /*videoSeq*/ + " expected=" + v13 + "");
            }
            if (v12 > 0 && local_2_5 /*audioSeq*/ < v12) {
              throw new Error("SABR audio incomplete: last=" + local_2_5 /*audioSeq*/ + " expected=" + v12 + "");
            }
            if (p5 != null) {
              p5({
                "track": "both",
                "phase": "done",
                "sequence": Math.max(local_2_1 /*videoSeq*/, local_2_5 /*audioSeq*/),
                "endSegment": Math.max(v13, v12),
                "bytesWritten": local_2_0 /*videoBytes*/ + local_2_4 /*audioBytes*/,
                "percent": 100,
                "videoBytes": local_2_0 /*videoBytes*/,
                "audioBytes": local_2_4 /*audioBytes*/,
                "videoSeq": local_2_1 /*videoSeq*/,
                "audioSeq": local_2_5 /*audioSeq*/
              });
            }
            v19 = "dump dual-track vItag=" + p0.getItag() + " aItag=" + p1.getItag() + " " + ("vSegs=" + local_2_1 /*videoSeq*/ + " aSegs=" + local_2_5 /*audioSeq*/ + " vBytes=" + local_2_0 /*videoBytes*/ + " aBytes=" + local_2_4 /*audioBytes*/ + " ") + ("vEnd=" + v13 + " aEnd=" + v12 + "");
            Logger.info(local_0_0 /*TAG*/, v19);
            return undefined;
          }
          v21 = local_2_1 /*videoSeq*/ > 0 ? p0.getSegmentEndMs(local_2_1 /*videoSeq*/) : 0;
          v17 = local_2_5 /*audioSeq*/ > 0 ? p1.getSegmentEndMs(local_2_5 /*audioSeq*/) : 0;
          if (!local_2_3 /*videoDone*/) {}
          if (!local_2_3 /*videoDone*/) {
            v18 = !local_2_7 /*audioDone*/ ? v21 <= v17 : local_2_7 /*audioDone*/;
          } else v18 = local_2_7 /*audioDone*/;
          v19 = false;
          if (!v18) {
            if (!local_2_7 /*audioDone*/) {
              acc = SabrOfflineDownloader.tryWriteNext(p1, local_2_6 /*nextAudioSeq*/, p4, function (p0, p1) {
                local_2_4 += p0;
                local_2_5 = p1;
                local_2_6 = p1 + 1;
              }, function () {
                local_2_7 = true;
              });
              v19 = await acc;
            }
          } else if (!local_2_3 /*videoDone*/) {
            acc = SabrOfflineDownloader.tryWriteNext(p0, local_2_2 /*nextVideoSeq*/, p3, function (p0, p1) {
              local_2_0 += p0;
              local_2_1 = p1;
              local_2_2 = p1 + 1;
            }, function () {
              local_2_3 = true;
            });
            v19 = await acc;
          } else if (!local_2_7 /*audioDone*/) {
            acc = SabrOfflineDownloader.tryWriteNext(p1, local_2_6 /*nextAudioSeq*/, p4, function (p0, p1) {
              local_2_4 += p0;
              local_2_5 = p1;
              local_2_6 = p1 + 1;
            }, function () {
              local_2_7 = true;
            });
            v19 = await acc;
          }
          if (!v19 && !v18) {
            if (!local_2_3 /*videoDone*/) {
              acc = SabrOfflineDownloader.tryWriteNext(p0, local_2_2 /*nextVideoSeq*/, p3, function (p0, p1) {
                local_2_0 += p0;
                local_2_1 = p1;
                local_2_2 = p1 + 1;
              }, function () {
                local_2_3 = true;
              });
              v19 = await acc;
            } else if (!v19 && v18) {
              if (!local_2_7 /*audioDone*/) {
                acc = SabrOfflineDownloader.tryWriteNext(p1, local_2_6 /*nextAudioSeq*/, p4, function (p0, p1) {
                  local_2_4 += p0;
                  local_2_5 = p1;
                  local_2_6 = p1 + 1;
                }, function () {
                  local_2_7 = true;
                });
                v19 = await acc;
              }
            }
          } else if (!v19 && v18) {
            if (!local_2_7 /*audioDone*/) {
              acc = SabrOfflineDownloader.tryWriteNext(p1, local_2_6 /*nextAudioSeq*/, p4, function (p0, p1) {
                local_2_4 += p0;
                local_2_5 = p1;
                local_2_6 = p1 + 1;
              }, function () {
                local_2_7 = true;
              });
              v19 = await acc;
            }
          }
          if (v19) {
            v11 = 0;
            v26 = local_2_1 /*videoSeq*/ > 0 ? p0.getSegmentEndMs(local_2_1 /*videoSeq*/) : 0;
            v22 = Math.min(v26, local_2_5 /*audioSeq*/ > 0 ? p1.getSegmentEndMs(local_2_5 /*audioSeq*/) : 0);
            v22 > 0 && sabrSessionStore.setPlayHeadMs(p2.key, v22);
            v23 = SabrOfflineDownloader.overallPercent(local_2_1 /*videoSeq*/, local_2_5 /*audioSeq*/, p0.getEndSegment(), p1.getEndSegment(), local_2_0 /*videoBytes*/, local_2_4 /*audioBytes*/);
            if (p5 != null) {
              acc = {
                "track": "both",
                "phase": "media",
                "sequence": Math.max(local_2_1 /*videoSeq*/, local_2_5 /*audioSeq*/),
                "endSegment": null,
                "bytesWritten": null,
                "percent": null,
                "videoBytes": null,
                "audioBytes": null,
                "videoSeq": null,
                "audioSeq": null
              };
              v28 = p0.getEndSegment();
              p1.getEndSegment();
              acc.endSegment = Math.max(v28, p1.getEndSegment());
              acc.bytesWritten = local_2_0 /*videoBytes*/ + local_2_4 /*audioBytes*/;
              acc.percent = v23;
              acc.videoBytes = local_2_0 /*videoBytes*/;
              acc.audioBytes = local_2_4 /*audioBytes*/;
              acc.videoSeq = local_2_1 /*videoSeq*/;
              acc.audioSeq = local_2_5 /*audioSeq*/;
              p5(acc);
            }
            continue;
          }
          v11 += 1;
          if (v11 >= 6) {
            throw new Error("SABR dual-track stalled videoSeq=" + local_2_2 /*nextVideoSeq*/ + " audioSeq=" + local_2_6 /*nextAudioSeq*/ + " " + ("vEnd=" + p0.getEndSegment() + " aEnd=" + p1.getEndSegment() + ""));
          }
          await new Promise(function (p0) {
            return setTimeout(p0, 300);
          });
          continue;
        }
        v13 = p0.getEndSegment();
        v12 = p1.getEndSegment();
        if (local_2_1 /*videoSeq*/ <= 0 || local_2_5 /*audioSeq*/ <= 0) {
          throw new Error("SABR download incomplete: missing media videoSeq=" + local_2_1 /*videoSeq*/ + " audioSeq=" + local_2_5 /*audioSeq*/ + "");
        }
        if (v13 > 0 && local_2_1 /*videoSeq*/ < v13) {
          throw new Error("SABR video incomplete: last=" + local_2_1 /*videoSeq*/ + " expected=" + v13 + "");
        }
        if (v12 > 0 && local_2_5 /*audioSeq*/ < v12) {
          throw new Error("SABR audio incomplete: last=" + local_2_5 /*audioSeq*/ + " expected=" + v12 + "");
        }
        if (p5 != null) {
          p5({
            "track": "both",
            "phase": "done",
            "sequence": Math.max(local_2_1 /*videoSeq*/, local_2_5 /*audioSeq*/),
            "endSegment": Math.max(v13, v12),
            "bytesWritten": local_2_0 /*videoBytes*/ + local_2_4 /*audioBytes*/,
            "percent": 100,
            "videoBytes": local_2_0 /*videoBytes*/,
            "audioBytes": local_2_4 /*audioBytes*/,
            "videoSeq": local_2_1 /*videoSeq*/,
            "audioSeq": local_2_5 /*audioSeq*/
          });
        }
        v19 = "dump dual-track vItag=" + p0.getItag() + " aItag=" + p1.getItag() + " " + ("vSegs=" + local_2_1 /*videoSeq*/ + " aSegs=" + local_2_5 /*audioSeq*/ + " vBytes=" + local_2_0 /*videoBytes*/ + " aBytes=" + local_2_4 /*audioBytes*/ + " ") + ("vEnd=" + v13 + " aEnd=" + v12 + "");
        Logger.info(local_0_0 /*TAG*/, v19);
        return undefined;
      }
      if (p6 == null ? undefined : p6()) {
        throw new Error("cancelled");
      }
      v20 = p0.getEndSegment();
      v16 = p1.getEndSegment();
      if (!local_2_3 /*videoDone*/ && v20 > 0 && local_2_2 /*nextVideoSeq*/ > v20) {
        local_2_3 = true;
      }
      if (!local_2_7 /*audioDone*/ && v16 > 0 && local_2_6 /*nextAudioSeq*/ > v16) {
        local_2_7 = true;
      }
      if (local_2_3 /*videoDone*/ && local_2_7 /*audioDone*/) {
        v13 = p0.getEndSegment();
        v12 = p1.getEndSegment();
        if (local_2_1 /*videoSeq*/ <= 0 || local_2_5 /*audioSeq*/ <= 0) {
          throw new Error("SABR download incomplete: missing media videoSeq=" + local_2_1 /*videoSeq*/ + " audioSeq=" + local_2_5 /*audioSeq*/ + "");
        }
        if (v13 > 0 && local_2_1 /*videoSeq*/ < v13) {
          throw new Error("SABR video incomplete: last=" + local_2_1 /*videoSeq*/ + " expected=" + v13 + "");
        }
        if (v12 > 0 && local_2_5 /*audioSeq*/ < v12) {
          throw new Error("SABR audio incomplete: last=" + local_2_5 /*audioSeq*/ + " expected=" + v12 + "");
        }
        if (p5 != null) {
          p5({
            "track": "both",
            "phase": "done",
            "sequence": Math.max(local_2_1 /*videoSeq*/, local_2_5 /*audioSeq*/),
            "endSegment": Math.max(v13, v12),
            "bytesWritten": local_2_0 /*videoBytes*/ + local_2_4 /*audioBytes*/,
            "percent": 100,
            "videoBytes": local_2_0 /*videoBytes*/,
            "audioBytes": local_2_4 /*audioBytes*/,
            "videoSeq": local_2_1 /*videoSeq*/,
            "audioSeq": local_2_5 /*audioSeq*/
          });
        }
        v19 = "dump dual-track vItag=" + p0.getItag() + " aItag=" + p1.getItag() + " " + ("vSegs=" + local_2_1 /*videoSeq*/ + " aSegs=" + local_2_5 /*audioSeq*/ + " vBytes=" + local_2_0 /*videoBytes*/ + " aBytes=" + local_2_4 /*audioBytes*/ + " ") + ("vEnd=" + v13 + " aEnd=" + v12 + "");
        Logger.info(local_0_0 /*TAG*/, v19);
        return undefined;
      }
      v21 = local_2_1 /*videoSeq*/ > 0 ? p0.getSegmentEndMs(local_2_1 /*videoSeq*/) : 0;
      v17 = local_2_5 /*audioSeq*/ > 0 ? p1.getSegmentEndMs(local_2_5 /*audioSeq*/) : 0;
      if (!local_2_3 /*videoDone*/) {}
      if (!local_2_3 /*videoDone*/) {
        v18 = !local_2_7 /*audioDone*/ ? v21 <= v17 : local_2_7 /*audioDone*/;
      } else v18 = local_2_7 /*audioDone*/;
      v19 = false;
      if (!v18) {
        if (!local_2_7 /*audioDone*/) {
          acc = SabrOfflineDownloader.tryWriteNext(p1, local_2_6 /*nextAudioSeq*/, p4, function (p0, p1) {
            local_2_4 += p0;
            local_2_5 = p1;
            local_2_6 = p1 + 1;
          }, function () {
            local_2_7 = true;
          });
          v19 = await acc;
        }
      } else if (!local_2_3 /*videoDone*/) {
        acc = SabrOfflineDownloader.tryWriteNext(p0, local_2_2 /*nextVideoSeq*/, p3, function (p0, p1) {
          local_2_0 += p0;
          local_2_1 = p1;
          local_2_2 = p1 + 1;
        }, function () {
          local_2_3 = true;
        });
        v19 = await acc;
      } else if (!local_2_7 /*audioDone*/) {
        acc = SabrOfflineDownloader.tryWriteNext(p1, local_2_6 /*nextAudioSeq*/, p4, function (p0, p1) {
          local_2_4 += p0;
          local_2_5 = p1;
          local_2_6 = p1 + 1;
        }, function () {
          local_2_7 = true;
        });
        v19 = await acc;
      }
      if (!v19 && !v18) {
        if (!local_2_3 /*videoDone*/) {
          acc = SabrOfflineDownloader.tryWriteNext(p0, local_2_2 /*nextVideoSeq*/, p3, function (p0, p1) {
            local_2_0 += p0;
            local_2_1 = p1;
            local_2_2 = p1 + 1;
          }, function () {
            local_2_3 = true;
          });
          v19 = await acc;
        } else if (!v19 && v18) {
          if (!local_2_7 /*audioDone*/) {
            acc = SabrOfflineDownloader.tryWriteNext(p1, local_2_6 /*nextAudioSeq*/, p4, function (p0, p1) {
              local_2_4 += p0;
              local_2_5 = p1;
              local_2_6 = p1 + 1;
            }, function () {
              local_2_7 = true;
            });
            v19 = await acc;
          }
        }
      } else if (!v19 && v18) {
        if (!local_2_7 /*audioDone*/) {
          acc = SabrOfflineDownloader.tryWriteNext(p1, local_2_6 /*nextAudioSeq*/, p4, function (p0, p1) {
            local_2_4 += p0;
            local_2_5 = p1;
            local_2_6 = p1 + 1;
          }, function () {
            local_2_7 = true;
          });
          v19 = await acc;
        }
      }
      if (v19) {
        v11 = 0;
        v26 = local_2_1 /*videoSeq*/ > 0 ? p0.getSegmentEndMs(local_2_1 /*videoSeq*/) : 0;
        v22 = Math.min(v26, local_2_5 /*audioSeq*/ > 0 ? p1.getSegmentEndMs(local_2_5 /*audioSeq*/) : 0);
        v22 > 0 && sabrSessionStore.setPlayHeadMs(p2.key, v22);
        v23 = SabrOfflineDownloader.overallPercent(local_2_1 /*videoSeq*/, local_2_5 /*audioSeq*/, p0.getEndSegment(), p1.getEndSegment(), local_2_0 /*videoBytes*/, local_2_4 /*audioBytes*/);
        if (p5 != null) {
          acc = {
            "track": "both",
            "phase": "media",
            "sequence": Math.max(local_2_1 /*videoSeq*/, local_2_5 /*audioSeq*/),
            "endSegment": null,
            "bytesWritten": null,
            "percent": null,
            "videoBytes": null,
            "audioBytes": null,
            "videoSeq": null,
            "audioSeq": null
          };
          v28 = p0.getEndSegment();
          p1.getEndSegment();
          acc.endSegment = Math.max(v28, p1.getEndSegment());
          acc.bytesWritten = local_2_0 /*videoBytes*/ + local_2_4 /*audioBytes*/;
          acc.percent = v23;
          acc.videoBytes = local_2_0 /*videoBytes*/;
          acc.audioBytes = local_2_4 /*audioBytes*/;
          acc.videoSeq = local_2_1 /*videoSeq*/;
          acc.audioSeq = local_2_5 /*audioSeq*/;
          p5(acc);
        }
        continue;
      }
      v11 += 1;
      if (v11 >= 6) {
        throw new Error("SABR dual-track stalled videoSeq=" + local_2_2 /*nextVideoSeq*/ + " audioSeq=" + local_2_6 /*nextAudioSeq*/ + " " + ("vEnd=" + p0.getEndSegment() + " aEnd=" + p1.getEndSegment() + ""));
      }
      await new Promise(function (p0) {
        return setTimeout(p0, 300);
      });
      continue;
    }
  }
  static async tryWriteNext(p0, p1, p2, p3, p4) {
    let v8, acc;
    try {
      v8 = await p0.readSegment(false, p1);
      if (!v8) {
        p4();
        return false;
      }
      await p2(v8);
      p3(v8.length, p1);
      return true;
    } catch (catchAcc) {
      String(catchAcc);
      if (catchAcc instanceof SabrProtocolException && catchAcc.kind === "beyond_end") {
        p4();
        return false;
      }
      if (catchAcc instanceof SabrProtocolException) {
        acc = catchAcc.kind === "protection" || catchAcc.kind === "no_media" || catchAcc.kind === "segment_unavailable";
      } else {
        acc = catchAcc instanceof SabrProtocolException;
      }
      if (acc) {
        Logger.warn(local_0_0 /*TAG*/, "tryWriteNext itag=" + p0.getItag() + " seq=" + p1 + ": " + catchAcc + "");
        return false;
      }
      acc = catchAcc instanceof Error ? catchAcc : new Error(catchAcc);
      throw acc;
    }
  }
  static overallPercent(p0, p1, p2, p3, p4, p5) {
    if (p2 > 0 && p3 > 0) {
      return Math.min(99, Math.round((Math.min(1, p0 / p2) + Math.min(1, p1 / p3)) / 2 * 100));
    }
    if (p2 > 0) {
      return Math.min(99, Math.round(p0 / p2 * 100));
    }
    if (p3 > 0) {
      return Math.min(99, Math.round(p1 / p3 * 100));
    }
    return Math.min(99, Math.max(2, Math.round((p4 + p5) / (1024 * 1024))));
  }
}