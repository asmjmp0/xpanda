/**
 * NAPI value conversion helpers (host ArkTS runtime).
 * @Author: jmp0
 */
#ifndef XPANDA_GADGET_NAPI_UTILS_H
#define XPANDA_GADGET_NAPI_UTILS_H

#include <string>

#include "napi/native_api.h"

namespace xpanda {

/** Read a NAPI string as UTF-8 text ("" for non-strings). */
std::string napiValueToText(napi_env env, napi_value value);

/** JSON-stringify a NAPI value; non-stringifyable values fall back to a JSON string. */
bool napiValueToJson(napi_env env, napi_value value, std::string* out);

/** Parse a JSON string into a NAPI value; nullptr when parsing fails. */
napi_value napiValueFromJson(napi_env env, const std::string& json);

} // namespace xpanda

#endif // XPANDA_GADGET_NAPI_UTILS_H
