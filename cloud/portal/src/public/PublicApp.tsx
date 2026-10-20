import { useEffect } from "react";
import { TablePage } from "./TablePage";
import { DemoCheckout } from "./DemoCheckout";
import "./public.css";

type Route = { page: "table"; token: string } | { page: "demo"; paymentId: string };

export function PublicApp({ route }: { route: Route }) {
  useEffect(() => {
    document.documentElement.lang = "es";
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", "#f6f3ee");
  }, []);

  return (
    <div className="customer">
      {route.page === "table" ? (
        <TablePage token={route.token} paymentId={new URLSearchParams(window.location.search).get("pago")} />
      ) : (
        <DemoCheckout paymentId={route.paymentId} />
      )}
    </div>
  );
}
