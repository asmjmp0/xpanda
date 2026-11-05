/**
 * Small JSVM helpers shared by the host bridge modules.
 * @Author: jmp0
 */
#ifndef XPANDA_GADGET_BRIDGE_UTILS_H
#define XPANDA_GADGET_BRIDGE_UTILS_H

#include <string>

#include "ark_runtime/jsvm.h"

namespace xpanda {

inline bool setNamed(JSVM_Env env, JSVM_Value object, const char* name, JSVM_Value value) {
    return OH_JSVM_SetNamedProperty(env, object, name, value) == JSVM_OK;
}

inline JSVM_Value createString(JSVM_Env env, const std::string& text) {
    JSVM_Value value = nullptr;
    if (OH_JSVM_CreateStringUtf8(env, text.data(), text.size(), &value) != JSVM_OK) return nullptr;
    return value;
}

} // namespace xpanda

#endif // XPANDA_GADGET_BRIDGE_UTILS_H
