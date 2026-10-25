/*
* class name:L&youtube_core/src/main/ets/network/HttpDownloader&1.0.0;
* Source code created from a .abc file.
* powered by xpanda decompiler, author: jmp0
*/
import { HttpProxyOptions } from "@normalized:N&&&youtube_core/src/main/ets/network/HttpProxyOptions&1.0.0";
import { YTCoreLogger } from "@normalized:N&&&youtube_core/src/main/ets/common/YTCoreLogger&1.0.0";
import deviceInfo from "@ohos:deviceInfo";
import http from "@ohos:net.http";
let HttpAbortToken, HttpDownloader, HttpError, HttpErrorType, Request;
let acc;
let local_0_0, local_0_1, local_0_2, local_0_3, local_0_4, local_0_5;
HttpErrorType = undefined;
local_0_0 = function (p0) {
  let v4, v5, v6, v7, v8;
  if (!p0) {
    return "";
  }
  v6 = p0.toLowerCase();
  v7 = v6.indexOf("://");
  if (v7 >= 0) {
    v6 = v6.substring(v7 + 3);
  }
  v4 = v6.length;
  v8 = v6.indexOf("/");
  if (v8 >= 0 && v8 < v6.length) {
    v4 = v8;
  }
  v5 = v6.indexOf(":");
  if (v5 >= 0 && v5 < v4) {
    v4 = v5;
  }
  return v6.substring(0, v4);
};
local_0_1 = function (p0) {
  let v4;
  v4 = local_0_0(p0);
  return v4 === "youtube.com" || v4.endsWith(".youtube.com");
};
local_0_3 = YTCoreLogger.getInstance("HttpDownloader");
local_0_2 = ["cookie", "authorization"];
local_0_4 = class panda_jmp0_reserved_anonymous_0 {
  constructor() {
    this.interceptorType = http.InterceptorType.REDIRECTION;
  }
  interceptorHandle(p0, p1) {
    let local_1_0, local_1_1, local_1_2;
    if (local_0_1(p0.url)) {
      return Promise.resolve(true);
    }
    local_1_2 = p0.header;
    if (!local_1_2 /*header*/) {
      return Promise.resolve(true);
    }
    local_1_0 = [];
    local_1_1 = {};
    Object.keys(local_1_2 /*header*/).forEach(function (p0) {
      if (local_0_2 /*REDIRECT_STRIP_HEADERS*/.indexOf(p0.toLowerCase()) >= 0) {
        local_1_0 /*stripped*/.push(p0);
      } else {
        local_1_1 /*kept*/[p0] = local_1_2 /*header*/[p0];
      }
    });
    if (local_1_0 /*stripped*/.length > 0) {
      p0.header = local_1_1 /*kept*/;
      local_0_3 /*logger*/.warn("Redirect to non-YouTube host=" + (local_0_0(p0.url) || "(invalid-url)") + " stripped=[" + local_1_0 /*stripped*/.join(",") + "]");
    }
    return Promise.resolve(true);
  }
};
local_0_5 = class panda_jmp0_reserved_anonymous_1 {
  constructor(p0) {
    this.interceptorType = http.InterceptorType.FINAL_RESPONSE;
    this.hook = p0;
  }
  interceptorHandle(p0, p1) {
    this.hook(p1);
    return Promise.resolve(true);
  }
};
let local_1_0;
{
  acc = class panda_jmp0_reserved_anonymous_2 extends Error {
    constructor(p0, p1, p2, p3, p4, p5, p6) {
      let v2, v10;
      v2 = super(p0);
      v2.name = "HttpError";
      v2.url = p1;
      v2.method = p2;
      v2.responseCode = p3;
      v2.httpStatusMessage = p4;
      v2.responseBody = p5;
      v2.networkErrorCode = p6;
      v10 = v2.analyzeErrorType(p3);
      v2.errorType = v10.errorType;
      v2.isRecoverable = v10.isRecoverable;
      v2.isHostUnreachable = local_1_0 /*HttpError*/.classifyHostUnreachable(p3, p6, p0);
      return v2;
    }
    analyzeErrorType(p0) {
      if (!p0) {
        return {
          "errorType": HttpErrorType.NETWORK_ERROR,
          "isRecoverable": true
        };
      }
      if (p0 >= 100 && p0 < 200) {
        return {
          "errorType": HttpErrorType.INFORMATIONAL,
          "isRecoverable": false
        };
      }
      if (p0 >= 400 && p0 < 500) if (p0 === 400) {
        return {
          "errorType": HttpErrorType.BAD_REQUEST,
          "isRecoverable": false
        };
      } else if (p0 === 401 || p0 === 403) {
        return {
          "errorType": HttpErrorType.FORBIDDEN,
          "isRecoverable": false
        };
      } else if (p0 === 404) {
        return {
          "errorType": HttpErrorType.NOT_FOUND,
          "isRecoverable": false
        };
      } else if (p0 === 407) {
        return {
          "errorType": HttpErrorType.PROXY_AUTH_REQUIRED,
          "isRecoverable": false
        };
      } else if (p0 === 408) {
        return {
          "errorType": HttpErrorType.TIMEOUT,
          "isRecoverable": true
        };
      } else if (p0 === 416) {
        return {
          "errorType": HttpErrorType.RANGE_NOT_SATISFIABLE,
          "isRecoverable": false
        };
      } else if (p0 === 429) {
        return {
          "errorType": HttpErrorType.TOO_MANY_REQUESTS,
          "isRecoverable": true
        };
      } else {
        return {
          "errorType": HttpErrorType.CLIENT_ERROR,
          "isRecoverable": false
        };
      }
      if (p0 < 500 || p0 >= 600) {
        return {
          "errorType": HttpErrorType.UNKNOWN,
          "isRecoverable": false
        };
      }
      if (p0 === 500) {
        return {
          "errorType": HttpErrorType.SERVER_ERROR,
          "isRecoverable": true
        };
      }
      if (p0 !== 502 && (p0 !== 503) && p0 !== 504) {
        return {
          "errorType": HttpErrorType.SERVER_ERROR,
          "isRecoverable": true
        };
      }
      return {
        "errorType": HttpErrorType.SERVICE_UNAVAILABLE,
        "isRecoverable": true
      };
    }
    getFriendlyMessage() {
      let v6;
      v6 = {};
      v6[HttpErrorType.NETWORK_ERROR] = "Network connection failed, please check your network settings";
      v6[HttpErrorType.INFORMATIONAL] = "Server response abnormal";
      v6[HttpErrorType.BAD_REQUEST] = "Bad request format";
      v6[HttpErrorType.FORBIDDEN] = "Access denied (403), IP may be blocked or link expired";
      v6[HttpErrorType.NOT_FOUND] = "Resource not found (404)";
      v6[HttpErrorType.PROXY_AUTH_REQUIRED] = "Proxy authentication failed (407), please check the proxy username and password";
      v6[HttpErrorType.TIMEOUT] = "Request timeout (408)";
      v6[HttpErrorType.RANGE_NOT_SATISFIABLE] = "Invalid request range (416)";
      v6[HttpErrorType.TOO_MANY_REQUESTS] = "Too many requests, please try again later (429)";
      v6[HttpErrorType.CLIENT_ERROR] = "Client error";
      v6[HttpErrorType.SERVER_ERROR] = "Server error, please try again later";
      v6[HttpErrorType.SERVICE_UNAVAILABLE] = "Service temporarily unavailable, please try again later";
      v6[HttpErrorType.UNKNOWN] = "An unknown error occurred";
      return "" + (v6[this.errorType] || "An error occurred") + " [" + this.method + " " + this.url + "] (" + this.responseCode + ")";
    }
    static classifyHostUnreachable(p0, p1, p2) {
      let v14;
      if (p0) {
        return false;
      }
      switch (p1) {
        case 2300006:
        case 2300007:
          return true;
        case 2300005:
          return false;
      }
      v14 = (p2 || "").toLowerCase();
      return v14.includes.call(v14, "couldn't resolve host")
        || v14.includes("could not resolve host")
        || v14.includes("unknownhost")
        || v14.includes("no route to host")
        || v14.includes("couldn't connect to server")
        || v14.includes("could not connect to server");
    }
  };
  local_1_0 = acc;
  HttpError = acc;
  HttpAbortToken = class panda_jmp0_reserved_anonymous_3 {
    constructor() {
      this.aborted = false;
    }
    abort() {
      this.aborted = true;
      try {
        if (this.request !== null && this.request !== undefined) {
          this.request.destroy();
        }
      } catch (catchAcc) {}
    }
  };
  HttpErrorType = {
    NETWORK_ERROR: "NETWORK_ERROR",
    INFORMATIONAL: "INFORMATIONAL",
    BAD_REQUEST: "BAD_REQUEST",
    FORBIDDEN: "FORBIDDEN",
    NOT_FOUND: "NOT_FOUND",
    PROXY_AUTH_REQUIRED: "PROXY_AUTH_REQUIRED",
    TIMEOUT: "TIMEOUT",
    RANGE_NOT_SATISFIABLE: "RANGE_NOT_SATISFIABLE",
    TOO_MANY_REQUESTS: "TOO_MANY_REQUESTS",
    CLIENT_ERROR: "CLIENT_ERROR",
    SERVER_ERROR: "SERVER_ERROR",
    SERVICE_UNAVAILABLE: "SERVICE_UNAVAILABLE",
    UNKNOWN: "UNKNOWN"
  };
  Request = class panda_jmp0_reserved_anonymous_4 {
    constructor(p0, p1, p2, p3, p4) {
      this.method = p0;
      this.url = p1;
      this.headers = p2;
      this.data = p3;
      this.localization = p4;
    }
  };
  let local_1_2_0;
  local_1_2_0 = class panda_jmp0_reserved_anonymous_5 {
    constructor() {}
    async request(p0, p1, p2, p3, p4, p5, p6) {
      let v8, v9, v10, v11, v12, v13, v14, v16, v17, v19, v21, acc;
      let local_2_0;
      local_2_0 = p1;
      v8 = p5 === undefined || p5;
      v9 = p6 === undefined ? 30000 : p6;
      v11 = null;
      v10 = 0;
      v12 = v8 ? local_1_2_0 /*HttpDownloader*/.MAX_RETRIES : 1;
      while (v10 < v12) {
        let local_3_0, local_3_1;
        v10 += 1;
        v14 = null;
        try {
          try {
            local_0_3 /*logger*/.debug("" + p0 + " " + local_2_0 + " (attempt " + v10 + "/" + v12 + ")");
            v17 = this.processHeaders(p2, p4);
            v17["Accept-Encoding"] = "identity";
            local_3_0 = http.createHttp();
            v14 = local_3_0 /*request*/;
            v16 = false;
            try {
              v19 = new http.HttpInterceptorChain();
              v19.addChain([new local_0_4 /*RedirectAuthStripInterceptor*/(), new local_0_5 /*FinalResponseHookInterceptor*/(function (p0) {
                local_1_2_0 /*HttpDownloader*/.notifySetCookie(p0, local_2_0);
              })]);
              v16 = v19.apply(local_3_0 /*request*/);
              if (!v16) {
                local_0_3 /*logger*/.error("interceptor chain apply returned false; falling back to manual Set-Cookie notify");
              }
            } catch (catchAcc) {
              local_0_3 /*logger*/.error("interceptor chain setup failed; falling back to manual Set-Cookie notify");
            }
            local_3_1 = {
              "method": p0,
              "header": v17,
              "extraData": p3,
              "connectTimeout": v9,
              "readTimeout": v9,
              "usingCache": false
            };
            local_1_2_0 /*HttpDownloader*/.applyConnectionPoolReuse(local_3_1 /*httpOptions*/);
            local_1_2_0 /*HttpDownloader*/.applyProxyToOptions(local_3_1 /*httpOptions*/, local_2_0);
            acc = new Promise(function (p0, p1) {
              let local_4_0, local_4_1;
              local_4_0 = p0;
              local_4_1 = p1;
              local_3_0 /*request*/.request(local_2_0, local_3_1 /*httpOptions*/, function (p0, p1) {
                if (!p0) {
                  local_0_3 /*logger*/.debug("Response code: " + p1.responseCode + "");
                  local_4_0(p1);
                } else {
                  local_0_3 /*logger*/.error("Request error: " + JSON.stringify(p0) + "");
                  local_4_1(p0);
                }
              });
            });
            v13 = await acc;
            if (!v16) {
              local_1_2_0 /*HttpDownloader*/.notifySetCookie(v13, local_2_0);
            }
            if (v13.responseCode && v13.responseCode >= 400) {
              acc = typeof v13.result === "string" ? v13.result : JSON.stringify(v13.result);
              v21 = v13.responseCode === 400 ? "Bad Request" : v13.responseCode === 401 ? "Unauthorized" : v13.responseCode === 403 ? "Forbidden" : v13.responseCode === 404 ? "Not Found" : v13.responseCode === 407 ? "Proxy Authentication Required (proxy authentication failed)" : v13.responseCode === 408 ? "Request Timeout" : v13.responseCode === 416 ? "Range Not Satisfiable" : v13.responseCode === 429 ? "Too Many Requests" : v13.responseCode === 500 ? "Internal Server Error" : v13.responseCode === 502 ? "Bad Gateway" : v13.responseCode === 503 ? "Service Unavailable" : v13.responseCode === 504 ? "Gateway Timeout" : "HTTP " + v13.responseCode + "";
              v19 = new HttpError("HTTP " + v13.responseCode + ": " + v21 + "", local_2_0, p0, v13.responseCode, v21, acc);
              local_0_3 /*logger*/.error("HTTP error: " + v19.getFriendlyMessage() + "");
              if (v19.isRecoverable && v10 < v12) {
                local_0_3 /*logger*/.debug("Retrying in " + local_1_2_0 /*HttpDownloader*/.RETRY_DELAY + "ms...");
                await this.sleep(local_1_2_0 /*HttpDownloader*/.RETRY_DELAY * v10);
                if (local_3_0 /*request*/) {
                  try {
                    local_3_0 /*request*/.destroy();
                  } catch (catchAcc) {}
                }
                continue;
              }
              throw v19;
            }
            local_0_3 /*logger*/.debug("Success: " + p0 + " " + local_2_0 + "");
            if (local_3_0 /*request*/) {
              try {
                local_3_0 /*request*/.destroy();
              } catch (catchAcc) {}
            }
            return v13;
          } finally {
            if (v14) {
              try {
                v14.destroy();
              } catch (catchAcc) {}
            }
          }
        } catch (catchAcc) {
          if (catchAcc instanceof HttpError) {
            throw catchAcc;
          }
          v11 = local_1_2_0 /*HttpDownloader*/.fromNetworkError(catchAcc, local_2_0, p0);
          if (v11.isRecoverable && v10 < v12) {
            local_0_3 /*logger*/.debug("Retrying network error in " + local_1_2_0 /*HttpDownloader*/.RETRY_DELAY + "ms...");
            await this.sleep(local_1_2_0 /*HttpDownloader*/.RETRY_DELAY * v10);
            continue;
          }
          throw v11;
        }
      }
      acc = v11 || new HttpError("Unknown error", local_2_0, p0);
      throw acc;
    }
    sleep(p0) {
      let local_2_0;
      local_2_0 = p0;
      return new Promise(function (p0) {
        return setTimeout(p0, local_2_0);
      });
    }
    processHeaders(p0, p1) {
      let v7, v8;
      let local_2_0, local_2_1;
      local_2_0 = p0;
      local_2_1 = {
        "Content-Type": "application/json"
      };
      if (p1) {
        v8 = p1.getLanguageCode();
        v7 = p1.getCountryCode();
        local_2_1 /*headers*/["Accept-Language"] = v7 ? "" + v8 + "-" + v7 + "," + v8 + ";q=0.9" : v8;
      }
      if (local_2_0) {
        Object.keys(local_2_0).forEach(function (p0) {
          let acc;
          if (Array.isArray(local_2_0[p0])) {
            acc = local_2_0[p0].filter(function (p0) {
              return typeof p0 === "string" && p0.trim() !== "";
            });
            if (acc.length > 0) {
              local_2_1 /*headers*/[p0] = acc.join(",");
            }
          } else if (typeof local_2_0[p0] === "string" && local_2_0[p0].trim() !== "") {
            local_2_1 /*headers*/[p0] = local_2_0[p0];
          }
        });
      }
      return local_2_1 /*headers*/;
    }
    post(p0, p1, p2, p3, p4, p5) {
      let v8, acc;
      v8 = p5 === undefined ? 30000 : p5;
      acc = p2 || {};
      if (p4) {
        acc["Content-Type"] = [p4];
      }
      return this.request("POST", p0, acc, p1, p3, true, v8);
    }
    async postBinary(p0, p1, p2, p3, p4, p5, p6) {
      return this.postBinaryWithRetry(p0, p1, p2, p3, p4 === undefined || p4, p5, p6, undefined, true);
    }
    async postBinaryStreaming(p0, p1, p2, p3, p4, p5, p6, p7) {
      return this.postBinaryWithRetry(p0, p1, p2, p3, p4 === undefined || p4, p6, p7, p5, false);
    }
    async postBinaryWithRetry(p0, p1, p2, p3, p4, p5, p6, p7, p8) {
      let v12, v13, v14, v16, v17, v18, v19, v20, v22, acc;
      v13 = null;
      v12 = 0;
      while (true) {
        if (v12 >= (p4 ? local_1_2_0 /*HttpDownloader*/.MAX_RETRIES : 1)) break;
        v12 += 1;
        if (p6?.aborted) {
          throw new HttpError("request aborted", p0, "POST");
        }
        try {
          local_0_3 /*logger*/.debug("POST-BIN-STREAM " + p0 + " (attempt " + v12 + "/" + local_1_2_0 /*HttpDownloader*/.MAX_RETRIES + ") bytes=" + p1.length + "");
          v14 = await this.postBinaryStreamOnce(p0, p1, p2, p3, p5, p6, p7, p8);
          if (!v14.responseCode || v14.responseCode < 400) {
            return v14;
          }
          v16 = "";
          try {
            if (v14.result instanceof ArrayBuffer) {
              v20 = new Uint8Array(v14.result);
              v18 = Math.min(v20.length, 200);
              v19 = "";
              for (v22 = 0; v22 < v18; v22 += 1) {
                v19 += String.fromCharCode(v20[v22]);
              }
              v16 = v19;
            }
          } catch (catchAcc) {
            v16 = "";
          }
          local_0_3 /*logger*/.error("POST-BIN-STREAM HTTP " + v14.responseCode + " bodySnippet=" + v16 + "");
          v17 = new HttpError("HTTP " + v14.responseCode + "", p0, "POST", v14.responseCode, "HTTP " + v14.responseCode + "", v16);
          if (v14.responseCode === 403) {
            throw v17;
          }
          if (!v17.isRecoverable || v12 >= local_1_2_0 /*HttpDownloader*/.MAX_RETRIES) {
            throw v17;
          }
          if (p6?.aborted) {
            throw new HttpError("request aborted", p0, "POST");
          }
          await this.sleep(local_1_2_0 /*HttpDownloader*/.RETRY_DELAY * v12);
        } catch (catchAcc) {
          if (catchAcc instanceof HttpError) {
            v13 = catchAcc;
            if (catchAcc.responseCode === 403) {
              throw catchAcc;
            }
            if (catchAcc.isRecoverable && v12 < local_1_2_0 /*HttpDownloader*/.MAX_RETRIES) {
              if (p6?.aborted) {
                throw new HttpError("request aborted", p0, "POST");
              }
              await this.sleep(local_1_2_0 /*HttpDownloader*/.RETRY_DELAY * v12);
              continue;
            }
            throw catchAcc;
          }
          v13 = local_1_2_0 /*HttpDownloader*/.fromNetworkError(catchAcc, p0, "POST");
          if (v13.isRecoverable && v12 < local_1_2_0 /*HttpDownloader*/.MAX_RETRIES) {
            if (p6?.aborted) {
              throw new HttpError("request aborted", p0, "POST");
            }
            await this.sleep(local_1_2_0 /*HttpDownloader*/.RETRY_DELAY * v12);
            continue;
          }
          throw v13;
        }
      }
      acc = v13 || new HttpError("Unknown error", p0, "POST");
      throw acc;
    }
    postBinaryStreamOnce(p0, p1, p2, p3, p4, p5, p6, p7) {
      let v11, v12, acc;
      let local_2_0, local_2_1, local_2_2, local_2_3, local_2_4, local_2_5, local_2_6;
      local_2_3 = p0;
      local_2_5 = p4;
      local_2_0 = p5;
      local_2_4 = p6;
      local_2_2 = p7;
      if (local_2_2 === undefined) {
        local_2_2 = true;
      }
      v12 = this.processBinaryHeaders(p2, p3);
      local_2_1 = http.createHttp();
      v11 = new ArrayBuffer(p1.length);
      new Uint8Array(v11).set(p1);
      local_2_6 = {
        "method": http.RequestMethod.POST,
        "header": v12,
        "extraData": v11,
        "connectTimeout": 30000,
        "readTimeout": 60000,
        "usingCache": false
      };
      local_1_2_0 /*HttpDownloader*/.applyConnectionPoolReuse(local_2_6 /*httpOptions*/);
      local_1_2_0 /*HttpDownloader*/.applyProxyToOptions(local_2_6 /*httpOptions*/, local_2_3);
      acc = new Promise(function (p0, p1) {
        let acc;
        let local_3_0, local_3_1, local_3_2, local_3_3, local_3_4, local_3_5, local_3_6, local_3_7, local_3_8, local_3_9, local_3_10, local_3_11, local_3_12, local_3_13, local_3_14;
        local_3_10 = p0;
        local_3_11 = p1;
        local_3_6 = [];
        local_3_5 = 0;
        local_3_8 = 0;
        local_3_9 = new Object();
        local_3_3 = false;
        local_3_4 = false;
        local_3_2 = false;
        local_3_14 = 60000 + 5000;
        local_3_0 = -1;
        local_3_1 = function () {
          if (local_3_0 /*watchdogTimer*/ >= 0) {
            clearTimeout(local_3_0 /*watchdogTimer*/);
            local_3_0 = -1;
          }
        };
        local_3_7 = function () {
          local_3_1 /*clearWatchdog*/();
          if (local_2_0 && local_2_0.request === local_2_1 /*httpRequest*/) {
            local_2_0.request = undefined;
          }
          try {
            local_2_1 /*httpRequest*/.off("headersReceive");
            local_2_1 /*httpRequest*/.off("dataReceive");
            local_2_1 /*httpRequest*/.off("dataEnd");
          } catch (catchAcc) {}
          try {
            local_2_1 /*httpRequest*/.destroy();
          } catch (catchAcc) {}
        };
        local_3_13 = function () {
          let v3, v4, v6, v7, v9, v10;
          if (!local_3_2 /*settled*/ && local_3_3 /*requestReturned*/) {
            if (!local_3_4 /*streamEnded*/) {
              return;
            }
            local_3_2 = true;
            v4 = new ArrayBuffer(0);
            if (local_2_2) {
              v4 = new ArrayBuffer(local_3_5 /*totalBytes*/);
              v7 = new Uint8Array(v4);
              v6 = 0;
              for (v9 = 0; v9 < local_3_6 /*chunks*/.length; v9 += 1) {
                v10 = new Uint8Array(local_3_6 /*chunks*/[v9]);
                v7.set(v10, v6);
                v6 += v10.length;
              }
            }
            local_3_7 /*cleanup*/();
            local_0_3 /*logger*/.debug("POST-BIN-STREAM complete status=" + local_3_8 /*responseCode*/ + " bytes=" + local_3_5 /*totalBytes*/ + " " + ("accumulated=" + local_2_2 + ""));
            v3 = {
              "result": v4,
              "responseCode": local_3_8 /*responseCode*/,
              "header": local_3_9 /*responseHeader*/,
              "cookies": "",
              "resultType": http.HttpDataType.ARRAY_BUFFER
            };
            local_1_2_0 /*HttpDownloader*/.notifySetCookie(v3, local_2_3);
            local_3_10(v3);
          }
          return;
        };
        local_3_12 = function (p0) {
          if (local_3_2 /*settled*/) {
            return;
          }
          local_3_2 = true;
          local_3_7 /*cleanup*/();
          local_3_11(p0);
          return;
        };
        local_2_1 /*httpRequest*/.on("headersReceive", function (p0) {
          local_3_9 = p0;
        });
        local_2_1 /*httpRequest*/.on("dataReceive", function (p0) {
          let v5, v6, acc;
          if (local_3_2 /*settled*/) {
            return;
          }
          if (p0 && (acc = !(p0.byteLength > 0), p0.byteLength > 0)) {
            v6 = new ArrayBuffer(p0.byteLength);
            v5 = new Uint8Array(v6);
            v5.set(new Uint8Array(p0));
            if (local_2_2) {
              local_3_6 /*chunks*/.push(v6);
            } else {
              try {
                if (local_2_4 != null) {
                  local_2_4(v5);
                }
              } catch (catchAcc) {
                acc = catchAcc instanceof Error ? catchAcc.message : String(catchAcc);
                local_0_3 /*logger*/.error("POST-BIN-STREAM chunk consumer failed: " + acc + "");
                local_3_12 /*finishErr*/(new HttpError("chunk consumer failed: " + acc + "", local_2_3, "POST"));
              }
            }
            if (local_2_5 != null) {
              local_2_5(p0.byteLength);
            }
          }
          return;
        });
        local_2_1 /*httpRequest*/.on("dataEnd", function () {
          local_3_4 = true;
          local_3_13 /*finishOk*/();
        });
        if (local_2_0 && (local_2_0.request = local_2_1 /*httpRequest*/, local_2_0.aborted)) {
          local_3_12 /*finishErr*/(new HttpError("request aborted", local_2_3, "POST"));
          return;
        }
        local_3_0 = setTimeout(function () {
          local_3_0 = -1;
          local_0_3 /*logger*/.warn("POST-BIN-STREAM stalled: no dataEnd within " + local_3_14 /*watchdogMs*/ + "ms, aborting request");
          local_3_12 /*finishErr*/(new HttpError("stream stalled: no dataEnd", local_2_3, "POST"));
        }, local_3_14 /*watchdogMs*/);
        acc = local_2_1 /*httpRequest*/.requestInStream(local_2_3, local_2_6 /*httpOptions*/).then(function (p0) {
          local_3_8 = p0 || 0;
          local_3_3 = true;
          local_3_13 /*finishOk*/();
        });
        acc.catch(function (p0) {
          local_3_12 /*finishErr*/(p0);
        });
        return;
      });
      return acc;
    }
    processBinaryHeaders(p0, p1) {
      let v6, v7;
      let local_2_0, local_2_1;
      local_2_0 = p0;
      local_2_1 = {};
      if (p1) {
        v7 = p1.getLanguageCode();
        v6 = p1.getCountryCode();
        local_2_1 /*headers*/["Accept-Language"] = v6 ? "" + v7 + "-" + v6 + "," + v7 + ";q=0.9" : v7;
      }
      if (local_2_0) {
        Object.keys(local_2_0).forEach(function (p0) {
          let acc;
          if (Array.isArray(local_2_0[p0])) {
            acc = local_2_0[p0].filter(function (p0) {
              return typeof p0 === "string" && p0.trim() !== "";
            });
            if (acc.length > 0) {
              local_2_1 /*headers*/[p0] = acc.join(",");
            }
          } else if (typeof local_2_0[p0] === "string" && local_2_0[p0].trim() !== "") {
            local_2_1 /*headers*/[p0] = local_2_0[p0];
          }
        });
      }
      return local_2_1 /*headers*/;
    }
    head(p0, p1) {
      return this.request("HEAD", p0, p1);
    }
    postJson(p0, p1, p2, p3) {
      return this.post(p0, p1, p2, p3, "application/json");
    }
    static setSetCookieObserver(p0) {
      local_1_2_0 /*HttpDownloader*/.setCookieObserver = p0;
    }
    static fromNetworkError(p0, p1, p2) {
      let acc;
      acc = p0.message || "Network error";
      return acc.includes("407") ? new HttpError(acc, p1, p2, 407) : new HttpError(acc, p1, p2, undefined, undefined, undefined, p0.code);
    }
    static notifySetCookie(p0, p1) {
      let v7;
      if (local_1_2_0 /*HttpDownloader*/.setCookieObserver && p0) {
        if (!p0.header) {
          return;
        }
        v7 = !p0.header["Set-Cookie"] ? p0.header["set-cookie"] : p0.header["Set-Cookie"];
        if (!v7) {
          return;
        }
        try {
          if (Array.isArray(v7)) {
            local_1_2_0 /*HttpDownloader*/.setCookieObserver(v7, p1);
          } else if (typeof v7 === "string") {
            local_1_2_0 /*HttpDownloader*/.setCookieObserver(v7, p1);
          }
        } catch (catchAcc) {
          local_0_3 /*logger*/.error("Set-Cookie observer threw");
        }
      }
      return;
    }
    static applyProxyToOptions(p0, p1) {
      let v5, v7, v8;
      v5 = HttpProxyOptions.getSnapshot();
      if (!HttpProxyOptions.isActive(v5) || HttpProxyOptions.shouldBypass(p1, v5)) {
        p0.usingProxy = false;
        return;
      }
      if (v5.kind === "http") {
        v8 = {
          "host": v5.host.trim(),
          "port": v5.port,
          "exclusionList": v5.exclusionList && v5.exclusionList.length > 0 ? v5.exclusionList : HttpProxyOptions.defaultExclusions()
        };
        if (v5.username && v5.username.length > 0) {
          v8.username = v5.username;
          v8.password = v5.password || "";
        }
        p0.usingProxy = v8;
        return;
      }
      if (v5.kind === "socks5") {
        if (deviceInfo.sdkApiVersion >= 26) {
          v7 = {
            "host": v5.host.trim(),
            "port": v5.port,
            "dnsStrategy": 1,
            "exclusionList": HttpProxyOptions.defaultExclusions()
          };
          if (v5.username && v5.username.length > 0) {
            v7.username = v5.username;
            v7.password = v5.password || "";
          }
          p0.usingSocks5Proxy = v7;
        } else if (v5.socks5LocalPort && v5.socks5LocalPort > 0) {
          p0.usingProxy = {
            "host": "127.0.0.1",
            "port": v5.socks5LocalPort,
            "exclusionList": []
          };
        } else {
          p0.usingProxy = false;
        }
        return;
      }
      p0.usingProxy = false;
      return;
    }
    static applyConnectionPoolReuse(p0) {
      if (deviceInfo.sdkApiVersion < 26) {
        return;
      }
      p0.reuseConnections = true;
      p0.inactivityMs = 30000;
      return;
    }
  };
  (function () {
    this.MAX_RETRIES = 3;
    this.RETRY_DELAY = 1000;
    this.setCookieObserver = undefined;
  }).call(local_1_2_0);
  HttpDownloader = local_1_2_0;
}
export { HttpAbortToken };
export { HttpDownloader };
export { HttpError };
export { HttpErrorType };
export { Request };