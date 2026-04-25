import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import { NotificationProvider } from "./context/NotificationContext";
import "./index.css";
import "./i18n";
import "./tauri-bridge";
window.React = React;
(window as any).ReactDOM = ReactDOM;
ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <NotificationProvider>
      <App />
    </NotificationProvider>
  </React.StrictMode>,
);
