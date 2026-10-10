import { createRoot } from "react-dom/client";
import { TentBoard } from "../src/components/tent-board";
import "../src/styles.css";

createRoot(document.getElementById("root")!).render(
  <>
    <aside className="border-b border-amber-400 bg-amber-100 px-4 py-2 text-center text-sm font-medium text-black">
      Demo: fictional patients only. Data stays in this browser and is not shared between devices.
    </aside>
    <TentBoard />
  </>,
);
