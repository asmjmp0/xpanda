/**
 * 顶部申明栏(中英文):
 *  - 反编译全部在浏览器本地完成,不向服务器传输任何信息;
 *  - 本项目仅供学习研究、禁止违法违规使用。
 * 始终可见,不可关闭;项目仓库入口只保留在顶栏。
 * @Author: jmp0
 */
export function NoticeBar() {
    return (
        <div className="noticebar" role="note">
            <span className="notice-icon" aria-hidden="true">⚠</span>
            <div className="notice-text">
                <p>
                    <strong className="notice-local">Runs entirely in your browser.</strong> All parsing and
                    decompilation happen locally — no file, code or other information is ever sent to a server.{" "}
                    <strong>For learning and research only.</strong>{" "}
                    <strong>Do not use xpanda for any illegal or unauthorized purpose.</strong> Decompiling
                    third-party software may infringe copyright, trade secrets or software licenses. Only process
                    files you own or are authorized to analyze.
                </p>
                <p className="notice-zh">
                    <strong className="notice-local">本反编译器完全在浏览器本地运行，不会向服务器传输任何文件、代码或其他信息。</strong>
                    <strong>本项目仅供学习研究，请勿用于任何违法违规场景。</strong>
                    请确保你拥有目标文件的合法权利或授权，使用本工具产生的一切风险与后果由使用者自行承担。
                </p>
            </div>
        </div>
    );
}
