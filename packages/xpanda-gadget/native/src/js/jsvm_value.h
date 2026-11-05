/**
 * JSVM value/exception conversion helpers.
 * @Author: jmp0
 */
#ifndef XPANDA_GADGET_JSVM_VALUE_H
#define XPANDA_GADGET_JSVM_VALUE_H

#include <string>

#include "ark_runtime/jsvm.h"

namespace xpanda {

/** Read a JSVM value as raw UTF-8 text (no JSON quoting). */
bool jsvmValueToText(JSVM_Env env, JSVM_Value value, std::string* out);

/** Stringify a JSVM value into valid JSON text (undefined/function/symbol → null). */
bool jsvmValueToJson(JSVM_Env env, JSVM_Value value, std::string* out);

/** Clear a pending JSVM exception and render it into `text`. */
void clearJsvmException(JSVM_Env env, std::string* text);

} // namespace xpanda

#endif // XPANDA_GADGET_JSVM_VALUE_H
