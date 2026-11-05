/**
 * NAPI value conversion helpers (see napi_utils.h).
 * @Author: jmp0
 */
#include "napi/napi_utils.h"

#include "common/mini_json.h"

namespace xpanda {

/** Call global JSON.<method>(input) — used to (de)serialize messages without extra deps. */
static bool callJsonMethod(napi_env env, const char* method, napi_value input, napi_value* out) {
    napi_value global = nullptr;
    napi_value json = nullptr;
    napi_value fn = nullptr;
    if (napi_get_global(env, &global) != napi_ok) return false;
    if (napi_get_named_property(env, global, "JSON", &json) != napi_ok) return false;
    if (napi_get_named_property(env, json, method, &fn) != napi_ok) return false;
    return napi_call_function(env, global, fn, 1, &input, out) == napi_ok;
}

std::string napiValueToText(napi_env env, napi_value value) {
    size_t size = 0;
    if (napi_get_value_string_utf8(env, value, nullptr, 0, &size) != napi_ok) return "";
    std::string out(size, '\0');
    size_t copied = 0;
    if (napi_get_value_string_utf8(env, value, out.data(), out.size() + 1, &copied) != napi_ok) return "";
    out.resize(copied);
    return out;
}

bool napiValueToJson(napi_env env, napi_value value, std::string* out) {
    napi_value json = nullptr;
    if (callJsonMethod(env, "stringify", value, &json) && json != nullptr) {
        napi_valuetype type = napi_undefined;
        if (napi_typeof(env, json, &type) == napi_ok && type == napi_string) {
            *out = napiValueToText(env, json);
            return true;
        }
    }
    // undefined / function / circular structure: render as a JSON string
    napi_value text = nullptr;
    if (napi_coerce_to_string(env, value, &text) == napi_ok && text != nullptr) {
        *out = MiniJson::escape(napiValueToText(env, text));
        return true;
    }
    *out = "null";
    return false;
}

napi_value napiValueFromJson(napi_env env, const std::string& json) {
    napi_value jsonText = nullptr;
    napi_value parsed = nullptr;
    if (napi_create_string_utf8(env, json.data(), json.size(), &jsonText) == napi_ok
        && callJsonMethod(env, "parse", jsonText, &parsed)) {
        return parsed;
    }
    return nullptr;
}

} // namespace xpanda
