import "./styles/tailwind.css";

import { QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { createRouter, RouterProvider } from "@tanstack/react-router";
import React, { type ReactNode } from "react";
import ReactDOM from "react-dom/client";

import { ToastProvider } from "./components/ToastProvider";
import { queryClient } from "./lib/query";
import { api } from "./lib/tauri";
import { useTheme } from "./modules/settings";
import { routeTree } from "./routeTree.gen";

const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
// Reveal the window once the app has mounted. It starts hidden (visible:false), and
// the window/webview backgroundColor (#0c0d18) plus the dark shell in index.html
// mean it reveals as the dark loading screen, never a white flash. The backend
// keeps it hidden when the user starts in the tray.
//
// Deliberately a direct call, not requestAnimationFrame: while the window is
// hidden the WebView document is `hidden`, which pauses rAF, so a deferred reveal
// could deadlock and never show the window.
function showAppWindow() {
  void api.showMainWindow();
}

// Theme provider component that applies theme to document
function ThemeProvider({ children }: { children: ReactNode }) {
  useTheme();
  return <>{children}</>;
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <ToastProvider>
          <RouterProvider router={router} />
        </ToastProvider>
      </ThemeProvider>
      {import.meta.env.DEV && <ReactQueryDevtools initialIsOpen={false} />}
    </QueryClientProvider>
  </React.StrictMode>,
);

// Executes function to show window
showAppWindow();
