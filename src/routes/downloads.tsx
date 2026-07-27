import { createFileRoute } from "@tanstack/react-router";

import { Downloads } from "@/pages/Downloads";

export const Route = createFileRoute("/downloads")({
  component: Downloads,
});
