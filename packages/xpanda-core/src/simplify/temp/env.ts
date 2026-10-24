import * as TYPE from "@babel/types";
import { EnvEntry } from "./types";
import { exprReadsMember, memberPropertyKey } from "./queries";

/**
 * 复制传播环境的缓存。成员写入按“同对象.同属性”精确失效,
 * 变量写入按依赖关系级联失效。
 *
 * @Author: jmp0
 */
export class EnvState {
    readonly map = new Map<string, EnvEntry>();
    private readonly deps = new Map<string, Set<string>>();

    get(name: string): EnvEntry | undefined {
        return this.map.get(name);
    }

    /** 使缓存中读取了 `object.property` 这一成员路径的项失效。
     *  成员写入只改对象属性,不改变变量绑定,因此别名(如 `v8 = acc`)与
     *  模板对象(`acc = {...}`)不受影响,不能按基对象一刀切。 */
    invalidateMemberReads(object: TYPE.Expression, property: TYPE.Expression, computed: boolean): void {
        const key = memberPropertyKey(property, computed);
        const doomed: string[] = [];
        for (const [name, entry] of this.map) {
            if (exprReadsMember(entry.expr, object, key)) doomed.push(name);
        }
        for (const name of doomed) this.invalidate(name);
    }

    set(name: string, entry: EnvEntry): void {
        this.delete(name);
        this.map.set(name, entry);
        for (const dep of entry.deps) {
            let set = this.deps.get(dep);
            if (!set) {
                set = new Set();
                this.deps.set(dep, set);
            }
            set.add(name);
        }
    }

    delete(name: string): void {
        const entry = this.map.get(name);
        if (!entry) return;
        this.map.delete(name);
        for (const dep of entry.deps) {
            this.deps.get(dep)?.delete(name);
        }
    }

    /** 删除 name 及其所有(传递)依赖它的环境项 */
    invalidate(name: string): void {
        const queue: string[] = [name];
        const seen = new Set<string>();
        while (queue.length > 0) {
            const current = queue.shift()!;
            if (seen.has(current)) continue;
            seen.add(current);
            const holders = this.deps.get(current);
            this.delete(current);
            if (!holders) continue;
            for (const holder of holders) {
                if (this.map.has(holder)) {
                    queue.push(holder);
                }
            }
        }
    }

    copy(): EnvState {
        const copy = new EnvState();
        for (const [name, entry] of this.map) copy.map.set(name, entry);
        for (const [name, set] of this.deps) copy.deps.set(name, new Set(set));
        return copy;
    }
}
