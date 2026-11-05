/**
 * Host ArkTS globalThis snapshot.
 *
 * The host ArkTS runtime and the gadget JSVM are separate runtimes, so global
 * values cannot be shared directly. This file enumerates the host globalThis in
 * a NAPI callback and serializes it into a JSVM-friendly snapshot: property
 * names, kinds and primitive values. The JS assembly in host_bridge.cpp turns
 * that snapshot into `ArkTS.hostGlobal`.
 * @Author: jmp0
 */
#include "js/module/host_global.h"

#include <algorithm>
#include <map>
#include <string>
#include <vector>

#include "common/log.h"
#include "js/module/bridge_utils.h"
#include "napi/napi_utils.h"

namespace xpanda {

namespace {

struct PrimitiveValue {
    enum class Kind { STRING, NUMBER, BOOLEAN, NULL_VALUE, UNDEFINED, BIGINT } kind = Kind::UNDEFINED;
    std::string text;
    double number = 0;
    bool boolean = false;
};

struct GlobalSnapshot {
    std::vector<std::string> keys;
    std::vector<std::string> classes;
    std::vector<std::string> functions;
    std::vector<std::string> objects;
    std::map<std::string, std::string> kinds;
    std::map<std::string, PrimitiveValue> primitives;
};

GlobalSnapshot g_snapshot;

JSVM_Value createStringArray(JSVM_Env env, const std::vector<std::string>& values) {
    JSVM_Value array = nullptr;
    if (OH_JSVM_CreateArrayWithLength(env, values.size(), &array) != JSVM_OK || array == nullptr) return nullptr;
    for (size_t i = 0; i < values.size(); i++) {
        JSVM_Value item = createString(env, values[i]);
        if (item == nullptr) return nullptr;
        if (OH_JSVM_SetElement(env, array, static_cast<uint32_t>(i), item) != JSVM_OK) return nullptr;
    }
    return array;
}

JSVM_Value createPrimitive(JSVM_Env env, const PrimitiveValue& value) {
    JSVM_Value out = nullptr;
    switch (value.kind) {
        case PrimitiveValue::Kind::STRING:
            return createString(env, value.text);
        case PrimitiveValue::Kind::NUMBER:
            OH_JSVM_CreateDouble(env, value.number, &out);
            return out;
        case PrimitiveValue::Kind::BOOLEAN:
            OH_JSVM_GetBoolean(env, value.boolean, &out);
            return out;
        case PrimitiveValue::Kind::NULL_VALUE:
            OH_JSVM_GetNull(env, &out);
            return out;
        case PrimitiveValue::Kind::BIGINT:
            // JSVM has no direct int64 BigInt creation in this API set; expose text.
            return createString(env, value.text);
        case PrimitiveValue::Kind::UNDEFINED:
        default:
            OH_JSVM_GetUndefined(env, &out);
            return out;
    }
}

JSVM_Value createPrimitiveMap(JSVM_Env env) {
    JSVM_Value object = nullptr;
    if (OH_JSVM_CreateObject(env, &object) != JSVM_OK || object == nullptr) return nullptr;
    for (const auto& entry : g_snapshot.primitives) {
        JSVM_Value value = createPrimitive(env, entry.second);
        if (value == nullptr || !setNamed(env, object, entry.first.c_str(), value)) return nullptr;
    }
    return object;
}

JSVM_Value createKindMap(JSVM_Env env) {
    JSVM_Value object = nullptr;
    if (OH_JSVM_CreateObject(env, &object) != JSVM_OK || object == nullptr) return nullptr;
    for (const auto& entry : g_snapshot.kinds) {
        JSVM_Value value = createString(env, entry.second);
        if (value == nullptr || !setNamed(env, object, entry.first.c_str(), value)) return nullptr;
    }
    return object;
}

} // namespace

void captureHostGlobalSnapshot(napi_env env) {
    g_snapshot = GlobalSnapshot{};
    if (env == nullptr) return;
    napi_value global = nullptr;
    if (napi_get_global(env, &global) != napi_ok || global == nullptr) return;

    napi_value names = nullptr;
    napi_status status = napi_get_all_property_names(
        env, global, napi_key_own_only,
        static_cast<napi_key_filter>(napi_key_all_properties | napi_key_skip_symbols),
        napi_key_numbers_to_strings, &names);
    if (status != napi_ok || names == nullptr) {
        GADGET_LOG_ERROR("host bridge: global enumeration failed (%{public}d)", static_cast<int>(status));
        return;
    }

    uint32_t length = 0;
    napi_get_array_length(env, names, &length);
    for (uint32_t i = 0; i < length; i++) {
        napi_value key = nullptr;
        napi_value value = nullptr;
        if (napi_get_element(env, names, i, &key) != napi_ok) continue;
        if (napi_get_property(env, global, key, &value) != napi_ok) continue;
        const std::string name = napiValueToText(env, key);
        if (name.empty()) continue;

        napi_valuetype type = napi_undefined;
        napi_typeof(env, value, &type);
        std::string kind;
        PrimitiveValue primitive;
        bool hasPrimitive = false;

        if (type == napi_function) {
            napi_value prototype = nullptr;
            napi_valuetype prototypeType = napi_undefined;
            if (napi_get_named_property(env, value, "prototype", &prototype) == napi_ok) {
                napi_typeof(env, prototype, &prototypeType);
            }
            if (prototypeType == napi_object) {
                kind = "class";
                g_snapshot.classes.push_back(name);
            } else {
                kind = "function";
                g_snapshot.functions.push_back(name);
            }
        } else if (type == napi_object) {
            kind = "object";
            g_snapshot.objects.push_back(name);
        } else if (type == napi_string) {
            kind = "string";
            primitive.kind = PrimitiveValue::Kind::STRING;
            primitive.text = napiValueToText(env, value);
            hasPrimitive = true;
        } else if (type == napi_number) {
            kind = "number";
            primitive.kind = PrimitiveValue::Kind::NUMBER;
            napi_get_value_double(env, value, &primitive.number);
            hasPrimitive = true;
        } else if (type == napi_boolean) {
            kind = "boolean";
            primitive.kind = PrimitiveValue::Kind::BOOLEAN;
            napi_get_value_bool(env, value, &primitive.boolean);
            hasPrimitive = true;
        } else if (type == napi_null) {
            kind = "null";
            primitive.kind = PrimitiveValue::Kind::NULL_VALUE;
            hasPrimitive = true;
        } else if (type == napi_undefined) {
            kind = "undefined";
            primitive.kind = PrimitiveValue::Kind::UNDEFINED;
            hasPrimitive = true;
        } else if (type == napi_bigint) {
            kind = "bigint";
            primitive.kind = PrimitiveValue::Kind::BIGINT;
            napi_value text = nullptr;
            if (napi_coerce_to_string(env, value, &text) == napi_ok && text != nullptr) {
                primitive.text = napiValueToText(env, text);
            }
            hasPrimitive = true;
        } else if (type == napi_symbol) {
            kind = "symbol";
        } else {
            kind = "external";
        }

        g_snapshot.keys.push_back(name);
        g_snapshot.kinds[name] = kind;
        if (hasPrimitive) {
            g_snapshot.primitives[name] = primitive;
        }
    }

    std::sort(g_snapshot.keys.begin(), g_snapshot.keys.end());
    std::sort(g_snapshot.classes.begin(), g_snapshot.classes.end());
    std::sort(g_snapshot.functions.begin(), g_snapshot.functions.end());
    std::sort(g_snapshot.objects.begin(), g_snapshot.objects.end());
    GADGET_LOG_INFO("host bridge: captured %{public}d globals, %{public}d classes, %{public}d functions",
        static_cast<int>(g_snapshot.keys.size()), static_cast<int>(g_snapshot.classes.size()),
        static_cast<int>(g_snapshot.functions.size()));
}

bool installHostGlobalSnapshot(JSVM_Env env, JSVM_Value arkts) {
    JSVM_Value keys = createStringArray(env, g_snapshot.keys);
    JSVM_Value kinds = createKindMap(env);
    JSVM_Value primitives = createPrimitiveMap(env);
    if (keys == nullptr || kinds == nullptr || primitives == nullptr) return false;

    JSVM_Value snapshot = nullptr;
    if (OH_JSVM_CreateObject(env, &snapshot) != JSVM_OK || snapshot == nullptr) return false;
    if (!setNamed(env, snapshot, "__keys", keys) || !setNamed(env, snapshot, "__kinds", kinds)
        || !setNamed(env, snapshot, "__primitives", primitives)) {
        return false;
    }
    return setNamed(env, arkts, "__snapshot", snapshot);
}

} // namespace xpanda
