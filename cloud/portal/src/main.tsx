import React from "react";
import ReactDOM from "react-dom/client";

const root = ReactDOM.createRoot(document.getElementById("root")!);
const path = window.location.pathname;
const table = path.match(/^\/m\/([^/]+)\/?$/);
const demo = path.match(/^\/pago-demo\/([^/]+)\/?$/);

if (table || demo) {
  import("./public/PublicApp").then(({ PublicApp }) =>
    root.render(
      <React.StrictMode>
        <PublicApp
          route={
            table
              ? { page: "table", token: decodeURIComponent(table[1]) }
              : { page: "demo", paymentId: decodeURIComponent(demo![1]) }
          }
        />
      </React.StrictMode>,
    ),
  );
} else {
  import("./App").then(({ default: App }) =>
    root.render(
      <React.StrictMode>
        <App />
      </React.StrictMode>,
    ),
  );
}
