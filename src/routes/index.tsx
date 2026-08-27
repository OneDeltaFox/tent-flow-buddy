import { createFileRoute } from "@tanstack/react-router";
import { TentBoard } from "@/components/tent-board";

const title = "Race Medical Tent — Patient Flow & Bed Board";
const description =
  "Live command whiteboard for a race medical tent: incoming runners, every pod and bed at a glance, pod capabilities and staffing, and where patients went.";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title },
      { name: "description", content: description },
      { property: "og:title", content: title },
      { property: "og:description", content: description },
    ],
  }),
  component: Index,
});

function Index() {
  return <TentBoard />;
}
