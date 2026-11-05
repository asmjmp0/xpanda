/**
 * argv parsing helpers shared by the CLI commands.
 * @Author: jmp0
 */
import { fail } from "./help";

/**
 * Read the value of `option` located at args[index].
 * Returns the value plus the index it consumed (the caller sets its loop index).
 */
export function takeValue(
    args: readonly string[],
    index: number,
    option: string,
    command?: string,
): { value: string; index: number } {
    const value = args[index + 1];
    if (value === undefined) fail(`option ${option} requires a value`, command);
    return { value, index: index + 1 };
}

/** Match the `--name=value` form; returns the value or null. */
export function matchLongOption(arg: string, name: string): string | null {
    const prefix = name + "=";
    return arg.startsWith(prefix) ? arg.substring(prefix.length) : null;
}
