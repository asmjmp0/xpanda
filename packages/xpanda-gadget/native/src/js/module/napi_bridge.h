/**
 * Host NAPI bridge: ArkTS.napi helpers and the host call proxy (see napi_bridge.cpp).
 * @Author: jmp0
 */
#ifndef XPANDA_GADGET_NAPI_BRIDGE_H
#define XPANDA_GADGET_NAPI_BRIDGE_H

#include <string>
#include <vector>

#include "ark_runtime/jsvm.h"
#include "napi/native_api.h"

namespace xpanda {

/** Install globalThis.ArkTS.napi on the host runtime and remember its env. */
void captureHostNapi(napi_env env);

/** Attach `__hostInvoke` / `__loadModule` / `__loadModuleWithInfo` to ArkTS. */
bool installNapiBridge(JSVM_Env env, JSVM_Value arkts);

/** Release host module references created by ArkTS.napi.loadModule(). */
void releaseHostModules();

/** Host NAPI env captured by captureHostNapi() (nullptr before start()). */
napi_env hostBridgeEnv();

/** Resolve a raw or `@id` host path for another bridge module. */
bool resolveHostPathForBridge(const std::string& path, napi_value* receiver,
                              napi_value* target, std::string* error);

/** Keep a host value alive and return a temporary host module id (0 on failure). */
int retainHostValue(napi_value value);

/** Release an id returned by retainHostValue(). */
void releaseHostValue(int id);

/** Resolve an id returned by retainHostValue()/loadModule. */
bool getHostReferenceValue(int id, napi_value* out);

/** Retain a host function and its receiver; returns two temporary ref ids. */
bool retainHostFunction(const std::string& path, int* fnId, int* recvId, std::string* error);

/** Invoke a function retained by retainHostFunction with tagged arguments. */
bool invokeHostRef(int fnId, int recvId, const std::string& taggedArgs, bool isNew,
                   std::string* resultJson, std::string* error);

/** Read and clear the pending host NAPI exception. */
std::string takeHostException(const std::string& fallback);

/**
 * Tag a host value for the VM bridge:
 *   {"t":"v","v":<json>} primitive / plain JSON
 *   {"t":"r","id":N}     live object/function reference
 *   {"t":"p","id":N}     host Promise reference
 *   {"t":"b","bytes":[]} ArrayBuffer copy
 */
bool tagHostValue(napi_value value, std::string* out, std::string* error);

/** Decode a JSON array of tagged values into host NAPI arguments. */
bool decodeTaggedArguments(const std::string& taggedJson, std::vector<napi_value>* args,
                           std::string* error);

/** Decode one tagged value (the result of a patched/replacement call). */
bool decodeTaggedValue(const std::string& taggedJson, napi_value* out, std::string* error);

} // namespace xpanda

#endif // XPANDA_GADGET_NAPI_BRIDGE_H
