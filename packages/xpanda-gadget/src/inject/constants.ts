/**
 * Injection defaults shared by the abc/HAP paths.
 * @Author: jmp0
 */

/** Gadget NAPI library file name (nm_modname is the name without lib prefix / .so suffix). */
export const GADGET_SO_NAME = "libxpanda_gadget.so";
/** Default TCP port, an homage to frida-server's default. */
export const DEFAULT_GADGET_PORT = 27041;
/** Default init function name injected into the entry class's func_main_0. */
export const DEFAULT_INIT_NAME = "init";
