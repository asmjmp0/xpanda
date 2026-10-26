/*
* class name:L&youtube_core/src/main/ets/extractor/sabr/SabrResponseDecoder&1.0.0;
* Source code created from a .abc file.
* powered by xpanda decompiler, author: jmp0
*/
import { SabrContextSendingPolicy } from "@normalized:N&&&youtube_core/src/main/ets/extractor/sabr/SabrDecodedResponse&1.0.0";
import { SabrContextUpdate } from "@normalized:N&&&youtube_core/src/main/ets/extractor/sabr/SabrDecodedResponse&1.0.0";
import { SabrDecodedResponse } from "@normalized:N&&&youtube_core/src/main/ets/extractor/sabr/SabrDecodedResponse&1.0.0";
import { SabrFormatInitMeta } from "@normalized:N&&&youtube_core/src/main/ets/extractor/sabr/SabrDecodedResponse&1.0.0";
import { SabrMediaHeader } from "@normalized:N&&&youtube_core/src/main/ets/extractor/sabr/SabrMediaHeader&1.0.0";
import { SabrMediaSegment } from "@normalized:N&&&youtube_core/src/main/ets/extractor/sabr/SabrMediaSegment&1.0.0";
import { SabrNextRequestPolicy } from "@normalized:N&&&youtube_core/src/main/ets/extractor/sabr/SabrDecodedResponse&1.0.0";
import { SabrProtocolException } from "@normalized:N&&&youtube_core/src/main/ets/extractor/sabr/SabrProtocolException&1.0.0";
import { SabrRedirectInfo } from "@normalized:N&&&youtube_core/src/main/ets/extractor/sabr/SabrDecodedResponse&1.0.0";
import { WIRE_LENGTH_DELIMITED } from "@normalized:N&&&youtube_core/src/main/ets/extractor/sabr/SabrProto&1.0.0";
import { WIRE_VARINT } from "@normalized:N&&&youtube_core/src/main/ets/extractor/sabr/SabrProto&1.0.0";
import { YTCoreLogger } from "@normalized:N&&&youtube_core/src/main/ets/common/YTCoreLogger&1.0.0";
import { readProtoVarint } from "@normalized:N&&&youtube_core/src/main/ets/common/ProtoUtil&1.0.0";
import { sabrReadFields } from "@normalized:N&&&youtube_core/src/main/ets/extractor/sabr/SabrProto&1.0.0";
import { umpReadAll } from "@normalized:N&&&youtube_core/src/main/ets/extractor/sabr/UmpReader&1.0.0";
let PART_FORMAT_INITIALIZATION_METADATA, PART_MEDIA, PART_MEDIA_END, PART_MEDIA_HEADER, PART_NEXT_REQUEST_POLICY, PART_RELOAD_PLAYER_RESPONSE, PART_SABR_CONTEXT_SENDING_POLICY, PART_SABR_CONTEXT_UPDATE, PART_SABR_ERROR, PART_SABR_REDIRECT, PART_SABR_SEEK, PART_STREAM_PROTECTION_STATUS, isRecoverableIntegrityIssues, requireUmpContentType, sabrDecodeBody, sabrDecodeParts;
let local_0_2, local_0_3, local_0_4, local_0_5, local_0_6, local_0_9, local_0_10, local_0_11, local_0_13, local_0_14, local_0_15;
let local_0_12 = function (p0, p1, p2) {
  let v14, v17;
  let v7 = [];
  let v6 = [];
  for (v14 of p0) {
    if (v6.indexOf(v14.headerId) >= 0) {
      v7.push("duplicate-media-header:" + v14.headerId + "");
    }
    v6.push(v14.headerId);
    v17 = p1.get(v14.headerId);
    if (v17 === undefined) {
      v7.push("missing-media:" + v14.headerId + "");
    } else if (v14.contentLength >= 0 && v17 !== v14.contentLength) {
      v7.push("length-mismatch:" + v14.headerId + ":expected=" + v14.contentLength + ":actual=" + v17 + "");
    }
    if (p2.indexOf(v14.headerId) < 0) {
      v7.push("missing-media-end:" + v14.headerId + "");
    }
  }
  for (v14 of p1.keys()) {
    if (v6.indexOf(v14) < 0) {
      v7.push("media-without-header:" + v14 + "");
    }
  }
  for (v14 of p2) {
    if (v6.indexOf(v14) < 0) {
      v7.push("media-end-without-header:" + v14 + "");
    }
  }
  return v7;
};
let local_0_1 = function (p0) {
  let v4, v5, v13;
  let v6 = 0;
  for (v13 of p0) {
    v6 += v13.length;
  }
  v5 = new Uint8Array(v6);
  v4 = 0;
  for (v13 of p0) {
    v5.set(v13, v4);
    v4 += v13.length;
  }
  return v5;
};
let local_0_8 = function (p0) {
  let v11, v14, v15, v16, v17, v20;
  let v4 = new SabrContextSendingPolicy();
  for (v11 of sabrReadFields(p0)) {
    v14 = [];
    if (v11.wireType === WIRE_VARINT) {
      v14 = [v11.varint | 0];
    } else if (v11.wireType === WIRE_LENGTH_DELIMITED) {
      v15 = v11.getBytes();
      for (v16 = 0; v16 < v15.length; v16 = v17.next) {
        v17 = readProtoVarint(v15, v16);
        if (!v17) {
          break;
        }
        v14.push(v17.value | 0);
      }
    }
    for (v20 of v14) {
      switch (v11.number) {
        case 1:
          v4.activateTypes.push(v20);
          break;
        case 2:
          v4.deactivateTypes.push(v20);
          break;
        case 3:
          v4.disposeTypes.push(v20);
          break;
      }
    }
  }
  return v4;
};
let local_0_7 = function (p0) {
  let v11;
  let v4 = new SabrContextUpdate();
  for (v11 of sabrReadFields(p0)) {
    if (v11.number === 1) {
      v4.type = v11.varint | 0;
    } else if (v11.number === 2) {
      v4.scope = v11.varint | 0;
    } else if (v11.number === 3) {
      if (v11.wireType === WIRE_LENGTH_DELIMITED) {
        v4.value = v11.getBytes();
      }
    } else if (v11.number === 4) {
      v4.sendByDefault = v11.varint !== 0;
    } else if (v11.number === 5) {
      v4.writePolicy = v11.varint | 0;
    }
  }
  return v4;
};
local_0_14 = function (p0) {
  let v11;
  let v4 = new local_0_15 /*FormatByteRange*/();
  for (v11 of sabrReadFields(p0)) {
    if ((v11.number === 1 || v11.number === 3) && v11.wireType === WIRE_VARINT) {
      v4.start = v11.varint;
    } else if ((v11.number === 2 || v11.number === 4) && v11.wireType === WIRE_VARINT) {
      v4.end = v11.varint;
    }
  }
  return v4;
};
local_0_9 = function (p0) {
  let v11, v14, v19;
  let v4 = new SabrFormatInitMeta();
  for (v11 of sabrReadFields(p0)) {
    if (v11.number === 1 && v11.wireType === WIRE_LENGTH_DELIMITED) {
      v4.videoId = v11.getString();
    } else if (v11.number === 2 && v11.wireType === WIRE_LENGTH_DELIMITED) {
      for (v19 of sabrReadFields(v11.getBytes())) {
        if (v19.number === 1) {
          v4.itag = v19.varint | 0;
        } else if (v19.number === 2) {
          v4.lastModified = v19.varint;
        } else if (v19.number === 3 && v19.wireType === WIRE_LENGTH_DELIMITED) {
          v4.xtags = v19.getString();
        }
      }
    } else if (v11.number === 3 && v11.wireType === WIRE_VARINT) {
      v4.endTimeMs = v11.varint;
    } else if (v11.number === 4 && v11.wireType === WIRE_VARINT) {
      v4.endSegmentNumber = v11.varint | 0;
    } else if (v11.number === 5 && v11.wireType === WIRE_LENGTH_DELIMITED) {
      v4.mimeType = v11.getString();
    } else if (v11.number === 6 && v11.wireType === WIRE_LENGTH_DELIMITED) {
      v14 = local_0_14(v11.getBytes());
      v4.initRangeStart = v14.start;
      v4.initRangeEnd = v14.end;
    } else if (v11.number === 7 && v11.wireType === WIRE_LENGTH_DELIMITED) {
      v14 = local_0_14(v11.getBytes());
      v4.indexRangeStart = v14.start;
      v4.indexRangeEnd = v14.end;
    } else if (v11.number === 8 && v11.wireType === WIRE_VARINT) {
      v4.field8 = v11.varint;
    } else if (v11.number === 9 && v11.wireType === WIRE_VARINT) {
      v4.durationUnits = v11.varint;
    } else if (v11.number === 10 && v11.wireType === WIRE_VARINT) {
      v4.durationTimescale = v11.varint;
    }
  }
  return v4;
};
local_0_2 = function (p0) {
  let v11;
  let v4 = new SabrNextRequestPolicy();
  for (v11 of sabrReadFields(p0)) {
    if (v11.number === 1) {
      v4.targetAudioReadaheadMs = v11.varint | 0;
    } else if (v11.number === 2) {
      v4.targetVideoReadaheadMs = v11.varint | 0;
    } else if (v11.number === 3) {
      v4.maxTimeSinceLastRequestMs = v11.varint | 0;
    } else if (v11.number === 4) {
      v4.backoffTimeMs = v11.varint | 0;
    } else if (v11.number === 5) {
      v4.minAudioReadaheadMs = v11.varint | 0;
    } else if (v11.number === 6) {
      v4.minVideoReadaheadMs = v11.varint | 0;
    } else if (v11.number === 7) {
      if (v11.wireType === WIRE_LENGTH_DELIMITED) {
        v4.playbackCookie = v11.getBytes();
      }
    } else if (v11.number === 8) {
      if (v11.wireType === WIRE_LENGTH_DELIMITED) {
        v4.videoId = v11.getString();
      }
    }
  }
  return v4;
};
local_0_3 = function (p0) {
  let v11;
  let v4 = new SabrRedirectInfo();
  for (v11 of sabrReadFields(p0)) {
    if (v11.number === 1 && v11.wireType === WIRE_LENGTH_DELIMITED) {
      v4.url = v11.getString();
    }
  }
  return v4;
};
local_0_5 = function (p0) {
  let v10, v11, v12, v17, v18, v19, v20, v21, acc;
  let v9 = sabrReadFields(p0)[Symbol.iterator]();
  do {
    label_52: ;
    v10 = v9.next();
    if (v10.done) {
      return undefined;
    }
    v11 = v10.value;
  } while ((v12 = v11, v11.number !== 1) || v11.wireType !== WIRE_LENGTH_DELIMITED);
  v17 = sabrReadFields(v12.getBytes())[Symbol.iterator]();
  do {
    v18 = v17.next();
    if (v18.done) {
      break; //from goto label_52
    }
    v19 = v18.value;
  } while ((v20 = v19, v19.number !== 1) || v19.wireType !== WIRE_LENGTH_DELIMITED);
  v21 = v20.getString();
  acc = v21.length > 0 ? v21 : undefined;
  if (v17.return != undefined) {
    v17.return();
  }
  if (v9.return != undefined) {
    v9.return();
  }
  return acc;
};
local_0_10 = function (p0) {
  let v10, v11, v12;
  for (v10 of sabrReadFields(p0)) {
    v11 = v10;
    if ((v12 = v11, v11.number === 1) && v11.wireType === WIRE_VARINT) return v12.varint | 0;
  }
  return -1;
};
local_0_6 = function (p0) {
  let v11;
  let v4 = new local_0_13 /*StreamProtectionResult*/();
  for (v11 of sabrReadFields(p0)) {
    if (v11.number === 1 && v11.wireType === WIRE_VARINT) {
      v4.status = v11.varint | 0;
    } else if (v11.number === 2 && v11.wireType === WIRE_VARINT) {
      v4.maxRetries = v11.varint | 0;
    }
  }
  return v4;
};
isRecoverableIntegrityIssues = function (p0) {
  let v10;
  if (p0.length === 0) {
    return false;
  }
  for (v10 of p0) {
    if (v10.startsWith("length-mismatch:") || v10.startsWith("missing-media-end:") || v10.startsWith("missing-media:") || v10.startsWith("media-without-header:") || v10.startsWith("media-end-without-header:")) {
      continue;
    }
    if (!v10.startsWith("truncated-ump-response:")) return false;
  }
  return true;
};
requireUmpContentType = function (p0, p1) {
  if (!p0 || p0.toLowerCase().indexOf("application/vnd.yt-ump") < 0) {
    throw new SabrProtocolException("Expected UMP response, got content type: " + p0 + ", status=" + p1 + "");
  }
  return;
};
sabrDecodeBody = function (p0) {
  return sabrDecodeParts(umpReadAll(p0));
};
sabrDecodeParts = function (p0) {
  let v11;
  let v4 = new SabrPartProcessor();
  for (v11 of p0) {
    v4.acceptPart(v11);
  }
  return v4.finish();
};
local_0_4 = function (p0, p1) {
  let v7, v13;
  try {
    v7 = [];
    for (v13 of sabrReadFields(p0)) {
      if (v13.wireType === WIRE_VARINT) {
        v7.push("" + v13.number + "=" + v13.varint + "");
      } else {
        v7.push("" + v13.number + "=bytes(" + ((v13.bytes !== null && v13.bytes !== undefined ? v13.bytes.length : undefined) ?? 0) + ")");
      }
    }
    return "" + p1 + ":{" + v7.join(",") + "}";
  } catch (catchAcc) {
    return "" + p1 + ":opaque(" + p0.length + ")";
  }
};
PART_MEDIA_HEADER = 20;
PART_MEDIA = 21;
PART_MEDIA_END = 22;
PART_NEXT_REQUEST_POLICY = 35;
PART_FORMAT_INITIALIZATION_METADATA = 42;
PART_SABR_REDIRECT = 43;
PART_SABR_ERROR = 44;
PART_SABR_SEEK = 45;
PART_RELOAD_PLAYER_RESPONSE = 46;
PART_STREAM_PROTECTION_STATUS = 58;
PART_SABR_CONTEXT_UPDATE = 57;
PART_SABR_CONTEXT_SENDING_POLICY = 59;
local_0_11 = YTCoreLogger.getInstance("SabrResponseDecoder");
class OpenMediaAssembly {
  constructor(p0) {
    this.chunks = [];
    this.header = p0;
  }
}
local_0_13 = class StreamProtectionResult {
  constructor() {
    this.status = -1;
    this.maxRetries = -1;
  }
};
local_0_15 = class FormatByteRange {
  constructor() {
    this.start = -1;
    this.end = -1;
  }
};
export class SabrPartProcessor {
  constructor(p0, p1) {
    this.decoded = new SabrDecodedResponse();
    this.open = new Map();
    this.mediaBytesByHeaderId = new Map();
    this.retainedSegments = [];
    this.segmentCountValue = 0;
    this.segmentSink = p0;
    this.formatMetaSink = p1;
  }
  acceptPart(p0) {
    let v6, v7, v8, acc;
    try {
      if (p0.type === PART_MEDIA_HEADER) {
        v6 = SabrMediaHeader.decode(p0.data);
        this.decoded.mediaHeaders.push(v6);
        this.open.set(v6.headerId, new OpenMediaAssembly(v6));
      } else if (p0.type !== PART_MEDIA) {
        if (p0.type === PART_MEDIA_END) {
          if (p0.data.length > 0) {
            v7 = p0.data[0];
            this.decoded.mediaEndHeaderIds.push(p0.data[0]);
            v6 = this.open.get(p0.data[0]);
            if (p0.data.length > 0) {
              v8 = local_0_1(v6.chunks);
              this.open.delete(v7);
              this.deliverSegment(new SabrMediaSegment(v6.header, v8));
            }
          }
        } else if (p0.type === PART_NEXT_REQUEST_POLICY) {
          v6 = local_0_2(p0.data);
          this.decoded.nextRequestPolicy = v6;
          if (v6.backoffTimeMs > 0) {
            this.decoded.backoffTimeMs = v6.backoffTimeMs;
          }
        } else if (p0.type === PART_SABR_REDIRECT) {
          this.decoded.redirectUrl = local_0_3(p0.data).url;
        } else if (p0.type === PART_SABR_ERROR) {
          this.decoded.sabrError = local_0_4(p0.data, "error");
        } else if (p0.type === PART_RELOAD_PLAYER_RESPONSE) {
          this.decoded.reloadRequested = true;
          this.decoded.reloadToken = local_0_5(p0.data);
        } else if (p0.type === PART_STREAM_PROTECTION_STATUS) {
          v6 = local_0_6(p0.data);
          this.decoded.streamProtectionStatus = v6.status;
          this.decoded.streamProtectionMaxRetries = v6.maxRetries;
        } else if (p0.type === PART_SABR_CONTEXT_UPDATE) {
          this.decoded.sabrContextUpdates.push(local_0_7(p0.data));
        } else if (p0.type === PART_SABR_CONTEXT_SENDING_POLICY) {
          this.decoded.sabrContextSendingPolicy = local_0_8(p0.data);
        } else if (p0.type === PART_FORMAT_INITIALIZATION_METADATA) {
          v6 = local_0_9(p0.data);
          this.decoded.formatInitializationMetadata.push(v6);
          if (this.formatMetaSink !== null && this.formatMetaSink !== undefined) {
            this.formatMetaSink(v6);
          }
        } else if (p0.type === PART_SABR_SEEK) {
          this.decoded.sabrSeekReason = local_0_10(p0.data);
        } else if ((p0.type === PART_MEDIA ? p0.type !== PART_MEDIA : p0.type !== PART_MEDIA_END) && p0.type !== PART_MEDIA_HEADER && p0.type >= 10 && p0.type <= 70) {
          this.decoded.unknownPartTypes.push(p0.type);
        }
      } else if (p0.data.length > 0) {
        v8 = p0.data.subarray(1);
        acc = this.mediaBytesByHeaderId.get(p0.data[0]) ?? 0;
        this.mediaBytesByHeaderId.set(p0.data[0], acc + v8.length);
        v6 = this.open.get(p0.data[0]);
        if (v6) {
          v6.chunks.push(v8);
        }
      }
    } catch (catchAcc) {
      acc = catchAcc instanceof Error ? catchAcc.message : String(catchAcc);
      local_0_11 /*logger*/.warn("[SABR-DECODE] part=" + p0.type + " decode-failed: " + acc + "");
    }
  }
  finish() {
    this.decoded.segmentCount = this.segmentCountValue;
    if (!this.segmentSink) {
      this.decoded.segments = this.retainedSegments;
    }
    this.decoded.integrityIssues = local_0_12(this.decoded.mediaHeaders, this.mediaBytesByHeaderId, this.decoded.mediaEndHeaderIds);
    return this.decoded;
  }
  deliverSegment(p0) {
    let acc;
    if (p0.header.contentLength >= 0) {
      p0.getLength();
      if (p0.header.contentLength !== p0.header.contentLength) {
        local_0_11 /*logger*/.warn("[SABR-DECODE] withhold incomplete segment itag=" + p0.header.itag + " " + ("seq=" + p0.header.sequenceNumber + " expected=" + p0.header.contentLength + " actual=" + p0.getLength() + ""));
        return;
      }
    }
    this.segmentCountValue = this.segmentCountValue + 1;
    if (this.segmentSink) {
      try {
        this.segmentSink(p0);
      } catch (catchAcc) {
        acc = catchAcc instanceof Error ? catchAcc.message : String(catchAcc);
        local_0_11 /*logger*/.warn("[SABR-DECODE] segment sink failed itag=" + p0.header.itag + ": " + acc + "");
      }
      return;
    }
    this.retainedSegments.push(p0);
    return;
  }
}
export { PART_FORMAT_INITIALIZATION_METADATA };
export { PART_MEDIA };
export { PART_MEDIA_END };
export { PART_MEDIA_HEADER };
export { PART_NEXT_REQUEST_POLICY };
export { PART_RELOAD_PLAYER_RESPONSE };
export { PART_SABR_CONTEXT_SENDING_POLICY };
export { PART_SABR_CONTEXT_UPDATE };
export { PART_SABR_ERROR };
export { PART_SABR_REDIRECT };
export { PART_SABR_SEEK };
export { PART_STREAM_PROTECTION_STATUS };
export { isRecoverableIntegrityIssues };
export { requireUmpContentType };
export { sabrDecodeBody };
export { sabrDecodeParts };