import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import { NotificationProvider } from "./context/NotificationContext";
import "./index.css";
import "./i18n";
import "./tauri-bridge";
import { ErrorBoundary } from "./App.jsx";

window.React = React;
(window as any).ReactDOM = ReactDOM;
ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <ErrorBoundary>
      <NotificationProvider>
        <App />
      </NotificationProvider>
    </ErrorBoundary>
  </React.StrictMode>,
);
