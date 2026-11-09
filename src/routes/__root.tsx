import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
  type ErrorComponentProps,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";
import { toast } from "sonner";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { Toaster } from "@/components/ui/sonner";
import { AccessBoundary } from "@/lib/access";
import { localStoragePersistentRequest, openLocalDatabase } from "@/lib/local-db";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: ErrorComponentProps) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This page didn't load
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong on our end. You can try refreshing or head back home.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "RetailHub POS" },
      {
        name: "description",
        content: "RetailHub POS — fast billing, inventory, cash drawer and manager tools.",
      },
      { name: "author", content: "RetailHub" },
      { property: "og:title", content: "RetailHub POS" },
      {
        property: "og:description",
        content: "RetailHub POS — fast billing, inventory, cash drawer and manager tools.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:site", content: "@Lovable" },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
      { rel: "icon", href: "/favicon.ico", type: "image/x-icon" },
      { rel: "manifest", href: "/manifest.webmanifest" },
      { name: "theme-color", content: "#176b55" },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,600;9..40,700&family=Space+Grotesk:wght@400;500;600;700&display=swap",
      },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  useEffect(() => {
    let cancelled = false;
    void openLocalDatabase().catch((error: unknown) => {
      console.error("RetailFlow local POS storage could not be opened", error);
      if (!cancelled) {
        toast.error("Local POS storage is unavailable", {
          description:
            "Some offline features may not work. Refresh the page or check device storage.",
        });
      }
    });
    void localStoragePersistentRequest().catch((error: unknown) => {
      console.warn("RetailFlow could not enable persistent local storage", error);
    });
    void import("@/lib/offline-sync")
      .then(({ startOfflineSync }) => {
        if (!cancelled) startOfflineSync();
      })
      .catch((error: unknown) => {
        console.error("RetailFlow offline sync could not start", error);
        if (!cancelled) {
          toast.error("Offline sync is unavailable", {
            description: "Saved work remains on this device. Refresh the page and try again.",
          });
        }
      });
    if ("serviceWorker" in navigator && import.meta.env.PROD) {
      void navigator.serviceWorker
        .register("/sw.js", { scope: "/" })
        .then(async () => {
          await navigator.serviceWorker.ready;
          await Promise.allSettled([
            import("./index"),
            import("./billing"),
            import("./sales"),
            import("./inventory"),
            import("./purchases"),
            import("./cash-drawer"),
            import("./manager"),
            // Load on-demand bundles online once so offline OCR and spreadsheets
            // remain usable after the service worker takes control.
            import("xlsx"),
            import("tesseract.js"),
            import("pdfjs-dist/legacy/build/pdf.mjs"),
          ]);
        })
        .catch((error) => {
          console.warn("RetailFlow offline app shell could not be registered", error);
        });
    }
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      {/* Required: nested routes render here. Removing <Outlet /> breaks all child routes. */}
      <AccessBoundary>
        <Outlet />
      </AccessBoundary>
      <Toaster position="top-center" richColors />
    </QueryClientProvider>
  );
}
