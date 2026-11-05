/**
 * Shared hilog helpers for the gadget native modules.
 * @Author: jmp0
 */
#ifndef XPANDA_GADGET_LOG_H
#define XPANDA_GADGET_LOG_H

#if __has_include(<hilog/log.h>)
#include <hilog/log.h>
#define GADGET_LOG_INFO(...) \
    ((void)OH_LOG_Print(LOG_APP, LOG_INFO, 0x3201, "xpanda-gadget", __VA_ARGS__))
#define GADGET_LOG_ERROR(...) \
    ((void)OH_LOG_Print(LOG_APP, LOG_ERROR, 0x3201, "xpanda-gadget", __VA_ARGS__))
#else
#define GADGET_LOG_INFO(...) do {} while (0)
#define GADGET_LOG_ERROR(...) do {} while (0)
#endif

#endif // XPANDA_GADGET_LOG_H
