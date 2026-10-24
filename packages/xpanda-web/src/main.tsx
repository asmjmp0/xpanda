import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./index.css";

/**
 * xpanda web 入口:纯前端反编译界面,core 库以浏览器安全入口(xpanda-core/src/index.ts)引入。
 * @Author: jmp0
 */
const container = document.getElementById("root");
if (container === null) throw new Error("#root container not found");
createRoot(container).render(
    <React.StrictMode>
        <App />
    </React.StrictMode>,
);
